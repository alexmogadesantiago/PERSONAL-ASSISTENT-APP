"""Connections: one per user and provider, stored as a `credentials` row.

Reusing the credential vault means a connection inherits everything the vault
already guarantees - Fernet encryption at rest, the secret never leaving the
backend, owner scoping, the audit trail - instead of growing a second secret
store. What makes a credential a *connection* is `meta.integration = true`.

`encrypted_data` holds the tokens:
  oauth2   -> {access_token, refresh_token, expires_at, token_type}
  telegram -> {bot_token}
`meta` holds everything safe to show: account, granted scopes, services,
health, timestamps, and for Telegram the bot and the linked chat.
"""
from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core import crypto
from app.models import Credential, CredentialStatus, CredentialType, EventSeverity
from app.services import audit
from app.services.integrations.providers import Provider

#: Health vocabulary shared with the frontend.
HEALTHY = "healthy"
DEGRADED = "degraded"
EXPIRED = "expired"
AUTH_REQUIRED = "auth_required"
ERROR = "error"
NOT_CONNECTED = "not_connected"
PENDING = "pending"  # Telegram: bot saved, chat not linked yet

HEALTH_STATES = (HEALTHY, DEGRADED, EXPIRED, AUTH_REQUIRED, ERROR, NOT_CONNECTED, PENDING)


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(value: dt.datetime | None) -> str | None:
    return value.isoformat() if value else None


def get(db: Session, user_id: uuid.UUID, provider: str) -> Credential | None:
    rows = db.scalars(
        select(Credential).where(Credential.user_id == user_id, Credential.provider == provider)
    ).all()
    for row in rows:
        if (row.meta or {}).get("integration"):
            return row
    return None


def list_for(db: Session, user_id: uuid.UUID) -> dict[str, Credential]:
    rows = db.scalars(select(Credential).where(Credential.user_id == user_id)).all()
    return {r.provider: r for r in rows if (r.meta or {}).get("integration")}


def secret_of(row: Credential) -> dict:
    return crypto.decrypt_secret(row.encrypted_data)


def _hint(secret: dict) -> str:
    material = str(secret.get("access_token") or secret.get("bot_token") or "")
    return "…" + material[-4:] if len(material) > 4 else ""


def save(
    db: Session,
    user_id: uuid.UUID,
    provider: Provider,
    *,
    secret: dict,
    meta: dict,
    health: str = HEALTHY,
    correlation_id: str | None = None,
) -> Credential:
    """Create or replace the user's connection to `provider`."""
    if not crypto.is_configured():
        raise RuntimeError("AC_CREDENTIAL_ENCRYPTION_KEY is not set")
    row = get(db, user_id, provider.key)
    created = row is None
    if row is None:
        # The vault's name is unique per user; a user who once stored a manual
        # credential called "Google Workspace" must not block connecting.
        name = provider.label
        clash = db.scalar(
            select(Credential).where(Credential.user_id == user_id, Credential.name == name)
        )
        if clash is not None:
            name = f"{provider.label} (connection)"
        row = Credential(
            user_id=user_id,
            provider=provider.key,
            name=name,
            type=CredentialType.oauth2 if provider.auth == "oauth2" else CredentialType.bearer,
            encrypted_data=b"",
            meta={},
        )
        db.add(row)
    previous = dict(row.meta or {})
    merged = {**previous, **meta, "integration": True}
    merged.setdefault("connected_at", iso(now()))
    merged["health"] = health
    merged["updated_at"] = iso(now())
    row.meta = merged
    flag_modified(row, "meta")
    row.encrypted_data = crypto.encrypt_secret(secret)
    row.hint = _hint(secret)
    row.is_enabled = True
    row.status = CredentialStatus.connected if health == HEALTHY else CredentialStatus.untested
    db.flush()
    audit.record(
        db,
        type="integration.connect" if created else "integration.update",
        message=f"{provider.label} {'connected' if created else 'connection updated'}",
        actor_id=user_id,
        correlation_id=correlation_id,
        meta={"provider": provider.key, "services": merged.get("services", [])},
        commit=False,
    )
    db.commit()
    db.refresh(row)
    return row


def update_secret(db: Session, row: Credential, secret: dict) -> None:
    row.encrypted_data = crypto.encrypt_secret(secret)
    row.hint = _hint(secret)
    db.commit()


def set_health(
    db: Session,
    row: Credential,
    health: str,
    detail: str = "",
    *,
    tested: bool = False,
    extra: dict | None = None,
) -> None:
    meta = dict(row.meta or {})
    meta["health"] = health
    meta["health_detail"] = detail[:300]
    meta["health_at"] = iso(now())
    if extra:
        meta.update(extra)
    row.meta = meta
    flag_modified(row, "meta")
    row.status = {
        HEALTHY: CredentialStatus.connected,
        DEGRADED: CredentialStatus.connected,
        PENDING: CredentialStatus.untested,
    }.get(health, CredentialStatus.error)
    if tested:
        row.last_tested_at = now()
    db.commit()


def touch_used(db: Session, row: Credential) -> None:
    row.last_used_at = now()
    meta = dict(row.meta or {})
    meta["last_sync_at"] = iso(now())
    row.meta = meta
    flag_modified(row, "meta")
    db.commit()


def disconnect(db: Session, user_id: uuid.UUID, provider: Provider, *, correlation_id: str | None = None) -> bool:
    row = get(db, user_id, provider.key)
    if row is None:
        return False
    db.delete(row)
    audit.record(
        db,
        type="integration.disconnect",
        message=f"{provider.label} disconnected",
        severity=EventSeverity.warning,
        actor_id=user_id,
        correlation_id=correlation_id,
        meta={"provider": provider.key},
        commit=False,
    )
    db.commit()
    return True
