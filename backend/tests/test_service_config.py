"""Service configuration: resolution order, secret handling, and the API.

The contract this locks down:

* database beats environment, and the API says which one won;
* a partially configured service is `configured: false` and names what is
  missing, so the panel can tell the user exactly what to fill in;
* secrets go in, hints come out - a stored secret must never appear in any
  response, in the audit trail, or in the OpenAPI schema;
* saving a URL must not silently wipe a stored key.
"""
from __future__ import annotations


import pytest

from app.models import ServiceConfig, SystemEvent
from app.services import service_config as svc

SECRET = "n8n_api_key_super_secret_value"


@pytest.fixture
def env_unset(settings_factory):
    """Nothing configured through the environment."""
    return settings_factory()


# ------------------------------------------------------------- resolution ----


def test_nothing_anywhere_is_not_configured(env_unset, db_session):
    resolved = svc.resolve(db_session, "n8n")
    assert resolved.configured is False
    assert resolved.source == svc.NONE
    assert resolved.missing == ["AC_N8N_BASE_URL", "AC_N8N_API_KEY"]


def test_environment_only(env_unset, db_session):
    env_unset.n8n_base_url = "https://env.example.com"
    env_unset.n8n_api_key = "env-key"

    resolved = svc.resolve(db_session, "n8n")
    assert resolved.configured is True
    assert resolved.source == svc.ENVIRONMENT
    assert resolved.base_url == "https://env.example.com"
    assert resolved.secret == "env-key"


def test_database_overrides_environment(env_unset, db_session):
    env_unset.n8n_base_url = "https://env.example.com"
    env_unset.n8n_api_key = "env-key"
    svc.upsert(db_session, "n8n", base_url="https://panel.example.com", secret=SECRET)

    resolved = svc.resolve(db_session, "n8n")
    assert resolved.source == svc.DATABASE
    assert resolved.base_url == "https://panel.example.com"
    assert resolved.secret == SECRET


def test_partial_configuration_is_not_configured(env_unset, db_session):
    """A URL with no API key cannot drive n8n, so it must not read as ready."""
    svc.upsert(db_session, "n8n", base_url="https://panel.example.com")

    resolved = svc.resolve(db_session, "n8n")
    assert resolved.configured is False
    assert resolved.missing == ["AC_N8N_API_KEY"]


def test_playwright_needs_no_secret(env_unset, db_session):
    svc.upsert(db_session, "playwright", base_url="https://scraper.example.com")
    resolved = svc.resolve(db_session, "playwright")
    assert resolved.configured is True
    assert resolved.missing == []


def test_gemini_needs_no_url_and_defaults_to_the_google_host(env_unset, db_session):
    svc.upsert(db_session, "gemini", secret="AIza-key")
    resolved = svc.resolve(db_session, "gemini")
    assert resolved.configured is True
    assert resolved.base_url == "https://generativelanguage.googleapis.com"


def test_disabled_is_never_configured(env_unset, db_session):
    svc.upsert(db_session, "n8n", base_url="https://panel.example.com", secret=SECRET)
    svc.upsert(db_session, "n8n", enabled=False)
    assert svc.resolve(db_session, "n8n").configured is False


# ----------------------------------------------------------------- secrets ---


def test_secret_is_encrypted_at_rest(env_unset, db_session):
    svc.upsert(db_session, "n8n", base_url="https://panel.example.com", secret=SECRET)
    row = db_session.get(ServiceConfig, "n8n")

    assert row.encrypted_secret is not None
    assert SECRET.encode() not in row.encrypted_secret
    assert row.secret_hint.endswith(SECRET[-4:])
    assert SECRET not in row.secret_hint


def test_saving_a_url_keeps_the_stored_secret(env_unset, db_session):
    svc.upsert(db_session, "n8n", base_url="https://a.example.com", secret=SECRET)
    resolved = svc.upsert(db_session, "n8n", base_url="https://b.example.com")

    assert resolved.base_url == "https://b.example.com"
    assert resolved.secret == SECRET, "editing the URL must not wipe the key"


def test_clear_secret_removes_it(env_unset, db_session):
    svc.upsert(db_session, "n8n", base_url="https://a.example.com", secret=SECRET)
    resolved = svc.upsert(db_session, "n8n", clear_secret=True)

    assert resolved.secret == ""
    assert resolved.configured is False


def test_public_view_carries_no_secret(env_unset, db_session):
    svc.upsert(db_session, "n8n", base_url="https://a.example.com", secret=SECRET)
    view = svc.public_view(svc.resolve(db_session, "n8n"))

    assert SECRET not in repr(view)
    assert view["secret_configured"] is True
    assert view["secret_hint"].endswith(SECRET[-4:])
    assert "secret" not in view


def test_rejects_a_url_without_a_scheme(env_unset, db_session):
    with pytest.raises(svc.ServiceConfigError):
        svc.upsert(db_session, "n8n", base_url="n8n.example.com")


def test_rejects_a_cloud_metadata_endpoint(env_unset, db_session):
    """An admin must not be able to aim the health prober at instance metadata."""
    for bad in ("http://169.254.169.254", "http://169.254.1.1/health"):
        with pytest.raises(svc.ServiceConfigError):
            svc.upsert(db_session, "playwright", base_url=bad)


def test_allows_a_private_service_address(env_unset, db_session):
    """Private is the NORMAL case: a Docker sidecar or a Render private service."""
    for good in ("http://playwright:3000", "http://10.0.0.5:3000", "http://127.0.0.1:3000"):
        resolved = svc.upsert(db_session, "playwright", base_url=good)
        assert resolved.base_url == good


def test_rejects_an_unknown_service(env_unset, db_session):
    with pytest.raises(svc.ServiceConfigError):
        svc.upsert(db_session, "nope", base_url="https://x.example.com")


def test_undecryptable_secret_degrades_instead_of_crashing(env_unset, db_session, monkeypatch):
    """A rotated/lost master key must not take the health dashboard down."""
    svc.upsert(db_session, "n8n", base_url="https://a.example.com", secret=SECRET)

    def boom(_blob):
        raise svc.crypto.DecryptionError("wrong key")

    monkeypatch.setattr(svc.crypto, "decrypt_secret", boom)
    resolved = svc.resolve(db_session, "n8n")
    assert resolved.secret == ""
    assert resolved.configured is False


# --------------------------------------------------------------------- API ---


_PASSWORD = "Correct9Horse"


def _login(client, *, username="admin", email="admin@example.com") -> str:
    r = client.post(
        "/api/auth/register",
        json={"email": email, "username": username, "password": _PASSWORD},
    )
    assert r.status_code in (200, 201), r.text
    r = client.post("/api/auth/login", json={"identifier": username, "password": _PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_api_requires_authentication(client):
    assert client.get("/api/services/config").status_code == 401


def test_api_lists_every_configurable_service(client):
    token = _login(client)
    r = client.get("/api/services/config", headers={"Authorization": f"Bearer {token}"})

    assert r.status_code == 200
    names = {row["service"] for row in r.json()["data"]}
    assert names == set(svc.CONFIGURABLE)


def test_api_saves_and_hides_the_secret(client, db_session):
    token = _login(client)
    headers = {"Authorization": f"Bearer {token}"}

    r = client.put(
        "/api/services/config/n8n",
        headers=headers,
        json={"base_url": "https://panel.example.com", "secret": SECRET},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["configured"] is True
    assert body["source"] == "database"
    assert body["secret_configured"] is True
    assert SECRET not in r.text

    # and it is still hidden when read back
    r2 = client.get("/api/services/config/n8n", headers=headers)
    assert SECRET not in r2.text


def test_api_audit_entry_holds_no_secret(client, db_session):
    token = _login(client)
    client.put(
        "/api/services/config/n8n",
        headers={"Authorization": f"Bearer {token}"},
        json={"base_url": "https://panel.example.com", "secret": SECRET},
    )
    events = db_session.query(SystemEvent).filter_by(type="service_config.update").all()
    assert events, "the change must be audited"
    assert all(SECRET not in repr(e.meta) + e.message for e in events)


def test_api_rejects_an_unknown_service(client):
    token = _login(client)
    r = client.put(
        "/api/services/config/nope",
        headers={"Authorization": f"Bearer {token}"},
        json={"base_url": "https://x.example.com"},
    )
    assert r.status_code == 404


def test_api_write_is_admin_only(client):
    """The first registered user is admin; a second one is not."""
    _login(client)
    token = _login(client, username="regular", email="regular@example.com")

    r = client.put(
        "/api/services/config/n8n",
        headers={"Authorization": f"Bearer {token}"},
        json={"base_url": "https://panel.example.com"},
    )
    assert r.status_code == 403
