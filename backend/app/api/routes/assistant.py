"""The assistant's skills: mail, briefing, insights, ask, tasks, memory, trust.

Message ids are validated before they reach a Gmail URL. Sending and changing
mail are separate POSTs the UI only calls after the user confirms.
"""
from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.models import User
from app.services import assistant, demo, memory, tasks, trust
from app.services.integrations import connections as conns

router = APIRouter(prefix="/assistant", tags=["assistant"])

MessageId = Path(pattern=r"^[A-Za-z0-9_-]{1,64}$")


def _err(exc: assistant.AssistantError):
    raise HTTPException(exc.status_code, detail={"message": exc.message, "provider": exc.provider})


def _plain(exc: Exception):
    raise HTTPException(getattr(exc, "status_code", 422), detail={"message": getattr(exc, "message", str(exc))})


# ------------------------------------------------------------------ mail ----

@router.get("/mail")
async def mail(q: str = Query(default="in:inbox", max_length=300), limit: int = Query(default=15, ge=1, le=25),
               user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return {"data": await assistant.list_mail(db, user.id, q, limit), "demo": assistant.is_demo(db, user.id)}
    except assistant.AssistantError as exc:
        _err(exc)


@router.get("/mail/{message_id}")
async def read(message_id: str = MessageId, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return await assistant.read_mail(db, user.id, message_id)
    except assistant.AssistantError as exc:
        _err(exc)


@router.post("/mail/{message_id}/analyze")
async def analyze(message_id: str = MessageId, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return await assistant.analyze_mail(db, user.id, message_id)
    except assistant.AssistantError as exc:
        _err(exc)


class DraftIn(BaseModel):
    instruction: str = Field(default="", max_length=500)
    tone: Literal["default", "formal", "professional", "informal", "concise", "brief", "detailed"] = "default"


@router.post("/mail/{message_id}/draft")
async def draft(body: DraftIn, message_id: str = MessageId, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    try:
        return await assistant.draft_reply(db, user.id, message_id, body.instruction, body.tone)
    except assistant.AssistantError as exc:
        _err(exc)


class SendIn(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


@router.post("/mail/{message_id}/reply")
async def reply(body: SendIn, message_id: str = MessageId, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    try:
        return await assistant.send_reply(db, user.id, message_id, body.body)
    except assistant.AssistantError as exc:
        _err(exc)


class ModifyIn(BaseModel):
    action: Literal["archive", "important", "not_important", "read"]


@router.post("/mail/{message_id}/modify")
async def modify(body: ModifyIn, message_id: str = MessageId, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    try:
        return await assistant.modify_mail(db, user.id, message_id, body.action)
    except assistant.AssistantError as exc:
        _err(exc)


# ------------------------------------------------- briefing / insights / ask --

@router.post("/briefing")
async def briefing(summary: bool = Query(default=True), user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    """`summary=false` skips the AI call: the dashboard's "Today" numbers load instantly and for free."""
    try:
        return await assistant.briefing(db, user.id, with_summary=summary)
    except assistant.AssistantError as exc:
        _err(exc)


@router.post("/briefing/telegram")
async def briefing_to_telegram(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Send the briefing to the user's own linked Telegram chat."""
    from app.services.integrations import telegram as itelegram

    if assistant.is_demo(db, user.id):
        return {"sent": False, "demo": True, "message": "Demo mode: nothing was sent."}
    row = conns.get(db, user.id, "telegram")
    if row is None or not ((row.meta or {}).get("chat") or {}).get("id"):
        raise HTTPException(409, detail={"message": "Connect Telegram and link your chat first.", "provider": "telegram"})
    try:
        text = assistant.briefing_text(await assistant.briefing(db, user.id))
        await itelegram.send(db, row, text)
    except assistant.AssistantError as exc:
        _err(exc)
    except itelegram.TelegramError as exc:
        raise HTTPException(409 if exc.status_code < 500 else 502, detail={"message": exc.message, "provider": "telegram"})
    return {"sent": True}


@router.get("/insights")
async def insights(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"data": await assistant.insights(db, user)}


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


@router.post("/ask")
async def ask(body: AskIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return await assistant.ask(db, user, body.question)
    except assistant.AssistantError as exc:
        _err(exc)


@router.get("/suggestions")
async def suggestions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"data": await assistant.suggestions(db, user.id)}


class DismissIn(BaseModel):
    id: str = Field(min_length=1, max_length=200)


@router.post("/suggestions/dismiss", status_code=204)
def dismiss(body: DismissIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    memory.dismiss(db, user.id, body.id)


# ----------------------------------------------------------------- tasks ----

class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    due: str | None = Field(default=None, max_length=40)
    notes: str = Field(default="", max_length=1000)
    source: dict[str, Any] = Field(default_factory=dict)


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    due: str | None = Field(default=None, max_length=40)
    clear_due: bool = False
    notes: str | None = Field(default=None, max_length=1000)
    status: Literal["open", "done"] | None = None


@router.get("/tasks")
def list_tasks(status: Literal["open", "done", "all"] = "open", user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    return {"data": tasks.list_for(db, user.id, status)}


@router.post("/tasks", status_code=201)
def create_task(body: TaskIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return tasks.create(db, user.id, body.title, body.due, body.notes, body.source)
    except tasks.TaskError as exc:
        _plain(exc)


@router.patch("/tasks/{task_id}")
def update_task(task_id: uuid.UUID, body: TaskPatch, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    try:
        return tasks.update(db, user.id, task_id, title=body.title, due=body.due, status=body.status,
                            notes=body.notes, clear_due=body.clear_due)
    except tasks.TaskError as exc:
        _plain(exc)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        tasks.delete(db, user.id, task_id)
    except tasks.TaskError as exc:
        _plain(exc)


# ---------------------------------------------------------------- memory ----

@router.get("/memory")
def get_memory(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return memory.overview(db, user.id)


class PrefIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    value: Any = None


@router.put("/memory/preferences")
def set_pref(body: PrefIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return {"preferences": memory.set_preference(db, user.id, body.key, body.value)}
    except memory.MemoryStoreError as exc:
        _plain(exc)


class MemoryItemIn(BaseModel):
    kind: Literal["sender", "note"]
    value: str = Field(min_length=1, max_length=300)
    label: str = Field(default="", max_length=80)


@router.post("/memory", status_code=201)
def add_memory(body: MemoryItemIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        if body.kind == "sender":
            memory.add_sender(db, user.id, body.value, body.label)
        else:
            memory.add_note(db, user.id, body.value)
    except memory.MemoryStoreError as exc:
        _plain(exc)
    return memory.overview(db, user.id)


class MemoryPatch(BaseModel):
    value: str = Field(max_length=300)


@router.patch("/memory/{item_id}")
def edit_memory(item_id: uuid.UUID, body: MemoryPatch, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    try:
        return memory.update_item(db, user.id, item_id, body.value)
    except memory.MemoryStoreError as exc:
        _plain(exc)


@router.delete("/memory/{item_id}", status_code=204)
def delete_memory(item_id: uuid.UUID, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        memory.delete_item(db, user.id, item_id)
    except memory.MemoryStoreError as exc:
        _plain(exc)


@router.delete("/memory")
def forget(kind: str = Query(max_length=16), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return {"deleted": memory.forget_all(db, user.id, kind)}
    except memory.MemoryStoreError as exc:
        _plain(exc)


# ----------------------------------------------------------------- trust ----

@router.get("/privacy")
def privacy(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return trust.privacy(db, user)


@router.get("/security")
async def security(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return await trust.security(db, user)


@router.get("/health")
async def system_health(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return await trust.system_health(db, user)


# ------------------------------------------------------------------ demo ----

@router.get("/demo/showcase")
def showcase(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """The presentation view's data. Always sample data, whatever the mode."""
    return {"demo": True, "automations": demo.automations(), "executions": demo.executions(),
            "errors": demo.errors(), "events": demo.events(), "deadlines": demo.deadlines(),
            "emails": [{k: m[k] for k in ("id", "from", "subject", "snippet", "date")} for m in demo.mail()],
            "enabled": memory.demo_enabled(db, user.id)}
