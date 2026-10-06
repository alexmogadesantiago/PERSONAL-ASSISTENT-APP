"""What every block actually does.

Each block key from `catalog` maps to a coroutine
    (ctx, params, item) -> list[item]
An empty list stops that branch (a condition that did not match); several items
fan out (a search that found five emails). Actions return the incoming item
enriched with their outputs, so later steps can use {{summary}} next to
{{subject}}.

All provider calls go through `health.authorized_request`, which refreshes
tokens and keeps the connection's health honest. Errors are `ActionError`s with
a message a person can act on and, when relevant, the integration to fix.
"""
from __future__ import annotations

import base64
import datetime as dt
import email.utils
import json
import uuid
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Any, Awaitable, Callable
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.services.automations import catalog
from app.services.automations.spec import lookup, render
from app.services.integrations import connections as conns
from app.services.integrations import health as ihealth
from app.services.integrations import providers as iproviders
from app.services.integrations import telegram as itelegram


class ActionError(Exception):
    def __init__(self, message: str, *, code: str = "action_failed", provider: str | None = None,
                 status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.code = code
        self.provider = provider
        self.status_code = status_code

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "provider": self.provider}


@dataclass
class Ctx:
    db: Session
    user_id: uuid.UUID
    #: persistent per-automation memory (seen ids for polling triggers)
    state: dict = field(default_factory=dict)
    #: a builder test run: polling triggers return recent items without
    #: marking them seen
    test: bool = False


# ------------------------------------------------------------ plumbing ----

def _connection(ctx: Ctx, provider_key: str, service: str | None):
    provider = iproviders.get(provider_key)
    row = conns.get(ctx.db, ctx.user_id, provider_key)
    if row is None:
        raise ActionError(f"Connect {provider.label} to use this step.", code="not_connected", provider=provider_key,
                          status_code=409)
    health = (row.meta or {}).get("health")
    if health in (conns.EXPIRED, conns.AUTH_REQUIRED):
        raise ActionError(f"{provider.label} needs you to sign in again.", code=health, provider=provider_key,
                          status_code=409)
    if service and provider.auth == "oauth2":
        granted = provider.services_granted((row.meta or {}).get("scopes") or [])
        if service not in granted:
            svc = provider.service(service)
            raise ActionError(f"Allow {svc.label if svc else service} access in your {provider.label} connection.",
                              code="permission_missing", provider=provider_key, status_code=409)
    return provider, row


async def _api(ctx: Ctx, provider_key: str, service: str | None, method: str, url: str, **kw) -> Any:
    provider, row = _connection(ctx, provider_key, service)
    try:
        r = await ihealth.authorized_request(ctx.db, row, provider, method, url, **kw)
    except ihealth.ConnectionUnavailable as exc:
        raise ActionError(exc.message, code=exc.health, provider=provider_key, status_code=409)
    if r.status_code >= 400:
        detail = ""
        try:
            body = r.json()
            detail = (body.get("error") or {}).get("message") if isinstance(body.get("error"), dict) else body.get("message", "")
        except ValueError:
            detail = r.text[:160]
        if r.status_code == 403:
            raise ActionError(f"{provider.label} refused: permission missing. {detail}".strip(), code="permission_missing",
                              provider=provider_key, status_code=409)
        if r.status_code == 404:
            raise ActionError(f"{provider.label}: not found. {detail}".strip(), code="not_found", provider=provider_key)
        if r.status_code == 429:
            raise ActionError(f"{provider.label} rate limit reached; it will be retried.", code="rate_limited",
                              provider=provider_key, status_code=429)
        raise ActionError(f"{provider.label} error (HTTP {r.status_code}). {detail}".strip(), provider=provider_key,
                          status_code=502)
    if not r.content:
        return {}
    try:
        return r.json()
    except ValueError:
        return {"raw": r.text}


def _seen(ctx: Ctx, ids: list[str]) -> list[str]:
    """Polling memory. First real poll primes: what already exists is not 'new'."""
    if ctx.test:
        return ids[:3]
    seen: list[str] = list(ctx.state.get("seen") or [])
    primed = bool(ctx.state.get("primed"))
    fresh = [i for i in ids if i not in seen]
    ctx.state["seen"] = (fresh + seen)[:500]
    ctx.state["primed"] = True
    return fresh if primed else []


# ---------------------------------------------------------------- Gmail ----

GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"


def _b64(data: str) -> str:
    try:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")
    except (ValueError, TypeError):
        return ""


def _gmail_text(payload: dict) -> tuple[str, list[dict]]:
    text, attachments = "", []
    stack = [payload]
    while stack:
        part = stack.pop(0)
        mime = part.get("mimeType", "")
        if part.get("filename"):
            attachments.append({"filename": part["filename"], "mime": mime})
        elif mime == "text/plain" and not text:
            text = _b64((part.get("body") or {}).get("data", ""))
        stack.extend(part.get("parts") or [])
    return text[:4000], attachments


def _gmail_item(msg: dict) -> dict:
    headers = {h["name"].lower(): h["value"] for h in (msg.get("payload") or {}).get("headers", [])}
    text, attachments = _gmail_text(msg.get("payload") or {})
    return {
        "id": msg.get("id"),
        "thread_id": msg.get("threadId"),
        "from": headers.get("from", ""),
        "to": headers.get("to", ""),
        "subject": headers.get("subject", "(no subject)"),
        "date": headers.get("date", ""),
        "snippet": msg.get("snippet", ""),
        "text": text or msg.get("snippet", ""),
        "has_attachments": bool(attachments),
        "attachments": attachments,
        "labels": msg.get("labelIds", []),
        "link": f"https://mail.google.com/mail/u/0/#all/{msg.get('id')}",
    }


async def _gmail_list(ctx: Ctx, query: str, limit: int) -> list[dict]:
    listing = await _api(ctx, "google", "gmail", "GET", f"{GMAIL}/messages",
                         params={"q": query or "in:inbox", "maxResults": max(1, min(int(limit or 10), 25))})
    return [m["id"] for m in listing.get("messages", [])]


async def _gmail_get(ctx: Ctx, ids: list[str]) -> list[dict]:
    out = []
    for mid in ids:
        msg = await _api(ctx, "google", "gmail", "GET", f"{GMAIL}/messages/{mid}", params={"format": "full"})
        out.append(_gmail_item(msg))
    return out


async def gmail_new_email(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    ids = await _gmail_list(ctx, p.get("query") or "in:inbox is:unread", 15)
    return await _gmail_get(ctx, _seen(ctx, ids))


async def gmail_search(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    ids = await _gmail_list(ctx, render(p.get("query"), item), int(p.get("max") or 20))
    return await _gmail_get(ctx, ids)


async def gmail_send(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    msg = EmailMessage()
    msg["To"] = render(p.get("to"), item)
    msg["Subject"] = render(p.get("subject"), item)
    msg.set_content(render(p.get("body"), item))
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    sent = await _api(ctx, "google", "gmail", "POST", f"{GMAIL}/messages/send", json={"raw": raw})
    return [{**item, "sent_message_id": sent.get("id")}]


# ------------------------------------------------------------- Calendar ----

def _window(days: Any) -> tuple[str, str]:
    now = dt.datetime.now(dt.timezone.utc)
    return now.isoformat(), (now + dt.timedelta(days=int(days or 1))).isoformat()


async def calendar_list(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    start, end = _window(p.get("days"))
    body = await _api(ctx, "google", "calendar", "GET",
                      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                      params={"timeMin": start, "timeMax": end, "singleEvents": "true", "orderBy": "startTime",
                              "maxResults": 25})
    return [{
        "title": e.get("summary", "(no title)"),
        "start": (e.get("start") or {}).get("dateTime") or (e.get("start") or {}).get("date"),
        "end": (e.get("end") or {}).get("dateTime") or (e.get("end") or {}).get("date"),
        "location": e.get("location", ""),
        "link": e.get("htmlLink", ""),
    } for e in body.get("items", [])]


def _parse_start(value: str) -> dt.datetime:
    v = value.strip()
    try:
        start = dt.datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        try:
            start = email.utils.parsedate_to_datetime(v)
        except (TypeError, ValueError):
            raise ActionError(f"«{v[:40]}» is not a date and time the calendar understands (use 2026-10-06T10:00).")
    if start.tzinfo is None:
        start = start.replace(tzinfo=dt.datetime.now().astimezone().tzinfo)
    return start


async def calendar_create(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    start = _parse_start(render(p.get("start"), item))
    end = start + dt.timedelta(minutes=int(p.get("duration_minutes") or 30))
    ev = await _api(ctx, "google", "calendar", "POST",
                    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                    json={"summary": render(p.get("title"), item), "description": render(p.get("description"), item),
                          "start": {"dateTime": start.isoformat()}, "end": {"dateTime": end.isoformat()}})
    return [{**item, "event_link": ev.get("htmlLink", "")}]


# ----------------------------------------------------- Drive/Sheets/Docs ----

async def drive_save(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    name = render(p.get("name"), item).strip()[:200] or "note.md"
    content = render(p.get("content"), item)
    boundary = "pa" + uuid.uuid4().hex
    meta = json.dumps({"name": name, "mimeType": "text/markdown" if name.endswith(".md") else "text/plain"})
    body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n"
            f"--{boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{content}\r\n--{boundary}--").encode()
    f = await _api(ctx, "google", "drive", "POST",
                   "https://www.googleapis.com/upload/drive/v3/files",
                   params={"uploadType": "multipart", "fields": "id,name,webViewLink"},
                   content=body, headers={"Content-Type": f"multipart/related; boundary={boundary}"})
    return [{**item, "drive_link": f.get("webViewLink", "")}]


async def sheets_append(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    values = [v.strip() for v in render(p.get("values"), item).split("|")]
    sheet = (p.get("sheet") or "Sheet1").strip()
    rng = quote(f"{sheet}!A1", safe="")
    r = await _api(ctx, "google", "sheets", "POST",
                   f"https://sheets.googleapis.com/v4/spreadsheets/{quote(str(p.get('spreadsheet_id')).strip(), safe='')}/values/{rng}:append",
                   params={"valueInputOption": "USER_ENTERED"}, json={"values": [values]})
    return [{**item, "updated_range": (r.get("updates") or {}).get("updatedRange", "")}]


async def docs_create(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    doc = await _api(ctx, "google", "docs", "POST", "https://docs.googleapis.com/v1/documents",
                     json={"title": render(p.get("title"), item)[:200]})
    doc_id = doc.get("documentId")
    text = render(p.get("content"), item)
    if doc_id and text:
        await _api(ctx, "google", "docs", "POST", f"https://docs.googleapis.com/v1/documents/{doc_id}:batchUpdate",
                   json={"requests": [{"insertText": {"location": {"index": 1}, "text": text}}]})
    return [{**item, "doc_link": f"https://docs.google.com/document/d/{doc_id}/edit" if doc_id else ""}]


# ------------------------------------------------------------ Microsoft ----

GRAPH = "https://graph.microsoft.com/v1.0"


def _outlook_item(m: dict) -> dict:
    sender = ((m.get("from") or {}).get("emailAddress") or {})
    return {
        "id": m.get("id"),
        "from": f"{sender.get('name', '')} <{sender.get('address', '')}>".strip(),
        "to": "",
        "subject": m.get("subject") or "(no subject)",
        "date": m.get("receivedDateTime", ""),
        "snippet": m.get("bodyPreview", ""),
        "text": m.get("bodyPreview", ""),
        "has_attachments": bool(m.get("hasAttachments")),
        "link": m.get("webLink", ""),
    }


async def outlook_new_email(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    params = {"$top": 15, "$select": "id,subject,from,receivedDateTime,bodyPreview,hasAttachments,webLink",
              "$orderby": "receivedDateTime desc", "$filter": "isRead eq false"}
    body = await _api(ctx, "microsoft", "outlook", "GET", f"{GRAPH}/me/mailFolders/inbox/messages", params=params)
    msgs = body.get("value", [])
    needle = str(p.get("search") or "").lower().strip()
    if needle:
        msgs = [m for m in msgs if needle in (m.get("subject", "") + m.get("bodyPreview", "")).lower()]
    by_id = {m["id"]: m for m in msgs}
    return [_outlook_item(by_id[i]) for i in _seen(ctx, list(by_id))]


async def outlook_send(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    await _api(ctx, "microsoft", "outlook", "POST", f"{GRAPH}/me/sendMail", json={"message": {
        "subject": render(p.get("subject"), item),
        "body": {"contentType": "Text", "content": render(p.get("body"), item)},
        "toRecipients": [{"emailAddress": {"address": a.strip()}} for a in render(p.get("to"), item).split(",") if a.strip()],
    }})
    return [item]


async def outlook_calendar_list(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    start, end = _window(p.get("days"))
    body = await _api(ctx, "microsoft", "calendar", "GET", f"{GRAPH}/me/calendarview",
                      params={"startDateTime": start, "endDateTime": end, "$top": 25, "$orderby": "start/dateTime"})
    return [{"title": e.get("subject", ""), "start": (e.get("start") or {}).get("dateTime"),
             "end": (e.get("end") or {}).get("dateTime"), "location": (e.get("location") or {}).get("displayName", ""),
             "link": e.get("webLink", "")} for e in body.get("value", [])]


async def onedrive_save(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    name = render(p.get("name"), item).strip().replace("/", "-")[:200] or "note.md"
    f = await _api(ctx, "microsoft", "onedrive", "PUT",
                   f"{GRAPH}/me/drive/root:/Personal Assistant/{quote(name)}:/content",
                   content=render(p.get("content"), item).encode(), headers={"Content-Type": "text/plain"})
    return [{**item, "onedrive_link": f.get("webUrl", "")}]


async def teams_post(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    await _api(ctx, "microsoft", "teams", "POST",
               f"{GRAPH}/teams/{quote(str(p.get('team_id')))}/channels/{quote(str(p.get('channel_id')))}/messages",
               json={"body": {"content": render(p.get("message"), item)}})
    return [item]


# --------------------------------------------------------------- GitHub ----

GH = "https://api.github.com"


async def github_notifications(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    body = await _api(ctx, "github", "notifications", "GET", f"{GH}/notifications", params={"per_page": 25})
    by_id = {}
    for n in body if isinstance(body, list) else []:
        subj = n.get("subject") or {}
        url = (subj.get("url") or "").replace("api.github.com/repos", "github.com").replace("/pulls/", "/pull/")
        by_id[f"{n.get('id')}:{n.get('updated_at')}"] = {
            "title": subj.get("title", ""), "repo": (n.get("repository") or {}).get("full_name", ""),
            "type": subj.get("type", ""), "reason": n.get("reason", ""), "link": url, "updated_at": n.get("updated_at", ""),
        }
    return [by_id[i] for i in _seen(ctx, list(by_id))]


async def github_prs(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    body = await _api(ctx, "github", "repos", "GET", f"{GH}/search/issues",
                      params={"q": "is:pr is:open review-requested:@me archived:false", "per_page": 20})
    return [{"title": i.get("title", ""), "repo": i.get("repository_url", "").split("/repos/")[-1],
             "link": i.get("html_url", ""), "author": (i.get("user") or {}).get("login", ""),
             "updated_at": i.get("updated_at", "")} for i in body.get("items", [])]


async def github_releases(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    repo = render(p.get("repo"), item).strip()
    body = await _api(ctx, "github", "repos", "GET", f"{GH}/repos/{repo}/releases", params={"per_page": 5})
    return [{"title": r.get("name") or r.get("tag_name", ""), "tag": r.get("tag_name", ""), "link": r.get("html_url", ""),
             "published_at": r.get("published_at", "")} for r in (body if isinstance(body, list) else [])]


async def github_issue(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    repo = render(p.get("repo"), item).strip()
    issue = await _api(ctx, "github", "repos", "POST", f"{GH}/repos/{repo}/issues",
                       json={"title": render(p.get("title"), item)[:250], "body": render(p.get("body"), item)})
    return [{**item, "issue_link": issue.get("html_url", "")}]


# ------------------------------------------------------------- Telegram ----

def _html_escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


async def telegram_send(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    _, row = _connection(ctx, "telegram", None)
    text = render(p.get("message"), item).strip() or "(empty message)"
    try:
        sent = await itelegram.send(ctx.db, row, _html_escape(text))
    except itelegram.TelegramError as exc:
        raise ActionError(exc.message, code="telegram", provider="telegram", status_code=409)
    return [{**item, "telegram_message_id": sent.get("message_id")}]


# ------------------------------------------------------------------- AI ----

def _item_text(item: dict) -> str:
    keep = {k: v for k, v in item.items() if k not in ("attachments", "labels", "id", "thread_id")}
    return json.dumps(keep, ensure_ascii=False, default=str)[:6000]


async def _ai(ctx: Ctx, instruction: str, item: dict, schema: dict) -> dict:
    from app.services.ai.errors import AIError
    from app.services.ai.service import AIService

    service = AIService.from_db(ctx.db)
    try:
        result = await service.generate(
            [{"role": "system", "content": "You are the user's personal assistant. Be accurate and concise. "
                                           "Never invent facts that are not in the data."},
             {"role": "user", "content": f"{instruction}\n\nData:\n{_item_text(item)}"}],
            response_format={"type": "json_schema", "schema": schema},
            temperature=0.2,
        )
    except AIError as exc:
        raise ActionError(f"AI step failed: {exc.message}", code="ai", status_code=502)
    data = result.response.data
    if not isinstance(data, dict):
        raise ActionError("The AI answer could not be read.", code="ai", status_code=502)
    return data


async def ai_summarize(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    data = await _ai(ctx, render(p.get("instruction"), item) or "Summarize in two sentences.", item,
                     {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"]})
    return [{**item, "summary": str(data.get("summary", ""))}]


async def ai_classify(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    cats = [c.strip() for c in str(p.get("categories") or "").split(",") if c.strip()]
    data = await _ai(ctx, f"Classify into exactly one of: {', '.join(cats)}. {render(p.get('instruction'), item)}",
                     item, {"type": "object", "properties": {"category": {"type": "string"}, "reason": {"type": "string"}},
                            "required": ["category", "reason"]})
    category = str(data.get("category", "")).strip()
    match = next((c for c in cats if c.lower() == category.lower()), cats[-1] if cats else category)
    return [{**item, "category": match, "reason": str(data.get("reason", ""))}]


async def ai_extract(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    fields = [f.strip().replace(" ", "_") for f in str(p.get("fields") or "").split(",") if f.strip()][:12]
    schema = {"type": "object", "properties": {f: {"type": "string"} for f in fields}, "required": fields}
    data = await _ai(ctx, f"Extract these fields (empty string when absent): {', '.join(fields)}. "
                          f"Dates as ISO 8601. {render(p.get('instruction'), item)}", item, schema)
    return [{**item, "extracted": {f: str(data.get(f, "")) for f in fields}}]


async def ai_compose(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    data = await _ai(ctx, render(p.get("prompt"), item), item,
                     {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]})
    return [{**item, "text": str(data.get("text", ""))}]


# ------------------------------------------------------- logic/transform ----

async def condition_match(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    value = lookup(item, str(p.get("field") or ""))
    op = p.get("operator") or "contains"
    text = "" if value is None else (json.dumps(value) if isinstance(value, (dict, list)) else str(value))
    needles = [n.strip().lower() for n in str(p.get("value") or "").split("|") if n.strip()]
    hay = text.lower()
    ok = {
        "contains": any(n in hay for n in needles) if needles else bool(hay),
        "not_contains": not any(n in hay for n in needles),
        "equals": hay in needles,
        "starts_with": any(hay.startswith(n) for n in needles),
        "is_true": value in (True, "true", "yes", 1, "1"),
        "is_false": value in (False, "false", "no", 0, "0", None, ""),
        "is_empty": not hay.strip(),
        "not_empty": bool(hay.strip()),
    }.get(op, False)
    return [item] if ok else []


async def trigger_now(ctx: Ctx, p: dict, item: dict) -> list[dict]:
    return [{"now": dt.datetime.now().astimezone().isoformat(timespec="minutes")}]


def combine(items: list[dict]) -> list[dict]:
    return [{"items": items, "count": len(items)}] if items else []


Handler = Callable[[Ctx, dict, dict], Awaitable[list[dict]]]

HANDLERS: dict[str, Handler] = {
    "schedule": trigger_now,
    "manual": trigger_now,
    "gmail.new_email": gmail_new_email,
    "outlook.new_email": outlook_new_email,
    "github.notifications": github_notifications,
    "condition.match": condition_match,
    "ai.summarize": ai_summarize,
    "ai.classify": ai_classify,
    "ai.extract": ai_extract,
    "ai.compose": ai_compose,
    "telegram.send": telegram_send,
    "gmail.search": gmail_search,
    "gmail.send": gmail_send,
    "calendar.list_events": calendar_list,
    "calendar.create_event": calendar_create,
    "drive.save_text": drive_save,
    "sheets.append_row": sheets_append,
    "docs.create": docs_create,
    "outlook.send": outlook_send,
    "outlook_calendar.list_events": outlook_calendar_list,
    "onedrive.save_text": onedrive_save,
    "teams.post": teams_post,
    "github.pull_requests": github_prs,
    "github.releases": github_releases,
    "github.create_issue": github_issue,
}

missing = [b.key for b in catalog.BLOCKS if b.kind != "transform" and b.key not in HANDLERS]
assert not missing, f"blocks without an implementation: {missing}"


async def run(ctx: Ctx, block_key: str, params: dict, item: dict) -> list[dict]:
    handler = HANDLERS.get(block_key)
    if handler is None:
        raise ActionError(f"unknown block {block_key}")
    out = await handler(ctx, params, item or {})
    return [o for o in out if isinstance(o, dict)]
