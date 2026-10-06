"""Privacy, security and system health - what the user can verify themselves.

* privacy(): which services have access and with which permissions, what is
  stored locally, what is sent to the AI provider and what never leaves the
  machine. Built from the live configuration, not a static page.
* security(): a checklist (OAuth valid, Telegram linked, n8n protected, secrets
  encrypted, automation token set) with the action for every failing item.
* system_health(): backend, PostgreSQL, n8n, AI, Gmail and Telegram in one list.

No secret, token or hint of one is part of any answer.
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import crypto
from app.models import AssistantMemory, AssistantTask, SystemEvent, User, Workflow
from app.services import memory
from app.services.integrations import connections as conns
from app.services.integrations import providers as iproviders

AI_DATA = [
    {"feature": "Email analysis", "sent": "Sender, subject, date and the email text (first 9,000 characters)",
     "when": "When you open an email and press Analyze"},
    {"feature": "Reply drafts", "sent": "Sender, subject and the email text", "when": "When you ask for a draft"},
    {"feature": "Daily briefing", "sent": "Sender, subject and preview of unread mail; event titles; deadline and problem titles",
     "when": "When a briefing is generated"},
    {"feature": "Chat and Telegram questions", "sent": "Your question and a short summary of the same data",
     "when": "When you ask something"},
    {"feature": "Automations with an AI step", "sent": "Only the fields that step is configured to use",
     "when": "When that automation runs"},
]
NEVER_SENT = ["Passwords and OAuth tokens", "API keys and bot tokens", "Attachments' contents",
              "Your AI memory notes, unless you ask a question they answer", "Emails you never open or ask about"]
LOCAL_ONLY = ["Credentials (encrypted with Fernet in PostgreSQL)", "Tasks and deadlines", "AI memory and preferences",
              "Priority cache (level and deadline per email - never the text)", "Automation definitions and run history",
              "Chat history (only in this browser)"]


def _count(db: Session, model, user_id) -> int:
    return int(db.scalar(select(func.count()).select_from(model).where(model.user_id == user_id)) or 0)


def privacy(db: Session, user: User) -> dict:
    from app.services.ai.config import resolve

    access = []
    for key, row in conns.list_for(db, user.id).items():
        p = iproviders.get(key)
        meta = row.meta or {}
        scopes = set(meta.get("scopes") or [])
        perms = [perm.label for s in p.services for perm in s.permissions if perm.scope in scopes] \
            if p.auth == "oauth2" else ["Send messages to your linked chat", "Read messages you send to the bot"]
        access.append({"service": p.label, "key": key, "account": (meta.get("account") or {}).get("email")
                       or ((meta.get("bot") or {}).get("username") and "@" + meta["bot"]["username"]) or "",
                       "permissions": perms, "connected_at": meta.get("connected_at")})
    cfg = resolve(db)
    mem = memory.overview(db, user.id)["counts"]
    events = int(db.scalar(select(func.count()).select_from(SystemEvent)) or 0)
    return {
        "access": access,
        "ai": {"provider": cfg.provider or None, "model": cfg.model or None, "configured": cfg.configured,
               "fallback": cfg.effective_fallback or None, "data": AI_DATA, "never": NEVER_SENT},
        "stored": {"tasks": _count(db, AssistantTask, user.id),
                   "memory": sum(v for k, v in mem.items() if k in ("sender", "note", "dismissed")),
                   "priority_cache": mem.get("triage", 0),
                   "automations": _count(db, Workflow, user.id),
                   "activity_events": events,
                   "local_only": LOCAL_ONLY},
        "demo_mode": memory.demo_enabled(db, user.id),
        "retention": ["Priority cache: last 300 emails", "Usage counters: 14 days",
                      "Chat history: until you clear it in the browser"],
    }


async def security(db: Session, user: User) -> dict:
    from app.services.ai import token as ai_token
    from app.services.service_config import resolve as resolve_service

    checks: list[dict] = []

    def add(key: str, label: str, ok: bool | None, detail: str, action: dict | None = None):
        checks.append({"key": key, "label": label, "status": "ok" if ok else "warn" if ok is None else "fail",
                       "detail": detail, "action": None if ok else action})

    rows = conns.list_for(db, user.id)
    for key in ("google", "telegram"):
        p = iproviders.get(key)
        row = rows.get(key)
        if row is None:
            add(key, p.label, None, "Not connected", {"label": f"Connect {p.label}", "href": f"/integrations/{key}"})
            continue
        meta = row.meta or {}
        health = meta.get("health") or conns.HEALTHY
        if key == "google":
            ok = health == conns.HEALTHY
            detail = ("OAuth valid · refreshes automatically" if meta.get("has_refresh_token") else "OAuth valid")
            add(key, "Google", ok, detail if ok else f"OAuth {health.replace('_', ' ')}",
                {"label": "Reconnect Google", "href": "/integrations/google"})
        else:
            linked = bool((meta.get("chat") or {}).get("id"))
            add(key, "Telegram", linked and health == conns.HEALTHY,
                "Connected · only your linked chat is answered" if linked else "Bot connected, chat not linked",
                {"label": "Open Telegram", "href": "/integrations/telegram"})
    n8n = resolve_service(db, "n8n")
    add("n8n", "n8n", bool(n8n.secret) and n8n.enabled,
        "Protected by an API key; reachable only inside Docker" if n8n.secret else "No API key configured",
        {"label": "Configure n8n", "href": "/settings/advanced"})
    tok = ai_token.status(db)
    add("automation_token", "Automation token", tok["configured"],
        "n8n authenticates to the platform with its own token" if tok["configured"] else "Not generated",
        {"label": "Generate token", "href": "/settings/ai"})
    add("encryption", "Credentials", crypto.is_configured(),
        "Encrypted at rest (Fernet) · never shown in full" if crypto.is_configured() else "Encryption key missing",
        {"label": "See installation guide", "href": "/settings/advanced"})
    add("human_in_the_loop", "Sensitive actions", True,
        "Sending email, archiving and disconnecting always ask for confirmation")
    worst = "fail" if any(c["status"] == "fail" for c in checks) else "warn" if any(c["status"] == "warn" for c in checks) else "ok"
    return {"status": worst, "checks": checks, "checked_at": dt.datetime.now(dt.timezone.utc).isoformat()}


async def system_health(db: Session, user: User) -> dict:
    from app.services.services_probe import system_status

    status = await system_status()
    by = {s["name"]: s for s in status["services"]}
    labels = {"database": "PostgreSQL", "n8n": "n8n", "ai": "AI provider"}
    items = [{"key": "backend", "label": "Backend", "status": "healthy", "detail": "API answering"}]
    for name, label in labels.items():
        s = by.get(name)
        if s is None:
            continue
        state = {"online": "healthy", "not_configured": "not_configured"}.get(s["status"], "unhealthy" if s["status"] == "offline" else s["status"])
        items.append({"key": name, "label": label, "status": state, "detail": s.get("detail") or "",
                      "latency_ms": s.get("latency_ms")})
    rows = conns.list_for(db, user.id)
    for key, label in (("google", "Gmail"), ("telegram", "Telegram")):
        row = rows.get(key)
        if row is None:
            items.append({"key": key, "label": label, "status": "not_connected", "detail": "Not connected"})
        else:
            h = (row.meta or {}).get("health") or conns.HEALTHY
            items.append({"key": key, "label": label, "status": "connected" if h == conns.HEALTHY else h,
                          "detail": (row.meta or {}).get("health_detail") or ""})
    bad = [i for i in items if i["status"] not in ("healthy", "connected", "not_configured", "not_connected")]
    return {"state": "operational" if not bad else "degraded", "items": items, "checked_at": status["checked_at"]}
