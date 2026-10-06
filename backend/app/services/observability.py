"""What the user sees of the system: activity, errors, notifications, overview.

Three sources, joined here so the panel never has to understand n8n:

* `system_events`  - the audit trail (integrations, automations, AI, security,
  and the failures n8n's Error workflow reports);
* n8n executions   - every run of every workflow, with status and duration;
* connection state - integrations whose health is not "healthy".

Errors are *diagnosed*: each one is matched against known failure patterns and
comes with a plain-language title, an explanation and the one action that fixes
it (reconnect Google, fill a setting, open the automation). Unknown errors are
shown as they are - never hidden - with "open the run" as the action.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import EventSeverity, SystemEvent, User
from app.services import audit
from app.services.integrations import connections as conns
from app.services.integrations import providers as iproviders
from app.services.n8n import N8nError, N8nService

CATEGORIES = ("automations", "ai", "integrations", "errors", "security", "system")

_TYPE_CATEGORY = (
    ("automation.failure", "errors"),
    ("automation.warning", "errors"),
    ("automation.", "automations"),
    ("ai.", "ai"),
    ("integration.", "integrations"),
    ("credential.", "security"),
    ("auth.", "security"),
    ("user.", "security"),
    ("service.", "system"),
)

_TITLES = {
    "automation.create": "Automation created",
    "automation.update": "Automation updated",
    "automation.delete": "Automation deleted",
    "automation.activate": "Automation activated",
    "automation.pause": "Automation paused",
    "automation.run": "Run requested",
    "automation.test": "Test run",
    "automation.failure": "Automation failed",
    "integration.connect": "Integration connected",
    "integration.update": "Connection updated",
    "integration.disconnect": "Integration disconnected",
    "integration.test": "Connection tested",
    "integration.connect_failed": "Sign-in failed",
    "integration.app_update": "OAuth app updated",
    "ai.fallback": "AI fallback used",
    "ai.service_token.rotate": "Automation token rotated",
    "ai.service_token.revoke": "Automation token revoked",
    "credential.create": "Credential stored",
    "credential.update": "Credential updated",
    "credential.delete": "Credential deleted",
    "credential.test": "Credential tested",
    "credential.reveal": "Secret accessed by the platform",
}


def category_of(event_type: str) -> str:
    for prefix, cat in _TYPE_CATEGORY:
        if event_type.startswith(prefix):
            return cat
    return "system"


def _iso(value: dt.datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.isoformat()


def _mine(ev: SystemEvent, user_id: uuid.UUID) -> bool:
    actor = (ev.meta or {}).get("actor_id")
    return actor is None or actor == str(user_id)


def _events(db: Session, user_id: uuid.UUID, limit: int = 300) -> list[SystemEvent]:
    rows = db.scalars(select(SystemEvent).order_by(SystemEvent.created_at.desc()).limit(limit)).all()
    return [e for e in rows if _mine(e, user_id)]


# ---------------------------------------------------------------- activity --

#: bookkeeping events that are not activity a person would want to read
_SILENT = {"notifications.read", "error.resolved"}


def _event_view(ev: SystemEvent) -> dict:
    meta = ev.meta or {}
    result = {"error": "error", "critical": "error", "warning": "warning"}.get(ev.severity.value, "success")
    service = meta.get("provider") or meta.get("workflow_name") or ""
    provider = iproviders.get(service) if service else None
    link = None
    if meta.get("automation_id"):
        link = f"/automations/{meta['automation_id']}"
    elif meta.get("provider") and provider:
        link = f"/integrations/{provider.key}"
    elif ev.type.startswith("automation.failure"):
        link = "/errors"
    return {
        "id": f"ev-{ev.id}",
        "at": _iso(ev.created_at),
        "category": category_of(ev.type),
        "kind": ev.type,
        "title": _TITLES.get(ev.type, ev.type.replace(".", " ").capitalize()),
        "message": ev.message,
        "service": provider.label if provider else service,
        "result": result,
        "duration_ms": None,
        "details": {k: v for k, v in meta.items() if k not in ("actor_id",) and not isinstance(v, (dict, list))},
        "link": link,
    }


def _execution_view(ex: dict, names: dict[str, str]) -> dict:
    status = str(ex.get("status") or "").lower()
    ok = status in ("success", "succeeded")
    failed = status in ("error", "failed", "crashed")
    duration = None
    try:
        a = dt.datetime.fromisoformat(str(ex["startedAt"]).replace("Z", "+00:00"))
        b = dt.datetime.fromisoformat(str(ex["stoppedAt"]).replace("Z", "+00:00"))
        duration = int((b - a).total_seconds() * 1000)
    except (KeyError, ValueError, TypeError):
        pass
    wid = str(ex.get("workflowId") or "")
    name = names.get(wid, "Automation")
    return {
        "id": f"ex-{ex.get('id')}",
        "at": ex.get("startedAt"),
        "category": "errors" if failed else "automations",
        "kind": "execution",
        "title": "Run failed" if failed else ("Run succeeded" if ok else "Run in progress"),
        "message": name.removeprefix("PA · "),
        "service": name.removeprefix("PA · "),
        "result": "error" if failed else ("success" if ok else "running"),
        "duration_ms": duration,
        "details": {"workflow_id": wid, "execution_id": str(ex.get("id")), "mode": ex.get("mode")},
        "link": f"/executions/{ex.get('id')}",
    }


async def _executions(n8n: N8nService | None, limit: int = 100) -> tuple[list[dict], dict[str, str], str | None]:
    if n8n is None:
        return [], {}, "n8n is not configured"
    try:
        workflows = await n8n.list_workflows(limit=200)
        executions = await n8n.list_executions(limit=limit)
    except N8nError as exc:
        return [], {}, exc.message
    return executions, {str(w.get("id")): str(w.get("name")) for w in workflows}, None


async def activity(db: Session, user: User, n8n: N8nService | None, *, category: str = "all",
                   limit: int = 100) -> dict:
    items = [_event_view(e) for e in _events(db, user.id) if e.type not in _SILENT]
    executions, names, n8n_error = await _executions(n8n)
    items += [_execution_view(x, names) for x in executions]
    if category != "all":
        items = [i for i in items if i["category"] == category or (category == "errors" and i["result"] == "error")]
    items.sort(key=lambda i: i["at"] or "", reverse=True)
    return {"data": items[:limit], "sources": {"n8n": n8n_error is None, "n8n_error": n8n_error}}


# ------------------------------------------------------------------ errors --

@dataclass
class Diagnosis:
    title: str
    explanation: str
    severity: str  # critical | high | medium | low
    action_label: str
    action_href: str
    action_kind: str  # reconnect | connect | configure | open | retry
    service: str = ""


def diagnose(message: str, *, workflow: str = "", node: str = "") -> Diagnosis:
    m = (message or "").strip()
    low = m.lower()

    for p in iproviders.PROVIDERS.values():
        name = p.label.lower()
        short = p.key
        mentions = name in low or short in low or (short == "google" and ("gmail" in low or "calendar" in low))
        if mentions and any(k in low for k in ("expired", "sign in again", "invalid_grant", "auth_required", "revoked")):
            return Diagnosis(f"{p.label} authentication expired",
                             f"{p.label} no longer accepts the saved sign-in, so steps that use it stop.",
                             "critical", f"Reconnect {p.label}", f"/integrations/{p.key}", "reconnect", p.label)
        if mentions and ("connect " in low or "not_connected" in low or "is not connected" in low):
            return Diagnosis(f"{p.label} is not connected",
                             f"This automation needs {p.label}, but no account is connected.",
                             "high", f"Connect {p.label}", f"/integrations/{p.key}", "connect", p.label)
        if mentions and ("permission" in low or "403" in low):
            return Diagnosis(f"{p.label} permission missing",
                             f"The {p.label} connection does not allow what this step does.",
                             "high", "Manage permissions", f"/integrations/{p.key}", "reconnect", p.label)

    conf = re.search(r"configuraci[oó]n incompleta:?\s*(.+)", m, re.I)
    if conf:
        return Diagnosis("Missing configuration",
                         f"Required settings are empty: {conf.group(1)[:200]}",
                         "high", "Open the launcher settings", "/settings/automations", "configure")
    if "telegram" in low and ("401" in low or "unauthorized" in low or "bot token" in low):
        return Diagnosis("Telegram bot token rejected", "Telegram refuses the bot token this automation uses.",
                         "high", "Reconnect Telegram", "/integrations/telegram", "reconnect", "Telegram")
    if "chat not found" in low or "blocked" in low:
        return Diagnosis("Telegram chat unavailable", "The bot can no longer write to your chat.",
                         "high", "Link your chat again", "/integrations/telegram", "reconnect", "Telegram")
    if "ai" in low.split() or "ai step" in low or "provider" in low and "ai" in low or "/api/ai" in low:
        return Diagnosis("AI provider failed", "The AI step could not get an answer from the configured model.",
                         "medium", "Check AI settings", "/settings/ai", "configure", "AI")
    if any(k in low for k in ("econnrefused", "enotfound", "timeout", "timed out", "unreachable", "socket hang up")):
        return Diagnosis("A service did not answer", "A network call failed. It usually recovers on the next run.",
                         "medium", "View service status", "/settings/advanced", "retry")
    if "x-ac-service-token" in low or ("401" in low and "/api/" in low):
        return Diagnosis("Automation token rejected", "n8n's token for the platform API is missing or was rotated.",
                         "critical", "Generate a new token", "/settings/ai", "configure")
    title = f"Failed at «{node}»" if node else "Automation failed"
    return Diagnosis(title, m[:300] or "No error message was recorded.", "medium", "Open the automation",
                     "/automations", "open")


_PROVIDER_BY_LABEL = {p.label: p.key for p in iproviders.PROVIDERS.values()} | {"Telegram": "telegram", "AI": "ai"}


def retry_advice(message: str, *, node: str = "") -> dict:
    """Before retrying: why it failed and whether a retry can help at all."""
    d = diagnose(message, node=node)
    low = (message or "").lower()
    diag = {"title": d.title, "explanation": d.explanation,
            "action": {"label": d.action_label, "href": d.action_href, "kind": d.action_kind}}
    if d.action_kind in ("reconnect", "connect"):
        advice = {"retry": False, "cause": d.explanation,
                  "suggestion": f"{d.action_label} first - retrying now would fail the same way.",
                  "action": diag["action"]}
    elif d.action_kind == "configure" and not any(k in low for k in ("timeout", "timed out", "rate limit", "429")):
        advice = {"retry": False, "cause": d.explanation, "suggestion": "Fix the setting, then retry.",
                  "action": diag["action"]}
    elif d.action_kind == "retry" or any(k in low for k in ("timeout", "timed out", "rate limit", "429", "503", "502")):
        what = "the AI provider" if ("ai" in low.split() or "gemini" in low or "model" in low) else "a service"
        advice = {"retry": True, "cause": f"The previous attempt failed because {what} did not answer in time."
                  if "time" in low else d.explanation, "suggestion": "Retry the run - temporary failures usually recover.",
                  "action": None}
    else:
        advice = {"retry": True, "cause": d.explanation,
                  "suggestion": "Retrying runs the same steps again; check the failing step if it fails twice.",
                  "action": diag["action"] if d.action_kind == "open" else None}
    return {"diagnosis": diag, "advice": advice}


def _impact(db: Session, user: User, service_label: str) -> dict:
    from app.services.integrations import hub

    key = _PROVIDER_BY_LABEL.get(service_label)
    if not key or key == "ai":
        return {"automations": 0, "features": ["AI steps in automations", "Email analysis", "Briefing summary"]
                if key == "ai" else []}
    p = iproviders.PROVIDERS.get(key)
    if p is None:
        return {"automations": 0, "features": []}
    deps = hub.dependencies(db, user.id, p)
    features = deps["features"] or [n for names in hub.FEATURES.get(key, {}).values() for n in names][:4]
    return {"automations": len(deps["automations"]), "features": features}


def _key(*parts: str) -> str:
    return hashlib.sha1("|".join(p or "" for p in parts).encode()).hexdigest()[:16]


def _norm(message: str) -> str:
    return re.sub(r"\d+", "#", (message or "").lower())[:160]


def _cause(message: str, diag: Diagnosis) -> str:
    """The technical cause in one readable line (the explanation says what it means)."""
    m = (message or "").strip()
    if not m or m == diag.explanation:
        return diag.explanation
    return m[:200]


async def errors(db: Session, user: User, n8n: N8nService | None) -> dict:
    groups: dict[str, dict] = {}
    resolved: dict[str, str] = {}
    for ev in _events(db, user.id, limit=500):
        if ev.type == "error.resolved":
            resolved.setdefault(str((ev.meta or {}).get("key")), _iso(ev.created_at) or "")

    def add(key: str, at: str | None, diag: Diagnosis, message: str, automation: str, source: str, link: str | None):
        g = groups.get(key)
        if g is None:
            groups[key] = {
                "id": key, "title": diag.title, "explanation": diag.explanation, "message": message[:500],
                "severity": diag.severity, "service": diag.service, "automation": automation, "source": source,
                "count": 1, "first_seen": at, "last_seen": at,
                "cause": _cause(message, diag), "impact": _impact(db, user, diag.service),
                "action": {"label": diag.action_label, "href": diag.action_href, "kind": diag.action_kind},
                "link": link,
            }
        else:
            g["count"] += 1
            if at and (not g["last_seen"] or at > g["last_seen"]):
                g["last_seen"] = at
            if at and (not g["first_seen"] or at < g["first_seen"]):
                g["first_seen"] = at

    for ev in _events(db, user.id, limit=500):
        if ev.type != "automation.failure":
            continue
        meta = ev.meta or {}
        raw = ev.message.split(": ", 1)[-1]
        diag = diagnose(raw, workflow=meta.get("workflow_name", ""), node=meta.get("node", ""))
        automation = str(meta.get("workflow_name") or "").removeprefix("PA · ")
        add(_key("auto", automation, diag.title, _norm(raw)), _iso(ev.created_at), diag, raw, automation,
            "automation", f"/executions/{meta['execution_id']}" if meta.get("execution_id") else None)

    for p_key, row in conns.list_for(db, user.id).items():
        p = iproviders.get(p_key)
        health = (row.meta or {}).get("health")
        if health in (conns.EXPIRED, conns.AUTH_REQUIRED, conns.ERROR, conns.DEGRADED):
            detail = (row.meta or {}).get("health_detail") or health
            if health in (conns.EXPIRED, conns.AUTH_REQUIRED):
                diag = Diagnosis(f"{p.label} authentication expired", f"{p.label} needs you to sign in again.",
                                 "critical", f"Reconnect {p.label}", f"/integrations/{p.key}", "reconnect", p.label)
            else:
                diag = Diagnosis(f"{p.label} connection {'degraded' if health == conns.DEGRADED else 'failing'}",
                                 str(detail), "high" if health == conns.ERROR else "medium", "Open connection",
                                 f"/integrations/{p.key}", "open", p.label)
            add(_key("int", p.key, health), (row.meta or {}).get("health_at"), diag, str(detail), "", "integration",
                f"/integrations/{p.key}")

    from app.services.automations import manager

    for wf in manager.list_mine(db, user.id):
        err = (wf.meta or {}).get("last_error")
        if err:
            diag = diagnose(err.get("message", ""), workflow=wf.name)
            if diag.action_kind == "open":
                diag.action_href = f"/automations/{wf.id}"
            add(_key("step", str(wf.id), diag.title), err.get("at"), diag, err.get("message", ""), wf.name,
                "automation", f"/automations/{wf.id}")

    executions, names, _ = await _executions(n8n, limit=100)
    reported = {g["link"] for g in groups.values() if g["link"]}
    for ex in executions:
        if str(ex.get("status")).lower() not in ("error", "failed", "crashed"):
            continue
        if f"/executions/{ex.get('id')}" in reported:
            continue
        name = names.get(str(ex.get("workflowId")), "Automation").removeprefix("PA · ")
        diag = Diagnosis("Automation run failed", "A run ended with an error. Open it to see which step failed.",
                         "medium", "Open the run", f"/executions/{ex.get('id')}", "open")
        add(_key("exec", str(ex.get("workflowId"))), ex.get("startedAt"), diag, "", name, "execution",
            f"/executions/{ex.get('id')}")

    out = []
    for g in groups.values():
        if g["id"] in resolved and (g["last_seen"] or "") <= resolved[g["id"]]:
            continue
        out.append(g)
    rank = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    out.sort(key=lambda g: (rank.get(g["severity"], 9), -_ts(g["last_seen"])))
    return {"data": out, "counts": {s: sum(1 for g in out if g["severity"] == s) for s in rank}}


def _ts(value: str | None) -> float:
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


def resolve_error(db: Session, user: User, key: str) -> None:
    audit.record(db, type="error.resolved", actor_id=user.id, message="error marked as resolved",
                 meta={"key": key[:32]})


# ----------------------------------------------------------- notifications --

_NOTIFY = {
    "automation.failure": ("error", "automation"),
    "integration.connect": ("success", "integration"),
    "integration.disconnect": ("warning", "integration"),
    "integration.connect_failed": ("warning", "integration"),
    "automation.create": ("success", "automation"),
    "automation.activate": ("success", "automation"),
    "ai.fallback": ("warning", "ai"),
    "ai.service_token.rotate": ("security", "security"),
    "credential.reveal": ("security", "security"),
    "integration.app_update": ("security", "security"),
}


def notifications(db: Session, user: User, limit: int = 30) -> dict:
    events = _events(db, user.id, limit=400)
    read_at = next((_iso(e.created_at) for e in events if e.type == "notifications.read"), None)
    items = []
    for e in events:
        if e.type not in _NOTIFY:
            continue
        tone, kind = _NOTIFY[e.type]
        v = _event_view(e)
        action = None
        if e.type == "automation.failure":
            diag = diagnose(e.message.split(": ", 1)[-1], node=(e.meta or {}).get("node", ""))
            action = {"label": diag.action_label, "href": diag.action_href}
            v["title"] = diag.title
        elif v["link"]:
            action = {"label": "Open", "href": v["link"]}
        items.append({"id": v["id"], "at": v["at"], "tone": tone, "kind": kind, "title": v["title"],
                      "body": e.message, "action": action, "unread": read_at is None or (v["at"] or "") > read_at})
        if len(items) >= limit:
            break
    for p_key, row in conns.list_for(db, user.id).items():
        if (row.meta or {}).get("health") in (conns.EXPIRED, conns.AUTH_REQUIRED):
            p = iproviders.get(p_key)
            items.insert(0, {"id": f"int-{p_key}", "at": (row.meta or {}).get("health_at"), "tone": "error",
                             "kind": "integration", "title": f"{p.label} needs you to sign in again",
                             "body": "Automations that use it are paused until you reconnect.",
                             "action": {"label": f"Reconnect {p.label}", "href": f"/integrations/{p_key}"},
                             "unread": True})
    return {"data": items, "unread": sum(1 for i in items if i["unread"])}


def mark_notifications_read(db: Session, user: User) -> None:
    audit.record(db, type="notifications.read", actor_id=user.id, severity=EventSeverity.debug,
                 message="notifications read")


# ---------------------------------------------------------------- overview --

async def overview(db: Session, user: User, n8n: N8nService | None) -> dict:
    from app.services import usage
    from app.services.automations import manager

    executions, names, n8n_error = await _executions(n8n, limit=250)
    today = dt.datetime.now(dt.timezone.utc).date()
    days = [(today - dt.timedelta(days=i)) for i in range(6, -1, -1)]
    series = {d.isoformat(): {"date": d.isoformat(), "success": 0, "error": 0} for d in days}
    durations: list[int] = []
    for ex in executions:
        try:
            started = dt.datetime.fromisoformat(str(ex.get("startedAt")).replace("Z", "+00:00"))
        except ValueError:
            continue
        key = started.date().isoformat()
        if key not in series:
            continue
        status = str(ex.get("status") or "").lower()
        if status in ("success", "succeeded"):
            series[key]["success"] += 1
        elif status in ("error", "failed", "crashed"):
            series[key]["error"] += 1
        view = _execution_view(ex, names)
        if view["duration_ms"] is not None:
            durations.append(view["duration_ms"])
    week = list(series.values())
    ok7 = sum(d["success"] for d in week)
    err7 = sum(d["error"] for d in week)
    today_row = series[today.isoformat()]

    custom = manager.list_mine(db, user.id)
    custom_ids = {c.n8n_workflow_id for c in custom if c.n8n_workflow_id}
    workflows_active = 0
    system_total = 0
    if n8n is not None and n8n_error is None:
        try:
            wfs = await n8n.list_workflows(limit=200)
            workflows_active = sum(1 for w in wfs if w.get("active") and str(w.get("id")) != "pa00errorhandler")
            system_total = sum(1 for w in wfs if str(w.get("id")) not in custom_ids and str(w.get("id")) != "pa00errorhandler")
        except N8nError:
            pass

    rows = conns.list_for(db, user.id)
    unhealthy = [
        {"key": k, "label": iproviders.get(k).label, "health": (r.meta or {}).get("health")}
        for k, r in rows.items()
        if (r.meta or {}).get("health") not in (conns.HEALTHY, None)
    ]
    err = await errors(db, user, None)
    ai_days = usage.read(db, 7)
    open_errors = len(err["data"]) + (today_row["error"] if n8n_error is None else 0)
    critical = err["counts"].get("critical", 0)

    if n8n_error and not custom:
        state, message = "attention", "Automations are offline: " + n8n_error
    elif critical:
        state, message = "attention", f"{critical} issue(s) need you - most likely a connection to renew."
    elif today_row["error"] or unhealthy:
        state, message = "degraded", "Running, with a few things worth a look."
    else:
        state, message = "operational", "Your assistant is running normally."

    return {
        "user": {"name": user.username},
        "system": {"state": state, "message": message},
        "automations": {"total": system_total + len(custom), "active": workflows_active,
                        "custom": len(custom), "system": system_total},
        "executions": {
            "today": today_row["success"] + today_row["error"],
            "failed_today": today_row["error"],
            "success_rate_7d": round(ok7 / (ok7 + err7) * 100, 1) if (ok7 + err7) else None,
            "avg_duration_ms": int(sum(durations) / len(durations)) if durations else None,
            "series": week,
        },
        "errors": {"open": len(err["data"]), "critical": critical, "top": err["data"][:3]},
        "integrations": {"connected": len(rows), "total": len(iproviders.PROVIDERS), "unhealthy": unhealthy},
        "ai": {"requests_today": ai_days[today.isoformat()].get("ai_requests", 0),
               "avg_latency_ms": (ai_days[today.isoformat()].get("ai_latency_ms", 0)
                                  // max(1, ai_days[today.isoformat()].get("ai_requests", 0))) or None,
               "errors_today": ai_days[today.isoformat()].get("ai_errors", 0),
               "series": [{"date": d, "requests": v.get("ai_requests", 0)} for d, v in ai_days.items()]},
        "telegram": {"messages_today": ai_days[today.isoformat()].get("telegram_messages", 0)},
        "n8n": {"available": n8n_error is None, "error": n8n_error},
        "open_issues": open_errors,
    }


# --------------------------------------------------------- execution view --

def _ordered_nodes(workflow: dict) -> list[str]:
    """Node names in flow order (BFS from the triggers), sticky notes excluded."""
    nodes = [n for n in workflow.get("nodes", []) if "stickyNote" not in str(n.get("type"))]
    names = [n["name"] for n in nodes]
    conns_map = workflow.get("connections") or {}
    targets = {link["node"] for outs in conns_map.values() for b in outs.get("main", []) for link in (b or [])}
    order: list[str] = []
    queue = [n for n in names if n not in targets]
    while queue:
        cur = queue.pop(0)
        if cur in order:
            continue
        order.append(cur)
        for b in (conns_map.get(cur) or {}).get("main", []):
            for link in b or []:
                if link["node"] not in order:
                    queue.append(link["node"])
    return order + [n for n in names if n not in order]


async def execution_detail(n8n: N8nService | None, execution_id: str) -> dict:
    from app.services.automations import manager

    if n8n is None:
        raise N8nError("n8n is not configured", status_code=503)
    ex = await n8n.get_execution(execution_id, include_data=True)
    wf = await n8n.get_workflow(str(ex.get("workflowId")))
    run_data = (((ex.get("data") or {}).get("resultData") or {}).get("runData")) or {}
    error = (((ex.get("data") or {}).get("resultData") or {}).get("error")) or {}
    failed_node = (error.get("node") or {}).get("name")
    order = [n for n in _ordered_nodes(wf) if n in run_data or n == failed_node]
    steps = manager.execution_steps(ex, [(n, n) for n in order])
    diag = advice = None
    if failed_node or error:
        msg = next((s["error"] for s in steps if s.get("error")), error.get("message", ""))
        r = retry_advice(msg or "", node=failed_node or "")
        diag, advice = r["diagnosis"], r["advice"]
    return {**manager.summarise_execution(ex), "workflow": {"id": wf.get("id"), "name": str(wf.get("name", "")).removeprefix("PA · ")},
            "steps": steps, "diagnosis": diag, "retry_advice": advice}


# ------------------------------------------------------ n8n control center --

async def n8n_center(db: Session, user: User, n8n: N8nService | None) -> dict:
    """n8n without opening n8n: workflows, runs, success, last execution, health."""
    from app.services.automations import manager

    if n8n is None:
        return {"available": False, "state": "not_configured", "error": "n8n is not configured",
                "workflows": [], "totals": None}
    try:
        wfs = await n8n.list_workflows(limit=200)
        executions = await n8n.list_executions(limit=250)
    except N8nError as exc:
        return {"available": False, "state": "unavailable", "error": exc.message, "workflows": [], "totals": None,
                "message": "n8n is unavailable. Your saved automations are safe; runs resume when it is back."}
    custom = {c.n8n_workflow_id: c for c in manager.list_mine(db, user.id) if c.n8n_workflow_id}
    now = dt.datetime.now(dt.timezone.utc)
    week_ago = now - dt.timedelta(days=7)
    per: dict[str, dict] = {}
    today_ok = today_err = week_ok = week_err = 0
    last: dict | None = None
    for ex in executions:
        try:
            started = dt.datetime.fromisoformat(str(ex.get("startedAt")).replace("Z", "+00:00"))
        except ValueError:
            continue
        status = str(ex.get("status") or "").lower()
        ok, bad = status in ("success", "succeeded"), status in ("error", "failed", "crashed")
        wid = str(ex.get("workflowId") or "")
        row = per.setdefault(wid, {"runs_7d": 0, "ok_7d": 0, "err_7d": 0, "last_run_at": None, "last_status": None,
                                   "durations": []})
        if row["last_run_at"] is None or str(ex.get("startedAt")) > row["last_run_at"]:
            row["last_run_at"], row["last_status"] = ex.get("startedAt"), "success" if ok else "error" if bad else "running"
        if started >= week_ago:
            row["runs_7d"] += 1
            row["ok_7d"] += ok
            row["err_7d"] += bad
            week_ok += ok
            week_err += bad
            dur = _execution_view(ex, {})["duration_ms"]
            if dur is not None:
                row["durations"].append(dur)
        if started.date() == now.date():
            today_ok += ok
            today_err += bad
        if last is None or str(ex.get("startedAt")) > str(last.get("startedAt")):
            last = ex
    names = {str(w.get("id")): str(w.get("name") or "") for w in wfs}
    items = []
    for w in wfs:
        wid = str(w.get("id"))
        st = per.get(wid, {})
        runs = st.get("ok_7d", 0) + st.get("err_7d", 0)
        durs = st.get("durations") or []
        items.append({
            "id": wid, "name": names[wid].removeprefix("PA · "), "active": bool(w.get("active")),
            "kind": "error_handler" if wid == "pa00errorhandler" else "custom" if wid in custom else "system",
            "automation_id": str(custom[wid].id) if wid in custom else None,
            "runs_7d": st.get("runs_7d", 0), "failed_7d": st.get("err_7d", 0),
            "success_rate_7d": round(st.get("ok_7d", 0) / runs * 100, 1) if runs else None,
            "avg_duration_ms": int(sum(durs) / len(durs)) if durs else None,
            "last_run_at": st.get("last_run_at"), "last_status": st.get("last_status"),
        })
    items.sort(key=lambda i: (i["kind"] == "error_handler", not i["active"], i["name"].lower()))
    total_today = today_ok + today_err
    state = "operational" if not today_err else "degraded"
    return {
        "available": True, "state": state, "error": None,
        "totals": {"workflows": len([i for i in items if i["kind"] != "error_handler"]),
                   "active": sum(1 for i in items if i["active"] and i["kind"] != "error_handler"),
                   "executions_today": total_today, "failed_today": today_err,
                   "success_rate_today": round(today_ok / total_today * 100, 1) if total_today else None,
                   "success_rate_7d": round(week_ok / (week_ok + week_err) * 100, 1) if (week_ok + week_err) else None,
                   "last_execution": {"at": last.get("startedAt"), "status": str(last.get("status") or "").lower(),
                                      "workflow": names.get(str(last.get("workflowId")), "").removeprefix("PA · "),
                                      "id": str(last.get("id"))} if last else None},
        "workflows": items,
    }

