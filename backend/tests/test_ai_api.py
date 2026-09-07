"""The /api/ai surface: what the panel and the automations actually call.

The invariants under test:

* no response ever carries an API key - the one exception is the service token
  the admin has just generated, which must be shown once to be pasted into n8n;
* writes and tests are admin-only;
* ``/api/ai/generate`` accepts either the automation service token or a user
  session, and rejects everything else;
* a provider swap does not change the JSON the automations receive.
"""
from __future__ import annotations

import json

import pytest

from app.services.ai import registry
from tests import ai_stubs

PAYLOAD = {"categoria": "cita", "prioridad": "alta"}
SCHEMA = {
    "type": "object",
    "properties": {"categoria": {"type": "string"}, "prioridad": {"type": "string"}},
    "required": ["categoria", "prioridad"],
}


@pytest.fixture(autouse=True)
def _clear_caches():
    from app.services.ai.service import reset_caches

    reset_caches()
    yield
    reset_caches()


def register(client, *, username="admin", email="admin@example.com") -> str:
    r = client.post(
        "/api/auth/register",
        json={"email": email, "username": username, "password": "Correct-Horse-9"},
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------- catalog ---


def test_providers_lists_nvidia_first_and_recommended(client):
    token = register(client)
    r = client.get("/api/ai/providers", headers=auth(token))

    assert r.status_code == 200
    rows = r.json()["data"]
    assert [row["id"] for row in rows] == list(registry.PROVIDER_IDS)
    assert rows[0]["id"] == "nvidia_nim"
    assert rows[0]["recommended"] is True
    assert [row["recommended"] for row in rows[1:]] == [False, False]


def test_provider_catalogue_never_carries_a_key(client):
    token = register(client)
    secret = "nvapi-do-not-leak-me"
    client.put(
        "/api/ai/config",
        headers=auth(token),
        json={"credentials": [{"provider": "nvidia_nim", "api_key": secret}]},
    )

    body = client.get("/api/ai/providers", headers=auth(token)).text
    assert secret not in body
    assert "-me" in json.loads(body)["data"][0]["secret_hint"]


# ---------------------------------------------------------- configuration ---


def test_config_starts_unconfigured(client):
    token = register(client)
    body = client.get("/api/ai/config", headers=auth(token)).json()
    assert body["configured"] is False
    assert body["provider"] == ""
    assert body["service_token"]["configured"] is False


def test_saving_the_selection_and_the_key_together(client):
    token = register(client)
    r = client.put(
        "/api/ai/config",
        headers=auth(token),
        json={
            "provider": "nvidia_nim",
            "model": "meta/llama-3.3-70b-instruct",
            "fallback_enabled": True,
            "fallback_provider": "openrouter",
            "credentials": [
                {"provider": "nvidia_nim", "api_key": "nvapi-k"},
                {"provider": "openrouter", "api_key": "sk-or-k"},
            ],
        },
    )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider"] == "nvidia_nim"
    assert body["model"] == "meta/llama-3.3-70b-instruct"
    assert body["configured"] is True
    assert body["effective_fallback_provider"] == "openrouter"
    assert body["source"] == "database"
    assert "nvapi-k" not in r.text


def test_an_empty_key_field_keeps_the_stored_one(client):
    token = register(client)
    client.put(
        "/api/ai/config",
        headers=auth(token),
        json={"credentials": [{"provider": "nvidia_nim", "api_key": "nvapi-k"}]},
    )
    # a later save that only changes the model must not wipe the credential
    body = client.put(
        "/api/ai/config",
        headers=auth(token),
        json={"provider": "nvidia_nim", "model": "meta/llama-3.1-8b-instruct"},
    ).json()
    assert body["configured"] is True


def test_clearing_a_key_removes_it(client):
    token = register(client)
    client.put(
        "/api/ai/config",
        headers=auth(token),
        json={"credentials": [{"provider": "nvidia_nim", "api_key": "nvapi-k"}]},
    )
    body = client.put(
        "/api/ai/config",
        headers=auth(token),
        json={"credentials": [{"provider": "nvidia_nim", "clear_api_key": True}]},
    ).json()
    nvidia = next(p for p in body["providers"] if p["provider"] == "nvidia_nim")
    assert nvidia["secret_configured"] is False


def test_an_unknown_provider_is_a_404(client):
    token = register(client)
    r = client.put("/api/ai/config", headers=auth(token), json={"provider": "skynet"})
    assert r.status_code == 400
    r = client.put(
        "/api/ai/config",
        headers=auth(token),
        json={"credentials": [{"provider": "skynet", "api_key": "x"}]},
    )
    assert r.status_code == 404


def test_writes_are_admin_only(client):
    register(client)  # the first account is the admin
    member = register(client, username="member", email="member@example.com")

    assert client.get("/api/ai/config", headers=auth(member)).status_code == 200
    assert client.put("/api/ai/config", headers=auth(member), json={}).status_code == 403
    assert client.post("/api/ai/test", headers=auth(member), json={}).status_code == 403
    assert client.post("/api/ai/service-token", headers=auth(member)).status_code == 403


def test_config_needs_a_session(client):
    assert client.get("/api/ai/config").status_code == 401


# ----------------------------------------------------------------- models ---


def test_models_are_listed_live_when_the_provider_answers(client, monkeypatch):
    token = register(client)
    client.put(
        "/api/ai/config",
        headers=auth(token),
        json={"provider": "nvidia_nim", "credentials": [{"provider": "nvidia_nim", "api_key": "k"}]},
    )
    ai_stubs.install(
        monkeypatch, ai_stubs.routes({ai_stubs.NIM: ai_stubs.openai_models("meta/a", "meta/b")})
    )

    body = client.get("/api/ai/models", headers=auth(token)).json()
    assert body["provider"] == "nvidia_nim"
    assert body["live"] is True
    assert [m["id"] for m in body["data"]] == ["meta/a", "meta/b"]


def test_models_fall_back_to_the_catalogue_and_admit_it(client, monkeypatch):
    token = register(client)
    ai_stubs.install(monkeypatch, ai_stubs.routes({}))

    body = client.get("/api/ai/models?provider=openrouter", headers=auth(token)).json()
    assert body["live"] is False
    assert body["detail"]
    assert all(m["source"] == "catalog" for m in body["data"])


# ------------------------------------------------------------------- test ---


def test_test_connection_runs_a_real_generation(client, monkeypatch):
    token = register(client)
    client.put(
        "/api/ai/config",
        headers=auth(token),
        json={"provider": "nvidia_nim", "credentials": [{"provider": "nvidia_nim", "api_key": "k"}]},
    )
    recorder = ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {"/chat/completions": ai_stubs.openai_completion(json.dumps({"ok": True}))}
        ),
    )

    body = client.post("/api/ai/test", headers=auth(token), json={}).json()
    assert body["ok"] is True
    assert body["provider"] == "nvidia_nim"
    assert body["status"] == "online"
    assert recorder.calls_to("/chat/completions"), "the test must actually call the provider"


def test_test_connection_reports_a_rejected_key(client, monkeypatch):
    token = register(client)
    client.put(
        "/api/ai/config",
        headers=auth(token),
        json={"provider": "nvidia_nim", "credentials": [{"provider": "nvidia_nim", "api_key": "bad"}]},
    )
    ai_stubs.install(monkeypatch, ai_stubs.routes({ai_stubs.NIM: ai_stubs.error(401)}))

    body = client.post("/api/ai/test", headers=auth(token), json={}).json()
    assert body["ok"] is False
    assert body["status"] == "invalid"


def test_test_connection_with_nothing_configured(client):
    token = register(client)
    body = client.post("/api/ai/test", headers=auth(token), json={}).json()
    assert body["ok"] is False
    assert body["status"] == "not_configured"


# ----------------------------------------------------------------- health ---


def test_health_reports_the_provider_and_model(client, monkeypatch):
    token = register(client)
    client.put(
        "/api/ai/config",
        headers=auth(token),
        json={"provider": "nvidia_nim", "credentials": [{"provider": "nvidia_nim", "api_key": "k"}]},
    )
    ai_stubs.install(monkeypatch, ai_stubs.routes({ai_stubs.NIM: ai_stubs.openai_models("m")}))

    body = client.get("/api/ai/health", headers=auth(token)).json()
    assert body["status"] == "online"
    assert body["provider"] == "nvidia_nim"
    assert body["model"]
    assert body["checked_at"]


# ---------------------------------------------------------- service token ---


def test_the_service_token_is_shown_once_then_only_hinted(client):
    token = register(client)
    created = client.post("/api/ai/service-token", headers=auth(token)).json()
    assert created["token"].startswith("acs_")

    status = client.get("/api/ai/service-token", headers=auth(token)).json()
    assert status["configured"] is True
    assert created["token"] not in json.dumps(status)


# --------------------------------------------------------------- generate ---


def configure(client, token, provider="nvidia_nim", key="k") -> str:
    client.put(
        "/api/ai/config",
        headers=auth(token),
        json={"provider": provider, "credentials": [{"provider": provider, "api_key": key}]},
    )
    return client.post("/api/ai/service-token", headers=auth(token)).json()["token"]


def test_generate_accepts_the_service_token(client, monkeypatch):
    token = register(client)
    service_token = configure(client, token)
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes({"/chat/completions": ai_stubs.openai_completion(json.dumps(PAYLOAD))}),
    )

    r = client.post(
        "/api/ai/generate",
        headers={"X-AC-Service-Token": service_token},
        json={"prompt": "clasifica", "json_schema": SCHEMA},
    )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["data"] == PAYLOAD
    assert body["provider"] == "nvidia_nim"
    assert body["used_fallback"] is False


def test_generate_accepts_a_user_session(client, monkeypatch):
    token = register(client)
    configure(client, token)
    ai_stubs.install(
        monkeypatch, ai_stubs.routes({"/chat/completions": ai_stubs.openai_completion("hola")})
    )

    r = client.post("/api/ai/generate", headers=auth(token), json={"prompt": "saluda"})
    assert r.status_code == 200
    assert r.json()["text"] == "hola"


def test_generate_rejects_an_unauthenticated_caller(client):
    r = client.post("/api/ai/generate", json={"prompt": "hola"})
    assert r.status_code == 401


def test_generate_rejects_a_wrong_service_token(client):
    token = register(client)
    configure(client, token)
    r = client.post(
        "/api/ai/generate",
        headers={"X-AC-Service-Token": "acs_not-the-right-one"},
        json={"prompt": "hola"},
    )
    assert r.status_code == 401


def test_generate_without_a_provider_is_503(client):
    token = register(client)
    r = client.post("/api/ai/generate", headers=auth(token), json={"prompt": "hola"})
    assert r.status_code == 503


def test_generate_falls_back_and_says_so(client, monkeypatch):
    token = register(client)
    client.put(
        "/api/ai/config",
        headers=auth(token),
        json={
            "provider": "nvidia_nim",
            "fallback_provider": "openrouter",
            "credentials": [
                {"provider": "nvidia_nim", "api_key": "k"},
                {"provider": "openrouter", "api_key": "k2"},
            ],
        },
    )
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {
                ai_stubs.NIM: ai_stubs.error(503),
                ai_stubs.OPENROUTER: ai_stubs.openai_completion(json.dumps(PAYLOAD)),
            }
        ),
    )

    body = client.post(
        "/api/ai/generate", headers=auth(token), json={"prompt": "x", "json_schema": SCHEMA}
    ).json()

    assert body["used_fallback"] is True
    assert body["provider"] == "openrouter"
    assert body["primary_provider"] == "nvidia_nim"
    assert body["data"] == PAYLOAD


def test_the_same_request_survives_a_provider_swap(client, monkeypatch):
    """What an automation sends and reads must not depend on the provider."""
    token = register(client)
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {
                "/chat/completions": ai_stubs.openai_completion(json.dumps(PAYLOAD)),
                ":generateContent": ai_stubs.gemini_completion(json.dumps(PAYLOAD)),
            }
        ),
    )
    request = {"prompt": "clasifica", "json_schema": SCHEMA}

    seen = []
    for provider in ("nvidia_nim", "openrouter", "gemini"):
        client.put(
            "/api/ai/config",
            headers=auth(token),
            json={
                "provider": provider,
                "fallback_enabled": False,
                "credentials": [{"provider": provider, "api_key": "k"}],
            },
        )
        body = client.post("/api/ai/generate", headers=auth(token), json=request).json()
        seen.append((body["provider"], body["data"]))

    assert seen == [
        ("nvidia_nim", PAYLOAD),
        ("openrouter", PAYLOAD),
        ("gemini", PAYLOAD),
    ]


def test_a_provider_401_is_not_reported_as_the_callers_fault(client, monkeypatch):
    token = register(client)
    configure(client, token)
    ai_stubs.install(monkeypatch, ai_stubs.routes({ai_stubs.NIM: ai_stubs.error(401)}))

    r = client.post("/api/ai/generate", headers=auth(token), json={"prompt": "x"})
    # our credential is wrong -> a server-side misconfiguration, not a 401 back
    assert r.status_code == 502


def test_generate_needs_a_prompt(client):
    token = register(client)
    configure(client, token)
    r = client.post("/api/ai/generate", headers=auth(token), json={})
    assert r.status_code == 400


def test_the_monitoring_tile_reflects_the_ai_configuration(client, monkeypatch):
    token = register(client)
    configure(client, token)
    ai_stubs.install(monkeypatch, ai_stubs.routes({ai_stubs.NIM: ai_stubs.openai_models("m")}))

    body = client.post("/api/system/check", headers=auth(token)).json()
    tile = next(s for s in body["services"] if s["name"] == "ai")
    assert tile["status"] == "online"
    assert tile["meta"]["provider"] == "nvidia_nim"
    assert tile["meta"]["provider_label"] == "NVIDIA NIM"
    assert "k" != tile["target"]  # target is a label, never a credential
