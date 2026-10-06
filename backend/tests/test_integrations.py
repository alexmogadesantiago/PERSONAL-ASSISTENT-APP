"""Integrations Hub: OAuth (Google), Telegram linking, health and secrecy.

Provider APIs are an `httpx.MockTransport` that answers like the real services
(same URLs, same token and error shapes), so the real client code runs end to
end: authorize URL, sealed state, code exchange with PKCE, identity, refresh,
probes, revocation.
"""
from __future__ import annotations

import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.services.integrations import http as int_http
from app.services.integrations import oauth

PASSWORD = "Correct-Horse-9"


def register(client, username="owner", email="owner@example.com") -> str:
    r = client.post("/api/auth/register", json={"email": email, "username": username, "password": PASSWORD})
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class FakeProviders:
    """Google + Telegram as far as the hub talks to them."""

    def __init__(self):
        self.calls: list[httpx.Request] = []
        self.token_requests: list[dict] = []
        self.refresh_ok = True
        self.gmail_status = 200
        self.telegram_updates: list[dict] = []
        self.telegram_sent: list[dict] = []
        self.revoked: list[str] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        url = str(req.url)
        if url == "https://oauth2.googleapis.com/token":
            form = {k: v[0] for k, v in parse_qs(req.content.decode()).items()}
            self.token_requests.append(form)
            if form["grant_type"] == "authorization_code":
                assert form.get("code_verifier"), "PKCE verifier must be sent"
                return httpx.Response(200, json={
                    "access_token": "ya29.first", "refresh_token": "1//refresh", "expires_in": 3599,
                    "token_type": "Bearer",
                    "scope": "openid https://www.googleapis.com/auth/userinfo.email "
                             "https://www.googleapis.com/auth/gmail.readonly "
                             "https://www.googleapis.com/auth/gmail.send "
                             "https://www.googleapis.com/auth/calendar.events",
                })
            if not self.refresh_ok:
                return httpx.Response(400, json={"error": "invalid_grant", "error_description": "Token has been expired or revoked."})
            return httpx.Response(200, json={"access_token": "ya29.refreshed", "expires_in": 3599, "token_type": "Bearer"})
        if url == "https://oauth2.googleapis.com/revoke":
            self.revoked.append(req.content.decode())
            return httpx.Response(200)
        if url.startswith("https://openidconnect.googleapis.com/v1/userinfo"):
            if req.headers["Authorization"] not in ("Bearer ya29.first", "Bearer ya29.refreshed"):
                return httpx.Response(401)
            return httpx.Response(200, json={"email": "alex@example.com", "name": "Alex", "picture": "https://x/y.png"})
        if url.startswith("https://gmail.googleapis.com/"):
            return httpx.Response(self.gmail_status, json={"emailAddress": "alex@example.com"})
        if url.startswith("https://www.googleapis.com/calendar/"):
            return httpx.Response(200, json={"items": []})
        if url.startswith("https://api.telegram.org/bot"):
            method = url.rsplit("/", 1)[-1]
            token = url.split("/bot", 1)[1].split("/", 1)[0]
            if token.endswith("BAD"):
                return httpx.Response(401, json={"ok": False, "error_code": 401, "description": "Unauthorized"})
            body = json.loads(req.content or b"{}")
            if method == "getMe":
                return httpx.Response(200, json={"ok": True, "result": {"id": 42, "username": "pa_test_bot", "first_name": "PA"}})
            if method == "getUpdates":
                return httpx.Response(200, json={"ok": True, "result": self.telegram_updates})
            if method == "sendMessage":
                self.telegram_sent.append(body)
                return httpx.Response(200, json={"ok": True, "result": {"message_id": len(self.telegram_sent)}})
            if method == "getChat":
                return httpx.Response(200, json={"ok": True, "result": {"id": body["chat_id"]}})
        return httpx.Response(404, json={"error": "unexpected " + url})


@pytest.fixture
def fake(monkeypatch):
    f = FakeProviders()
    int_http.set_transport(httpx.MockTransport(f))
    oauth._used_states.clear()
    yield f
    int_http.set_transport(None)


@pytest.fixture
def google_app(client):
    """An admin who has configured the Google OAuth app (Advanced setup)."""
    admin = register(client)
    r = client.put("/api/integrations/google/app", headers=auth(admin),
                   json={"client_id": "123.apps.googleusercontent.com", "client_secret": "GOCSPX-secret-value"})
    assert r.status_code == 200, r.text
    return admin


def _sign_in(client, token, fake, services=("gmail", "calendar")):
    r = client.post("/api/integrations/google/connect", headers=auth(token), json={"services": list(services)})
    assert r.status_code == 200, r.text
    url = urlparse(r.json()["authorization_url"])
    q = {k: v[0] for k, v in parse_qs(url.query).items()}
    cb = client.get("/api/integrations/google/callback", params={"code": "4/auth-code", "state": q["state"]},
                    follow_redirects=False)
    return q, cb


# ------------------------------------------------------------- catalogue ----

def test_the_hub_lists_the_four_pillars(client):
    token = register(client)
    r = client.get("/api/integrations", headers=auth(token))
    assert r.status_code == 200
    keys = [p["key"] for p in r.json()["data"]]
    assert keys == ["google", "telegram", "microsoft", "github"]
    google = r.json()["data"][0]
    assert google["connected"] is False and google["status"] == "not_connected"
    assert google["setup"]["available"] is False, "no OAuth app configured yet"
    assert google["setup"]["redirect_uri"].endswith("/api/integrations/google/callback")
    gmail = next(s for s in google["services"] if s["key"] == "gmail")
    assert {p["label"] for p in gmail["permissions"]} == {"Read your email", "Send email as you"}


def test_connect_explains_when_the_oauth_app_is_missing(client):
    token = register(client)
    r = client.post("/api/integrations/google/connect", headers=auth(token), json={"services": ["gmail"]})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "app_not_configured"


def test_only_an_admin_configures_the_oauth_app(client, google_app, session_factory):
    from tests.conftest import demote_to_plain_user

    member = register(client, "member", "member@example.com")
    with session_factory() as db:
        demote_to_plain_user(db, "member")
    r = client.put("/api/integrations/google/app", headers=auth(member), json={"client_id": "x.apps", "client_secret": "y"})
    assert r.status_code == 403
    view = client.get("/api/integrations/google/app", headers=auth(member)).json()
    assert view["client_id"] == "123.apps.googleusercontent.com", "the member's attempt changed nothing"
    assert view["client_secret_configured"] is True
    assert "GOCSPX-secret-value" not in json.dumps(view)


# --------------------------------------------------------------- OAuth ------

def test_google_sign_in_end_to_end(client, google_app, fake):
    q, cb = _sign_in(client, google_app, fake)
    assert q["code_challenge_method"] == "S256" and q["code_challenge"]
    assert q["access_type"] == "offline" and q["prompt"] == "consent"
    assert "gmail.readonly" in q["scope"] and "calendar.events" in q["scope"] and "drive.file" not in q["scope"]
    assert cb.status_code == 302
    assert cb.headers["location"].endswith("/integrations/google?connected=1")

    view = client.get("/api/integrations/google", headers=auth(google_app)).json()
    conn = view["connection"]
    assert view["status"] == "healthy"
    assert conn["account"]["email"] == "alex@example.com"
    assert set(conn["services"]) == {"gmail", "calendar"}
    assert conn["security"]["encrypted_at_rest"] is True and conn["security"]["refresh"] is True
    blob = json.dumps(view)
    for secret in ("ya29.first", "1//refresh", "GOCSPX-secret-value"):
        assert secret not in blob, f"{secret} leaked to the browser"


def test_a_state_cannot_be_replayed_or_forged(client, google_app, fake):
    q, cb = _sign_in(client, google_app, fake)
    assert "connected=1" in cb.headers["location"]
    again = client.get("/api/integrations/google/callback", params={"code": "x", "state": q["state"]}, follow_redirects=False)
    assert "error=invalid_state" in again.headers["location"]
    forged = client.get("/api/integrations/google/callback", params={"code": "x", "state": "not-a-state"}, follow_redirects=False)
    assert "error=invalid_state" in forged.headers["location"]


def test_a_denied_consent_comes_back_as_an_error(client, google_app, fake):
    r = client.get("/api/integrations/google/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert r.status_code == 302 and "error=access_denied" in r.headers["location"]


def test_connection_test_reports_every_check(client, google_app, fake):
    _sign_in(client, google_app, fake)
    r = client.post("/api/integrations/google/test", headers=auth(google_app))
    body = r.json()
    assert body["ok"] is True and body["health"] == "healthy"
    labels = {c["key"]: c["ok"] for c in body["checks"]}
    assert labels == {"auth": True, "identity": True, "gmail": True, "calendar": True}


def test_a_failing_service_degrades_instead_of_failing_everything(client, google_app, fake):
    _sign_in(client, google_app, fake)
    fake.gmail_status = 403
    body = client.post("/api/integrations/google/test", headers=auth(google_app)).json()
    assert body["health"] == "degraded" and body["action"] == "manage_permissions"
    gmail = next(c for c in body["checks"] if c["key"] == "gmail")
    assert "permission" in gmail["detail"].lower()


def test_an_expiring_token_is_refreshed_and_persisted(client, google_app, fake, session_factory):
    _sign_in(client, google_app, fake)
    from app.services.integrations import connections as conns
    from app.core import crypto
    from app.models import Credential
    from sqlalchemy import select

    with session_factory() as db:
        row = db.scalar(select(Credential).where(Credential.provider == "google"))
        secret = crypto.decrypt_secret(row.encrypted_data)
        secret["expires_at"] = time.time() - 10
        conns.update_secret(db, row, secret)

    body = client.post("/api/integrations/google/test", headers=auth(google_app)).json()
    assert body["ok"] is True
    assert fake.token_requests[-1]["grant_type"] == "refresh_token"
    with session_factory() as db:
        row = db.scalar(select(Credential).where(Credential.provider == "google"))
        assert crypto.decrypt_secret(row.encrypted_data)["access_token"] == "ya29.refreshed"
        assert crypto.decrypt_secret(row.encrypted_data)["refresh_token"] == "1//refresh", "refresh token kept"


def test_a_revoked_refresh_token_marks_the_connection_expired(client, google_app, fake, session_factory):
    _sign_in(client, google_app, fake)
    from app.services.integrations import connections as conns
    from app.core import crypto
    from app.models import Credential
    from sqlalchemy import select

    with session_factory() as db:
        row = db.scalar(select(Credential).where(Credential.provider == "google"))
        secret = crypto.decrypt_secret(row.encrypted_data)
        secret["expires_at"] = time.time() - 10
        conns.update_secret(db, row, secret)
    fake.refresh_ok = False
    body = client.post("/api/integrations/google/test", headers=auth(google_app)).json()
    assert body["health"] == "expired" and body["action"] == "reconnect"
    assert client.get("/api/integrations/google", headers=auth(google_app)).json()["status"] == "expired"


def test_disconnect_revokes_and_forgets(client, google_app, fake):
    _sign_in(client, google_app, fake)
    r = client.delete("/api/integrations/google", headers=auth(google_app))
    assert r.status_code == 200
    assert fake.revoked and "1%2F%2Frefresh" in fake.revoked[0]
    assert client.get("/api/integrations/google", headers=auth(google_app)).json()["connected"] is False


def test_another_user_cannot_see_my_connection(client, google_app, fake):
    _sign_in(client, google_app, fake)
    other = register(client, "other", "other@example.com")
    assert client.get("/api/integrations/google", headers=auth(other)).json()["connected"] is False
    assert client.post("/api/integrations/google/test", headers=auth(other)).status_code == 404


def test_connections_stay_out_of_the_manual_vault_names(client, google_app, fake):
    """A connection is a vault row, so it must not collide with a manual one."""
    client.post("/api/credentials", headers=auth(google_app), json={
        "provider": "google", "name": "Google Workspace", "type": "api_key", "secret": {"api_key": "abc12345"}})
    _, cb = _sign_in(client, google_app, fake)
    assert "connected=1" in cb.headers["location"]


# ------------------------------------------------------------- Telegram -----

BOT = "123456789:AAH" + "x" * 32


def test_telegram_connects_and_links_the_chat_without_a_chat_id(client, fake):
    token = register(client)
    r = client.post("/api/integrations/telegram/token", headers=auth(token), json={"bot_token": BOT})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    link = body["link_url"]
    assert link.startswith("https://t.me/pa_test_bot?start=pa")
    code = link.split("start=")[1]

    # not pressed yet
    assert client.post("/api/integrations/telegram/link", headers=auth(token)).json()["linked"] is False

    fake.telegram_updates = [{"update_id": 1, "message": {"text": f"/start {code}", "chat": {"id": 777, "first_name": "Alex", "type": "private"}}}]
    linked = client.post("/api/integrations/telegram/link", headers=auth(token)).json()
    assert linked["linked"] is True and linked["chat"]["id"] == 777
    assert fake.telegram_sent and fake.telegram_sent[0]["chat_id"] == 777, "a confirmation is sent"

    view = client.get("/api/integrations/telegram", headers=auth(token)).json()
    assert view["status"] == "healthy"
    assert BOT not in json.dumps(view)

    assert client.post("/api/integrations/telegram/test-message", headers=auth(token)).json()["sent"] is True
    test = client.post("/api/integrations/telegram/test", headers=auth(token)).json()
    assert test["ok"] is True


def test_someone_elses_start_code_does_not_link(client, fake):
    token = register(client)
    client.post("/api/integrations/telegram/token", headers=auth(token), json={"bot_token": BOT})
    fake.telegram_updates = [{"update_id": 1, "message": {"text": "/start pa000000000000", "chat": {"id": 1}}}]
    assert client.post("/api/integrations/telegram/link", headers=auth(token)).json()["linked"] is False


def test_a_bad_bot_token_is_refused_with_a_human_message(client, fake):
    token = register(client)
    r = client.post("/api/integrations/telegram/token", headers=auth(token), json={"bot_token": "123456789:" + "y" * 31 + "BAD"})
    assert r.status_code == 401 and "BotFather" in r.json()["detail"]
    r = client.post("/api/integrations/telegram/token", headers=auth(token), json={"bot_token": "not a token at all"})
    assert r.status_code == 400
