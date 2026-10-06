"""POST /api/automations/events: how n8n's Error workflow reports a failed run."""
from __future__ import annotations

from sqlalchemy import select

from app.models import EventSeverity, SystemEvent


def _register(client) -> str:
    r = client.post(
        "/api/auth/register",
        json={"email": "ops@example.com", "username": "ops", "password": "S3cure-pass-123"},
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def _service_token(client) -> str:
    token = _register(client)
    r = client.post("/api/ai/service-token", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code in (200, 201), r.text
    return r.json()["token"]


PAYLOAD = {
    "workflow_id": "pa03noticias0001",
    "workflow_name": "Asistente - Noticias",
    "execution_id": "4321",
    "node": "RSS - Noticias",
    "mode": "trigger",
    "message": "getaddrinfo ENOTFOUND news.google.com",
}


def test_a_failure_is_recorded_in_the_activity_trail(client, session_factory):
    st = _service_token(client)
    r = client.post("/api/automations/events", json=PAYLOAD, headers={"X-AC-Service-Token": st})
    assert r.status_code == 201, r.text
    assert r.json()["recorded"] is True

    with session_factory() as db:
        ev = db.scalar(select(SystemEvent).where(SystemEvent.type == "automation.failure"))
    assert ev is not None
    assert ev.severity == EventSeverity.error
    assert "Asistente - Noticias" in ev.message and "RSS - Noticias" in ev.message
    assert ev.meta["execution_id"] == "4321"


def test_without_the_service_token_it_is_refused(client):
    _register(client)
    assert client.post("/api/automations/events", json=PAYLOAD).status_code == 401
    bad = client.post(
        "/api/automations/events", json=PAYLOAD, headers={"X-AC-Service-Token": "acs_wrong"}
    )
    assert bad.status_code == 401


def test_a_user_bearer_token_is_not_a_service_token(client):
    token = _register(client)
    r = client.post(
        "/api/automations/events", json=PAYLOAD, headers={"Authorization": f"Bearer {token}"}
    )
    assert r.status_code == 401


def test_the_payload_shape_is_enforced(client):
    st = _service_token(client)
    headers = {"X-AC-Service-Token": st}
    assert client.post("/api/automations/events", json={**PAYLOAD, "message": ""}, headers=headers).status_code == 422
    assert (
        client.post("/api/automations/events", json={**PAYLOAD, "message": "x" * 2001}, headers=headers).status_code
        == 422
    )
    assert (
        client.post("/api/automations/events", json={**PAYLOAD, "severity": "critical"}, headers=headers).status_code
        == 422
    )
