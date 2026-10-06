"""Assistant skills: mail triage, replies, briefing, suggestions, Telegram bot."""
from __future__ import annotations

import base64
import json

import httpx
import pytest
from sqlalchemy import select

from app.services import assistant
from tests import ai_stubs
from tests.test_automations import FakeApis, _connect, auth, register  # noqa: F401
from tests.test_automations import apis  # noqa: F401  (fixture)


@pytest.fixture
def ai(monkeypatch, settings_factory):
    from app.services.ai.service import reset_caches

    reset_caches()
    settings_factory(nvidia_nim_api_key="nvapi-" + "t" * 30, ai_provider="nvidia_nim", ai_model="meta/test")

    def answer(req: httpx.Request) -> httpx.Response:
        prompt = json.dumps(json.loads(req.content)["messages"])
        if "Triage this email" in prompt:
            return ai_stubs.openai_completion(json.dumps({
                "priority": "HIGH", "category": "school", "action_required": True, "summary": "Entrega del TDR.",
                "deadline": "2026-10-09T10:00:00+02:00", "deadline_title": "Entregar TDR", "suggested_action": "Reply"}))
        if "Write a reply" in prompt:
            return ai_stubs.openai_completion(json.dumps({"body": "Gracias, lo entrego el viernes."}))
        return ai_stubs.openai_completion(json.dumps({"text": "Tienes 2 correos <importantes>."}))

    ai_stubs.install(monkeypatch, answer)
    yield
    reset_caches()


class Recorder(FakeApis):
    def __init__(self):
        super().__init__()
        self.sent_mail: list[dict] = []
        self.updates: list[dict] = []

    def __call__(self, req):
        url = str(req.url)
        if url.endswith("/messages/send"):
            self.sent_mail.append(json.loads(req.content))
            return httpx.Response(200, json={"id": "sent1"})
        if "format=metadata" in url:
            return httpx.Response(200, json={"payload": {"headers": [{"name": "Message-ID", "value": "<abc@mail>"}]}})
        if url.endswith("/getUpdates"):
            return httpx.Response(200, json={"ok": True, "result": self.updates})
        return super().__call__(req)


@pytest.fixture
def rec():
    from app.services.integrations import http as int_http

    r = Recorder()
    int_http.set_transport(httpx.MockTransport(r))
    yield r
    int_http.set_transport(None)


def test_mail_list_analyze_draft_and_reply_in_thread(client, rec, ai, session_factory):
    token = register(client)
    _connect(session_factory)
    h = auth(token)
    mail = client.get("/api/assistant/mail", headers=h).json()["data"]
    assert [m["subject"] for m in mail] == ["Invoice 42", "Lunch?"]
    assert "text" not in mail[0], "the list never carries bodies"

    a = client.post("/api/assistant/mail/m1/analyze", headers=h).json()
    assert a["priority"] == "high" and a["category"] == "school" and a["deadline"].startswith("2026-10-09")

    d = client.post("/api/assistant/mail/m1/draft", headers=h, json={}).json()
    assert d["subject"] == "Re: Invoice 42" and "viernes" in d["body"]

    r = client.post("/api/assistant/mail/m1/reply", headers=h, json={"body": d["body"]})
    assert r.json()["sent"] is True
    sent = rec.sent_mail[0]
    assert sent["threadId"] == "tm1"
    raw = base64.urlsafe_b64decode(sent["raw"]).decode()
    assert "In-Reply-To: <abc@mail>" in raw and "To: billing@acme.com" in raw


def test_mail_without_google_is_a_clear_409(client, ai):
    token = register(client)
    r = client.get("/api/assistant/mail", headers=auth(token))
    assert r.status_code == 409 and r.json()["detail"]["provider"] == "google"


def test_briefing_combines_mail_and_problems(client, rec, ai, session_factory):
    token = register(client)
    _connect(session_factory)
    b = client.post("/api/assistant/briefing", headers=auth(token)).json()
    assert len(b["emails"]) == 2 and b["summary"]


def test_bot_answers_only_the_linked_chat(client, rec, ai, session_factory):
    register(client)
    _connect(session_factory)
    rec.updates = [
        {"update_id": 10, "message": {"chat": {"id": 999}, "text": "/emails"}},  # stranger
        {"update_id": 11, "message": {"chat": {"id": 777}, "text": "/emails"}},
        {"update_id": 12, "message": {"chat": {"id": 777}, "text": "¿qué tengo pendiente?"}},
    ]
    import anyio

    with session_factory() as db:
        answered = anyio.run(assistant.poll_bot_once, db)
    assert answered == 2
    assert all(m["chat_id"] == 777 for m in rec.telegram_sent)
    assert "Invoice 42" in rec.telegram_sent[0]["text"]
    assert "&lt;importantes&gt;" in rec.telegram_sent[1]["text"], "AI text is escaped for HTML"
    from app.models import Credential

    with session_factory() as db:
        row = db.scalar(select(Credential).where(Credential.provider == "telegram"))
        assert row.meta["update_offset"] == 12, "updates are acknowledged, never answered twice"
