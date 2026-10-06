"""Automations built in the panel.

    GET    /api/automations/catalog            blocks the builder offers
    GET    /api/automations/templates          curated starting points
    POST   /api/automations/draft              {prompt} -> AI draft (validated, not saved)
    POST   /api/automations/test               {spec}   -> run it now, step by step
    GET    /api/automations                    mine
    POST   /api/automations                    create (+ deploy to n8n)
    GET    /api/automations/{id}
    PUT    /api/automations/{id}               save (+ redeploy)
    DELETE /api/automations/{id}
    POST   /api/automations/{id}/activate | pause | duplicate | run | redeploy
    GET    /api/automations/{id}/runs          history (from n8n)
    GET    /api/automations/{id}/runs/{exec}   one run, per step
    POST   /api/automations/{id}/run/{step}    n8n -> backend (service token)
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.models import User
from app.services.ai import token as ai_token
from app.services.automations import actions, catalog, drafting, manager

router = APIRouter(prefix="/automations", tags=["automations"])


def _guard_err(exc: manager.AutomationError):
    detail: Any = exc.message if not exc.problems else {"message": exc.message, "problems": exc.problems}
    raise HTTPException(exc.status_code, detail=detail)


@router.get("/catalog")
def get_catalog(_: User = Depends(get_current_user)):
    return {"data": catalog.as_list()}


@router.get("/templates")
def get_templates(_: User = Depends(get_current_user)):
    return {"data": drafting.templates()}


class DraftIn(BaseModel):
    prompt: str = Field(min_length=3, max_length=1500)


@router.post("/draft")
async def draft(body: DraftIn, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return await drafting.draft(db, body.prompt)


class SpecBody(BaseModel):
    spec: dict
    origin: str = Field(default="builder", pattern="^(builder|ai|template)$")


@router.post("/test")
async def test_run(body: SpecBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return await manager.test_run(db, user.id, body.spec)
    except manager.AutomationError as exc:
        _guard_err(exc)


@router.get("")
def list_mine(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"data": [manager.view(r) for r in manager.list_mine(db, user.id)]}


@router.post("", status_code=201)
async def create(body: SpecBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return manager.view(await manager.create(db, user.id, body.spec, origin=body.origin))
    except manager.AutomationError as exc:
        _guard_err(exc)


@router.get("/{automation_id}")
def get_one(automation_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return manager.view(manager._owned(db, user.id, automation_id))
    except manager.AutomationError as exc:
        _guard_err(exc)


@router.put("/{automation_id}")
async def update(automation_id: uuid.UUID, body: SpecBody, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    try:
        return manager.view(await manager.update(db, user.id, automation_id, body.spec))
    except manager.AutomationError as exc:
        _guard_err(exc)


@router.delete("/{automation_id}")
async def delete(automation_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        await manager.delete(db, user.id, automation_id)
    except manager.AutomationError as exc:
        _guard_err(exc)
    return {"deleted": True}


@router.post("/{automation_id}/{verb}")
async def act(automation_id: uuid.UUID, verb: str, user: User = Depends(get_current_user),
              db: Session = Depends(get_db)):
    try:
        if verb == "activate":
            return manager.view(await manager.set_active(db, user.id, automation_id, True))
        if verb == "pause":
            return manager.view(await manager.set_active(db, user.id, automation_id, False))
        if verb == "duplicate":
            return manager.view(await manager.duplicate(db, user.id, automation_id))
        if verb == "redeploy":
            return manager.view(await manager.redeploy(db, user.id, automation_id))
        if verb == "run":
            return await manager.run_now(db, user.id, automation_id)
    except manager.AutomationError as exc:
        _guard_err(exc)
    raise HTTPException(404, detail=f"unknown action '{verb}'")


@router.get("/{automation_id}/runs")
async def runs(automation_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return {"data": await manager.runs(db, user.id, automation_id)}
    except manager.AutomationError as exc:
        _guard_err(exc)


@router.get("/{automation_id}/runs/{execution_id}")
async def run_detail(automation_id: uuid.UUID, execution_id: str, user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    try:
        return await manager.run_detail(db, user.id, automation_id, execution_id)
    except manager.AutomationError as exc:
        _guard_err(exc)


class StepIn(BaseModel):
    input: dict = Field(default_factory=dict)


@router.post("/{automation_id}/run/{step_id}")
async def run_step(automation_id: uuid.UUID, step_id: str, body: StepIn, db: Session = Depends(get_db),
                   x_ac_service_token: str | None = Header(default=None, alias="X-AC-Service-Token")):
    presented = (x_ac_service_token or "").strip()
    if not presented or not ai_token.verify(db, presented):
        raise HTTPException(401, detail="X-AC-Service-Token required")
    try:
        return await manager.run_step(db, automation_id, step_id, body.input)
    except manager.AutomationError as exc:
        _guard_err(exc)
    except actions.ActionError as exc:
        raise HTTPException(exc.status_code, detail=exc.as_dict())
