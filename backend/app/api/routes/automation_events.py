"""Failure reports from the n8n automations.

n8n's Error workflow (`workflows/00-error-handler.json`) posts here whenever
any automation fails, so a broken run shows up in the panel's activity trail
and logs - not only in n8n's execution list, which the user rarely opens.

Authentication is the installation's service token (the same one the
workflows already present to `/api/ai/generate`). A user bearer token is not
accepted: this is a machine-to-machine report, not something a person files.
Nothing in the payload is trusted beyond its declared shape - every field is
length-capped and stored as plain text.
"""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import EventSeverity
from app.services import audit
from app.services.ai import token as ai_token

router = APIRouter(prefix="/automations", tags=["automations"])
log = logging.getLogger("automations")


class AutomationEventIn(BaseModel):
    workflow_id: str = Field(default="", max_length=64)
    workflow_name: str = Field(default="", max_length=200)
    execution_id: str = Field(default="", max_length=64)
    execution_url: str = Field(default="", max_length=500)
    node: str = Field(default="", max_length=200)
    mode: str = Field(default="", max_length=32)
    message: str = Field(min_length=1, max_length=2000)
    severity: Literal["warning", "error"] = "error"


class AutomationEventOut(BaseModel):
    recorded: bool
    event_id: str


@router.post("/events", response_model=AutomationEventOut, status_code=201)
def report_event(
    request: Request,
    body: AutomationEventIn,
    db: Session = Depends(get_db),
    x_ac_service_token: str | None = Header(default=None, alias="X-AC-Service-Token"),
) -> AutomationEventOut:
    presented = (x_ac_service_token or "").strip()
    if not presented or not ai_token.verify(db, presented):
        raise HTTPException(status_code=401, detail="X-AC-Service-Token required")

    name = body.workflow_name or body.workflow_id or "automation"
    where = f" at «{body.node}»" if body.node else ""
    severity = EventSeverity.error if body.severity == "error" else EventSeverity.warning
    event = audit.record(
        db,
        type="automation.failure" if body.severity == "error" else "automation.warning",
        message=f"{name} failed{where}: {body.message}",
        severity=severity,
        correlation_id=getattr(request.state, "correlation_id", None),
        meta={
            "workflow_id": body.workflow_id,
            "workflow_name": body.workflow_name,
            "execution_id": body.execution_id,
            "execution_url": body.execution_url,
            "node": body.node,
            "mode": body.mode,
        },
    )
    log.log(
        logging.ERROR if severity == EventSeverity.error else logging.WARNING,
        "automation %s failed%s (execution %s)",
        name,
        where,
        body.execution_id or "?",
        extra={"operation": "automation.failure", "workflow_id": body.workflow_id},
    )
    return AutomationEventOut(recorded=True, event_id=str(event.id))


# ------------------------------------------------------------ notify relay --

class NotifyIn(BaseModel):
    text: str = Field(min_length=1, max_length=4096)
    parse_mode: Literal["HTML", ""] = "HTML"
    source: str = Field(default="", max_length=200)
    profile_id: str = Field(default="", max_length=64)


def _recipient(db: Session, profile_id: str):
    """Whose Telegram receives a system-assistant message: the profile's owner,
    otherwise the first administrator with a linked chat."""
    import uuid as _uuid

    from sqlalchemy import select

    from app.models import Credential, Profile, User, UserRole

    def linked(user_id):
        row = db.scalar(select(Credential).where(Credential.user_id == user_id, Credential.provider == "telegram"))
        ok = row is not None and (row.meta or {}).get("integration") and ((row.meta or {}).get("chat") or {}).get("id")
        return row if ok else None

    try:
        profile = db.get(Profile, _uuid.UUID(profile_id)) if profile_id else None
    except ValueError:
        profile = None
    if profile is not None and (row := linked(profile.user_id)) is not None:
        return row
    for user in db.scalars(select(User).where(User.role == UserRole.admin).order_by(User.created_at)).all():
        if (row := linked(user.id)) is not None:
            return row
    return None


@router.post("/notify")
async def notify(
    body: NotifyIn,
    db: Session = Depends(get_db),
    x_ac_service_token: str | None = Header(default=None, alias="X-AC-Service-Token"),
) -> dict:
    """Send a message from an n8n assistant through the Hub's Telegram connection.

    Lets the built-in assistants work without bot tokens in the launcher: when
    their own token is not set they post here, and the message goes out through
    the bot the user connected in Integrations (encrypted, single source).
    """
    from app.services.integrations import telegram as itelegram

    presented = (x_ac_service_token or "").strip()
    if not presented or not ai_token.verify(db, presented):
        raise HTTPException(status_code=401, detail="X-AC-Service-Token required")
    row = _recipient(db, body.profile_id)
    if row is None:
        raise HTTPException(status_code=409, detail=(
            "Telegram is not connected: connect it in Integrations > Telegram, "
            "or set the assistant's bot token in the launcher settings"))
    try:
        sent = await itelegram.send(db, row, body.text, parse_mode=body.parse_mode or None)
    except itelegram.TelegramError as exc:
        raise HTTPException(status_code=502 if exc.status_code >= 500 else 409, detail=f"Telegram: {exc.message}")
    log.info("assistant message relayed via the Hub (%s)", body.source or "n8n",
             extra={"operation": "automation.notify"})
    return {"sent": True, "message_id": sent.get("message_id"), "via": "hub"}
