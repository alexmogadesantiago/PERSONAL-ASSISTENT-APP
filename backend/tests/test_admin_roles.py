"""Who may change the platform's settings, and how one becomes that person.

The rules under test:

* the API decides, not the browser - a plain user is refused with 403 no matter
  what the frontend renders;
* reading Settings is open to any signed-in user; writing is not;
* nobody can give themselves a role over HTTP - there is no such field and no
  such endpoint;
* `python -m app.manage` is the only way to change a role, it is idempotent,
  it is audited, and it will not leave the platform with zero administrators;
* a promotion takes effect immediately, on the token the user already holds,
  because authorisation reads the database rather than the JWT's role claim.
"""
from __future__ import annotations

import pytest

from app import manage
from app.models import User, UserRole
from app.services import auth as auth_service


@pytest.fixture
def cli(monkeypatch, session_factory):
    """Run the operator CLI against the test database."""
    monkeypatch.setattr(manage, "SessionLocal", session_factory)
    return manage.main


def register(client, username: str, email: str) -> str:
    r = client.post(
        "/api/auth/register",
        json={"email": email, "username": username, "password": "Correct-Horse-9"},
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def role_of(db_session, username: str) -> UserRole:
    db_session.expire_all()
    user = db_session.query(User).filter(User.username == username).one()
    return user.role


# ------------------------------------------------------- the API decides ---


def test_the_first_account_is_admin_and_the_second_is_not(client):
    owner = register(client, "owner", "owner@example.com")
    member = register(client, "member", "member@example.com")

    assert client.get("/api/auth/me", headers=auth(owner)).json()["role"] == "admin"
    assert client.get("/api/auth/me", headers=auth(member)).json()["role"] == "user"


def test_a_plain_user_cannot_write_any_administrative_setting(client):
    register(client, "owner", "owner@example.com")
    member = register(client, "member", "member@example.com")

    # AI: provider, model, fallback and the credentials behind them
    assert client.put("/api/ai/config", headers=auth(member), json={}).status_code == 403
    assert client.post("/api/ai/test", headers=auth(member), json={}).status_code == 403
    # integrations: n8n and Playwright endpoints and keys
    for service in ("n8n", "playwright"):
        write = client.put(
            f"/api/services/config/{service}",
            headers=auth(member),
            json={"base_url": "https://attacker.example.com"},
        )
        assert write.status_code == 403, service
        assert (
            client.post(f"/api/services/config/{service}/test", headers=auth(member)).status_code
            == 403
        )


def test_a_plain_user_can_still_read_the_settings_page(client):
    register(client, "owner", "owner@example.com")
    member = register(client, "member", "member@example.com")

    for path in (
        "/api/ai/config",
        "/api/ai/providers",
        "/api/ai/health",
        "/api/services/config",
    ):
        assert client.get(path, headers=auth(member)).status_code == 200, path


def test_an_administrator_can_write_them(client):
    owner = register(client, "owner", "owner@example.com")

    ai = client.put(
        "/api/ai/config",
        headers=auth(owner),
        json={"provider": "nvidia_nim", "model": "nvidia/nemotron-3-super-120b-a12b"},
    )
    assert ai.status_code == 200, ai.text
    assert ai.json()["provider"] == "nvidia_nim"

    n8n = client.put(
        "/api/services/config/n8n",
        headers=auth(owner),
        json={"base_url": "https://n8n.example.com", "secret": "n8n-api-key"},
    )
    assert n8n.status_code == 200, n8n.text
    assert n8n.json()["configured"] is True


# ------------------------------------------------ no self-service admin ----


def test_registration_ignores_a_role_the_caller_tries_to_set(client):
    register(client, "owner", "owner@example.com")
    r = client.post(
        "/api/auth/register",
        json={
            "email": "sneaky@example.com",
            "username": "sneaky",
            "password": "Correct-Horse-9",
            "role": "admin",
        },
    )
    assert r.status_code in (200, 201), r.text
    assert r.json()["user"]["role"] == "user"


def test_there_is_no_endpoint_that_writes_a_role(client):
    member_token = register(client, "owner", "owner@example.com")
    # `/api/auth/me` is read-only; nothing else accepts a role at all.
    for method in ("PUT", "PATCH", "POST"):
        r = client.request(method, "/api/auth/me", headers=auth(member_token), json={"role": "admin"})
        assert r.status_code in (404, 405), f"{method} /api/auth/me -> {r.status_code}"


# ------------------------------------------------------- the operator CLI --


def test_promote_makes_a_user_an_administrator(client, cli, db_session, capsys):
    register(client, "owner", "owner@example.com")
    register(client, "alexmogadesantiago", "alex@example.com")
    assert role_of(db_session, "alexmogadesantiago") is UserRole.user

    assert cli(["promote-admin", "alexmogadesantiago"]) == 0
    assert role_of(db_session, "alexmogadesantiago") is UserRole.admin
    assert "role=admin" in capsys.readouterr().out


def test_promote_matches_the_email_too_and_ignores_case(client, cli, db_session):
    register(client, "owner", "owner@example.com")
    register(client, "Alex", "Alex@Example.com")

    assert cli(["promote-admin", "ALEX@example.com"]) == 0
    assert role_of(db_session, "Alex") is UserRole.admin


def test_promoting_twice_changes_nothing_and_still_succeeds(client, cli, db_session, capsys):
    register(client, "owner", "owner@example.com")
    register(client, "member", "member@example.com")

    assert cli(["promote-admin", "member"]) == 0
    capsys.readouterr()
    # A runbook that is safe to re-run is a runbook people actually follow.
    assert cli(["promote-admin", "member"]) == 0
    assert "unchanged" in capsys.readouterr().out
    assert role_of(db_session, "member") is UserRole.admin


def test_an_unknown_user_is_an_error_not_a_silent_no_op(client, cli, capsys):
    register(client, "owner", "owner@example.com")
    assert cli(["promote-admin", "nobody"]) == 1
    assert "no user matches" in capsys.readouterr().err


def test_the_last_administrator_cannot_be_demoted(client, cli, db_session, capsys):
    register(client, "owner", "owner@example.com")
    register(client, "member", "member@example.com")

    # Losing the only admin would lock the panel for everyone.
    assert cli(["demote-admin", "owner"]) == 2
    assert "only administrator" in capsys.readouterr().err
    assert role_of(db_session, "owner") is UserRole.admin


def test_demotion_works_once_a_second_administrator_exists(client, cli, db_session):
    register(client, "owner", "owner@example.com")
    register(client, "member", "member@example.com")

    assert cli(["promote-admin", "member"]) == 0
    assert cli(["demote-admin", "owner"]) == 0
    assert role_of(db_session, "owner") is UserRole.user
    assert role_of(db_session, "member") is UserRole.admin


def test_listing_shows_roles_and_never_a_password_hash(client, cli, capsys):
    register(client, "owner", "owner@example.com")
    register(client, "member", "member@example.com")

    assert cli(["list-users"]) == 0
    out = capsys.readouterr().out
    assert "owner <owner@example.com> role=admin" in out
    assert "member <member@example.com> role=user" in out
    assert "$argon2" not in out and "password" not in out

    assert cli(["list-users", "--admins-only"]) == 0
    admins = capsys.readouterr().out
    assert "owner" in admins and "member" not in admins


def test_a_role_change_is_written_to_the_audit_log(client, cli, db_session):
    register(client, "owner", "owner@example.com")
    register(client, "member", "member@example.com")
    cli(["promote-admin", "member"])

    from app.models import SystemEvent

    event = (
        db_session.query(SystemEvent)
        .filter(SystemEvent.type == "auth.role.change")
        .order_by(SystemEvent.created_at.desc())
        .first()
    )
    assert event is not None
    assert event.meta["username"] == "member"
    assert event.meta["from"] == "user" and event.meta["to"] == "admin"
    assert event.meta["via"] == "cli"


def test_a_promotion_applies_to_the_token_the_user_already_holds(client, cli):
    """No re-login: `require_admin` reads the database, not the JWT claim.

    This is what makes the fix usable in production - the operator promotes the
    account from a shell and the browser session that is already open can save
    Settings on the next click.
    """
    register(client, "owner", "owner@example.com")
    member = register(client, "member", "member@example.com")
    assert client.put("/api/ai/config", headers=auth(member), json={}).status_code == 403

    assert cli(["promote-admin", "member"]) == 0

    allowed = client.put(
        "/api/ai/config", headers=auth(member), json={"provider": "openrouter"}
    )
    assert allowed.status_code == 200, allowed.text


def test_a_demoted_administrator_loses_access_immediately(client, cli):
    owner = register(client, "owner", "owner@example.com")
    member = register(client, "member", "member@example.com")
    cli(["promote-admin", "member"])

    assert cli(["demote-admin", "owner"]) == 0
    assert client.put("/api/ai/config", headers=auth(owner), json={}).status_code == 403
    assert client.get("/api/ai/config", headers=auth(owner)).status_code == 200
    assert client.put("/api/ai/config", headers=auth(member), json={}).status_code == 200


def test_authentication_itself_is_untouched(client, db_session):
    register(client, "owner", "owner@example.com")

    login = client.post(
        "/api/auth/login", json={"identifier": "owner", "password": "Correct-Horse-9"}
    )
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    assert client.get("/api/auth/me", headers=auth(token)).json()["username"] == "owner"

    bad = client.post("/api/auth/login", json={"identifier": "owner", "password": "wrong"})
    assert bad.status_code == 401
    assert auth_service.user_count(db_session) == 1


# ------------------------------------------- what an admin writes survives --


def test_what_an_admin_saves_beats_the_environment(client, settings_factory):
    """The panel promises "saving here overrides the environment". Prove it."""
    settings = settings_factory()
    settings.n8n_base_url = "https://from-the-environment.example.com"
    settings.n8n_api_key = "env-key"

    owner = register(client, "owner", "owner@example.com")
    before = client.get("/api/services/config/n8n", headers=auth(owner)).json()
    assert before["source"] == "environment"
    assert before["base_url"] == "https://from-the-environment.example.com"

    saved = client.put(
        "/api/services/config/n8n",
        headers=auth(owner),
        json={"base_url": "https://from-the-panel.example.com", "secret": "panel-key"},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["source"] == "database"
    assert saved.json()["base_url"] == "https://from-the-panel.example.com"

    after = client.get("/api/services/config/n8n", headers=auth(owner)).json()
    assert after["source"] == "database"
    assert after["base_url"] == "https://from-the-panel.example.com"
    # and the key it stored is never handed back
    assert "panel-key" not in client.get("/api/services/config", headers=auth(owner)).text


# ------------------------------------------- an admin's secrets stay secret --


def test_a_key_an_admin_saves_never_appears_anywhere_readable(client, db_session):
    owner = register(client, "owner", "owner@example.com")
    nim_key = "nvapi-secret-value-do-not-echo"
    n8n_key = "n8n-secret-value-do-not-echo"

    client.put(
        "/api/ai/config",
        headers=auth(owner),
        json={
            "provider": "nvidia_nim",
            "credentials": [{"provider": "nvidia_nim", "api_key": nim_key}],
        },
    )
    client.put(
        "/api/services/config/n8n",
        headers=auth(owner),
        json={"base_url": "https://n8n.example.com", "secret": n8n_key},
    )

    # every view the panel can reach
    for path in (
        "/api/ai/config",
        "/api/ai/providers",
        "/api/ai/health",
        "/api/services/config",
        "/api/services/config/n8n",
        "/api/system/status",
    ):
        body = client.get(path, headers=auth(owner)).text
        assert nim_key not in body, path
        assert n8n_key not in body, path

    # and the audit trail, which an operator reads and an exporter may ship
    from app.models import SystemEvent

    for event in db_session.query(SystemEvent).all():
        blob = f"{event.message} {event.meta}"
        assert nim_key not in blob and n8n_key not in blob

    # what IS shown is a four-character hint, which identifies without revealing
    stored = {p["provider"]: p for p in client.get("/api/ai/config", headers=auth(owner)).json()["providers"]}
    assert stored["nvidia_nim"]["secret_configured"] is True
    assert stored["nvidia_nim"]["secret_hint"].endswith("echo")


def test_a_rejected_write_does_not_echo_the_secret_back(client):
    owner = register(client, "owner", "owner@example.com")
    secret = "n8n-secret-that-must-not-come-back"

    # The SSRF guard refuses a link-local endpoint; the error must name the URL
    # problem without quoting the credential that came with it.
    r = client.put(
        "/api/services/config/n8n",
        headers=auth(owner),
        json={"base_url": "http://169.254.169.254/latest/meta-data", "secret": secret},
    )
    assert r.status_code >= 400, r.text
    assert secret not in r.text
