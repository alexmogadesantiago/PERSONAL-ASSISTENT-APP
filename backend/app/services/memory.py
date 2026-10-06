"""The assistant's memory: small, visible, editable, never secret.

Kinds of entry (all in `assistant_memory`, one row each):

* ``preference`` - a closed set of settings with validated values (below);
* ``sender``     - an important sender (address + optional label);
* ``note``       - a short fact the user wants the assistant to know
                   ("my TDR tutor is Marta Puig");
* ``dismissed``  - a suggestion the user said "never" to;
* ``triage``     - the last priority/deadline computed for a message (never the
                   body or the AI summary), so filters and insights survive a
                   reload. Capped, oldest dropped first;
* ``state``      - internal bookkeeping (last automatic briefing, pending
                   Telegram confirmation). Shown in the privacy view, not edited.

Anything that looks like a credential is refused: memory is for preferences,
not a second, unencrypted vault.
"""
from __future__ import annotations

import datetime as dt
import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AssistantMemory

EDITABLE_KINDS = ("preference", "sender", "note", "dismissed")
TRIAGE_CAP = 300

#: key -> (default, validator description, validator)
PREFERENCES: dict[str, dict[str, Any]] = {
    "briefing_time": {"default": "08:00", "label": "Preferred briefing time",
                      "check": lambda v: isinstance(v, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v)},
    "briefing_auto": {"default": False, "label": "Send the daily briefing automatically",
                      "check": lambda v: isinstance(v, bool)},
    "notification_channel": {"default": "telegram", "label": "Preferred notification channel",
                             "check": lambda v: v in ("telegram", "web")},
    "email_summaries": {"default": True, "label": "AI email summaries",
                        "check": lambda v: isinstance(v, bool)},
    "proactive": {"default": True, "label": "Proactive insights",
                  "check": lambda v: isinstance(v, bool)},
    "language": {"default": "auto", "label": "Assistant language",
                 "check": lambda v: v in ("auto", "es", "ca", "en")},
    "demo_mode": {"default": False, "label": "Demo mode (sample data)",
                  "check": lambda v: isinstance(v, bool)},
}

_SECRETISH = re.compile(
    r"(passw|contrase|token|secret|api[_ -]?key|bearer\s|\b\d{6,}:[\w-]{30,}\b|ya29\.|sk-[\w-]{10,}|"
    r"AIza[\w-]{20,}|nvapi-|\b(?:\d[ -]?){13,19}\b|-----BEGIN)", re.I)


class MemoryStoreError(Exception):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _rows(db: Session, user_id: uuid.UUID, kind: str | None = None) -> list[AssistantMemory]:
    q = select(AssistantMemory).where(AssistantMemory.user_id == user_id)
    if kind:
        q = q.where(AssistantMemory.kind == kind)
    return list(db.scalars(q.order_by(AssistantMemory.created_at)).all())


def _get(db: Session, user_id: uuid.UUID, kind: str, key: str) -> AssistantMemory | None:
    return db.scalar(select(AssistantMemory).where(AssistantMemory.user_id == user_id,
                                                   AssistantMemory.kind == kind, AssistantMemory.key == key))


def _put(db: Session, user_id: uuid.UUID, kind: str, key: str, value: dict) -> AssistantMemory:
    row = _get(db, user_id, kind, key)
    if row is None:
        row = AssistantMemory(user_id=user_id, kind=kind, key=key[:200], value=value)
        db.add(row)
    else:
        row.value = value
        row.updated_at = _now()
    db.commit()
    db.refresh(row)
    return row


def _guard(text: str) -> str:
    text = (text or "").strip()
    if _SECRETISH.search(text):
        raise MemoryStoreError("That looks like a password, token or card number. Memory never stores secrets - "
                          "use Integrations for credentials.")
    return text


# ------------------------------------------------------------ preferences --

def preferences(db: Session, user_id: uuid.UUID) -> dict[str, Any]:
    out = {k: spec["default"] for k, spec in PREFERENCES.items()}
    for row in _rows(db, user_id, "preference"):
        if row.key in PREFERENCES:
            out[row.key] = (row.value or {}).get("v", out[row.key])
    return out


def set_preference(db: Session, user_id: uuid.UUID, key: str, value: Any) -> dict[str, Any]:
    spec = PREFERENCES.get(key)
    if spec is None:
        raise MemoryStoreError(f"Unknown preference «{key[:40]}».")
    if not spec["check"](value):
        raise MemoryStoreError(f"Invalid value for «{spec['label']}».")
    _put(db, user_id, "preference", key, {"v": value})
    return preferences(db, user_id)


def demo_enabled(db: Session, user_id: uuid.UUID) -> bool:
    row = _get(db, user_id, "preference", "demo_mode")
    return bool(row and (row.value or {}).get("v"))


# ---------------------------------------------------------------- senders --

_ADDR = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def address_of(sender: str) -> str:
    m = re.search(r"<([^>]+)>", sender or "") or _ADDR.search(sender or "")
    return (m.group(1) if m and m.re.groups else m.group(0) if m else (sender or "")).strip().lower()


def important_senders(db: Session, user_id: uuid.UUID) -> dict[str, str]:
    return {r.key: (r.value or {}).get("label", "") for r in _rows(db, user_id, "sender")}


def add_sender(db: Session, user_id: uuid.UUID, address: str, label: str = "") -> AssistantMemory:
    addr = address_of(address)
    if not _ADDR.fullmatch(addr) and not re.fullmatch(r"@?[\w-]+(?:\.[\w-]+)+", addr):
        raise MemoryStoreError("Use an email address (ana@school.edu) or a domain (@school.edu).")
    return _put(db, user_id, "sender", addr, {"label": _guard(label)[:80]})


# ------------------------------------------------------------------ notes --

def add_note(db: Session, user_id: uuid.UUID, text: str) -> AssistantMemory:
    text = _guard(text)
    if not text:
        raise MemoryStoreError("A note cannot be empty.")
    return _put(db, user_id, "note", uuid.uuid4().hex, {"text": text[:300]})


def notes(db: Session, user_id: uuid.UUID) -> list[str]:
    return [(r.value or {}).get("text", "") for r in _rows(db, user_id, "note")]


# -------------------------------------------------------------- dismissed --

def dismiss(db: Session, user_id: uuid.UUID, suggestion_id: str) -> None:
    _put(db, user_id, "dismissed", suggestion_id[:200], {"at": _now().isoformat()})


def dismissed(db: Session, user_id: uuid.UUID) -> set[str]:
    return {r.key for r in _rows(db, user_id, "dismissed")}


# ----------------------------------------------------------------- triage --

def remember_triage(db: Session, user_id: uuid.UUID, message_id: str, value: dict) -> None:
    keep = {k: value.get(k) for k in ("level", "score", "category", "action_required", "deadline", "from", "subject")}
    keep["subject"] = str(keep.get("subject") or "")[:120]
    keep["at"] = _now().isoformat()
    _put(db, user_id, "triage", message_id, keep)
    rows = _rows(db, user_id, "triage")
    if len(rows) > TRIAGE_CAP:
        for old in sorted(rows, key=lambda r: r.updated_at)[: len(rows) - TRIAGE_CAP]:
            db.delete(old)
        db.commit()


def triage(db: Session, user_id: uuid.UUID) -> dict[str, dict]:
    return {r.key: r.value or {} for r in _rows(db, user_id, "triage")}


# ------------------------------------------------------------------ state --

def get_state(db: Session, user_id: uuid.UUID, key: str) -> dict:
    row = _get(db, user_id, "state", key)
    return dict(row.value or {}) if row else {}


def set_state(db: Session, user_id: uuid.UUID, key: str, value: dict) -> None:
    _put(db, user_id, "state", key, value)


def clear_state(db: Session, user_id: uuid.UUID, key: str) -> None:
    row = _get(db, user_id, "state", key)
    if row is not None:
        db.delete(row)
        db.commit()


# ------------------------------------------------------------- the panel --

def _view(row: AssistantMemory) -> dict:
    v = row.value or {}
    if row.kind == "preference":
        spec = PREFERENCES.get(row.key, {})
        label, value = spec.get("label", row.key), v.get("v")
    elif row.kind == "sender":
        label, value = row.key, v.get("label", "")
    elif row.kind == "note":
        label, value = "Note", v.get("text", "")
    else:
        label, value = row.key, v.get("at", "")
    return {"id": str(row.id), "kind": row.kind, "key": row.key, "label": label, "value": value,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None}


def overview(db: Session, user_id: uuid.UUID) -> dict:
    rows = [r for r in _rows(db, user_id) if r.kind in EDITABLE_KINDS]
    return {
        "preferences": preferences(db, user_id),
        "preference_labels": {k: s["label"] for k, s in PREFERENCES.items()},
        "items": [_view(r) for r in rows if r.kind != "preference"],
        "counts": {k: sum(1 for r in _rows(db, user_id, k)) for k in ("sender", "note", "dismissed", "triage", "state")},
    }


def update_item(db: Session, user_id: uuid.UUID, item_id: uuid.UUID, value: str) -> dict:
    row = db.get(AssistantMemory, item_id)
    if row is None or row.user_id != user_id or row.kind not in ("sender", "note"):
        raise MemoryStoreError("Memory item not found.", 404)
    if row.kind == "note":
        text = _guard(value)
        if not text:
            raise MemoryStoreError("A note cannot be empty.")
        row.value = {"text": text[:300]}
    else:
        row.value = {"label": _guard(value)[:80]}
    row.updated_at = _now()
    db.commit()
    return _view(row)


def delete_item(db: Session, user_id: uuid.UUID, item_id: uuid.UUID) -> None:
    row = db.get(AssistantMemory, item_id)
    if row is None or row.user_id != user_id or row.kind not in EDITABLE_KINDS:
        raise MemoryStoreError("Memory item not found.", 404)
    db.delete(row)
    db.commit()


def forget_all(db: Session, user_id: uuid.UUID, kind: str) -> int:
    if kind not in ("sender", "note", "dismissed", "triage"):
        raise MemoryStoreError("This part of memory cannot be cleared from here.")
    rows = _rows(db, user_id, kind)
    for r in rows:
        db.delete(r)
    db.commit()
    return len(rows)
