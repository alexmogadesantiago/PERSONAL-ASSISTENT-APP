"""The credential an automation presents to use the platform's AI API.

n8n runs outside the browser session, so it cannot hold a user JWT. It presents
a long-lived shared secret in ``X-AC-Service-Token`` instead.

Where it lives: encrypted (same Fernet master key as every other secret) in the
``encrypted_secret`` column of the ``ai`` row of ``service_configs``, with
``AC_AI_SERVICE_TOKEN`` as the environment fallback. It is shown in clear text
exactly once - the moment an admin generates it - because it has to be pasted
into n8n; after that only the hint is ever returned.

Comparison uses :func:`hmac.compare_digest`, so a wrong token cannot be found
one character at a time by timing the endpoint.
"""
from __future__ import annotations

import hmac
import secrets
import uuid

from sqlalchemy.orm import Session

from app.config import get_settings
from app.services import service_config as svc
from app.services.ai import registry

_PREFIX = "acs_"


def generate() -> str:
    """A new token. 32 random bytes, url-safe, prefixed so it is recognisable
    in a paste box."""
    return _PREFIX + secrets.token_urlsafe(32)


def resolve(db: Session | None) -> tuple[str, str]:
    """Return ``(token, source)``. Database first, environment second."""
    resolved = svc.resolve(db, registry.AI_SETTINGS_KEY)
    if resolved.secret:
        return resolved.secret, svc.DATABASE
    env_token = (get_settings().ai_service_token or "").strip()
    if env_token:
        return env_token, svc.ENVIRONMENT
    return "", svc.NONE


def status(db: Session | None) -> dict:
    """Browser-safe view: configured or not, plus the last four characters."""
    token, source = resolve(db)
    return {
        "configured": bool(token),
        "source": source,
        "hint": f"...{token[-4:]}" if len(token) > 4 else "",
    }


def rotate(db: Session, *, actor_id: uuid.UUID | None = None) -> str:
    """Create and store a new token, returning it once in clear text."""
    token = generate()
    svc.upsert(db, registry.AI_SETTINGS_KEY, secret=token, actor_id=actor_id)
    return token


def revoke(db: Session, *, actor_id: uuid.UUID | None = None) -> None:
    svc.upsert(db, registry.AI_SETTINGS_KEY, clear_secret=True, actor_id=actor_id)


def verify(db: Session | None, presented: str) -> bool:
    """Constant-time check of a presented token."""
    token, _ = resolve(db)
    if not token or not presented:
        return False
    return hmac.compare_digest(token, presented)


__all__ = ["generate", "resolve", "revoke", "rotate", "status", "verify"]
