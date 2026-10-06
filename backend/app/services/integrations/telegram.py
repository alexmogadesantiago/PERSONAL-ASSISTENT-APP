"""Telegram: a bot token and a linked chat, with no chat id to copy by hand.

    1. the user pastes the token @BotFather gave them  -> getMe validates it
    2. the hub shows  https://t.me/<bot>?start=<code>  (one tap opens Telegram)
    3. the user presses Start; Telegram delivers "/start <code>" to the bot
    4. `check_link` finds that message with getUpdates and stores the chat

The code is random and single-purpose, so nobody else's chat can be linked by
guessing. The bot token is encrypted like every other secret and only its last
four characters are ever shown.
"""
from __future__ import annotations

import re
import secrets
import uuid

import httpx
from sqlalchemy.orm import Session

from app.models import Credential
from app.services.integrations import connections as conns
from app.services.integrations import http
from app.services.integrations.providers import TELEGRAM

API = "https://api.telegram.org"
TOKEN_RE = re.compile(r"^\d{5,15}:[A-Za-z0-9_-]{30,}$")


class TelegramError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


async def _call(token: str, method: str, **params) -> dict:
    try:
        async with http.client() as c:
            r = await c.post(f"{API}/bot{token}/{method}", json=params)
    except httpx.HTTPError as exc:
        raise TelegramError(f"Could not reach Telegram ({type(exc).__name__}).", 502)
    try:
        body = r.json()
    except ValueError:
        raise TelegramError(f"Telegram sent an unreadable response (HTTP {r.status_code}).", 502)
    if not body.get("ok"):
        code = body.get("error_code") or r.status_code
        desc = str(body.get("description") or "")
        if code == 401:
            raise TelegramError("Telegram rejected this bot token. Copy it again from @BotFather.", 401)
        if code == 403:
            raise TelegramError("The bot cannot write to your chat (it was blocked or the chat left). Link it again.", 403)
        if code == 409:
            raise TelegramError("This bot has a webhook set, so links cannot be detected. Remove the webhook in @BotFather.", 409)
        raise TelegramError(f"Telegram error: {desc or code}", 502)
    return body.get("result") or {}


def _new_code() -> str:
    return "pa" + secrets.token_hex(6)


async def connect(db: Session, user_id: uuid.UUID, bot_token: str, *, correlation_id: str | None = None) -> Credential:
    token = (bot_token or "").strip()
    if not TOKEN_RE.match(token):
        raise TelegramError("That does not look like a bot token (it should be like 123456789:AA…).")
    me = await _call(token, "getMe")
    existing = conns.get(db, user_id, TELEGRAM.key)
    keep_chat = None
    if existing is not None:
        prev = existing.meta or {}
        if (prev.get("bot") or {}).get("id") == me.get("id"):
            keep_chat = prev.get("chat")
    meta = {
        "services": ["messages"],
        "scopes": ["bot:send"],
        "account": {"name": me.get("first_name", ""), "login": me.get("username", "")},
        "bot": {"id": me.get("id"), "username": me.get("username", ""), "name": me.get("first_name", "")},
        "chat": keep_chat,
        "link_code": None if keep_chat else _new_code(),
    }
    return conns.save(
        db, user_id, TELEGRAM, secret={"bot_token": token}, meta=meta,
        health=conns.HEALTHY if keep_chat else conns.PENDING, correlation_id=correlation_id,
    )


def link_url(row: Credential) -> str | None:
    meta = row.meta or {}
    bot = (meta.get("bot") or {}).get("username")
    code = meta.get("link_code")
    if not bot or not code:
        return None
    return f"https://t.me/{bot}?start={code}"


def new_link_code(db: Session, row: Credential) -> str:
    code = _new_code()
    conns.set_health(db, row, conns.PENDING, "Waiting for you to press Start in Telegram",
                     extra={"link_code": code, "chat": None})
    return code


async def check_link(db: Session, row: Credential) -> bool:
    """True once the chat is linked. Idempotent: call it while the user taps."""
    meta = row.meta or {}
    if meta.get("chat"):
        return True
    code = meta.get("link_code")
    if not code:
        return False
    token = conns.secret_of(row).get("bot_token", "")
    updates = await _call(token, "getUpdates", timeout=0, allowed_updates=["message"])
    for upd in reversed(updates if isinstance(updates, list) else []):
        msg = upd.get("message") or {}
        text = str(msg.get("text") or "").strip()
        if text in (f"/start {code}", f"/start@{(meta.get('bot') or {}).get('username', '')} {code}"):
            chat = msg.get("chat") or {}
            title = chat.get("title") or " ".join(
                x for x in (chat.get("first_name"), chat.get("last_name")) if x
            ) or chat.get("username") or "your chat"
            conns.set_health(
                db, row, conns.HEALTHY, "Chat linked",
                extra={"chat": {"id": chat.get("id"), "title": title, "type": chat.get("type", "private")},
                       "link_code": None},
            )
            try:
                await _call(token, "sendMessage", chat_id=chat.get("id"),
                            text="✅ Personal Assistant is connected. Alerts and summaries will arrive here.")
            except TelegramError:
                pass
            return True
    return False


async def send(db: Session, row: Credential, text: str, *, parse_mode: str | None = "HTML",
               reply_markup: dict | None = None) -> dict:
    meta = row.meta or {}
    chat = (meta.get("chat") or {}).get("id")
    if not chat:
        raise TelegramError("Telegram is connected but no chat is linked yet.", 409)
    token = conns.secret_of(row).get("bot_token", "")
    params: dict = {"chat_id": chat, "text": text[:4096], "disable_web_page_preview": True}
    if parse_mode:
        params["parse_mode"] = parse_mode
    if reply_markup:
        params["reply_markup"] = reply_markup
    try:
        result = await _call(token, "sendMessage", **params)
    except TelegramError as exc:
        if exc.status_code in (401, 403):
            conns.set_health(db, row, conns.AUTH_REQUIRED if exc.status_code == 401 else conns.DEGRADED, exc.message)
        raise
    conns.touch_used(db, row)
    from app.services import usage

    usage.bump(db, "telegram_messages")
    return {"message_id": result.get("message_id")}


async def test(db: Session, row: Credential):
    from app.services.integrations.health import Check, TestOutcome

    checks: list[Check] = []
    token = conns.secret_of(row).get("bot_token", "")
    try:
        me = await _call(token, "getMe")
        checks.append(Check("auth", "Bot token", True, f"@{me.get('username', '')}"))
    except TelegramError as exc:
        checks.append(Check("auth", "Bot token", False, exc.message))
        health = conns.AUTH_REQUIRED if exc.status_code == 401 else conns.ERROR
        return TestOutcome(False, health, exc.message, "reconnect" if exc.status_code == 401 else "retry", checks)
    chat = (row.meta or {}).get("chat") or {}
    if not chat.get("id"):
        checks.append(Check("chat", "Linked chat", False, "Press Start in Telegram to link your chat"))
        return TestOutcome(False, conns.PENDING, "Bot connected. Link your chat to finish.", "link_chat", checks)
    try:
        await _call(token, "getChat", chat_id=chat["id"])
        checks.append(Check("chat", "Linked chat", True, str(chat.get("title", ""))))
    except TelegramError as exc:
        checks.append(Check("chat", "Linked chat", False, exc.message))
        return TestOutcome(False, conns.DEGRADED, exc.message, "link_chat", checks)
    checks.append(Check("messages", "Messages", True, "Ready to send"))
    return TestOutcome(True, conns.HEALTHY, "Everything is working correctly.", "", checks)
