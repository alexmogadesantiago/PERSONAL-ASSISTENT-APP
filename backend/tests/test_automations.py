"""Panel-built automations: spec, compiler, n8n deployment, engine, AI drafts.

n8n, Google, Telegram and the AI provider are `httpx.MockTransport`s that
answer like the real services, so the real client code runs end to end.
"""
from __future__ import annotations

import json
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import select

from app.services.automations import compiler, drafting, manager
from app.services.automations import spec as specmod
from app.services.integrations import connections as conns
from app.services.integrations import http as int_http
from app.services.integrations import providers
from app.services.n8n import N8nService
from tests import ai_stubs

PASSWORD = "Correct-Horse-9"


def register(client, username="owner", email="owner@example.com") -> str:
    r = client.post("/api/auth/register", json={"email": email, "username": username, "password": PASSWORD})
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------ fakes --------

class FakeN8n:
    def __init__(self, up: bool = True):
        self.up = up
        self.workflows: dict[str, dict] = {}
        self.active: set[str] = set()
        self.webhooks: list[str] = []
        self.executions: dict[str, dict] = {}
        self.next_id = 100

    def __call__(self, req: httpx.Request) -> httpx.Response:
        if not self.up:
            raise httpx.ConnectError("n8n down", request=req)
        path = req.url.path
        if req.method == "POST" and path == "/api/v1/workflows":
            body = json.loads(req.content)
            self.next_id += 1
            wid = f"wf{self.next_id}"
            self.workflows[wid] = body
            return httpx.Response(200, json={"id": wid, **body})
        if path.startswith("/api/v1/workflows/"):
            parts = path.split("/")
            wid = parts[4]
            if wid not in self.workflows:
                return httpx.Response(404, json={"message": "not found"})
            if req.method == "PUT":
                self.workflows[wid] = json.loads(req.content)
                return httpx.Response(200, json={"id": wid})
            if req.method == "DELETE":
                self.workflows.pop(wid)
                return httpx.Response(200, json={"id": wid})
            if path.endswith("/activate"):
                self.active.add(wid)
                return httpx.Response(200, json={"id": wid, "active": True})
            if path.endswith("/deactivate"):
                self.active.discard(wid)
                return httpx.Response(200, json={"id": wid, "active": False})
        if path.startswith("/webhook/"):
            self.webhooks.append(path.split("/webhook/")[1])
            return httpx.Response(200, json={"message": "Workflow was started"})
        if path == "/api/v1/executions":
            wid = req.url.params.get("workflowId")
            return httpx.Response(200, json={"data": [e for e in self.executions.values() if e["workflowId"] == wid]})
        if path.startswith("/api/v1/executions/"):
            ex = self.executions.get(path.rsplit("/", 1)[1])
            return httpx.Response(200, json=ex) if ex else httpx.Response(404)
        return httpx.Response(404)


class FakeApis:
    def __init__(self):
        self.messages = [
            {"id": "m1", "subject": "Invoice 42", "from": "billing@acme.com"},
            {"id": "m2", "subject": "Lunch?", "from": "friend@example.com"},
        ]
        self.telegram_sent: list[dict] = []
        self.created_events: list[dict] = []

    def gmail_msg(self, m):
        return {"id": m["id"], "threadId": "t" + m["id"], "snippet": m["subject"] + " snippet",
                "labelIds": ["INBOX"],
                "payload": {"mimeType": "text/plain", "headers": [
                    {"name": "From", "value": m["from"]}, {"name": "Subject", "value": m["subject"]},
                    {"name": "Date", "value": "Mon, 5 Oct 2026 09:00:00 +0200"}],
                    "body": {"data": "SGVsbG8"}}}

    def __call__(self, req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if url.startswith("https://gmail.googleapis.com/gmail/v1/users/me/messages?"):
            return httpx.Response(200, json={"messages": [{"id": m["id"]} for m in self.messages]})
        if url.startswith("https://gmail.googleapis.com/gmail/v1/users/me/messages/"):
            mid = urlparse(url).path.rsplit("/", 1)[1]
            m = next(x for x in self.messages if x["id"] == mid)
            return httpx.Response(200, json=self.gmail_msg(m))
        if url.startswith("https://www.googleapis.com/calendar/v3/calendars/primary/events") and req.method == "POST":
            self.created_events.append(json.loads(req.content))
            return httpx.Response(200, json={"htmlLink": "https://calendar/e1"})
        if "api.telegram.org" in url and url.endswith("/sendMessage"):
            self.telegram_sent.append(json.loads(req.content))
            return httpx.Response(200, json={"ok": True, "result": {"message_id": len(self.telegram_sent)}})
        return httpx.Response(404, json={"error": {"message": "unexpected " + url}})


@pytest.fixture
def n8n(monkeypatch):
    fake = FakeN8n()
    monkeypatch.setattr(manager, "get_n8n_service",
                        lambda db: N8nService(base_url="http://n8n:5678", api_key="k", transport=httpx.MockTransport(fake)))
    return fake


@pytest.fixture
def apis():
    fake = FakeApis()
    int_http.set_transport(httpx.MockTransport(fake))
    yield fake
    int_http.set_transport(None)


@pytest.fixture
def ai(monkeypatch, settings_factory):
    """A configured provider whose answers depend on what was asked."""
    from app.services.ai.service import reset_caches

    reset_caches()
    settings_factory(nvidia_nim_api_key="nvapi-" + "t" * 30, ai_provider="nvidia_nim", ai_model="meta/test")

    def answer(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        prompt = json.dumps(body["messages"])
        if "turn a person's request into an automation" in prompt:
            if "bogus" in prompt:
                spec = {"name": "x", "description": "", "trigger": {"block": "teleport", "params": {}},
                        "steps": [{"block": "telegram.send", "params": {"message": "hi"}}], "explanation": "e"}
            else:
                spec = {"name": "Facturas", "description": "Guarda facturas",
                        "trigger": {"block": "gmail.new_email", "params": {"query": "invoice"}},
                        "steps": [{"block": "telegram.send", "params": {"message": "Factura de {{from}}"}}],
                        "explanation": "Te aviso de cada factura."}
            return ai_stubs.openai_completion(json.dumps(spec))
        if "Classify" in prompt:
            return ai_stubs.openai_completion(json.dumps({"category": "urgent", "reason": "asks for payment"}))
        if "Summarize" in prompt or "summary" in prompt:
            return ai_stubs.openai_completion(json.dumps({"summary": "short summary"}))
        return ai_stubs.openai_completion(json.dumps({"text": "Digest <b>of</b> the week"}))

    ai_stubs.install(monkeypatch, answer)
    yield
    reset_caches()


def _connect(session_factory, user_token_owner="owner"):
    """Store Google + Telegram connections directly (OAuth is tested elsewhere)."""
    from app.models import User

    with session_factory() as db:
        user = db.scalar(select(User).where(User.username == user_token_owner))
        conns.save(db, user.id, providers.GOOGLE,
                   secret={"access_token": "ya29.t", "refresh_token": "r", "expires_at": 9_999_999_999},
                   meta={"scopes": providers.GOOGLE.scopes_for(["gmail", "calendar", "drive"]),
                         "services": ["gmail", "calendar", "drive"], "account": {"email": "a@x.com"}})
        conns.save(db, user.id, providers.TELEGRAM, secret={"bot_token": "1:" + "A" * 35},
                   meta={"services": ["messages"], "scopes": ["bot:send"], "chat": {"id": 777, "title": "Alex"}})
        return user.id


def _service_token(client, token):
    return client.post("/api/ai/service-token", headers=auth(token)).json()["token"]


URGENT = {
    "name": "Urgent email",
    "trigger": {"block": "gmail.new_email", "params": {"query": "in:inbox is:unread"}},
    "steps": [
        {"block": "ai.classify", "params": {"categories": "urgent, normal"}},
        {"block": "condition.match", "params": {"field": "category", "operator": "equals", "value": "urgent"}},
        {"block": "telegram.send", "params": {"message": "⚠️ {{subject}} from {{from}} <now>"}},
    ],
}


# -------------------------------------------------------------- spec --------

def test_every_template_is_a_valid_spec():
    for t in drafting.templates():
        assert t["spec"]["steps"], t["id"]
        assert t["providers"], t["id"]


def test_validation_explains_what_is_missing():
    with pytest.raises(specmod.SpecError) as exc:
        specmod.normalise({"name": "x", "trigger": {"block": "telegram.send", "params": {}},
                           "steps": [{"block": "gmail.send", "params": {"to": "a@b.c"}}]})
    problems = " | ".join(exc.value.problems)
    assert "is not a trigger" in problems
    assert "«Subject» is required" in problems and "«Body» is required" in problems


def test_unknown_params_are_dropped_and_types_coerced():
    s = specmod.normalise({"name": "x", "trigger": {"block": "schedule", "params": {"every": "day", "at": "07:15", "evil": "$env"}},
                           "steps": [{"block": "gmail.search", "params": {"query": "x", "max": "7"}}]})
    assert "evil" not in s["trigger"]["params"]
    assert s["steps"][0]["params"]["max"] == 7


def test_templates_render_placeholders():
    item = {"from": "a@b.c", "extracted": {"amount": "12 €"}, "items": [{"subject": "A"}, {"subject": "B"}]}
    assert specmod.render("{{from}} paid {{extracted.amount}}{{missing}}", item) == "a@b.c paid 12 €"
    assert specmod.render("{{items}}", item) == "• A\n• B"


# ---------------------------------------------------------- compiler --------

def test_compiled_workflow_carries_no_user_text():
    spec = specmod.normalise(URGENT)
    body, names = compiler.compile_spec(spec, automation_id="abc", webhook_path="pa-secret")
    blob = json.dumps(body)
    assert "⚠️" not in blob and "{{subject}}" not in blob, "user text stays in the backend"
    assert "in:inbox" not in blob
    assert body["settings"]["errorWorkflow"] == "pa00errorhandler"
    types = [n["type"] for n in body["nodes"]]
    assert types.count("n8n-nodes-base.httpRequest") == 4  # fetch + 3 steps
    assert "n8n-nodes-base.webhook" in types
    assert set(names) == {"trigger"} | {s["id"] for s in spec["steps"]}
    for n in body["nodes"]:
        if n["type"].endswith("httpRequest"):
            assert "/api/automations/abc/run/" in n["parameters"]["url"]
            assert n["parameters"]["jsonBody"] == "={{ JSON.stringify({ input: $json }) }}"


def test_schedule_compiles_to_cron():
    assert compiler._cron({"every": "weekdays", "at": "07:30"}) == "30 7 * * 1-5"
    assert compiler._cron({"every": "week", "at": "08:00", "weekday": "7"}) == "0 8 * * 0"
    assert compiler._cron({"every": "hour", "at": "00:15"}) == "15 * * * *"


# ------------------------------------------------------------- CRUD ---------

def test_create_deploys_activate_pause_duplicate_delete(client, n8n):
    token = register(client)
    r = client.post("/api/automations", headers=auth(token), json={"spec": URGENT})
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["deploy"]["status"] == "deployed" and a["n8n_workflow_id"] in n8n.workflows
    assert a["providers"] == ["google", "telegram"]
    assert n8n.workflows[a["n8n_workflow_id"]]["name"] == "PA · Urgent email"

    on = client.post(f"/api/automations/{a['id']}/activate", headers=auth(token)).json()
    assert on["active"] is True and a["n8n_workflow_id"] in n8n.active
    assert client.post(f"/api/automations/{a['id']}/run", headers=auth(token)).json()["started"] is True
    assert n8n.webhooks and n8n.webhooks[0].startswith("pa-")

    off = client.post(f"/api/automations/{a['id']}/pause", headers=auth(token)).json()
    assert off["active"] is False
    assert client.post(f"/api/automations/{a['id']}/run", headers=auth(token)).status_code == 409

    dup = client.post(f"/api/automations/{a['id']}/duplicate", headers=auth(token)).json()
    assert dup["name"] == "Urgent email (copy)" and dup["id"] != a["id"]
    assert len(client.get("/api/automations", headers=auth(token)).json()["data"]) == 2

    assert client.delete(f"/api/automations/{a['id']}", headers=auth(token)).json()["deleted"] is True
    assert a["n8n_workflow_id"] not in n8n.workflows


def test_saving_works_even_when_n8n_is_down(client, n8n):
    n8n.up = False
    token = register(client)
    a = client.post("/api/automations", headers=auth(token), json={"spec": URGENT}).json()
    assert a["deploy"]["status"] == "error"
    r = client.post(f"/api/automations/{a['id']}/activate", headers=auth(token))
    assert r.status_code == 503
    n8n.up = True
    redeployed = client.post(f"/api/automations/{a['id']}/redeploy", headers=auth(token)).json()
    assert redeployed["deploy"]["status"] == "deployed"


def test_an_incomplete_spec_is_refused_with_its_problems(client, n8n):
    token = register(client)
    bad = {"name": "x", "trigger": {"block": "manual", "params": {}}, "steps": []}
    r = client.post("/api/automations", headers=auth(token), json={"spec": bad})
    assert r.status_code == 422
    assert "add at least one step" in json.dumps(r.json())


def test_another_user_cannot_touch_my_automation(client, n8n):
    token = register(client)
    a = client.post("/api/automations", headers=auth(token), json={"spec": URGENT}).json()
    other = register(client, "other", "other@example.com")
    assert client.get(f"/api/automations/{a['id']}", headers=auth(other)).status_code == 404
    assert client.delete(f"/api/automations/{a['id']}", headers=auth(other)).status_code == 404


# ------------------------------------------------------------ engine --------

def test_n8n_runs_the_steps_through_the_backend(client, n8n, apis, ai, session_factory):
    token = register(client)
    _connect(session_factory)
    st = _service_token(client, token)
    a = client.post("/api/automations", headers=auth(token), json={"spec": URGENT}).json()
    steps = a["spec"]["steps"]
    h = {"X-AC-Service-Token": st}

    # the first poll primes: existing mail is not "new"
    first = client.post(f"/api/automations/{a['id']}/run/trigger", headers=h, json={"input": {}})
    assert first.status_code == 200 and first.json() == []
    apis.messages.insert(0, {"id": "m3", "subject": "PAY NOW", "from": "boss@acme.com"})
    new = client.post(f"/api/automations/{a['id']}/run/trigger", headers=h, json={"input": {}}).json()
    assert [m["subject"] for m in new] == ["PAY NOW"]
    assert client.post(f"/api/automations/{a['id']}/run/trigger", headers=h, json={"input": {}}).json() == []

    classified = client.post(f"/api/automations/{a['id']}/run/{steps[0]['id']}", headers=h, json={"input": new[0]}).json()
    assert classified[0]["category"] == "urgent"
    kept = client.post(f"/api/automations/{a['id']}/run/{steps[1]['id']}", headers=h, json={"input": classified[0]}).json()
    assert len(kept) == 1
    dropped = client.post(f"/api/automations/{a['id']}/run/{steps[1]['id']}", headers=h,
                          json={"input": {**classified[0], "category": "normal"}}).json()
    assert dropped == []
    sent = client.post(f"/api/automations/{a['id']}/run/{steps[2]['id']}", headers=h, json={"input": kept[0]}).json()
    assert sent[0]["telegram_message_id"] == 1
    assert apis.telegram_sent[0]["chat_id"] == 777
    assert apis.telegram_sent[0]["text"] == "⚠️ PAY NOW from boss@acme.com &lt;now&gt;", "user text is escaped for HTML"


def test_step_endpoint_requires_the_service_token(client, n8n):
    token = register(client)
    a = client.post("/api/automations", headers=auth(token), json={"spec": URGENT}).json()
    assert client.post(f"/api/automations/{a['id']}/run/trigger", json={"input": {}}).status_code == 401
    assert client.post(f"/api/automations/{a['id']}/run/trigger", headers=auth(token), json={"input": {}}).status_code == 401


def test_a_missing_connection_is_a_clear_409(client, n8n):
    token = register(client)
    st = _service_token(client, token)
    a = client.post("/api/automations", headers=auth(token), json={"spec": URGENT}).json()
    r = client.post(f"/api/automations/{a['id']}/run/trigger", headers={"X-AC-Service-Token": st}, json={"input": {}})
    assert r.status_code == 409
    assert r.json()["detail"] == {"code": "not_connected", "message": "Connect Google Workspace to use this step.",
                                  "provider": "google"}
    view = client.get(f"/api/automations/{a['id']}", headers=auth(token)).json()
    assert view["last_error"]["code"] == "not_connected"


def test_test_run_reports_every_step(client, apis, ai, session_factory):
    token = register(client)
    _connect(session_factory)
    weekly = next(t for t in drafting.templates() if t["id"] == "weekly-digest")["spec"]
    r = client.post("/api/automations/test", headers=auth(token), json={"spec": weekly})
    body = r.json()
    assert body["ok"] is True, body
    assert [s["block"] for s in body["steps"]] == ["schedule", "gmail.search", "transform.combine", "ai.compose", "telegram.send"]
    assert body["steps"][1]["items"] == 2 and body["steps"][2]["items"] == 1
    assert "Digest &lt;b&gt;of&lt;/b&gt; the week" in apis.telegram_sent[-1]["text"]


def test_test_run_stops_at_the_failing_step(client, apis, ai):
    token = register(client)  # nothing connected
    r = client.post("/api/automations/test", headers=auth(token), json={"spec": URGENT}).json()
    assert r["ok"] is False
    assert r["steps"][0]["error"]["code"] == "not_connected"


# --------------------------------------------------------------- AI ---------

def test_ai_draft_turns_a_sentence_into_a_valid_spec(client, ai):
    token = register(client)
    r = client.post("/api/automations/draft", headers=auth(token),
                    json={"prompt": "Cuando reciba una factura avísame por Telegram"}).json()
    assert r["ok"] is True
    assert r["spec"]["trigger"]["block"] == "gmail.new_email"
    assert r["providers"] == ["google", "telegram"] and r["explanation"]


def test_ai_draft_with_unknown_blocks_comes_back_with_problems(client, ai):
    token = register(client)
    r = client.post("/api/automations/draft", headers=auth(token), json={"prompt": "bogus request"}).json()
    assert r["ok"] is False and any("not a trigger" in p for p in r["problems"])


# ----------------------------------------------------------- history --------

def test_run_detail_maps_n8n_nodes_to_steps(client, n8n):
    token = register(client)
    a = client.post("/api/automations", headers=auth(token), json={"spec": URGENT}).json()
    wid = a["n8n_workflow_id"]
    names = [n["name"] for n in n8n.workflows[wid]["nodes"]]
    fetch = next(n for n in names if n == "New email in Gmail")
    classify = next(n for n in names if n.startswith("1."))
    cond = next(n for n in names if n.startswith("2."))
    n8n.executions["9"] = {
        "id": "9", "workflowId": wid, "status": "error", "mode": "trigger",
        "startedAt": "2026-10-05T10:00:00.000Z", "stoppedAt": "2026-10-05T10:00:03.420Z",
        "data": {"resultData": {
            "runData": {
                fetch: [{"executionTime": 800, "data": {"main": [[{"json": {}}]]}}],
                classify: [{"executionTime": 1200, "data": {"main": [[{"json": {}}]]}}],
            },
            "error": {"message": '409 - "{\\"detail\\":{\\"code\\":\\"not_connected\\",\\"message\\":\\"Connect Telegram to use this step.\\"}}"',
                      "node": {"name": cond}},
        }},
    }
    runs = client.get(f"/api/automations/{a['id']}/runs", headers=auth(token)).json()["data"]
    assert runs[0]["status"] == "error" and runs[0]["duration_ms"] == 3420
    detail = client.get(f"/api/automations/{a['id']}/runs/9", headers=auth(token)).json()
    statuses = [(s["label"], s["status"]) for s in detail["steps"]]
    assert statuses[0] == ("New email in Gmail", "success")
    assert statuses[2][1] == "error" and statuses[3][1] == "skipped"
    assert detail["steps"][2]["error"] == "Connect Telegram to use this step."
