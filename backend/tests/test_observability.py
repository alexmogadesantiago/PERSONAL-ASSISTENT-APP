"""Activity, error centre, notifications and the dashboard overview."""
from __future__ import annotations

from sqlalchemy import select

from app.services import observability as obs
from app.services.integrations import connections as conns
from app.services.integrations import providers

PASSWORD = "Correct-Horse-9"


def register(client, username="owner", email="owner@example.com") -> str:
    r = client.post("/api/auth/register", json={"email": email, "username": username, "password": PASSWORD})
    return r.json()["access_token"]


def auth(t):
    return {"Authorization": f"Bearer {t}"}


def _fail(client, token, message, node="Gmail", execution="11"):
    st = client.post("/api/ai/service-token", headers=auth(token)).json()["token"]
    r = client.post("/api/automations/events", headers={"X-AC-Service-Token": st}, json={
        "workflow_id": "w1", "workflow_name": "Asistente - Email", "execution_id": execution,
        "node": node, "message": message})
    assert r.status_code == 201


def test_diagnosis_turns_errors_into_actions():
    d = obs.diagnose("Google Workspace access expired. Reconnect to continue.")
    assert d.title == "Google Workspace authentication expired" and d.action_href == "/integrations/google"
    d = obs.diagnose("Configuracion incompleta: TELEGRAM_TOKEN_EMAIL (launcher > Ajustes > Bot Email)")
    assert d.title == "Missing configuration" and "TELEGRAM_TOKEN_EMAIL" in d.explanation
    d = obs.diagnose('409 - {"detail":{"code":"not_connected","message":"Connect Telegram to use this step."}}')
    assert d.title == "Telegram is not connected" and d.action_kind == "connect"
    d = obs.diagnose("getaddrinfo ENOTFOUND news.google.com")
    assert d.title == "A service did not answer"
    d = obs.diagnose("something odd", node="Parse")
    assert d.title == "Failed at «Parse»" and d.explanation == "something odd"


def test_error_centre_groups_repeats_and_can_resolve(client):
    token = register(client)
    _fail(client, token, "Configuracion incompleta: AC_PROFILE_ID (launcher)", execution="1")
    _fail(client, token, "Configuracion incompleta: AC_PROFILE_ID (launcher)", execution="2")
    _fail(client, token, "getaddrinfo ENOTFOUND news.google.com", node="RSS", execution="3")
    body = client.get("/api/errors", headers=auth(token)).json()
    titles = {g["title"]: g for g in body["data"]}
    assert titles["Missing configuration"]["count"] == 2
    assert titles["Missing configuration"]["automation"] == "Asistente - Email"
    assert "A service did not answer" in titles

    key = titles["Missing configuration"]["id"]
    assert client.post(f"/api/errors/{key}/resolve", headers=auth(token)).json()["resolved"] is True
    after = {g["title"] for g in client.get("/api/errors", headers=auth(token)).json()["data"]}
    assert "Missing configuration" not in after
    # it comes back if it happens again (SQLite timestamps have 1 s resolution)
    import time

    time.sleep(1.1)
    _fail(client, token, "Configuracion incompleta: AC_PROFILE_ID (launcher)", execution="4")
    again = {g["title"] for g in client.get("/api/errors", headers=auth(token)).json()["data"]}
    assert "Missing configuration" in again


def test_an_expired_connection_is_an_error_and_a_notification(client, session_factory):
    token = register(client)
    from app.models import User

    with session_factory() as db:
        user = db.scalar(select(User))
        row = conns.save(db, user.id, providers.GOOGLE, secret={"access_token": "a"}, meta={"scopes": []})
        conns.set_health(db, row, conns.EXPIRED, "invalid_grant")
    errs = client.get("/api/errors", headers=auth(token)).json()["data"]
    assert errs[0]["severity"] == "critical" and errs[0]["action"]["href"] == "/integrations/google"
    notes = client.get("/api/notifications", headers=auth(token)).json()
    assert notes["data"][0]["title"] == "Google Workspace needs you to sign in again"
    assert notes["unread"] >= 1


def test_notifications_can_be_marked_read(client):
    token = register(client)
    _fail(client, token, "boom")
    body = client.get("/api/notifications", headers=auth(token)).json()
    # the failure, plus the security notice for the token the helper rotated
    assert {n["kind"] for n in body["data"]} == {"automation", "security"}
    assert body["unread"] == 2
    client.post("/api/notifications/read", headers=auth(token))
    assert client.get("/api/notifications", headers=auth(token)).json()["unread"] == 0


def test_activity_filters_by_category_and_hides_bookkeeping(client):
    token = register(client)
    _fail(client, token, "boom")
    client.post("/api/notifications/read", headers=auth(token))
    all_items = client.get("/api/activity", headers=auth(token)).json()
    kinds = {i["kind"] for i in all_items["data"]}
    assert "automation.failure" in kinds and "notifications.read" not in kinds
    assert all_items["sources"]["n8n"] is False, "n8n is not configured in tests and says so"
    errors_only = client.get("/api/activity?category=errors", headers=auth(token)).json()["data"]
    assert errors_only and all(i["category"] == "errors" or i["result"] == "error" for i in errors_only)
    security = client.get("/api/activity?category=security", headers=auth(token)).json()["data"]
    assert all(i["category"] == "security" for i in security)


def test_overview_is_honest_without_n8n(client):
    token = register(client)
    body = client.get("/api/overview", headers=auth(token)).json()
    assert body["n8n"]["available"] is False
    assert body["system"]["state"] == "attention"
    assert body["integrations"] == {"connected": 0, "total": 4, "unhealthy": []}
    assert len(body["executions"]["series"]) == 7
    assert body["executions"]["success_rate_7d"] is None, "no runs -> no fake percentage"


def test_execution_detail_orders_steps_and_diagnoses(client, monkeypatch):
    import httpx

    from app.api.routes import observability as route
    from app.services.n8n import N8nService

    wf = {"id": "w1", "name": "Asistente - Noticias", "nodes": [
        {"name": "Nota", "type": "n8n-nodes-base.stickyNote"},
        {"name": "Telegram", "type": "n8n-nodes-base.httpRequest"},
        {"name": "Trigger", "type": "n8n-nodes-base.scheduleTrigger"},
        {"name": "RSS", "type": "n8n-nodes-base.rssFeedRead"}],
        "connections": {"Trigger": {"main": [[{"node": "RSS"}]]}, "RSS": {"main": [[{"node": "Telegram"}]]}}}
    ex = {"id": "5", "workflowId": "w1", "status": "error", "startedAt": "2026-10-05T08:00:00Z",
          "stoppedAt": "2026-10-05T08:00:02Z",
          "data": {"resultData": {"runData": {
              "Trigger": [{"executionTime": 1, "data": {"main": [[{"json": {}}]]}}],
              "RSS": [{"executionTime": 900, "data": {"main": [[{"json": {}}, {"json": {}}]]}}]},
              "error": {"message": "Telegram error: Unauthorized 401 bot token", "node": {"name": "Telegram"}}}}}

    def handler(req):
        if req.url.path == "/api/v1/executions/5":
            return httpx.Response(200, json=ex)
        if req.url.path == "/api/v1/workflows/w1":
            return httpx.Response(200, json=wf)
        return httpx.Response(404)

    monkeypatch.setattr(route, "_n8n", lambda db: N8nService(base_url="http://n8n", api_key="k",
                                                              transport=httpx.MockTransport(handler)))
    token = register(client)
    body = client.get("/api/executions/5", headers=auth(token)).json()
    assert [s["label"] for s in body["steps"]] == ["Trigger", "RSS", "Telegram"]
    assert body["steps"][1]["items"] == 2 and body["steps"][2]["status"] == "error"
    assert body["diagnosis"]["title"] == "Telegram bot token rejected"
    assert body["duration_ms"] == 2000
