"""What the assistant remembers for a user, and the tasks it tracks.

* `AssistantMemory` - small, user-visible facts: preferences (briefing time,
  notification channel, demo mode), important senders, short notes, dismissed
  suggestions and a compact triage cache (priority/deadline per message - never
  the email body or summary). Every row can be seen, edited and deleted from
  Settings > AI memory.
* `AssistantTask` - something to do, usually extracted from an email ("send
  the document by Friday"), with an optional due date.
"""
from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JsonB, TimestampMixin, uuid_pk


class AssistantMemory(Base, TimestampMixin):
    __tablename__ = "assistant_memory"
    __table_args__ = (UniqueConstraint("user_id", "kind", "key", name="uq_memory_user_kind_key"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    #: preference | sender | note | dismissed | triage | state
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    key: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[dict] = mapped_column(JsonB, default=dict, nullable=False)


class AssistantTask(Base, TimestampMixin):
    __tablename__ = "assistant_tasks"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    notes: Mapped[str] = mapped_column(String(1000), default="", nullable=False)
    due_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: open | done
    status: Mapped[str] = mapped_column(String(16), default="open", nullable=False)
    #: where it came from: {"type": "email", "message_id": ..., "subject": ..., "from": ...}
    source: Mapped[dict] = mapped_column(JsonB, default=dict, nullable=False)
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
