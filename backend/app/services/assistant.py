"""The assistant's own skills, on top of the user's connections and the AI layer.

* Mail: list / read / AI triage + personal priority with reasons / reply drafts
  in several tones / send in the same thread / archive / mark important /
  extract tasks.
* Daily briefing 2.0: important mail, today's calendar, deadlines, automation
  health and an AI summary - on demand, on the dashboard, and automatically on
  Telegram at the user's preferred time.
* Insights: short proactive notices (important unread mail, a deadline close
  by, an automation failing repeatedly), each with one action.
* Ask: what the chat needs to answer a personal question - structured sections
  and buttons, plus a compact context the model writes the prose from.
* Suggestions 2.0: patterns in the user's mail (frequent senders, the same
  sender every week, recurring PDFs) not covered by an automation yet.
* Telegram bot: commands and free questions from the linked chat only; sending
  a reply always goes through an explicit [Send] / [Cancel] confirmation.

Everything reuses the Integrations Hub (tokens, refresh, health) and AIService
(provider, fallback); nothing here holds credentials of its own. With demo mode
on, the read surfaces use `demo` instead of Google and nothing is ever sent.
"""
from __future__ import annotations

import asyncio
import base64
import collections
import datetime as dt
import json
import logging
import re
import uuid
from email.message import EmailMessage
from email.utils import parsedate_to_datetime

from sqlalchemy.orm import Session

from app.services import demo, memory, priority, tasks
from app.services.automations import actions
from app.services.integrations import connections as conns
from app.services.integrations import telegram as itelegram

log = logging.getLogger("assistant")


class AssistantError(Exception):
    def __init__(self, message: str, status_code: int = 409, provider: str | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.provider = provider


def _ctx(db: Session, user_id: uuid.UUID) -> actions.Ctx:
    return actions.Ctx(db=db, user_id=user_id, state={}, test=False)


def _wrap(exc: actions.ActionError) -> AssistantError:
    return AssistantError(exc.message, exc.status_code if exc.status_code < 500 else 502, exc.provider)


def is_demo(db: Session, user_id: uuid.UUID) -> bool:
    return memory.demo_enabled(db, user_id)


async def _ai(db: Session, instruction: str, data: dict | str, schema: dict, temperature: float = 0.2) -> dict:
    from app.services import usage
    from app.services.ai.errors import AIError
    from app.services.ai.service import AIService

    payload = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, default=str)
    try:
        result = await AIService.from_db(db).generate(
            [{"role": "system", "content": "You are the user's personal assistant. Be accurate and brief. "
                                           "Never invent facts. Answer in the user's language when one is evident."},
             {"role": "user", "content": f"{instruction}\n\nData:\n{payload[:9000]}"}],
            response_format={"type": "json_schema", "schema": schema}, temperature=temperature)
    except AIError as exc:
        usage.bump(db, "ai_errors")
        raise AssistantError(f"AI is unavailable: {exc.message}", 502)
    usage.bump(db, "ai_requests")
    usage.bump(db, "ai_latency_ms", int(result.response.latency_ms or 0))
    return result.response.data if isinstance(result.response.data, dict) else {}


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# ------------------------------------------------------------------ mail ----

def _public(m: dict) -> dict:
    return {k: m.get(k) for k in ("id", "thread_id", "from", "to", "subject", "date", "snippet", "has_attachments",
                                  "attachments", "labels", "link")} | {"unread": "UNREAD" in (m.get("labels") or []),
                                                                      "important": "IMPORTANT" in (m.get("labels") or [])}


def _with_triage(db: Session, user_id: uuid.UUID, items: list[dict]) -> list[dict]:
    cache = memory.triage(db, user_id)
    senders = memory.important_senders(db, user_id)
    out = []
    for m in items:
        t = cache.get(m["id"])
        m = m | {"triage": {k: t.get(k) for k in ("level", "category", "action_required", "deadline")} if t else None}
        m["important_sender"] = memory.address_of(m.get("from") or "") in senders
        out.append(m)
    return out


async def list_mail(db: Session, user_id: uuid.UUID, query: str = "in:inbox", limit: int = 15) -> list[dict]:
    if is_demo(db, user_id):
        return _with_triage(db, user_id, [_public(m) | {"demo": True} for m in demo.mail(query, limit)])
    ctx = _ctx(db, user_id)
    try:
        ids = await actions._gmail_list(ctx, query or "in:inbox", limit)
        return _with_triage(db, user_id, [_public(m) for m in await actions._gmail_get(ctx, ids)])
    except actions.ActionError as exc:
        raise _wrap(exc)


async def read_mail(db: Session, user_id: uuid.UUID, message_id: str) -> dict:
    if is_demo(db, user_id):
        m = demo.message(message_id)
        if m is None:
            raise AssistantError("Message not found.", 404)
        return _public(m) | {"text": m["text"], "demo": True}
    try:
        msgs = await actions._gmail_get(_ctx(db, user_id), [message_id])
    except actions.ActionError as exc:
        raise _wrap(exc)
    m = msgs[0]
    return _public(m) | {"text": m.get("text", "")}


ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "priority": {"type": "string"}, "category": {"type": "string"}, "action_required": {"type": "boolean"},
        "summary": {"type": "string"}, "deadline": {"type": "string"}, "deadline_title": {"type": "string"},
        "suggested_action": {"type": "string"},
        "tasks": {"type": "array", "items": {"type": "object", "properties": {
            "title": {"type": "string"}, "due": {"type": "string"}}, "required": ["title", "due"]}},
    },
    "required": ["priority", "category", "action_required", "summary", "deadline", "deadline_title", "suggested_action"],
}
CATEGORIES = ("important", "school", "work", "personal", "notification", "spam-like")


async def _sender_count(db: Session, user_id: uuid.UUID, sender: str) -> int:
    addr = memory.address_of(sender)
    if not addr or "@" not in addr:
        return 0
    try:
        return len(await actions._gmail_list(_ctx(db, user_id), f"from:{addr} newer_than:60d", 10))
    except actions.ActionError:
        return 0


async def analyze_mail(db: Session, user_id: uuid.UUID, message_id: str) -> dict:
    m = await read_mail(db, user_id, message_id)
    demo_on = bool(m.get("demo"))
    if demo_on:
        data = demo.analysis(message_id) or {}
        important = demo.IMPORTANT_SENDERS | memory.important_senders(db, user_id)
        count = 0
    else:
        now = dt.datetime.now().astimezone().isoformat(timespec="minutes")
        data = await _ai(db, (
            f"Triage this email. Now is {now}. priority: high|medium|low. category: one of {', '.join(CATEGORIES)}. "
            "action_required: does the reader need to do something? summary: 1-2 sentences. "
            "deadline: if the email mentions a due date/time or meeting, ISO 8601 with timezone, else ''. "
            "deadline_title: short reminder title, else ''. suggested_action: one short sentence. "
            "tasks: concrete things the reader must do (title + due ISO date or ''), [] if none."),
            {k: m.get(k) for k in ("from", "subject", "date", "text", "has_attachments")}, ANALYSIS_SCHEMA)
        important = memory.important_senders(db, user_id)
        count = await _sender_count(db, user_id, m.get("from") or "")
    ai_priority = str(data.get("priority", "medium")).lower()
    category = str(data.get("category", "personal")).lower()
    analysis = {
        "ai_priority": ai_priority if ai_priority in ("high", "medium", "low") else "medium",
        "category": category if category in CATEGORIES else "personal",
        "action_required": bool(data.get("action_required")),
        "summary": str(data.get("summary", "")),
        "deadline": str(data.get("deadline", "")) or None,
        "deadline_title": str(data.get("deadline_title", "")) or None,
        "suggested_action": str(data.get("suggested_action", "")),
        "tasks": [{"title": str(t.get("title", ""))[:200], "due": str(t.get("due", "")) or None}
                  for t in (data.get("tasks") or []) if isinstance(t, dict) and t.get("title")][:5],
    }
    pr = priority.score(m, {"priority": analysis["ai_priority"], "deadline": analysis["deadline"],
                            "action_required": analysis["action_required"]}, important=important, sender_count=count)
    result = analysis | {"priority": pr["level"], "priority_score": pr["score"], "priority_reasons": pr["reasons"],
                         "sender": memory.address_of(m.get("from") or ""), "demo": demo_on}
    memory.remember_triage(db, user_id, message_id, {"level": pr["level"], "score": pr["score"],
                                                     "category": analysis["category"],
                                                     "action_required": analysis["action_required"],
                                                     "deadline": analysis["deadline"], "from": m.get("from"),
                                                     "subject": m.get("subject")})
    return result


TONES = {
    "default": "polite and concise",
    "formal": "formal and professional",
    "professional": "formal and professional",
    "informal": "warm and informal",
    "concise": "very brief (2-3 sentences)",
    "brief": "very brief (2-3 sentences)",
    "detailed": "complete and detailed, answering every point",
}


async def draft_reply(db: Session, user_id: uuid.UUID, message_id: str, instruction: str = "",
                      tone: str = "default") -> dict:
    m = await read_mail(db, user_id, message_id)
    style = TONES.get(tone, TONES["default"])
    if m.get("demo"):
        body = demo.draft(message_id)
    else:
        data = await _ai(db, (
            f"Write a reply to this email, in the email's language, {style}, ready to send. "
            f"No subject line, no placeholders like [Name]. {instruction}".strip()),
            {k: m.get(k) for k in ("from", "subject", "text")},
            {"type": "object", "properties": {"body": {"type": "string"}}, "required": ["body"]}, temperature=0.4)
        body = str(data.get("body", ""))
    return {"to": m["from"], "subject": m["subject"] if m["subject"].lower().startswith("re:") else f"Re: {m['subject']}",
            "body": body, "tone": tone if tone in TONES else "default", "demo": bool(m.get("demo"))}


async def send_reply(db: Session, user_id: uuid.UUID, message_id: str, body: str) -> dict:
    """Only ever called after an explicit confirmation (web button or Telegram [Send])."""
    m = await read_mail(db, user_id, message_id)
    if m.get("demo"):
        return {"sent": False, "demo": True, "message": "Demo mode: nothing was sent."}
    ctx = _ctx(db, user_id)
    raw_msg = await actions._api(ctx, "google", "gmail", "GET", f"{actions.GMAIL}/messages/{message_id}",
                                 params={"format": "metadata", "metadataHeaders": "Message-ID"})
    headers = {h["name"].lower(): h["value"] for h in (raw_msg.get("payload") or {}).get("headers", [])}
    msg = EmailMessage()
    msg["To"] = m["from"]
    msg["Subject"] = m["subject"] if m["subject"].lower().startswith("re:") else f"Re: {m['subject']}"
    if headers.get("message-id"):
        msg["In-Reply-To"] = headers["message-id"]
        msg["References"] = headers["message-id"]
    msg.set_content(body)
    try:
        sent = await actions._api(ctx, "google", "gmail", "POST", f"{actions.GMAIL}/messages/send",
                                  json={"raw": base64.urlsafe_b64encode(msg.as_bytes()).decode(), "threadId": m["thread_id"]})
    except actions.ActionError as exc:
        raise _wrap(exc)
    from app.services import audit

    audit.record(db, type="assistant.reply_sent", actor_id=user_id, message=f"reply sent: {msg['Subject']}",
                 meta={"provider": "google"})
    return {"sent": True, "id": sent.get("id")}


async def modify_mail(db: Session, user_id: uuid.UUID, message_id: str, action: str) -> dict:
    """archive | important | not_important | read. Needs the optional "Organize Gmail" permission."""
    changes = {
        "archive": {"removeLabelIds": ["INBOX"]},
        "important": {"addLabelIds": ["IMPORTANT"]},
        "not_important": {"removeLabelIds": ["IMPORTANT"]},
        "read": {"removeLabelIds": ["UNREAD"]},
    }.get(action)
    if changes is None:
        raise AssistantError("Unknown action.", 422)
    if is_demo(db, user_id):
        return {"done": False, "demo": True, "message": "Demo mode: Gmail was not changed."}
    try:
        await actions._api(_ctx(db, user_id), "google", "gmail_manage", "POST",
                           f"{actions.GMAIL}/messages/{message_id}/modify", json=changes)
    except actions.ActionError as exc:
        raise _wrap(exc)
    from app.services import audit

    audit.record(db, type=f"assistant.mail_{action}", actor_id=user_id, message=f"email {action.replace('_', ' ')}",
                 meta={"provider": "google"})
    return {"done": True, "action": action}


# -------------------------------------------------------------- calendar ----

async def _events_today(db: Session, user_id: uuid.UUID, notes: list[str]) -> list[dict]:
    if is_demo(db, user_id):
        return demo.events()
    google = conns.list_for(db, user_id).get("google")
    if google is None or "calendar" not in ((google.meta or {}).get("services") or []):
        return []
    try:
        return await actions.calendar_list(_ctx(db, user_id), {"days": 1}, {})
    except actions.ActionError as exc:
        notes.append(f"Calendar: {exc.message}")
        return []


def _deadlines(db: Session, user_id: uuid.UUID, days: int = 7) -> list[dict]:
    if is_demo(db, user_id):
        return demo.deadlines()
    now = _now()
    out = []
    for t in tasks.list_for(db, user_id, "open"):
        if t["due_at"]:
            due = dt.datetime.fromisoformat(t["due_at"])
            if due <= now + dt.timedelta(days=days):
                out.append({"title": t["title"], "due": t["due_at"], "source": (t["source"] or {}).get("from", ""),
                            "href": "/tasks", "overdue": t["overdue"]})
    for mid, tri in memory.triage(db, user_id).items():
        if tri.get("deadline"):
            try:
                due = dt.datetime.fromisoformat(str(tri["deadline"]).replace("Z", "+00:00"))
            except ValueError:
                continue
            if due.tzinfo is None:
                due = due.replace(tzinfo=dt.timezone.utc)
            if now <= due <= now + dt.timedelta(days=days) and not any(o["title"] == tri.get("subject") for o in out):
                out.append({"title": tri.get("subject") or "Email deadline", "due": due.isoformat(),
                            "source": tri.get("from") or "", "href": f"/inbox?id={mid}", "overdue": False})
    out.sort(key=lambda d: d["due"])
    return out[:8]


# -------------------------------------------------------------- briefing ----

def greeting(hour: int | None = None) -> str:
    h = dt.datetime.now().astimezone().hour if hour is None else hour
    return "Good morning" if 5 <= h < 12 else "Good afternoon" if 12 <= h < 20 else "Good evening"


async def _automation_health(db: Session, user) -> dict:
    from app.services import observability

    if is_demo(db, user.id):
        items = demo.automations()
        return {"active": len(items), "failed_today": 1, "success_rate": 98.7, "state": "degraded",
                "message": "One automation failed once today."}
    try:
        o = await observability.overview(db, user, None)
    except Exception:  # noqa: BLE001 - the briefing must not fail because of a counter
        return {"active": 0, "failed_today": 0, "success_rate": None, "state": "unknown", "message": ""}
    return {"active": o["automations"]["active"] or o["automations"]["custom"],
            "failed_today": o["executions"]["failed_today"], "success_rate": o["executions"]["success_rate_7d"],
            "state": o["system"]["state"], "message": o["system"]["message"]}


async def briefing(db: Session, user_id: uuid.UUID, *, with_summary: bool = True) -> dict:
    from app.models import User
    from app.services import observability

    demo_on = is_demo(db, user_id)
    rows = conns.list_for(db, user_id)
    google = rows.get("google")
    mail: list[dict] = []
    notes: list[str] = []
    if demo_on:
        mail = await list_mail(db, user_id, "is:unread", 10)
    elif google is not None:
        if "gmail" in ((google.meta or {}).get("services") or []):
            try:
                mail = await list_mail(db, user_id, "in:inbox is:unread newer_than:1d", 10)
            except AssistantError as exc:
                notes.append(exc.message)
    else:
        notes.append("Google is not connected, so mail and calendar are not included.")
    events = await _events_today(db, user_id, notes)
    user = db.get(User, user_id)
    errs = demo.errors() if demo_on else (await observability.errors(db, user, None))["data"]
    important = [m for m in mail if (m.get("triage") or {}).get("level") in ("high", "urgent") or m.get("important")
                 or m.get("important_sender")]
    deadlines = _deadlines(db, user_id)
    autos = await _automation_health(db, user)
    summary = ""
    if with_summary and (mail or events or errs or deadlines):
        if demo_on:
            summary = ("Hoy tienes un día bastante tranquilo: 3 eventos y 4 correos sin leer. Lo más importante es la "
                       "presentación del TDR, que vence el viernes; aprovecha la reunión de las 13:00 con tu tutora. "
                       "Una automatización falló una vez por un timeout de la IA.")
        else:
            try:
                data = await _ai(db, (
                    "Write a short daily briefing (max 90 words, friendly, in Spanish unless the data is clearly in "
                    "another language): what matters in the unread emails, the calendar, the deadlines and any "
                    "problem. Start with the most important thing."),
                    {"emails": [{k: e.get(k) for k in ("from", "subject", "snippet")} for e in mail],
                     "important": [e.get("subject") for e in important], "events": events,
                     "deadlines": deadlines, "problems": [e["title"] for e in errs[:5]], "automations": autos},
                    {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]})
                summary = str(data.get("text", ""))
            except AssistantError as exc:
                notes.append(exc.message)
    return {"generated_at": _now().isoformat(), "greeting": greeting(), "emails": mail, "important": important,
            "events": events, "deadlines": deadlines, "automations": autos,
            "problems": [{"title": e["title"], "action": e["action"]} for e in errs[:5]],
            "summary": summary, "notes": notes, "demo": demo_on}


def briefing_text(b: dict) -> str:
    """The briefing as one Telegram message (HTML)."""
    lines = [f"☀️ <b>{_esc(b.get('greeting') or 'Hola')}</b> — tu briefing", ""]
    if b.get("summary"):
        lines += [_esc(b["summary"]), ""]
    lines.append(f"📧 <b>Correo</b>: {len(b['emails'])} sin leer, {len(b['important'])} importantes")
    for m in b["important"][:3]:
        lines.append(f"   • {_esc(m.get('subject') or '')}")
    lines.append(f"📅 <b>Calendario</b>: {len(b['events'])} eventos")
    for e in b["events"][:4]:
        start = str(e.get("start") or "")
        lines.append(f"   • {start[11:16] or start[:10]} {_esc(e.get('title') or '')}")
    if b["deadlines"]:
        lines.append(f"⏰ <b>Fechas límite</b>: {len(b['deadlines'])}")
        for d in b["deadlines"][:3]:
            lines.append(f"   • {_esc(d['title'])} ({d['due'][:10]})")
    a = b.get("automations") or {}
    lines.append(f"⚙️ <b>Automatizaciones</b>: {a.get('message') or 'sin datos'}")
    if b["problems"]:
        lines.append(f"⚠️ {len(b['problems'])} aviso(s): /errors")
    return "\n".join(lines)


# -------------------------------------------------------------- insights ----

async def insights(db: Session, user) -> list[dict]:
    """Few, useful, actionable. Empty when proactive insights are off."""
    from app.services import observability

    if not memory.preferences(db, user.id)["proactive"]:
        return []
    out: list[dict] = []
    demo_on = is_demo(db, user.id)
    tri = memory.triage(db, user.id)
    try:
        unread = await list_mail(db, user.id, "in:inbox is:unread", 15) if (demo_on or "google" in conns.list_for(db, user.id)) else []
    except AssistantError:
        unread = []
    if demo_on:
        for m in unread:
            if m["id"] not in tri and demo.analysis(m["id"]):
                a = demo.analysis(m["id"])
                pr = priority.score(m, a, important=demo.IMPORTANT_SENDERS)
                m["triage"] = {"level": pr["level"], "action_required": a["action_required"], "deadline": a["deadline"]}
    important = [m for m in unread if m.get("important_sender") or (m.get("triage") or {}).get("level") in ("high", "urgent")]
    action = [m for m in unread if (m.get("triage") or {}).get("action_required")]
    if important:
        out.append({"id": "important-unread", "kind": "email", "severity": "high",
                    "title": f"{len(important)} unread email{'s' if len(important) != 1 else ''} from important senders",
                    "detail": ", ".join(str(m.get("subject") or "")[:50] for m in important[:2]),
                    "action": {"label": "Review", "href": "/inbox?filter=important"}})
    elif action:
        out.append({"id": "action-unread", "kind": "email", "severity": "medium",
                    "title": f"{len(action)} email{'s' if len(action) != 1 else ''} need{'s' if len(action) == 1 else ''} an action",
                    "detail": str(action[0].get("subject") or "")[:80],
                    "action": {"label": "Review", "href": "/inbox?filter=action"}})
    for d in _deadlines(db, user.id, days=3)[:1]:
        out.append({"id": f"deadline-{d['title'][:40]}", "kind": "deadline", "severity": "high" if d.get("overdue") else "medium",
                    "title": f"{'Overdue' if d.get('overdue') else 'Deadline approaching'}: {d['title']}",
                    "detail": f"Due {d['due'][:16].replace('T', ' ')}",
                    "action": {"label": "Open", "href": d["href"]}})
    errs = demo.errors() if demo_on else (await observability.errors(db, user, None))["data"]
    repeated = [e for e in errs if e.get("count", 1) >= 2] or [e for e in errs if e["severity"] == "critical"]
    if repeated:
        e = repeated[0]
        out.append({"id": f"error-{e['id']}", "kind": "automation", "severity": e["severity"],
                    "title": f"{e['automation'] or e['title']} failed {e.get('count', 1)} time{'s' if e.get('count', 1) != 1 else ''}"
                    if e.get("automation") else e["title"],
                    "detail": e["explanation"][:120], "action": {"label": "Investigate", "href": "/errors"}})
    elif demo_on and errs:
        e = errs[0]
        out.append({"id": f"error-{e['id']}", "kind": "automation", "severity": "medium",
                    "title": f"{e['automation']} failed once today", "detail": e["cause"],
                    "action": {"label": "Investigate", "href": "/errors"}})
    hidden = memory.dismissed(db, user.id)
    return [i for i in out if f"insight:{i['id']}" not in hidden]


# ------------------------------------------------------------------- ask ----

_INTENTS = (
    ("failures", r"\b(fail|fall|error|problem|roto|broken|fallad|ha fallat)"),
    ("briefing", r"\b(briefing|resumen del d[ií]a|resum del dia|daily summary|prepara)"),
    ("automation", r"\b(automati[zs]|automate|crea(r)? una automat|cuando (me )?llegue|when i (get|receive))"),
    ("tasks", r"\b(tarea|task|deadline|fecha l[ií]mite|entrega|plazo|tasca)"),
    ("calendar", r"\b(calendar|calendario|calendari|evento|event|reuni[oó]n|meeting|agenda)"),
    ("emails", r"\b(correo|email|mail|inbox|bandeja|missatge|urgente|urgent)"),
    ("today", r"\b(hoy|today|avui|pendiente|pending|qu[eé] tengo|what do i|what should i|qu[eè] tinc|ma[ñn]ana)"),
)


def intent_of(question: str) -> str:
    q = (question or "").lower()
    for name, pattern in _INTENTS:
        if re.search(pattern, q):
            return name
    return "general"


def _mail_item(m: dict) -> dict:
    t = m.get("triage") or {}
    return {"title": m.get("subject") or "(no subject)", "subtitle": (m.get("from") or "").split("<")[0].strip(),
            "badge": t.get("level"), "href": f"/inbox?id={m['id']}"}


async def ask(db: Session, user, question: str) -> dict:
    from app.services import observability

    intent = intent_of(question)
    demo_on = is_demo(db, user.id)
    notes: list[str] = []
    sections: list[dict] = []
    actions_: list[dict] = []
    ctx: dict = {"now": dt.datetime.now().astimezone().isoformat(timespec="minutes"), "demo": demo_on,
                 "memory_notes": memory.notes(db, user.id)[:10]}

    google = demo_on or "google" in conns.list_for(db, user.id)
    unread: list[dict] = []
    if google and intent in ("today", "emails", "general", "briefing"):
        try:
            unread = await list_mail(db, user.id, "in:inbox is:unread", 10)
        except AssistantError as exc:
            notes.append(exc.message)
        if demo_on:
            for m in unread:
                a = demo.analysis(m["id"]) or {}
                m["triage"] = m.get("triage") or {"level": priority.score(m, a, important=demo.IMPORTANT_SENDERS)["level"],
                                                  "action_required": a.get("action_required")}
    elif not google and intent in ("today", "emails"):
        notes.append("Google is not connected yet.")
        actions_.append({"label": "Connect Google", "kind": "navigate", "href": "/integrations/google"})

    if intent in ("today", "emails", "general", "briefing") and unread:
        need = [m for m in unread if (m.get("triage") or {}).get("action_required")
                or (m.get("triage") or {}).get("level") in ("high", "urgent")]
        shown = need if intent == "today" and need else unread
        sections.append({"key": "email", "title": "Email",
                         "summary": f"{len(need)} require action" if intent == "today" else f"{len(unread)} unread",
                         "count": len(need) if intent == "today" else len(unread),
                         "items": [_mail_item(m) for m in shown[:5]]})
        ctx["unread_emails"] = [{"from": m.get("from"), "subject": m.get("subject"), "snippet": m.get("snippet"),
                                 "priority": (m.get("triage") or {}).get("level")} for m in unread[:8]]
        actions_.append({"label": "Show emails", "kind": "navigate", "href": "/inbox?filter=action" if intent == "today" else "/inbox"})

    if intent in ("today", "calendar", "general", "briefing"):
        events = await _events_today(db, user.id, notes)
        if events or intent == "calendar":
            sections.append({"key": "calendar", "title": "Calendar", "summary": f"{len(events)} event{'s' if len(events) != 1 else ''} today",
                             "count": len(events),
                             "items": [{"title": e.get("title"), "subtitle": f"{str(e.get('start') or '')[11:16]} {e.get('location') or ''}".strip(),
                                        "href": e.get("link") or None} for e in events[:6]]})
        ctx["events_today"] = events

    if intent in ("today", "tasks", "general", "briefing"):
        dls = _deadlines(db, user.id)
        open_tasks = [] if demo_on else tasks.list_for(db, user.id, "open")
        if dls or intent == "tasks":
            sections.append({"key": "deadlines", "title": "Deadlines", "summary": f"{len(dls)} coming up", "count": len(dls),
                             "items": [{"title": d["title"], "subtitle": d["due"][:16].replace("T", " "), "href": d["href"],
                                        "badge": "overdue" if d.get("overdue") else None} for d in dls[:5]]})
        ctx["deadlines"] = dls
        ctx["open_tasks"] = [t["title"] for t in open_tasks[:10]]
        if intent == "tasks":
            actions_.append({"label": "Open tasks", "kind": "navigate", "href": "/tasks"})

    if intent in ("failures", "general", "today"):
        errs = demo.errors() if demo_on else (await observability.errors(db, user, None))["data"]
        if errs or intent == "failures":
            sections.append({"key": "errors", "title": "Problems", "summary": f"{len(errs)} open" if errs else "Nothing failing",
                             "count": len(errs),
                             "items": [{"title": e["title"], "subtitle": e.get("automation") or e.get("service") or "",
                                        "badge": e["severity"], "href": "/errors"} for e in errs[:5]]})
        ctx["open_problems"] = [{"title": e["title"], "cause": e.get("cause") or e.get("explanation"),
                                 "automation": e.get("automation")} for e in errs[:5]]
        if intent == "failures":
            actions_.append({"label": "Open error center", "kind": "navigate", "href": "/errors"})

    if intent == "briefing" or intent == "today":
        actions_.append({"label": "Create briefing", "kind": "briefing"})
    if intent == "automation":
        actions_.append({"label": "Open the builder with this", "kind": "navigate",
                         "href": "/automations/new?prompt=" + _urlquote(question[:300])})
        ctx["hint"] = "The user wants an automation. Explain briefly what it would do and point to the builder button."
    if intent == "calendar":
        actions_.append({"label": "Open Google Calendar", "kind": "external", "href": "https://calendar.google.com"})

    total = sum(s["count"] for s in sections if s["key"] in ("email", "calendar", "deadlines"))
    title = {"today": f"You have {total} thing{'s' if total != 1 else ''} to take care of.",
             "failures": "Here is what is failing." if any(s["key"] == "errors" and s["count"] for s in sections)
             else "Nothing is failing right now.",
             "emails": "Your inbox.", "calendar": "Your day.", "tasks": "Your deadlines.",
             "briefing": "Your briefing.", "automation": "Let's automate it."}.get(intent, "")
    seen = set()
    unique_actions = []
    for a in actions_:
        if a["label"] not in seen:
            seen.add(a["label"])
            unique_actions.append(a)
    return {"intent": intent, "title": title, "sections": sections, "actions": unique_actions, "notes": notes,
            "context": json.dumps(ctx, ensure_ascii=False, default=str)[:6000], "demo": demo_on}


def _urlquote(s: str) -> str:
    from urllib.parse import quote

    return quote(s, safe="")


# ----------------------------------------------------------- suggestions ----

async def suggestions(db: Session, user_id: uuid.UUID) -> list[dict]:
    """Patterns in the last weeks of mail that no automation covers yet."""
    from app.services.automations import manager

    hidden = memory.dismissed(db, user_id)
    if is_demo(db, user_id):
        out = [{"id": "weekly:entrenos@clubesportiu.cat", "kind": "weekly",
                "title": "You receive emails from Club Esportiu every Monday",
                "detail": "4 Mondays in a row. Get them summarised on Telegram automatically?",
                "prompt": "When I receive an email from entrenos@clubesportiu.cat, summarise it and send it to me on Telegram"},
               {"id": "pdf:attachments", "kind": "pdf", "title": "You often receive PDFs by email",
                "detail": "5 PDFs in the last month. Save them to Drive automatically?",
                "prompt": "When I receive an email with a PDF attachment, save it to Google Drive"}]
        return [s for s in out if s["id"] not in hidden]
    if "google" not in conns.list_for(db, user_id):
        return []
    try:
        ctx = _ctx(db, user_id)
        ids = await actions._gmail_list(ctx, "in:inbox newer_than:35d -category:promotions -category:social", 40)
        msgs = await actions._gmail_get(ctx, ids)
    except actions.ActionError:
        return []
    covered = json.dumps([w.meta.get("spec") for w in manager.list_mine(db, user_id)]).lower()
    counts: collections.Counter = collections.Counter()
    weekdays: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    weeks: dict[str, set] = collections.defaultdict(set)
    names: dict[str, str] = {}
    pdfs = 0
    for m in msgs:
        if any(str(a.get("filename", "")).lower().endswith(".pdf") for a in (m.get("attachments") or [])):
            pdfs += 1
        addr = memory.address_of(m["from"])
        if "@" not in addr or any(x in addr for x in ("noreply", "no-reply", "notifications", "mailer")):
            continue
        counts[addr] += 1
        names[addr] = m["from"].split("<")[0].strip().strip('"') or addr
        try:
            when = parsedate_to_datetime(m.get("date") or "")
            weekdays[addr][when.weekday()] += 1
            weeks[addr].add(when.isocalendar()[:2])
        except (TypeError, ValueError):
            pass
    out: list[dict] = []
    days = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
    for addr, n in counts.most_common(6):
        if addr in covered:
            continue
        day, same = (weekdays[addr].most_common(1) or [(None, 0)])[0]
        if day is not None and same >= 3 and len(weeks[addr]) >= 3:
            out.append({"id": f"weekly:{addr}", "kind": "weekly",
                        "title": f"You receive emails from {names[addr]} every {days[day]}",
                        "detail": f"{same} {days[day]}s in a row. Get them summarised on Telegram automatically?",
                        "prompt": f"When I receive an email from {addr}, summarise it and send it to me on Telegram"})
        elif n >= 3:
            out.append({"id": f"frequent:{addr}", "kind": "frequent",
                        "title": f"You get frequent email from {names[addr]}",
                        "detail": f"{n} emails in the last weeks. Get a Telegram alert when the next one arrives?",
                        "prompt": f"When I receive an email from {addr}, summarise it and send it to me on Telegram"})
    if pdfs >= 3 and "drive.save" not in covered:
        out.append({"id": "pdf:attachments", "kind": "pdf", "title": "You often receive PDFs by email",
                    "detail": f"{pdfs} PDFs recently. Save them to Drive automatically?",
                    "prompt": "When I receive an email with a PDF attachment, save it to Google Drive"})
    return [s for s in out if s["id"] not in hidden][:3]


# ---------------------------------------------------------- telegram bot ----

HELP = ("Hola 👋 Soy tu Personal Assistant. Puedes escribirme cualquier pregunta, o usar:\n"
        "/emails – correos sin leer\n/briefing – resumen del día\n/tasks – tareas y fechas límite\n"
        "/errors – qué falla\n/automations – tus automatizaciones\n/status – estado general\n"
        "/reply N – preparo una respuesta al correo N (te la enseño antes de enviar)")

PENDING_TTL = dt.timedelta(minutes=15)
CONFIRM_KEYBOARD = {"inline_keyboard": [[{"text": "✅ Enviar", "callback_data": "pa:send"},
                                         {"text": "✏️ Editar", "callback_data": "pa:edit"},
                                         {"text": "❌ Cancelar", "callback_data": "pa:cancel"}]]}


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


async def _bot_reply_draft(db: Session, user_id: uuid.UUID, n: int) -> tuple[str, dict | None]:
    mail = await list_mail(db, user_id, "in:inbox is:unread", 8)
    if not 1 <= n <= len(mail):
        return f"No encuentro el correo {n}. Escribe /emails para ver la lista.", None
    m = mail[n - 1]
    d = await draft_reply(db, user_id, m["id"])
    memory.set_state(db, user_id, "tg_pending_reply", {
        "message_id": m["id"], "subject": d["subject"], "to": d["to"], "body": d["body"],
        "expires": (_now() + PENDING_TTL).isoformat()})
    return (f"✍️ He preparado esta respuesta para <b>{_esc(d['to'])}</b>:\n\n<i>{_esc(d['body'])}</i>\n\n"
            "¿La envío? Nada se envía sin tu confirmación."), CONFIRM_KEYBOARD


def _pending(db: Session, user_id: uuid.UUID) -> dict | None:
    p = memory.get_state(db, user_id, "tg_pending_reply")
    if not p:
        return None
    if dt.datetime.fromisoformat(p["expires"]) < _now():
        memory.clear_state(db, user_id, "tg_pending_reply")
        return None
    return p


async def bot_callback(db: Session, user_id: uuid.UUID, data: str) -> str:
    p = _pending(db, user_id)
    if data == "pa:cancel":
        memory.clear_state(db, user_id, "tg_pending_reply")
        return "❌ Cancelado. No se ha enviado nada."
    if p is None:
        return "⌛ Esa respuesta ha caducado. Usa /reply N para preparar otra."
    if data == "pa:edit":
        return "✏️ Escribe <code>/edit</code> seguido del texto nuevo y te lo vuelvo a enseñar antes de enviar."
    if data == "pa:send":
        try:
            r = await send_reply(db, user_id, p["message_id"], p["body"])
        except AssistantError as exc:
            return f"⚠️ No se pudo enviar: {_esc(exc.message)}"
        memory.clear_state(db, user_id, "tg_pending_reply")
        if r.get("demo"):
            return "🧪 Modo demo: la respuesta no se ha enviado."
        return f"✅ Respuesta enviada a {_esc(p['to'])}."
    return "No entiendo ese botón."


async def bot_reply(db: Session, user_id: uuid.UUID, text: str) -> str | tuple[str, dict]:
    """Text answer, or (text, reply_markup) when the user must confirm something."""
    from app.models import User
    from app.services import observability
    from app.services.automations import manager

    raw = text.strip()
    cmd = raw.split()[0].lower().split("@")[0] if raw else ""
    arg = raw[len(raw.split()[0]):].strip() if raw else ""
    user = db.get(User, user_id)
    try:
        if cmd in ("/start", "/help"):
            return HELP
        if cmd == "/emails":
            mail = await list_mail(db, user_id, "in:inbox is:unread", 8)
            if not mail:
                return "📭 No tienes correos sin leer."
            marks = {"urgent": "🔴 ", "high": "🟠 "}
            lines = [f"{i + 1}. {marks.get((m.get('triage') or {}).get('level'), '')}<b>{_esc(m['subject'] or '')}</b>\n"
                     f"   {_esc(m['from'] or '')}" for i, m in enumerate(mail)]
            return (f"📬 Tienes {len(mail)} correo(s) sin leer:\n\n" + "\n".join(lines) +
                    "\n\n/reply N para responder a uno · /briefing para un resumen")
        if cmd == "/reply":
            if not arg.isdigit():
                return "Uso: /reply N (el número de la lista de /emails)."
            text_, markup_ = await _bot_reply_draft(db, user_id, int(arg))
            return (text_, markup_) if markup_ else text_
        if cmd == "/edit":
            p = _pending(db, user_id)
            if p is None:
                return "No hay ninguna respuesta pendiente. Usa /reply N."
            if not arg:
                return "Escribe /edit seguido del texto nuevo."
            p["body"] = arg[:3000]
            p["expires"] = (_now() + PENDING_TTL).isoformat()
            memory.set_state(db, user_id, "tg_pending_reply", p)
            return (f"✍️ Respuesta actualizada para <b>{_esc(p['to'])}</b>:\n\n<i>{_esc(p['body'])}</i>\n\n¿La envío?",
                    CONFIRM_KEYBOARD)
        if cmd == "/briefing":
            return briefing_text(await briefing(db, user_id))
        if cmd == "/tasks":
            dls = _deadlines(db, user_id, days=30)
            open_tasks = tasks.list_for(db, user_id, "open")
            if not dls and not open_tasks:
                return "✅ No tienes tareas abiertas."
            lines = [f"• {_esc(t['title'])}{' — ' + t['due_at'][:10] if t['due_at'] else ''}" for t in open_tasks[:8]]
            lines += [f"⏰ {_esc(d['title'])} — {d['due'][:10]}" for d in dls if d["href"] != "/tasks"][:5]
            return "📝 <b>Tus tareas</b>\n\n" + "\n".join(lines)
        if cmd == "/automations":
            if is_demo(db, user_id):
                return "⚙️ <b>Automatizaciones (demo)</b>\n\n" + "\n".join(
                    f"• {a['name']} — {a['success_rate']}% éxito" for a in demo.automations())
            mine = manager.list_mine(db, user_id)
            o = await observability.overview(db, user, None)
            lines = [f"• {_esc(w.name)} — {w.status.value}" for w in mine[:10]]
            return (f"⚙️ <b>Automatizaciones</b>: {o['automations']['total']} en total, {o['automations']['active']} activas\n"
                    + ("\n".join(lines) if lines else "Aún no has creado ninguna desde el panel."))
        if cmd == "/errors":
            errs = demo.errors() if is_demo(db, user_id) else (await observability.errors(db, user, None))["data"]
            if not errs:
                return "✅ Todo funciona, no hay errores abiertos."
            return "⚠️ <b>Problemas abiertos</b>\n\n" + "\n".join(
                f"• {_esc(e['title'])} → {_esc(e['action']['label'])}" for e in errs[:6])
        if cmd == "/status":
            o = await observability.overview(db, user, None)
            return (f"🟢 {_esc(o['system']['message'])}\n⚡ {o['automations']['custom']} automatizaciones propias · "
                    f"🔗 {o['integrations']['connected']}/{o['integrations']['total']} conexiones · "
                    f"✦ {o['ai']['requests_today']} peticiones IA hoy")
        # natural language: same context the web chat uses
        a = await ask(db, user, raw)
        data = await _ai(db, (f"The user asks via Telegram: «{raw[:800]}». Answer helpfully in their language, max 120 "
                              "words, using only this data; if it is not there, say what you can check (/emails, "
                              "/briefing, /tasks). Never claim you sent or changed anything."),
                         a["context"], {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
                         temperature=0.4)
        return _esc(str(data.get("text") or "No tengo respuesta para eso."))
    except AssistantError as exc:
        return f"⚠️ {_esc(exc.message)}"


async def _answer_callback(token: str, callback_id: str) -> None:
    try:
        await itelegram._call(token, "answerCallbackQuery", callback_query_id=callback_id)
    except itelegram.TelegramError:
        pass


async def poll_bot_once(db: Session) -> int:
    """One pass over every linked Telegram connection. Returns messages answered."""
    from sqlalchemy import select

    from app.models import Credential

    answered = 0
    rows = [r for r in db.scalars(select(Credential).where(Credential.provider == "telegram")).all()
            if (r.meta or {}).get("integration") and ((r.meta or {}).get("chat") or {}).get("id")]
    for row in rows:
        meta = row.meta or {}
        chat_id = meta["chat"]["id"]
        token = conns.secret_of(row).get("bot_token", "")
        offset = int(meta.get("update_offset") or 0)
        try:
            updates = await itelegram._call(token, "getUpdates", offset=offset + 1 if offset else 0, timeout=0,
                                            allowed_updates=["message", "callback_query"])
        except itelegram.TelegramError:
            continue
        last = offset
        for upd in updates if isinstance(updates, list) else []:
            last = max(last, int(upd.get("update_id", 0)))
            cb = upd.get("callback_query")
            if cb:
                if ((cb.get("message") or {}).get("chat") or {}).get("id") != chat_id:
                    continue  # buttons only work in the linked chat
                await _answer_callback(token, str(cb.get("id")))
                reply = await bot_callback(db, row.user_id, str(cb.get("data") or ""))
            else:
                msg = upd.get("message") or {}
                if (msg.get("chat") or {}).get("id") != chat_id or not msg.get("text"):
                    continue  # only the linked chat may talk to the assistant
                reply = await bot_reply(db, row.user_id, msg["text"])
            text, markup = reply if isinstance(reply, tuple) else (reply, None)
            try:
                await itelegram.send(db, row, text, reply_markup=markup)
                answered += 1
            except itelegram.TelegramError:
                pass
        if last != offset:
            conns.set_health(db, row, meta.get("health") or conns.HEALTHY, meta.get("health_detail", ""),
                             extra={"update_offset": last})
    return answered


async def scheduled_briefings(db: Session, now: dt.datetime | None = None) -> int:
    """Send the daily briefing on Telegram to users who asked for it, once a day."""
    from sqlalchemy import select

    from app.models import AssistantMemory, Credential

    now = now or dt.datetime.now().astimezone()
    sent = 0
    user_ids = {r.user_id for r in db.scalars(select(AssistantMemory).where(
        AssistantMemory.kind == "preference", AssistantMemory.key == "briefing_auto")).all() if (r.value or {}).get("v")}
    for uid in user_ids:
        prefs = memory.preferences(db, uid)
        if prefs["notification_channel"] != "telegram":
            continue
        hh, mm = (int(x) for x in prefs["briefing_time"].split(":"))
        if (now.hour, now.minute) < (hh, mm):
            continue
        if memory.get_state(db, uid, "briefing_sent").get("date") == now.date().isoformat():
            continue
        row = db.scalar(select(Credential).where(Credential.user_id == uid, Credential.provider == "telegram"))
        if row is None or not ((row.meta or {}).get("chat") or {}).get("id"):
            continue
        memory.set_state(db, uid, "briefing_sent", {"date": now.date().isoformat()})  # once, even if sending fails
        if is_demo(db, uid):
            continue  # demo never sends
        try:
            await itelegram.send(db, row, briefing_text(await briefing(db, uid)))
            sent += 1
        except (itelegram.TelegramError, AssistantError) as exc:
            log.warning("scheduled briefing not delivered: %s", getattr(exc, "message", exc))
    return sent


async def bot_loop(session_factory, interval: float = 4.0) -> None:
    while True:
        try:
            with session_factory() as db:
                await poll_bot_once(db)
                await scheduled_briefings(db)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - the loop must survive any single failure
            log.exception("telegram bot pass failed")
        await asyncio.sleep(interval)
