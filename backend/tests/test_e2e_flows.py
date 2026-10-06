"""End-to-end flows through the real HTTP API, with every external service mocked.

TEST LEVEL: *mock* end-to-end. The application code (routes, OAuth+PKCE, token
vault, Gmail/Calendar clients, AI layer, Telegram client, n8n client) is the real
one; only the network is an `httpx.MockTransport` that answers like Google,
Telegram, the AI provider and n8n. Nothing here proves anything about a real
Gmail account - see docs/TESTING.md for the real-service checklist.

Flows: 1 login -> dashboard   2 connect Google   3 read email   4 AI analysis
5 generate reply   6 confirm send   7 Telegram command   8 create automation
9 execute automation   10 failure -> retry.
"""
from __future__ import annotations

import base64
import json
from urllib.parse import parse_qs, urlparse

import anyio
import httpx
import pytest
from sqlalchemy import select

from app.services import assistant
from app.services.integrations import connections as conns
from app.services.integrations import http as int_http
from app.services.integrations import oauth, providers
from tests.test_assistant import Recorder, ai  # noqa: F401  (ai is a fixture)
from tests.test_automations import PASSWORD, auth, n8n, register  # noqa: F401
from tests.test_integrations import FakeProviders


class World:
    """Google OAuth + Gmail/Calendar + Telegram, behind one transport."""

    def __init__(self):
        self.oauth = FakeProviders()
        self.apis = Recorder()

    def __call__(self, req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if "oauth2.googleapis.com" in url or "openidconnect.googleapis.com" in url:
            return self.oauth(req)
        return self.apis(req)


@pytest.fixture
def world():
    w = World()
    int_http.set_transport(httpx.MockTransport(w))
    oauth._used_states.clear()
    yield w
    int_http.set_transport(None)


def _connect_google_via_oauth(client, token):
    """Flow 2, the way a user does it: the OAuth app exists, consent, callback."""
    app = client.put("/api/integrations/google/app", headers=auth(token),
                     json={"client_id": "123.apps.googleusercontent.com", "client_secret": "GOCSPX-secret-value"})
    assert app.status_code == 200, app.text
    r = client.post("/api/integrations/google/connect", headers=auth(token), json={"services": ["gmail", "calendar"]})
    url = urlparse(r.json()["authorization_url"])
    state = parse_qs(url.query)["state"][0]
    cb = client.get("/api/integrations/google/callback", params={"code": "4/auth-code", "state": state}, follow_redirects=False)
    assert cb.status_code == 302 and cb.headers["location"].endswith("/integrations/google?connected=1")


def _link_telegram(session_factory, username="owner"):
    from app.models import User

    with session_factory() as db:
        user = db.scalar(select(User).where(User.username == username))
        conns.save(db, user.id, providers.TELEGRAM, secret={"bot_token": "1:" + "A" * 35},
                   meta={"services": ["messages"], "scopes": ["bot:send"], "chat": {"id": 777, "title": "Alex"}})
        return user.id


def test_the_ten_main_flows(client, world, ai, n8n, session_factory):  # noqa: F811
    # ---- 1. login -> dashboard ------------------------------------------------
    register(client)
    login = client.post("/api/auth/login", json={"identifier": "owner", "password": PASSWORD})
    assert login.status_code == 200
    token = login.json()["access_token"]
    h = auth(token)
    assert client.get("/api/auth/me", headers=h).json()["username"] == "owner"
    overview = client.get("/api/overview", headers=h)
    assert overview.status_code == 200 and "automations" in overview.json()
    lite = client.post("/api/assistant/briefing?summary=false", headers=h)
    assert lite.status_code == 409 or lite.status_code == 200  # no Google yet: the dashboard degrades, it does not crash
    assert client.get("/api/assistant/insights", headers=h).status_code == 200

    # ---- 2. connect Google -----------------------------------------------------
    _connect_google_via_oauth(client, token)
    view = client.get("/api/integrations/google", headers=h).json()
    assert view["status"] == "healthy" and view["connection"]["account"]["email"] == "alex@example.com"
    assert "ya29.first" not in json.dumps(view) and "1//refresh" not in json.dumps(view), "no token reaches the browser"

    # ---- 3. read email ---------------------------------------------------------
    mail = client.get("/api/assistant/mail", headers=h).json()["data"]
    assert [m["subject"] for m in mail] == ["Invoice 42", "Lunch?"]

    # ---- 4. AI analysis (priority with reasons) -------------------------------
    client.post("/api/assistant/memory", headers=h, json={"kind": "sender", "value": "billing@acme.com", "label": "vendor"})
    analysis = client.post("/api/assistant/mail/m1/analyze", headers=h).json()
    assert analysis["priority"] in ("high", "urgent") and analysis["category"] == "school"
    assert any("important sender" in r["label"] for r in analysis["priority_reasons"])

    # ---- 5. generate reply ------------------------------------------------------
    draft = client.post("/api/assistant/mail/m1/draft", headers=h, json={"tone": "formal"}).json()
    assert draft["subject"] == "Re: Invoice 42" and draft["body"]
    assert world.apis.sent_mail == [], "a draft is never sent"

    # ---- 6. confirm send (the user edits, then confirms) ------------------------
    sent = client.post("/api/assistant/mail/m1/reply", headers=h, json={"body": "Texto revisado por la persona"})
    assert sent.json()["sent"] is True and len(world.apis.sent_mail) == 1
    raw = base64.urlsafe_b64decode(world.apis.sent_mail[0]["raw"]).decode()
    assert "Texto revisado por la persona" in raw and "In-Reply-To: <abc@mail>" in raw
    assert world.apis.sent_mail[0]["threadId"] == "tm1"

    # ---- 7. Telegram command ----------------------------------------------------
    _link_telegram(session_factory)
    world.apis.updates = [{"update_id": 31, "message": {"chat": {"id": 777}, "text": "/emails"}},
                          {"update_id": 32, "message": {"chat": {"id": 999}, "text": "/emails"}}]
    with session_factory() as db:
        assert anyio.run(assistant.poll_bot_once, db) == 1, "only the linked chat is answered"
    assert "Invoice 42" in world.apis.telegram_sent[-1]["text"] and world.apis.telegram_sent[-1]["chat_id"] == 777

    # ---- 8. create automation ---------------------------------------------------
    templates = {t["id"]: t for t in client.get("/api/automations/templates", headers=h).json()["data"]}
    spec = templates["important-email-alert"]["spec"]
    created = client.post("/api/automations", headers=h, json={"spec": spec, "origin": "template"})
    assert created.status_code == 201, created.text
    auto = created.json()
    assert auto["deploy"]["status"] == "deployed" and auto["n8n_workflow_id"] in n8n.workflows

    # ---- 9. execute automation --------------------------------------------------
    assert client.post(f"/api/automations/{auto['id']}/activate", headers=h).json()["active"] is True
    started = client.post(f"/api/automations/{auto['id']}/run", headers=h)
    assert started.json()["started"] is True and len(n8n.webhooks) == 1

    # ---- 10. failure -> smart retry ---------------------------------------------
    wid = auto["n8n_workflow_id"]
    names = [n["name"] for n in n8n.workflows[wid]["nodes"]]
    trigger = next(n for n in names if n == "New email in Gmail")
    failing = next(n for n in names if n.startswith("1."))

    def failure(execution_id: str, message: str):
        n8n.executions[execution_id] = {
            "id": execution_id, "workflowId": wid, "status": "error", "mode": "trigger",
            "startedAt": "2026-10-06T09:42:01.000Z", "stoppedAt": "2026-10-06T09:42:04.000Z",
            "data": {"resultData": {"runData": {trigger: [{"executionTime": 300, "startTime": 1790000000000, "data": {"main": [[{"json": {}}]]}}]},
                                    "error": {"message": message, "node": {"name": failing}}}}}

    failure("50", "AI step timed out after 30 seconds")
    temporary = client.get(f"/api/automations/{auto['id']}/runs/50", headers=h).json()
    assert temporary["status"] == "error" and temporary["retry_advice"]["retry"] is True
    assert "did not answer in time" in temporary["retry_advice"]["cause"]
    assert temporary["steps"][0]["at"], "the timeline carries a time per step"

    failure("51", "Google Workspace authentication expired: sign in again")
    needs_reconnect = client.get(f"/api/automations/{auto['id']}/runs/51", headers=h).json()
    assert needs_reconnect["retry_advice"]["retry"] is False
    assert needs_reconnect["retry_advice"]["action"]["href"] == "/integrations/google"

    before = len(n8n.webhooks)
    assert client.post(f"/api/automations/{auto['id']}/run", headers=h).json()["started"] is True  # the Retry button
    assert len(n8n.webhooks) == before + 1


def test_the_whole_flow_leaks_no_secret_into_responses_or_logs(client, world, ai, caplog, session_factory):  # noqa: F811
    caplog.set_level("DEBUG")
    token = register(client)
    h = auth(token)
    _connect_google_via_oauth(client, token)
    _link_telegram(session_factory)
    bodies = []
    for method, path, payload in (
        ("GET", "/api/integrations", None), ("GET", "/api/assistant/mail", None), ("POST", "/api/assistant/mail/m1/analyze", None),
        ("GET", "/api/assistant/privacy", None), ("GET", "/api/assistant/security", None), ("GET", "/api/assistant/memory", None),
        ("POST", "/api/assistant/briefing", None), ("GET", "/api/overview", None), ("GET", "/api/errors", None),
    ):
        r = client.request(method, path, headers=h, json=payload)
        bodies.append(r.text)
    everything = "\n".join(bodies) + "\n" + caplog.text
    for secret in ("ya29.first", "1//refresh", "GOCSPX-secret-value", "1:" + "A" * 35, "4/auth-code"):
        assert secret not in everything, f"{secret[:8]}… leaked"


def test_demo_mode_runs_the_same_flow_without_any_account(client, ai, world):  # noqa: F811
    token = register(client)
    h = auth(token)
    client.put("/api/assistant/memory/preferences", headers=h, json={"key": "demo_mode", "value": True})
    mail = client.get("/api/assistant/mail", headers=h).json()
    assert mail["demo"] is True and len(mail["data"]) == 5
    analysis = client.post("/api/assistant/mail/demo-1/analyze", headers=h).json()
    assert analysis["demo"] is True and analysis["priority_reasons"]
    draft = client.post("/api/assistant/mail/demo-1/draft", headers=h, json={"tone": "formal"}).json()
    assert draft["demo"] is True
    assert client.post("/api/assistant/mail/demo-1/reply", headers=h, json={"body": "x"}).json()["sent"] is False
    assert world.apis.sent_mail == [] and world.apis.telegram_sent == [], "demo mode touches nothing outside"
    b = client.post("/api/assistant/briefing", headers=h).json()
    assert b["demo"] is True and b["events"] and b["deadlines"]
