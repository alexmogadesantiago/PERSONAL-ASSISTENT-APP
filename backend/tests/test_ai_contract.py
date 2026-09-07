"""The AI surface as a contract, not as behaviour.

``test_ai_api`` checks what each endpoint *does*. This module checks that each
endpoint *is there*, under the exact URL the web panel calls, with the exact
provider vocabulary the frontend's TypeScript union declares.

It exists because of a real incident: the panel showed "Something went wrong -
Not Found" against a deployment whose image predated the AI layer. Every
``/api/ai/*`` call answered 404 while ``/api/services/config`` answered 401.
That difference is the whole diagnosis - a mounted endpoint refuses an
anonymous caller, a missing one is simply not there - so it is pinned here. A
router dropped from ``app.api.__init__``, a renamed prefix, or a provider id
that drifts away from the frontend union now fails the suite instead of
reaching a deployment.
"""
from __future__ import annotations

import pytest

from app.services.ai import registry

#: Every AI request the browser makes, taken from `frontend/src/api/index.ts`
#: (`aiApi`). `generate` is the automations' door rather than the panel's, and
#: is included because n8n depends on the same contract.
PANEL_ENDPOINTS: tuple[tuple[str, str], ...] = (
    ("GET", "/api/ai/providers"),
    ("GET", "/api/ai/config"),
    ("PUT", "/api/ai/config"),
    ("GET", "/api/ai/models"),
    ("POST", "/api/ai/test"),
    ("GET", "/api/ai/health"),
    ("GET", "/api/ai/service-token"),
    ("POST", "/api/ai/service-token"),
    ("DELETE", "/api/ai/service-token"),
    ("POST", "/api/ai/generate"),
)


def register(client) -> str:
    r = client.post(
        "/api/auth/register",
        json={
            "email": "contract@example.com",
            "username": "contract",
            "password": "Correct-Horse-9",
        },
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# -------------------------------------------------------------- mounted ---


def test_the_ai_router_is_mounted_under_api_ai(client):
    spec = client.get("/openapi.json").json()
    served = {p for p in spec["paths"] if p.startswith("/api/ai")}
    assert served == {path for _, path in PANEL_ENDPOINTS}


@pytest.mark.parametrize("method,path", PANEL_ENDPOINTS)
def test_every_endpoint_the_panel_calls_is_published(client, method, path):
    spec = client.get("/openapi.json").json()
    assert path in spec["paths"], f"{path} is not served by this build"
    assert method.lower() in spec["paths"][path], f"{method} {path} is not served"


@pytest.mark.parametrize("method,path", PANEL_ENDPOINTS)
def test_an_anonymous_call_is_refused_not_missing(client, method, path):
    """401, never 404.

    This is the assertion that distinguishes "the endpoint exists and you are
    not signed in" from "this build has no AI layer at all" - exactly what the
    panel could not tell the user when it reported "Not Found".
    """
    r = client.request(method, path, json={})
    assert r.status_code == 401, f"{method} {path} -> {r.status_code} {r.text[:120]}"


def test_an_unknown_ai_path_is_still_a_404(client):
    # The check above is only meaningful because a genuinely absent route
    # answers differently.
    assert client.get("/api/ai/does-not-exist").status_code == 404


# ----------------------------------------------------------- vocabulary ---


def test_provider_ids_match_the_frontend_union(client):
    """`AiProviderId` in `frontend/src/api/types.ts` is this tuple, in order."""
    token = register(client)
    rows = client.get("/api/ai/providers", headers=auth(token)).json()["data"]
    assert [row["id"] for row in rows] == ["nvidia_nim", "openrouter", "gemini"]
    assert list(registry.PROVIDER_IDS) == ["nvidia_nim", "openrouter", "gemini"]


def test_the_catalogue_keeps_the_verified_provider_defaults(client):
    """Defaults the panel pre-fills.

    NIM's default is the model that was actually validated against the live
    API - several entries its /models endpoint lists answer 404 there.
    """
    token = register(client)
    rows = {
        r["id"]: r for r in client.get("/api/ai/providers", headers=auth(token)).json()["data"]
    }

    assert rows["nvidia_nim"]["default_base_url"] == "https://integrate.api.nvidia.com/v1"
    assert rows["nvidia_nim"]["default_model"] == "nvidia/nemotron-3-super-120b-a12b"
    assert rows["nvidia_nim"]["recommended"] is True
    assert rows["openrouter"]["default_base_url"] == "https://openrouter.ai/api/v1"
    assert rows["gemini"]["default_base_url"] == "https://generativelanguage.googleapis.com"
    # Gemini stays a supported provider, not a deprecated leftover.
    assert rows["gemini"]["service_key"] == "gemini"


# --------------------------------------------------------------- shapes ---

#: Read by `AiProviderInfo` in the frontend.
PROVIDER_FIELDS = {
    "id",
    "label",
    "tagline",
    "recommended",
    "api_style",
    "default_base_url",
    "default_model",
    "key_help",
    "console_url",
    "service_key",
    "configured",
    "secret_configured",
    "secret_hint",
    "base_url",
    "model",
    "source",
}
#: Read by `AiConfig`.
CONFIG_FIELDS = {
    "provider",
    "model",
    "fallback_enabled",
    "fallback_provider",
    "fallback_model",
    "effective_fallback_provider",
    "temperature",
    "max_tokens",
    "timeout_seconds",
    "source",
    "configured",
    "missing",
    "providers",
    "service_token",
}
#: Read by `AiHealth`, including the Monitoring card.
HEALTH_FIELDS = {
    "status",
    "detail",
    "provider",
    "model",
    "latency_ms",
    "fallback_provider",
    "fallback_status",
    "error",
    "cached",
    "checked_at",
    "last_fallback",
}


def test_the_provider_catalogue_carries_every_field_the_panel_reads(client):
    token = register(client)
    rows = client.get("/api/ai/providers", headers=auth(token)).json()["data"]
    for row in rows:
        assert PROVIDER_FIELDS <= set(row), PROVIDER_FIELDS - set(row)
        # a credential is never a field here, configured or not
        assert "api_key" not in row and "secret" not in row


def test_the_configuration_carries_every_field_the_panel_reads(client):
    token = register(client)
    body = client.get("/api/ai/config", headers=auth(token)).json()
    assert CONFIG_FIELDS <= set(body), CONFIG_FIELDS - set(body)
    assert set(body["service_token"]) >= {"configured", "source", "hint"}
    for row in body["providers"]:
        assert {"provider", "configured", "secret_configured", "secret_hint"} <= set(row)


def test_health_carries_every_field_monitoring_reads(client):
    token = register(client)
    body = client.get("/api/ai/health", headers=auth(token)).json()
    assert HEALTH_FIELDS <= set(body), HEALTH_FIELDS - set(body)
    # nothing configured is a state, not an error
    assert body["status"] == "not_configured"
    assert body["last_fallback"] is None


def test_the_primary_and_the_fallback_are_two_independent_settings(client):
    """The panel saves them in one PUT; the response must report them apart."""
    token = register(client)
    r = client.put(
        "/api/ai/config",
        headers=auth(token),
        json={
            "provider": "nvidia_nim",
            "model": "nvidia/nemotron-3-super-120b-a12b",
            "fallback_enabled": True,
            "fallback_provider": "openrouter",
            "fallback_model": "meta-llama/llama-3.3-70b-instruct",
            "credentials": [
                {"provider": "nvidia_nim", "api_key": "nim-key-for-the-test"},
                {"provider": "openrouter", "api_key": "or-key-for-the-test"},
            ],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["provider"] == "nvidia_nim"
    assert body["model"] == "nvidia/nemotron-3-super-120b-a12b"
    assert body["fallback_provider"] == "openrouter"
    assert body["fallback_model"] == "meta-llama/llama-3.3-70b-instruct"
    assert body["effective_fallback_provider"] == "openrouter"

    # both keys are stored, and neither comes back
    stored = {p["provider"]: p for p in body["providers"]}
    assert stored["nvidia_nim"]["secret_configured"] is True
    assert stored["openrouter"]["secret_configured"] is True
    assert "nim-key-for-the-test" not in r.text
    assert "or-key-for-the-test" not in r.text
    # only the last four characters are ever shown
    assert stored["nvidia_nim"]["secret_hint"].endswith("test")
    assert len(stored["nvidia_nim"]["secret_hint"]) <= 7


def test_an_unknown_provider_never_reaches_the_stored_configuration(client):
    token = register(client)
    before = client.get("/api/ai/config", headers=auth(token)).json()

    r = client.put("/api/ai/config", headers=auth(token), json={"provider": "skynet"})
    assert r.status_code in (400, 404), r.text

    after = client.get("/api/ai/config", headers=auth(token)).json()
    assert after["provider"] == before["provider"]
