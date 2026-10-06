"""What the Integrations Hub renders: one browser-safe view per provider.

Assembles, for the signed-in user, each provider's catalogue entry, whether
sign-in is available (OAuth app configured), the connection (account, granted
services and permissions, health, timestamps, security posture) and which of
the user's automations use it. No token, secret or hint of one is included
beyond the vault's last-four `hint`.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Credential, Workflow
from app.services.integrations import connections as conns
from app.services.integrations import oauth, telegram
from app.services.integrations.providers import PROVIDERS, Provider, catalogue


def _usage(db: Session, user_id: uuid.UUID) -> dict[str, list[dict]]:
    """Automations built in the panel, grouped by the providers their blocks use."""
    out: dict[str, list[dict]] = {k: [] for k in PROVIDERS}
    rows = db.scalars(select(Workflow).where(Workflow.user_id == user_id)).all()
    for wf in rows:
        providers = set((wf.meta or {}).get("providers") or [])
        for p in providers:
            if p in out:
                out[p].append({"id": str(wf.id), "name": wf.name, "status": wf.status.value})
    return out


def _connection_view(row: Credential | None, provider: Provider) -> dict | None:
    if row is None:
        return None
    meta = row.meta or {}
    scopes = list(meta.get("scopes") or [])
    granted_services = provider.services_granted(scopes) if provider.auth == "oauth2" else list(meta.get("services") or [])
    perms = []
    for svc in provider.services:
        for perm in svc.permissions:
            perms.append({
                "service": svc.key,
                "scope": perm.scope,
                "label": perm.label,
                "access": perm.access,
                "granted": perm.scope in scopes,
            })
    view = {
        "id": str(row.id),
        "health": meta.get("health") or conns.HEALTHY,
        "health_detail": meta.get("health_detail", ""),
        "account": meta.get("account") or {},
        "services": granted_services,
        "requested_services": list(meta.get("services") or []),
        "permissions": perms,
        "connected_at": meta.get("connected_at"),
        "last_sync_at": meta.get("last_sync_at"),
        "last_refresh_at": meta.get("last_refresh_at"),
        "last_tested_at": conns.iso(row.last_tested_at),
        "last_test": meta.get("last_test"),
        "token_expires_at": meta.get("token_expires_at"),
        "security": {
            "method": "OAuth 2.0 + PKCE" if provider.auth == "oauth2" else "Bot token",
            "encrypted_at_rest": True,
            "refresh": provider.auth == "oauth2" and bool(meta.get("has_refresh_token")),
            "secret_hint": row.hint,
        },
    }
    if provider.key == "telegram":
        view["telegram"] = {
            "bot": meta.get("bot") or {},
            "chat": meta.get("chat"),
            "link_url": telegram.link_url(row),
        }
    return view


def provider_view(db: Session, user_id: uuid.UUID, provider: Provider, *, usage: dict | None = None,
                  rows: dict[str, Credential] | None = None) -> dict:
    cat = next(c for c in catalogue() if c["key"] == provider.key)
    rows = rows if rows is not None else conns.list_for(db, user_id)
    usage = usage if usage is not None else _usage(db, user_id)
    row = rows.get(provider.key)
    connection = _connection_view(row, provider)
    if provider.auth == "oauth2":
        app = oauth.app_for(db, provider)
        setup = {
            "available": app.configured,
            "source": app.source,
            "redirect_uri": oauth.redirect_uri(provider),
        }
    else:
        setup = {"available": True, "source": "user", "redirect_uri": None}
    status = "not_connected" if connection is None else connection["health"]
    return {
        **cat,
        "status": status,
        "connected": connection is not None,
        "setup": setup,
        "connection": connection,
        "used_by": usage.get(provider.key, []),
    }


def overview(db: Session, user_id: uuid.UUID) -> list[dict]:
    rows = conns.list_for(db, user_id)
    usage = _usage(db, user_id)
    return [provider_view(db, user_id, p, usage=usage, rows=rows) for p in PROVIDERS.values()]


#: assistant features that stop working without the provider, by service
FEATURES = {
    "google": {"gmail": ["Inbox and AI email triage", "Reply drafts", "Daily briefing (email)", "Telegram /emails"],
               "calendar": ["Calendar reminders", "Daily briefing (calendar)"],
               "drive": ["Save to Drive steps"],
               "gmail_manage": ["Archive / mark important"]},
    "telegram": {"messages": ["Telegram chat with the assistant", "Automatic daily briefing",
                              "Telegram notifications from automations"]},
    "microsoft": {}, "github": {},
}


def dependencies(db: Session, user_id: uuid.UUID, provider: Provider) -> dict:
    """What a disconnect would break: automations, scheduled ones, features."""
    row = conns.get(db, user_id, provider.key)
    used = _usage(db, user_id).get(provider.key, [])
    scheduled = 0
    for wf in db.scalars(select(Workflow).where(Workflow.user_id == user_id)).all():
        spec = (wf.meta or {}).get("spec") or {}
        trig = (spec.get("trigger") or {}).get("block")
        if provider.key in set((wf.meta or {}).get("providers") or []) and trig in ("schedule", "gmail.new_email",
                                                                                  "outlook.new_email", "github.notifications"):
            scheduled += 1
    granted = (row.meta or {}).get("services") or [] if row is not None else []
    if provider.auth == "oauth2" and row is not None:
        granted = provider.services_granted((row.meta or {}).get("scopes") or [])
    features: list[str] = []
    for svc, names in FEATURES.get(provider.key, {}).items():
        if provider.key == "telegram" or svc in granted:
            features += names
    return {"provider": provider.key, "connected": row is not None, "automations": used,
            "scheduled": scheduled, "features": features}  # scheduled = runs without you

