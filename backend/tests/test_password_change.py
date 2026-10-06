"""POST /api/auth/password and GET /api/auth/sessions."""
from __future__ import annotations

PASSWORD = "Correct-Horse-9"


def _register(client):
    r = client.post("/api/auth/register", json={"email": "p@example.com", "username": "pat", "password": PASSWORD})
    assert r.status_code == 201, r.text
    return r.json()


def test_change_password_signs_every_session_out(client):
    body = _register(client)
    token, refresh = body["access_token"], body["refresh_token"]
    h = {"Authorization": f"Bearer {token}"}
    assert len(client.get("/api/auth/sessions", headers=h).json()) == 1

    r = client.post("/api/auth/password", headers=h, json={"current_password": PASSWORD, "new_password": "Newer-Horse-10"})
    assert r.status_code == 200 and r.json()["sessions_revoked"] == 1
    assert client.post("/api/auth/refresh", json={"refresh_token": refresh}).status_code == 401
    assert client.post("/api/auth/login", json={"identifier": "pat", "password": PASSWORD}).status_code == 401
    assert client.post("/api/auth/login", json={"identifier": "pat", "password": "Newer-Horse-10"}).status_code == 200


def test_wrong_current_password_and_weak_new_password_are_refused(client):
    h = {"Authorization": f"Bearer {_register(client)['access_token']}"}
    wrong = client.post("/api/auth/password", headers=h, json={"current_password": "nope", "new_password": "Newer-Horse-10"})
    assert wrong.status_code == 400 and "incorrect" in wrong.json()["detail"]
    weak = client.post("/api/auth/password", headers=h, json={"current_password": PASSWORD, "new_password": "short"})
    assert weak.status_code == 422
    same = client.post("/api/auth/password", headers=h, json={"current_password": PASSWORD, "new_password": PASSWORD})
    assert same.status_code == 400
