"""v3.0: memory, priority engine, tasks, demo mode, ask, insights, briefing 2.0,
Telegram confirmation flow, notify relay, dependencies, n8n center, retry advice,
privacy/security. Every external HTTP call is mocked (mock tests, not real services)."""
from __future__ import annotations

import base64
import datetime as dt
import json

import anyio
import httpx
import pytest
from sqlalchemy import select

from app.services import assistant, memory, priority, tasks
from tests.test_assistant import ai, rec  # noqa: F401  (fixtures)
from tests.test_automations import _connect, auth, register  # noqa: F401
from tests.test_automations import apis  # noqa: F401


# ------------------------------------------------------------- priority ----

def test_priority_explains_itself_and_known_sender_outranks_newsletter():
    now = dt.datetime(2026, 10, 6, 9, tzinfo=dt.timezone.utc)
    deadline = (now + dt.timedelta(hours=30)).isoformat()
    teacher = priority.score(
        {"from": "Marta <marta@school.edu>", "subject": "Entrega urgente", "snippet": "antes del viernes", "labels": []},
        {"priority": "high", "deadline": deadline, "action_required": True},
        important={"marta@school.edu": "tutor"}, now=now)
    news = priority.score({"from": "news@tech.io", "subject": "Weekly", "snippet": "", "labels": []},
                          {"priority": "low"}, now=now)
    assert teacher["level"] == "urgent" and news["level"] == "low"
    labels = [r["label"] for r in teacher["reasons"]]
    assert any("important sender" in x for x in labels) and "Deadline within 48 hours" in labels
    assert all(r["positive"] == (r["weight"] > 0) for r in teacher["reasons"])
    assert priority.at_least("high", "normal") and not priority.at_least("low", "high")


def test_priority_domain_rule_and_frequent_sender():
    r = priority.score({"from": "x@uni.edu", "subject": "hi", "snippet": ""}, {}, important={"@uni.edu": ""}, sender_count=0)
    assert any("important sender" in x["label"] for x in r["reasons"])
    r2 = priority.score({"from": "y@z.com", "subject": "hi", "snippet": ""}, {}, sender_count=5)
    assert any("often" in x["label"] for x in r2["reasons"])


# --------------------------------------------------------------- memory ----

def test_memory_preferences_validate_and_refuse_secrets(client):
    token = register(client)
    h = auth(token)
    assert client.get("/api/assistant/memory", headers=h).json()["preferences"]["briefing_time"] == "08:00"
    ok = client.put("/api/assistant/memory/preferences", headers=h, json={"key": "briefing_time", "value": "07:30"})
    assert ok.json()["preferences"]["briefing_time"] == "07:30"
    assert client.put("/api/assistant/memory/preferences", headers=h, json={"key": "briefing_time", "value": "25:99"}).status_code == 422
    assert client.put("/api/assistant/memory/preferences", headers=h, json={"key": "nope", "value": 1}).status_code == 422
    secret = client.post("/api/assistant/memory", headers=h, json={"kind": "note", "value": "my password is hunter2"})
    assert secret.status_code == 422 and "never stores secrets" in secret.json()["detail"]["message"]
    bot = client.post("/api/assistant/memory", headers=h, json={"kind": "note", "value": "token 123456789:" + "A" * 35})
    assert bot.status_code == 422


def test_memory_senders_notes_edit_delete_and_isolation(client):
    t1 = register(client)
    h1 = auth(t1)
    ov = client.post("/api/assistant/memory", headers=h1, json={"kind": "sender", "value": "Ana <ana@school.edu>", "label": "tutor"}).json()
    sender = next(i for i in ov["items"] if i["kind"] == "sender")
    assert sender["key"] == "ana@school.edu"
    ov = client.post("/api/assistant/memory", headers=h1, json={"kind": "note", "value": "My tutor is Ana"}).json()
    note = next(i for i in ov["items"] if i["kind"] == "note")
    edited = client.patch(f"/api/assistant/memory/{note['id']}", headers=h1, json={"value": "My tutor is Ana Puig"})
    assert edited.json()["value"] == "My tutor is Ana Puig"
    # another user cannot touch it
    t2 = register(client, "second", "second@example.com")
    assert client.delete(f"/api/assistant/memory/{note['id']}", headers=auth(t2)).status_code == 404
    assert client.delete(f"/api/assistant/memory/{note['id']}", headers=h1).status_code == 204
    assert client.post("/api/assistant/memory", headers=h1, json={"kind": "sender", "value": "not an address"}).status_code == 422
    assert client.delete("/api/assistant/memory?kind=sender", headers=h1).json()["deleted"] == 1
    assert client.delete("/api/assistant/memory?kind=state", headers=h1).status_code == 422


# ---------------------------------------------------------------- tasks ----

def test_tasks_crud_idempotent_from_email_and_ownership(client):
    t1 = register(client)
    h = auth(t1)
    src = {"type": "email", "message_id": "m1", "subject": "TDR", "from": "marta@school.edu"}
    a = client.post("/api/assistant/tasks", headers=h, json={"title": "Send the TDR", "due": "2020-01-01", "source": src})
    assert a.status_code == 201 and a.json()["overdue"] is True
    again = client.post("/api/assistant/tasks", headers=h, json={"title": "Send the TDR", "source": src})
    assert again.json()["id"] == a.json()["id"], "the same email action makes one task"
    assert client.post("/api/assistant/tasks", headers=h, json={"title": "x", "due": "tomorrow-ish"}).status_code == 422
    done = client.patch(f"/api/assistant/tasks/{a.json()['id']}", headers=h, json={"status": "done"}).json()
    assert done["status"] == "done" and done["completed_at"]
    assert client.get("/api/assistant/tasks", headers=h).json()["data"] == []
    assert len(client.get("/api/assistant/tasks?status=done", headers=h).json()["data"]) == 1
    t2 = register(client, "second", "second@example.com")
    assert client.delete(f"/api/assistant/tasks/{a.json()['id']}", headers=auth(t2)).status_code == 404
    assert client.delete(f"/api/assistant/tasks/{a.json()['id']}", headers=h).status_code == 204


# ------------------------------------------------------ mail with v3 data ----

def test_analyze_returns_priority_with_reasons_and_tasks_and_caches_triage(client, rec, ai, session_factory):
    token = register(client)
    _connect(session_factory)
    h = auth(token)
    client.post("/api/assistant/memory", headers=h, json={"kind": "sender", "value": "billing@acme.com", "label": "vendor"})
    a = client.post("/api/assistant/mail/m1/analyze", headers=h).json()
    assert a["priority"] in ("high", "urgent") and a["priority_reasons"]
    assert any("important sender" in r["label"] for r in a["priority_reasons"])
    assert a["ai_priority"] == "high" and a["demo"] is False
    mail = client.get("/api/assistant/mail", headers=h).json()["data"]
    first = next(m for m in mail if m["id"] == "m1")
    assert first["triage"]["level"] == a["priority"] and first["important_sender"] is True
    assert "summary" not in json.dumps(memory.triage(client.app.dependency_overrides and None or _db(session_factory), _uid(session_factory))), \
        "the cache never keeps the AI summary or body"


def _db(sf):
    return sf()


def _uid(sf):
    from app.models import User

    with sf() as db:
        return db.scalar(select(User)).id


def test_draft_tones_reach_the_model_and_user_edit_is_what_gets_sent(client, rec, session_factory, monkeypatch):
    token = register(client)
    _connect(session_factory)
    h = auth(token)
    seen: list[str] = []

    async def fake_ai(db, instruction, data, schema, temperature=0.2):
        seen.append(instruction)
        return {"body": "Texto generado"}

    monkeypatch.setattr(assistant, "_ai", fake_ai)
    for tone, needle in (("formal", "formal"), ("concise", "very brief"), ("informal", "informal"), ("detailed", "detailed")):
        d = client.post("/api/assistant/mail/m1/draft", headers=h, json={"tone": tone}).json()
        assert d["tone"] == tone and needle in seen[-1]
    assert client.post("/api/assistant/mail/m1/draft", headers=h, json={"tone": "rude"}).status_code == 422
    client.post("/api/assistant/mail/m1/reply", headers=h, json={"body": "Mi versión editada"})
    raw = base64.urlsafe_b64decode(rec.sent_mail[-1]["raw"]).decode()
    assert "Mi versión editada" in raw and "Texto generado" not in raw


def test_message_id_is_validated_before_reaching_gmail(client, rec, session_factory):
    token = register(client)
    _connect(session_factory)
    r = client.get("/api/assistant/mail/..%2F..%2Fsettings", headers=auth(token))
    assert r.status_code in (404, 422)
    assert client.post("/api/assistant/mail/bad id!/analyze", headers=auth(token)).status_code in (404, 422)


def test_archive_needs_the_optional_permission_and_audits(client, rec, session_factory):
    token = register(client)
    _connect(session_factory)  # gmail/calendar/drive only
    r = client.post("/api/assistant/mail/m1/modify", headers=auth(token), json={"action": "archive"})
    assert r.status_code == 409 and "Organize Gmail" in r.json()["detail"]["message"]

    from app.models import User
    from app.services.integrations import connections as conns
    from app.services.integrations import providers

    with session_factory() as db:
        user = db.scalar(select(User))
        conns.save(db, user.id, providers.GOOGLE,
                   secret={"access_token": "ya29.t", "refresh_token": "r", "expires_at": 9_999_999_999},
                   meta={"scopes": providers.GOOGLE.scopes_for(["gmail", "calendar", "gmail_manage"]),
                         "services": ["gmail", "calendar", "gmail_manage"], "account": {"email": "a@x.com"}})
    calls: list[dict] = []
    base = rec.__call__

    def with_modify(req):
        if str(req.url).endswith("/modify"):
            calls.append(json.loads(req.content))
            return httpx.Response(200, json={"id": "m1"})
        return base(req)

    from app.services.integrations import http as int_http

    int_http.set_transport(httpx.MockTransport(with_modify))
    ok = client.post("/api/assistant/mail/m1/modify", headers=auth(token), json={"action": "archive"})
    assert ok.json()["done"] is True and calls == [{"removeLabelIds": ["INBOX"]}]
    assert client.post("/api/assistant/mail/m1/modify", headers=auth(token), json={"action": "delete"}).status_code == 422, \
        "deleting is not an action the assistant offers"


# -------------------------------------------------------------- demo mode ----

def test_demo_mode_serves_sample_data_and_never_sends(client, rec, ai, session_factory):
    token = register(client)
    h = auth(token)  # not even connected to Google
    assert client.get("/api/assistant/mail", headers=h).status_code == 409
    client.put("/api/assistant/memory/preferences", headers=h, json={"key": "demo_mode", "value": True})
    mail = client.get("/api/assistant/mail", headers=h).json()
    assert mail["demo"] is True and len(mail["data"]) == 5
    a = client.post("/api/assistant/mail/demo-1/analyze", headers=h).json()
    assert a["demo"] is True and a["priority"] in ("high", "urgent") and a["tasks"]
    sent = client.post("/api/assistant/mail/demo-1/reply", headers=h, json={"body": "hola"}).json()
    assert sent["sent"] is False and sent["demo"] is True
    assert rec.sent_mail == [], "nothing leaves the machine in demo mode"
    assert client.post("/api/assistant/mail/demo-1/modify", headers=h, json={"action": "archive"}).json()["demo"] is True
    b = client.post("/api/assistant/briefing", headers=h).json()
    assert b["demo"] is True and len(b["events"]) == 3 and len(b["deadlines"]) == 1 and b["summary"]
    client.put("/api/assistant/memory/preferences", headers=h, json={"key": "demo_mode", "value": False})
    assert client.get("/api/assistant/mail", headers=h).status_code == 409


def test_showcase_is_always_sample_data(client):
    token = register(client)
    d = client.get("/api/assistant/demo/showcase", headers=auth(token)).json()
    assert d["demo"] is True and len(d["automations"]) == 4 and len(d["executions"]) == 2 and len(d["errors"]) == 1
    assert len(d["emails"]) == 5 and len(d["events"]) == 3 and len(d["deadlines"]) == 1 and d["enabled"] is False


# ------------------------------------------------------ briefing / ask / insights --

def test_briefing_v2_has_sections_and_telegram_text(client, rec, ai, session_factory):
    token = register(client)
    _connect(session_factory)
    h = auth(token)
    b = client.post("/api/assistant/briefing", headers=h).json()
    for key in ("greeting", "emails", "important", "events", "deadlines", "automations", "problems", "summary"):
        assert key in b
    text = assistant.briefing_text(b)
    assert "Correo" in text and "Calendario" in text and "<script" not in text


def test_ask_returns_structured_sections_and_actions(client, rec, ai, session_factory):
    token = register(client)
    _connect(session_factory)
    h = auth(token)
    r = client.post("/api/assistant/ask", headers=h, json={"question": "¿Qué tengo pendiente hoy?"}).json()
    assert r["intent"] == "today" and r["title"].startswith("You have")
    keys = [s["key"] for s in r["sections"]]
    assert "email" in keys
    assert {"Show emails", "Create briefing"} <= {a["label"] for a in r["actions"]}
    assert all(a["kind"] in ("navigate", "briefing", "external") for a in r["actions"])
    assert "unread_emails" in json.loads(r["context"])
    auto = client.post("/api/assistant/ask", headers=h, json={"question": "Crea una automatización cuando me llegue un correo"}).json()
    assert auto["intent"] == "automation" and any("/automations/new?prompt=" in (a.get("href") or "") for a in auto["actions"])
    assert client.post("/api/assistant/ask", headers=h, json={"question": ""}).status_code == 422


def test_ask_without_google_guides_to_connect(client, ai):
    token = register(client)
    r = client.post("/api/assistant/ask", headers=auth(token), json={"question": "¿Qué correos tengo?"}).json()
    assert r["intent"] == "emails" and r["notes"] and any(a["href"] == "/integrations/google" for a in r["actions"])


@pytest.mark.parametrize("q,intent", [
    ("¿Qué automatizaciones han fallado?", "failures"), ("Hazme el briefing", "briefing"),
    ("¿Tengo algún correo urgente?", "emails"), ("¿Qué tengo hoy?", "today"), ("hola", "general"),
    ("What is on my calendar?", "calendar"), ("any deadline soon?", "tasks")])
def test_intent_detection(q, intent):
    assert assistant.intent_of(q) == intent


def test_insights_are_few_actionable_and_dismissable(client, rec, ai, session_factory):
    token = register(client)
    _connect(session_factory)
    h = auth(token)
    client.post("/api/assistant/memory", headers=h, json={"kind": "sender", "value": "billing@acme.com"})
    ins = client.get("/api/assistant/insights", headers=h).json()["data"]
    assert ins and ins[0]["id"] == "important-unread" and ins[0]["action"]["href"].startswith("/inbox")
    assert len(ins) <= 4
    client.post("/api/assistant/suggestions/dismiss", headers=h, json={"id": "insight:important-unread"})
    assert all(i["id"] != "important-unread" for i in client.get("/api/assistant/insights", headers=h).json()["data"])
    client.put("/api/assistant/memory/preferences", headers=h, json={"key": "proactive", "value": False})
    assert client.get("/api/assistant/insights", headers=h).json()["data"] == []


def test_suggestions_can_be_dismissed_for_good(client, rec, session_factory):
    token = register(client)
    h = auth(token)
    client.put("/api/assistant/memory/preferences", headers=h, json={"key": "demo_mode", "value": True})
    s = client.get("/api/assistant/suggestions", headers=h).json()["data"]
    assert {x["kind"] for x in s} == {"weekly", "pdf"}
    client.post("/api/assistant/suggestions/dismiss", headers=h, json={"id": s[0]["id"]})
    assert len(client.get("/api/assistant/suggestions", headers=h).json()["data"]) == 1


# ------------------------------------------------------------ telegram ----

def _run(session_factory, fn, *args):
    async def go():
        with session_factory() as db:
            return await fn(db, *args)

    return anyio.run(go)


def test_telegram_reply_needs_explicit_confirmation(client, rec, ai, session_factory, monkeypatch):
    register(client)
    uid = _connect(session_factory)

    async def fake_ai(db, instruction, data, schema, temperature=0.2):
        return {"body": "Respuesta preparada"}

    monkeypatch.setattr(assistant, "_ai", fake_ai)
    text, markup = _run(session_factory, assistant.bot_reply, uid, "/reply 1")
    assert "Respuesta preparada" in text and markup["inline_keyboard"][0][0]["callback_data"] == "pa:send"
    assert rec.sent_mail == [], "preparing a reply sends nothing"
    # edit, then cancel: still nothing is sent
    text, markup = _run(session_factory, assistant.bot_reply, uid, "/edit Versión final")
    assert "Versión final" in text and markup
    assert "Cancelado" in _run(session_factory, assistant.bot_callback, uid, "pa:cancel")
    assert rec.sent_mail == []
    assert "caducado" in _run(session_factory, assistant.bot_callback, uid, "pa:send")
    # prepare again and confirm
    _run(session_factory, assistant.bot_reply, uid, "/reply 1")
    out = _run(session_factory, assistant.bot_callback, uid, "pa:send")
    assert "Respuesta enviada" in out and len(rec.sent_mail) == 1
    assert "caducado" in _run(session_factory, assistant.bot_callback, uid, "pa:send"), "one confirmation sends once"


def test_telegram_pending_reply_expires(client, rec, ai, session_factory, monkeypatch):
    register(client)
    uid = _connect(session_factory)
    with session_factory() as db:
        memory.set_state(db, uid, "tg_pending_reply", {"message_id": "m1", "subject": "Re: x", "to": "a@b.c", "body": "x",
                                                      "expires": (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)).isoformat()})
    assert "caducado" in _run(session_factory, assistant.bot_callback, uid, "pa:send")
    assert rec.sent_mail == []


def test_telegram_new_commands(client, rec, ai, session_factory):
    register(client)
    uid = _connect(session_factory)
    with session_factory() as db:
        tasks.create(db, uid, "Entregar el TDR", "2030-01-01")
    out = _run(session_factory, assistant.bot_reply, uid, "/tasks")
    assert "Entregar el TDR" in out
    assert "Automatizaciones" in _run(session_factory, assistant.bot_reply, uid, "/automations")
    assert "/reply" in _run(session_factory, assistant.bot_reply, uid, "/help")
    assert "Uso: /reply" in _run(session_factory, assistant.bot_reply, uid, "/reply")
    assert "No encuentro" in _run(session_factory, assistant.bot_reply, uid, "/reply 9")
    nl = _run(session_factory, assistant.bot_reply, uid, "¿Tengo algún correo urgente?")
    assert isinstance(nl, str) and "&lt;importantes&gt;" in nl


def test_buttons_only_work_in_the_linked_chat(client, rec, ai, session_factory):
    register(client)
    uid = _connect(session_factory)
    with session_factory() as db:
        memory.set_state(db, uid, "tg_pending_reply", {"message_id": "m1", "subject": "Re: x", "to": "a@b.c", "body": "hi",
                                                      "expires": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)).isoformat()})
    rec.updates = [{"update_id": 20, "callback_query": {"id": "c1", "data": "pa:send", "message": {"chat": {"id": 999}}}}]
    with session_factory() as db:
        assert anyio.run(assistant.poll_bot_once, db) == 0
    assert rec.sent_mail == [], "a stranger's button press is ignored"
    rec.updates = [{"update_id": 21, "callback_query": {"id": "c2", "data": "pa:send", "message": {"chat": {"id": 777}}}}]
    with session_factory() as db:
        assert anyio.run(assistant.poll_bot_once, db) == 1
    assert len(rec.sent_mail) == 1


def test_scheduled_briefing_sends_once_at_the_preferred_time(client, rec, ai, session_factory):
    register(client)
    uid = _connect(session_factory)
    with session_factory() as db:
        memory.set_preference(db, uid, "briefing_auto", True)
        memory.set_preference(db, uid, "briefing_time", "08:00")
    early = dt.datetime(2026, 10, 6, 7, 30).astimezone()
    on_time = dt.datetime(2026, 10, 6, 8, 5).astimezone()
    assert _run(session_factory, assistant.scheduled_briefings, early) == 0
    assert _run(session_factory, assistant.scheduled_briefings, on_time) == 1
    assert _run(session_factory, assistant.scheduled_briefings, on_time) == 0, "once a day"
    assert "briefing" in rec.telegram_sent[-1]["text"].lower()


def test_scheduled_briefing_never_sends_in_demo_mode(client, rec, ai, session_factory):
    register(client)
    uid = _connect(session_factory)
    with session_factory() as db:
        memory.set_preference(db, uid, "briefing_auto", True)
        memory.set_preference(db, uid, "demo_mode", True)
    sent_before = len(rec.telegram_sent)
    assert _run(session_factory, assistant.scheduled_briefings, dt.datetime(2026, 10, 6, 23, 0).astimezone()) == 0
    assert len(rec.telegram_sent) == sent_before


# --------------------------------------------------------- notify relay ----

def test_notify_relay_sends_through_the_hub_connection(client, rec, session_factory):
    register(client)
    _connect(session_factory)
    from app.services.ai import token as ai_token

    with session_factory() as db:
        tok = ai_token.rotate(db)
    assert client.post("/api/automations/notify", json={"text": "hola"}).status_code == 401
    assert client.post("/api/automations/notify", json={"text": "hola"}, headers={"X-AC-Service-Token": "wrong"}).status_code == 401
    ok = client.post("/api/automations/notify", json={"text": "🔔 aviso del asistente", "source": "pa-email"},
                     headers={"X-AC-Service-Token": tok})
    assert ok.status_code == 200 and ok.json()["via"] == "hub"
    assert rec.telegram_sent[-1]["chat_id"] == 777 and "aviso" in rec.telegram_sent[-1]["text"]
    assert tok not in json.dumps(rec.telegram_sent), "the service token never reaches Telegram"


def test_notify_relay_explains_when_telegram_is_not_connected(client, session_factory):
    register(client)
    from app.services.ai import token as ai_token

    with session_factory() as db:
        tok = ai_token.rotate(db)
    r = client.post("/api/automations/notify", json={"text": "x"}, headers={"X-AC-Service-Token": tok})
    assert r.status_code == 409 and "Integrations > Telegram" in r.json()["detail"]


# ------------------------------------------------- dependencies / trust ----

def test_disconnect_dependencies_list_what_breaks(client, apis, session_factory):
    token = register(client)
    _connect(session_factory)
    h = auth(token)
    d = client.get("/api/integrations/google/dependencies", headers=h).json()
    assert d["connected"] is True and "Inbox and AI email triage" in d["features"]
    assert "Archive / mark important" not in d["features"], "only granted services are listed"
    t = client.get("/api/integrations/telegram/dependencies", headers=h).json()
    assert "Automatic daily briefing" in t["features"]
    assert client.get("/api/integrations/github/dependencies", headers=h).json()["connected"] is False


def test_privacy_lists_access_ai_data_and_what_stays_local(client, session_factory):
    token = register(client)
    _connect(session_factory)
    p = client.get("/api/assistant/privacy", headers=auth(token)).json()
    assert {a["key"] for a in p["access"]} == {"google", "telegram"}
    gmail = next(a for a in p["access"] if a["key"] == "google")
    assert "Read your email" in gmail["permissions"]
    assert p["ai"]["data"] and p["ai"]["never"] and p["stored"]["local_only"]
    blob = json.dumps(p)
    assert "ya29" not in blob and "1:AAAA" not in blob


def test_security_center_flags_what_needs_attention(client, session_factory):
    token = register(client)
    s = client.get("/api/assistant/security", headers=auth(token)).json()
    by = {c["key"]: c for c in s["checks"]}
    assert by["human_in_the_loop"]["status"] == "ok" and by["google"]["status"] == "warn"
    assert by["google"]["action"]["href"] == "/integrations/google"
    _connect(session_factory)
    s = client.get("/api/assistant/security", headers=auth(token)).json()
    assert {c["key"]: c for c in s["checks"]}["google"]["status"] == "ok"


def test_system_health_lists_every_component(client, session_factory):
    token = register(client)
    _connect(session_factory)
    h = client.get("/api/assistant/health", headers=auth(token)).json()
    keys = [i["key"] for i in h["items"]]
    assert keys[0] == "backend" and {"google", "telegram"} <= set(keys)


# ------------------------------------------------- errors / retry / n8n ----

def test_retry_advice_distinguishes_retryable_from_reconnect():
    from app.services import observability as obs

    timeout = obs.retry_advice("Gemini AI step timed out after 30 s", node="Gemini")["advice"]
    assert timeout["retry"] is True and "did not answer in time" in timeout["cause"]
    auth_err = obs.retry_advice("Google authentication expired: sign in again")["advice"]
    assert auth_err["retry"] is False and auth_err["action"]["href"] == "/integrations/google"
    cfg = obs.retry_advice("Configuración incompleta: TELEGRAM_CHAT_ID")["advice"]
    assert cfg["retry"] is False and "setting" in cfg["suggestion"]


def test_error_groups_carry_cause_and_impact(client, session_factory):
    token = register(client)
    _connect(session_factory)
    from app.models import Credential
    from app.services.integrations import connections as conns

    with session_factory() as db:
        row = db.scalar(select(Credential).where(Credential.provider == "telegram"))
        conns.set_health(db, row, conns.AUTH_REQUIRED, "Bot authentication unavailable")
    errs = client.get("/api/errors", headers=auth(token)).json()["data"]
    tg = next(e for e in errs if e["service"] == "Telegram")
    assert tg["cause"] and tg["impact"]["features"] and "automations" in tg["impact"]
    assert tg["action"]["kind"] == "reconnect"


def test_n8n_center_summarises_workflows_and_handles_outages(client, session_factory, monkeypatch):
    token = register(client)
    h = auth(token)
    off = client.get("/api/n8n-center", headers=h).json()
    assert off["available"] is False and off["workflows"] == []
    from app.api.routes import observability as route
    from app.services.n8n import N8nError, N8nService

    now = dt.datetime.now(dt.timezone.utc)

    class Up(N8nService):
        async def list_workflows(self, limit=200):
            return [{"id": "w1", "name": "Asistente - Email", "active": True}, {"id": "pa00errorhandler", "name": "Sistema", "active": True}]

        async def list_executions(self, workflow_id=None, limit=100, **kw):
            mk = lambda i, st, m: {"id": i, "workflowId": "w1", "status": st, "startedAt": (now - dt.timedelta(minutes=m)).isoformat(),
                                   "stoppedAt": (now - dt.timedelta(minutes=m) + dt.timedelta(seconds=2)).isoformat()}
            return [mk("1", "success", 1), mk("2", "success", 5), mk("3", "error", 9)]

    monkeypatch.setattr(route, "_n8n", lambda db: Up(base_url="http://n8n", api_key="k"))
    c = client.get("/api/n8n-center", headers=h).json()
    assert c["available"] is True and c["totals"]["workflows"] == 1
    w = next(x for x in c["workflows"] if x["id"] == "w1")
    assert w["runs_7d"] == 3 and w["failed_7d"] == 1 and w["success_rate_7d"] == 66.7 and w["avg_duration_ms"] == 2000
    assert c["totals"]["last_execution"]["id"] == "1"

    class Down(Up):
        async def list_workflows(self, limit=200):
            raise N8nError("connection refused", status_code=503)

    monkeypatch.setattr(route, "_n8n", lambda db: Down(base_url="http://n8n", api_key="k"))
    d = client.get("/api/n8n-center", headers=h).json()
    assert d["available"] is False and "saved automations are safe" in d["message"]


def test_new_templates_are_valid_and_cover_the_tdr_set():
    from app.services.automations import drafting

    ids = {t["id"]: t for t in drafting.templates()}
    for key in ("email-assistant", "daily-briefing", "important-email-alert", "deadline-detector", "email-summarizer"):
        assert key in ids and ids[key]["providers"]
    assert ids["deadline-detector"]["spec"]["steps"][-1]["block"] == "calendar.create_event"


def test_migration_0005_is_additive():
    import importlib.util
    import pathlib

    path = pathlib.Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0005_assistant_memory_tasks.py"
    spec = importlib.util.spec_from_file_location("m0005", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.down_revision == "0004_service_configs"
    src = path.read_text(encoding="utf-8")
    assert "drop_table" in src.split("def downgrade")[1] and "drop_table" not in src.split("def downgrade")[0]


def test_briefing_lite_skips_the_ai_and_telegram_delivery_is_explicit(client, rec, ai, session_factory):
    token = register(client)
    h = auth(token)
    assert client.post("/api/assistant/briefing/telegram", headers=h).status_code == 409
    _connect(session_factory)
    ai_calls_before = len(rec.telegram_sent)
    lite = client.post("/api/assistant/briefing?summary=false", headers=h).json()
    assert lite["summary"] == "" and len(lite["emails"]) == 2
    sent = client.post("/api/assistant/briefing/telegram", headers=h).json()
    assert sent["sent"] is True and len(rec.telegram_sent) == ai_calls_before + 1
    assert "briefing" in rec.telegram_sent[-1]["text"].lower()
    client.put("/api/assistant/memory/preferences", headers=h, json={"key": "demo_mode", "value": True})
    assert client.post("/api/assistant/briefing/telegram", headers=h).json()["demo"] is True
    assert len(rec.telegram_sent) == ai_calls_before + 1, "demo mode never sends"


def test_overview_reports_ai_errors_and_telegram_messages_today(client, rec, session_factory, monkeypatch):
    token = register(client)
    _connect(session_factory)
    h = auth(token)
    from app.services import usage

    with session_factory() as db:
        usage.bump(db, "ai_errors")
        usage.bump(db, "telegram_messages", 2)
    o = client.get("/api/overview", headers=h).json()
    assert o["ai"]["errors_today"] == 1 and o["telegram"]["messages_today"] == 2


def test_a_date_without_a_time_is_due_at_the_end_of_that_day(client):
    token = register(client)
    h = auth(token)
    today = dt.date.today().isoformat()
    yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    due_today = client.post("/api/assistant/tasks", headers=h, json={"title": "due today", "due": today}).json()
    assert due_today["overdue"] is False, "a task due today is not overdue until the day is over"
    assert due_today["due_soon"] is True
    late = client.post("/api/assistant/tasks", headers=h, json={"title": "was due yesterday", "due": yesterday}).json()
    assert late["overdue"] is True
    exact = client.post("/api/assistant/tasks", headers=h, json={"title": "exact", "due": "2030-01-01T09:30:00+00:00"}).json()
    assert exact["due_at"].startswith("2030-01-01T09:30")


def test_calendar_lists_and_creates_events_and_demo_creates_nothing(client, rec, session_factory):
    token = register(client)
    h = auth(token)
    assert client.get("/api/assistant/calendar", headers=h).status_code == 409, "without Google it says so"
    _connect(session_factory)
    from app.services.integrations import http as int_http

    base = rec.__call__

    def with_events(req):
        if req.method == "GET" and "calendar/v3/calendars/primary/events" in str(req.url):
            return httpx.Response(200, json={"items": [{"summary": "Matemáticas", "start": {"dateTime": "2026-10-06T09:00:00+02:00"},
                                                        "end": {"dateTime": "2026-10-06T10:00:00+02:00"}, "htmlLink": "https://cal/e1"}]})
        return base(req)

    int_http.set_transport(httpx.MockTransport(with_events))
    listed = client.get("/api/assistant/calendar?days=7", headers=h).json()
    assert listed["data"][0]["title"] == "Matemáticas" and listed["demo"] is False
    made = client.post("/api/assistant/calendar/events", headers=h,
                       json={"title": "Reunión TDR", "start": "2026-10-09T17:00", "duration_minutes": 45})
    assert made.status_code == 201 and made.json()["created"] is True
    assert rec.created_events[-1]["summary"] == "Reunión TDR"
    assert client.post("/api/assistant/calendar/events", headers=h, json={"title": "x", "start": "not-a-date-at-all"}).status_code == 422 \
        or client.post("/api/assistant/calendar/events", headers=h, json={"title": "x", "start": "not-a-date-at-all"}).status_code == 400
    client.put("/api/assistant/memory/preferences", headers=h, json={"key": "demo_mode", "value": True})
    demo_events = client.get("/api/assistant/calendar", headers=h).json()
    assert demo_events["demo"] is True and len(demo_events["data"]) >= 3
    before = len(rec.created_events)
    d = client.post("/api/assistant/calendar/events", headers=h, json={"title": "demo", "start": "2026-10-09T17:00"}).json()
    assert d["created"] is False and len(rec.created_events) == before
