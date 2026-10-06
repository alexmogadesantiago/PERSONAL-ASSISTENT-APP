"""assistant_memory + assistant_tasks: what the assistant remembers and tracks

Purely additive: two new tables, nothing existing is altered or dropped.

Revision ID: 0005_assistant_memory_tasks
Revises: 0004_service_configs
Create Date: 2026-10-06
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0005_assistant_memory_tasks"
down_revision: str | None = "0004_service_configs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_JSON = sa.JSON().with_variant(JSONB(), "postgresql")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "assistant_memory",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("key", sa.String(length=200), nullable=False),
        sa.Column("value", _JSON, nullable=False, server_default="{}"),
        *_timestamps(),
        sa.UniqueConstraint("user_id", "kind", "key", name="uq_memory_user_kind_key"),
    )
    op.create_index("ix_assistant_memory_user_id", "assistant_memory", ["user_id"])
    op.create_table(
        "assistant_tasks",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("notes", sa.String(length=1000), nullable=False, server_default=""),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="open"),
        sa.Column("source", _JSON, nullable=False, server_default="{}"),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
    )
    op.create_index("ix_assistant_tasks_user_id", "assistant_tasks", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_assistant_tasks_user_id", table_name="assistant_tasks")
    op.drop_table("assistant_tasks")
    op.drop_index("ix_assistant_memory_user_id", table_name="assistant_memory")
    op.drop_table("assistant_memory")
