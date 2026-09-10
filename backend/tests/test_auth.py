from __future__ import annotations

import uuid

import pytest

GOOD_PW = "Sup3rSecret!!"


def _reg(client, **over):
    body = {
        "email": over.get("email", f"{uuid.uuid4().hex}@example.com"),
        "username": over.get("username", "u" + uuid.uuid4().hex[:10]),
        "password": over.get("password", GOOD_PW),
    }
    return client.post("/api/auth/register", json=body)


def test_register_first_user_is_admin(client):
    r = _reg(client)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"] and body["refresh_token"]
    assert body["user"]["role"] == "admin"  # first account


def test_every_registered_user_is_an_administrator(client):
    """Not just the first one: this is a single-operator product and the
    accounts in it are the same person on another device. An account that
    could not reach Settings had no way to be promoted without a terminal."""
    _reg(client)
    r = _reg(client)
    assert r.status_code == 201
    assert r.json()["user"]["role"] == "admin"


def test_password_policy_enforced(client):
    r = _reg(client, password="short")
    assert r.status_code == 422


def test_duplicate_email_is_generic_409(client):
    email = f"{uuid.uuid4().hex}@example.com"
    _reg(client, email=email)
    r = _reg(client, email=email)
    assert r.status_code == 409
    assert "in use" in r.json()["detail"].lower()


def test_login_and_me(client):
    reg = _reg(client).json()
    username = reg["user"]["username"]
    r = client.post("/api/auth/login", json={"identifier": username, "password": GOOD_PW})
    assert r.status_code == 200
    access = r.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200
    assert me.json()["username"] == username


def test_login_username_is_case_insensitive(client):
    reg = _reg(client, username="MixedCaseUser").json()
    assert reg["user"]["username"] == "MixedCaseUser"
    r = client.post(
        "/api/auth/login", json={"identifier": "mixedcaseuser", "password": GOOD_PW}
    )
    assert r.status_code == 200, r.text


def test_register_duplicate_username_differing_case_is_409(client):
    _reg(client, username="Duplicate1")
    r = _reg(client, username="duplicate1")
    assert r.status_code == 409


def test_login_wrong_password_is_401_generic(client):
    reg = _reg(client).json()
    r = client.post(
        "/api/auth/login",
        json={"identifier": reg["user"]["username"], "password": "WrongPass9!"},
    )
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid credentials"


def test_login_unknown_user_same_response_as_wrong_password(client):
    r = client.post(
        "/api/auth/login", json={"identifier": "nobody-here", "password": "WrongPass9!"}
    )
    assert r.status_code == 401
    assert r.json()["detail"] == "invalid credentials"


def test_protected_endpoint_requires_token(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get(
        "/api/auth/me", headers={"Authorization": "Bearer garbage"}
    ).status_code == 401


def test_refresh_rotates_and_old_token_is_rejected(client):
    reg = _reg(client).json()
    old_refresh = reg["refresh_token"]
    r1 = client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r1.status_code == 200
    new_refresh = r1.json()["refresh_token"]
    assert new_refresh != old_refresh
    # reusing the rotated token is refused...
    r2 = client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r2.status_code == 401
    assert r2.json()["detail"] == "refresh token reuse detected"
    # ...and the reuse nuked the whole family, so the "new" one is dead too
    r3 = client.post("/api/auth/refresh", json={"refresh_token": new_refresh})
    assert r3.status_code == 401


def test_logout_revokes_refresh(client):
    reg = _reg(client).json()
    rt = reg["refresh_token"]
    assert client.post("/api/auth/logout", json={"refresh_token": rt}).status_code == 200
    assert client.post("/api/auth/refresh", json={"refresh_token": rt}).status_code == 401
    # idempotent
    assert client.post("/api/auth/logout", json={"refresh_token": rt}).status_code == 200


def test_access_token_still_valid_after_logout_until_expiry(client):
    """Logout revokes refresh tokens; short-lived access tokens are not tracked.
    This documents the trade-off rather than asserting a bug.
    """
    reg = _reg(client).json()
    access = reg["access_token"]
    client.post("/api/auth/logout", json={"refresh_token": reg["refresh_token"]})
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"}).status_code == 200


def test_rate_limiting_can_be_enabled(client):
    from app.core import ratelimit

    ratelimit._hits.clear()
    ratelimit.set_enabled(True)
    try:
        codes = [
            client.post(
                "/api/auth/login", json={"identifier": "someone", "password": "WrongPass9!"}
            ).status_code
            for _ in range(15)
        ]
    finally:
        ratelimit.set_enabled(False)
        ratelimit._hits.clear()
    # limit is 10/minute for auth routes -> the tail of the burst is throttled
    assert 429 in codes
    assert codes.count(401) == 10
