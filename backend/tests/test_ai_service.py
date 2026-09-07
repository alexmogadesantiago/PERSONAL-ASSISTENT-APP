"""Configuration resolution, provider selection and the fallback policy.

The behaviours that matter:

* configuration resolves database -> environment -> default, exactly like every
  other integration in this platform;
* an installation that only ever had ``GEMINI_API_KEY`` keeps working with no
  change: nobody chose a provider, so the first one holding a credential wins;
* the fallback fires for timeout / 429 / 5xx / connection failures and for
  nothing else - a rejected key must surface, not be replayed elsewhere;
* API keys are encrypted at rest and never appear in a resolved public view.
"""
from __future__ import annotations

import json

import pytest

from app.models import ServiceConfig
from app.services import service_config as svc
from app.services.ai import config as ai_config
from app.services.ai import registry
from app.services.ai import token as ai_token
from app.services.ai.errors import AIAuthError, AIBadRequest, AINotConfigured, AIUnavailable
from app.services.ai.service import AIService, reset_caches
from tests import ai_stubs

pytestmark = pytest.mark.anyio

PAYLOAD = {"ok": True}


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def _clear_caches():
    reset_caches()
    yield
    reset_caches()


@pytest.fixture
def env_unset(settings_factory):
    return settings_factory()


def prompt() -> list[dict]:
    return [{"role": "user", "content": "hola"}]


# --------------------------------------------------------- configuration ----


def test_nothing_configured_anywhere(env_unset, db_session):
    config = ai_config.resolve(db_session)
    assert config.provider == ""
    assert config.configured is False
    assert config.missing == ["an AI provider (none is configured)"]


def test_environment_only_nvidia(env_unset, db_session):
    env_unset.nvidia_nim_api_key = "nvapi-env"
    config = ai_config.resolve(db_session)
    assert config.provider == registry.NVIDIA_NIM
    assert config.configured is True
    assert config.source == ai_config.DEFAULT  # nobody *chose*, it was inferred
    assert config.providers[registry.NVIDIA_NIM].source == svc.ENVIRONMENT


def test_an_existing_gemini_only_install_still_resolves(env_unset, db_session):
    """The migration guarantee: no panel visit, no env edit, still works."""
    env_unset.gemini_api_key = "AIza-existing"
    config = ai_config.resolve(db_session)
    assert config.provider == registry.GEMINI
    assert config.configured is True


def test_nvidia_wins_over_gemini_when_both_have_keys(env_unset, db_session):
    env_unset.gemini_api_key = "AIza-existing"
    env_unset.nvidia_nim_api_key = "nvapi-new"
    assert ai_config.resolve(db_session).provider == registry.NVIDIA_NIM


def test_the_database_selection_beats_the_environment(env_unset, db_session):
    env_unset.nvidia_nim_api_key = "nvapi-env"
    env_unset.openrouter_api_key = "sk-or-env"
    env_unset.ai_provider = registry.NVIDIA_NIM

    ai_config.save(db_session, {"provider": registry.OPENROUTER, "model": "openai/gpt-4o-mini"})

    config = ai_config.resolve(db_session)
    assert config.provider == registry.OPENROUTER
    assert config.model == "openai/gpt-4o-mini"
    assert config.source == ai_config.DATABASE


def test_an_unknown_provider_is_refused(env_unset, db_session):
    with pytest.raises(ai_config.AIConfigError):
        ai_config.save(db_session, {"provider": "skynet"})


def test_the_model_falls_back_provider_default(env_unset, db_session):
    env_unset.nvidia_nim_api_key = "nvapi-env"
    config = ai_config.resolve(db_session)
    assert config.model == registry.meta(registry.NVIDIA_NIM).default_model


def test_a_per_provider_model_is_honoured(env_unset, db_session):
    svc.upsert(db_session, "nvidia_nim", secret="nvapi-k", meta={"model": "meta/llama-3.1-8b-instruct"})
    config = ai_config.resolve(db_session)
    assert config.providers[registry.NVIDIA_NIM].model == "meta/llama-3.1-8b-instruct"


def test_the_fallback_is_inferred_when_a_second_provider_has_a_key(env_unset, db_session):
    env_unset.nvidia_nim_api_key = "nvapi-env"
    env_unset.openrouter_api_key = "sk-or-env"
    config = ai_config.resolve(db_session)
    assert config.effective_fallback == registry.OPENROUTER


def test_no_fallback_when_only_one_provider_has_a_key(env_unset, db_session):
    env_unset.nvidia_nim_api_key = "nvapi-env"
    assert ai_config.resolve(db_session).effective_fallback == ""


def test_the_fallback_can_be_turned_off(env_unset, db_session):
    env_unset.nvidia_nim_api_key = "nvapi-env"
    env_unset.openrouter_api_key = "sk-or-env"
    ai_config.save(db_session, {"fallback_enabled": False})
    assert ai_config.resolve(db_session).effective_fallback == ""


def test_a_disabled_provider_is_never_used(env_unset, db_session):
    env_unset.nvidia_nim_api_key = "nvapi-env"
    svc.upsert(db_session, "nvidia_nim", enabled=False)
    assert ai_config.resolve(db_session).providers[registry.NVIDIA_NIM].configured is False


# -------------------------------------------------------------- secrecy -----


def test_the_key_is_encrypted_at_rest_and_never_in_the_public_view(env_unset, db_session):
    secret = "nvapi-super-secret-value"
    svc.upsert(db_session, "nvidia_nim", secret=secret)

    row = db_session.get(ServiceConfig, "nvidia_nim")
    assert row.encrypted_secret is not None
    assert secret.encode() not in row.encrypted_secret

    view = ai_config.resolve(db_session).public_view()
    blob = json.dumps(view)
    assert secret not in blob
    nvidia = next(p for p in view["providers"] if p["provider"] == registry.NVIDIA_NIM)
    assert nvidia["secret_configured"] is True
    assert nvidia["secret_hint"] == "...alue"


# ------------------------------------------------------------ generation ----


async def test_generation_uses_the_selected_provider(env_unset, db_session, monkeypatch):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    recorder = ai_stubs.install(
        monkeypatch,
        ai_stubs.routes({"/chat/completions": ai_stubs.openai_completion(json.dumps(PAYLOAD))}),
    )

    result = await AIService.from_db(db_session).generate(
        prompt(), response_format={"type": "json_object"}
    )

    assert result.response.provider == registry.NVIDIA_NIM
    assert result.used_fallback is False
    assert ai_stubs.NIM in recorder.urls()[0]


async def test_generation_without_a_provider_is_not_configured(env_unset, db_session):
    with pytest.raises(AINotConfigured):
        await AIService.from_db(db_session).generate(prompt())


# -------------------------------------------------------------- fallback ----


@pytest.mark.parametrize("failure", [ai_stubs.timeout, ai_stubs.connect_error])
async def test_transport_failures_fall_back(env_unset, db_session, monkeypatch, failure):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    env_unset.openrouter_api_key = "sk-or-k"
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {
                ai_stubs.NIM: failure,
                ai_stubs.OPENROUTER: ai_stubs.openai_completion(json.dumps(PAYLOAD)),
            }
        ),
    )

    result = await AIService.from_db(db_session).generate(prompt())

    assert result.used_fallback is True
    assert result.primary_provider == registry.NVIDIA_NIM
    assert result.response.provider == registry.OPENROUTER


@pytest.mark.parametrize("status", [429, 500, 502, 503])
async def test_retryable_status_codes_fall_back(env_unset, db_session, monkeypatch, status):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    env_unset.openrouter_api_key = "sk-or-k"
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {
                ai_stubs.NIM: ai_stubs.error(status),
                ai_stubs.OPENROUTER: ai_stubs.openai_completion(json.dumps(PAYLOAD)),
            }
        ),
    )

    result = await AIService.from_db(db_session).generate(prompt())
    assert result.used_fallback is True


@pytest.mark.parametrize("status,expected", [(401, AIAuthError), (400, AIBadRequest)])
async def test_input_errors_never_fall_back(env_unset, db_session, monkeypatch, status, expected):
    """Replaying a rejected key or a malformed request elsewhere fixes nothing."""
    env_unset.nvidia_nim_api_key = "nvapi-k"
    env_unset.openrouter_api_key = "sk-or-k"
    recorder = ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {
                ai_stubs.NIM: ai_stubs.error(status),
                ai_stubs.OPENROUTER: ai_stubs.openai_completion(json.dumps(PAYLOAD)),
            }
        ),
    )

    with pytest.raises(expected):
        await AIService.from_db(db_session).generate(prompt())
    assert recorder.calls_to(ai_stubs.OPENROUTER) == [], "the fallback must not have been called"


async def test_both_providers_failing_reports_both(env_unset, db_session, monkeypatch):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    env_unset.openrouter_api_key = "sk-or-k"
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes({ai_stubs.NIM: ai_stubs.error(503), ai_stubs.OPENROUTER: ai_stubs.error(503)}),
    )

    with pytest.raises(AIUnavailable) as excinfo:
        await AIService.from_db(db_session).generate(prompt())
    assert "nvidia_nim" in str(excinfo.value)


async def test_no_fallback_configured_raises_the_primary_error(env_unset, db_session, monkeypatch):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    ai_stubs.install(monkeypatch, ai_stubs.routes({ai_stubs.NIM: ai_stubs.error(503)}))

    with pytest.raises(AIUnavailable):
        await AIService.from_db(db_session).generate(prompt())


# ---------------------------------------------------------------- health ----


async def test_health_is_a_real_call_not_a_key_presence_check(
    env_unset, db_session, monkeypatch
):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    recorder = ai_stubs.install(
        monkeypatch, ai_stubs.routes({ai_stubs.NIM: ai_stubs.openai_models("m")})
    )

    health = await AIService.from_db(db_session).health()

    assert health.status == "online"
    assert recorder.calls_to("/models"), "a stored key alone must never mean ONLINE"


async def test_health_is_degraded_when_the_fallback_is_carrying(
    env_unset, db_session, monkeypatch
):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    env_unset.openrouter_api_key = "sk-or-k"
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {ai_stubs.NIM: ai_stubs.error(503), ai_stubs.OPENROUTER: ai_stubs.openai_models("m")}
        ),
    )

    health = await AIService.from_db(db_session).health()
    assert health.status == "degraded"
    assert health.fallback_provider == registry.OPENROUTER
    assert health.fallback_status == "online"


async def test_health_is_invalid_when_the_key_is_refused(env_unset, db_session, monkeypatch):
    env_unset.nvidia_nim_api_key = "bad"
    ai_stubs.install(monkeypatch, ai_stubs.routes({ai_stubs.NIM: ai_stubs.error(403)}))
    assert (await AIService.from_db(db_session).health()).status == "invalid"


async def test_health_is_cached(env_unset, db_session, monkeypatch):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    recorder = ai_stubs.install(
        monkeypatch, ai_stubs.routes({ai_stubs.NIM: ai_stubs.openai_models("m")})
    )
    service = AIService.from_db(db_session)

    await service.health()
    second = await service.health()
    assert second.cached is True
    assert len(recorder.calls_to("/models")) == 1

    await service.health(force=True)
    assert len(recorder.calls_to("/models")) == 2


# ---------------------------------------------------------------- models ----


async def test_model_list_falls_back_to_the_catalogue_and_says_so(
    env_unset, db_session, monkeypatch
):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    ai_stubs.install(monkeypatch, ai_stubs.routes({ai_stubs.NIM: ai_stubs.error(503)}))

    models = await AIService.from_db(db_session).list_models(registry.NVIDIA_NIM)
    assert models
    assert all(m.source == "catalog" for m in models)


async def test_a_live_model_list_is_preferred(env_unset, db_session, monkeypatch):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    ai_stubs.install(
        monkeypatch, ai_stubs.routes({ai_stubs.NIM: ai_stubs.openai_models("meta/x")})
    )
    models = await AIService.from_db(db_session).list_models(registry.NVIDIA_NIM)
    assert [m.id for m in models] == ["meta/x"]
    assert models[0].source == "live"


# --------------------------------------------------------- service token ----


def test_the_service_token_round_trips_encrypted(env_unset, db_session):
    token = ai_token.rotate(db_session)
    assert token.startswith("acs_")
    assert ai_token.verify(db_session, token) is True
    assert ai_token.verify(db_session, "acs_wrong") is False
    assert ai_token.status(db_session)["configured"] is True
    assert token not in json.dumps(ai_token.status(db_session))


def test_the_service_token_falls_back_to_the_environment(settings_factory, db_session):
    settings_factory(ai_service_token="acs_from_env")
    assert ai_token.verify(db_session, "acs_from_env") is True


def test_revoking_the_service_token_denies_it(env_unset, db_session):
    token = ai_token.rotate(db_session)
    ai_token.revoke(db_session)
    assert ai_token.verify(db_session, token) is False
