"""Tasks: what the user has to do, usually extracted from an email."""
from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AssistantTask


class TaskError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _parse_due(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    text = str(value).strip()
    try:
        if len(text) <= 10:
            # a date with no time means "during that day": due at its end, never at 00:00,
            # otherwise a task due today would read as overdue from the first minute
            d = dt.datetime.combine(dt.date.fromisoformat(text), dt.time(23, 59))
        else:
            d = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise TaskError(f"«{text[:40]}» is not a date (use 2026-10-09 or 2026-10-09T17:00).")
    return d if d.tzinfo else d.replace(tzinfo=dt.datetime.now().astimezone().tzinfo)


def view(t: AssistantTask) -> dict:
    now = dt.datetime.now(dt.timezone.utc)
    due = t.due_at if (t.due_at is None or t.due_at.tzinfo) else t.due_at.replace(tzinfo=dt.timezone.utc)
    return {
        "id": str(t.id), "title": t.title, "notes": t.notes, "status": t.status,
        "due_at": due.isoformat() if due else None,
        "overdue": bool(due and t.status == "open" and due < now),
        "due_soon": bool(due and t.status == "open" and now <= due <= now + dt.timedelta(days=3)),
        "source": t.source or {},
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
    }


def list_for(db: Session, user_id: uuid.UUID, status: str = "open") -> list[dict]:
    q = select(AssistantTask).where(AssistantTask.user_id == user_id)
    if status in ("open", "done"):
        q = q.where(AssistantTask.status == status)
    rows = list(db.scalars(q).all())
    far = dt.datetime.max.replace(tzinfo=dt.timezone.utc)
    rows.sort(key=lambda t: (t.status != "open",
                             (t.due_at if t.due_at is None or t.due_at.tzinfo else t.due_at.replace(tzinfo=dt.timezone.utc)) or far))
    return [view(t) for t in rows]


def create(db: Session, user_id: uuid.UUID, title: str, due: str | None = None, notes: str = "",
           source: dict | None = None) -> dict:
    title = (title or "").strip()
    if not title:
        raise TaskError("A task needs a title.")
    src = {k: str(v)[:200] for k, v in (source or {}).items() if k in ("type", "message_id", "subject", "from", "href")}
    if src.get("message_id"):
        dup = db.scalar(select(AssistantTask).where(AssistantTask.user_id == user_id, AssistantTask.title == title[:300],
                                                    AssistantTask.status == "open"))
        if dup is not None:
            return view(dup)  # idempotent: the same email action twice makes one task
    t = AssistantTask(user_id=user_id, title=title[:300], notes=(notes or "")[:1000], due_at=_parse_due(due), source=src)
    db.add(t)
    db.commit()
    db.refresh(t)
    return view(t)


def _owned(db: Session, user_id: uuid.UUID, task_id: uuid.UUID) -> AssistantTask:
    t = db.get(AssistantTask, task_id)
    if t is None or t.user_id != user_id:
        raise TaskError("Task not found.", 404)
    return t


def update(db: Session, user_id: uuid.UUID, task_id: uuid.UUID, *, title: str | None = None,
           due: str | None = None, status: str | None = None, notes: str | None = None, clear_due: bool = False) -> dict:
    t = _owned(db, user_id, task_id)
    if title is not None:
        if not title.strip():
            raise TaskError("A task needs a title.")
        t.title = title.strip()[:300]
    if notes is not None:
        t.notes = notes[:1000]
    if clear_due:
        t.due_at = None
    elif due is not None:
        t.due_at = _parse_due(due)
    if status is not None:
        if status not in ("open", "done"):
            raise TaskError("Status must be open or done.")
        t.status = status
        t.completed_at = dt.datetime.now(dt.timezone.utc) if status == "done" else None
    db.commit()
    db.refresh(t)
    return view(t)


def delete(db: Session, user_id: uuid.UUID, task_id: uuid.UUID) -> None:
    db.delete(_owned(db, user_id, task_id))
    db.commit()
