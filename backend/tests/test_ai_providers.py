"""Provider-level behaviour: the wire format, the error taxonomy, the contract.

Only the socket is stubbed (``httpx.MockTransport``), so what is under test is
the code that actually builds the request and reads the answer.

The two properties that matter most here:

* a status code always maps to the *same* error class, because that class is
  what decides whether the fallback provider is allowed to see the request;
* the JSON contract survives a provider swap - NIM, OpenRouter and Gemini all
  return the same parsed object for the same schema.
"""
from __future__ import annotations

import json

import httpx
import pytest

from app.services.ai.base import Message, ResponseFormat
from app.services.ai.errors import (
    AIAuthError,
    AIBadRequest,
    AIInvalidResponse,
    AIRateLimited,
    AITimeout,
    AIUnavailable,
)
from app.services.ai.gemini import GeminiProvider
from app.services.ai.openai_compatible import NvidiaNimProvider, OpenRouterProvider
from tests import ai_stubs

pytestmark = pytest.mark.anyio

SCHEMA = {
    "type": "object",
    "properties": {"categoria": {"type": "string"}, "prioridad": {"type": "string"}},
    "required": ["categoria", "prioridad"],
}
PAYLOAD = {"categoria": "cita", "prioridad": "alta"}


@pytest.fixture
def anyio_backend():
    return "asyncio"


def prompt() -> list[Message]:
    return [Message(role="user", content="clasifica esto")]


# ------------------------------------------------------------ happy path ----


async def test_nim_returns_a_normalised_response(monkeypatch):
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {"/chat/completions": ai_stubs.openai_completion(json.dumps(PAYLOAD), model="meta/x")}
        ),
    )
    provider = NvidiaNimProvider(api_key="nvapi-k")

    response = await provider.generate(prompt(), response_format={"type": "json_object"})

    assert response.provider == "nvidia_nim"
    assert response.model == "meta/x"
    assert response.data == PAYLOAD
    assert response.usage["total_tokens"] == 15
    assert response.latency_ms >= 0


async def test_openrouter_returns_a_normalised_response(monkeypatch):
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes({"/chat/completions": ai_stubs.openai_completion(json.dumps(PAYLOAD))}),
    )
    provider = OpenRouterProvider(api_key="sk-or-k")

    response = await provider.generate(prompt(), response_format={"type": "json_object"})

    assert response.provider == "openrouter"
    assert response.data == PAYLOAD


async def test_gemini_returns_a_normalised_response(monkeypatch):
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes({":generateContent": ai_stubs.gemini_completion(json.dumps(PAYLOAD))}),
    )
    provider = GeminiProvider(api_key="AIza-k")

    response = await provider.generate(prompt(), response_format={"type": "json_object"})

    assert response.provider == "gemini"
    assert response.data == PAYLOAD


async def test_every_provider_produces_the_same_parsed_object(monkeypatch):
    """The JSON contract is what the automations read - it must not move."""
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {
                "/chat/completions": ai_stubs.openai_completion(json.dumps(PAYLOAD)),
                ":generateContent": ai_stubs.gemini_completion(json.dumps(PAYLOAD)),
            }
        ),
    )
    fmt = {"type": "json_schema", "schema": SCHEMA}
    results = []
    for provider in (
        NvidiaNimProvider(api_key="k"),
        OpenRouterProvider(api_key="k"),
        GeminiProvider(api_key="k"),
    ):
        results.append((await provider.generate(prompt(), response_format=fmt)).data)

    assert results == [PAYLOAD, PAYLOAD, PAYLOAD]


# --------------------------------------------------------- request shape ----


async def test_the_api_key_travels_in_a_header_never_in_the_url(monkeypatch):
    recorder = ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {
                "/chat/completions": ai_stubs.openai_completion("hi"),
                ":generateContent": ai_stubs.gemini_completion("hi"),
            }
        ),
    )
    secret = "super-secret-key-value"
    for provider in (
        NvidiaNimProvider(api_key=secret),
        OpenRouterProvider(api_key=secret),
        GeminiProvider(api_key=secret),
    ):
        await provider.generate(prompt())

    for request in recorder.requests:
        assert secret not in str(request.url), "a key in a URL ends up in proxy logs"
    assert recorder.requests[0].headers["authorization"] == f"Bearer {secret}"
    assert recorder.requests[2].headers["x-goog-api-key"] == secret


async def test_nim_asks_for_a_json_object_and_describes_the_schema(monkeypatch):
    """NIM's guided decoding is opt-in; the default path must stay portable.

    Sending ``nvext.guided_json`` unconditionally was verified live to fail with
    HTTP 400 ``unknown field guided_json`` on engines that do not implement it -
    turning a working model into a hard error. So the default asks only for a
    JSON object and describes the schema in the prompt.
    """
    recorder = ai_stubs.install(
        monkeypatch,
        ai_stubs.routes({"/chat/completions": ai_stubs.openai_completion(json.dumps(PAYLOAD))}),
    )
    await NvidiaNimProvider(api_key="k").generate(
        prompt(), response_format={"type": "json_schema", "schema": SCHEMA}
    )

    body = recorder.bodies()[0]
    assert body["response_format"] == {"type": "json_object"}
    assert "nvext" not in body
    # NIM does not enforce the shape, so it has to be told in words
    assert any("JSON Schema" in m["content"] for m in body["messages"])


async def test_nim_guided_decoding_can_be_switched_on(monkeypatch):
    recorder = ai_stubs.install(
        monkeypatch,
        ai_stubs.routes({"/chat/completions": ai_stubs.openai_completion(json.dumps(PAYLOAD))}),
    )
    provider = NvidiaNimProvider(api_key="k")
    provider.enable_guided_json = True
    await provider.generate(prompt(), response_format={"type": "json_schema", "schema": SCHEMA})

    assert recorder.bodies()[0]["nvext"]["guided_json"] == SCHEMA


async def test_openrouter_uses_native_json_schema(monkeypatch):
    recorder = ai_stubs.install(
        monkeypatch,
        ai_stubs.routes({"/chat/completions": ai_stubs.openai_completion(json.dumps(PAYLOAD))}),
    )
    await OpenRouterProvider(api_key="k").generate(
        prompt(), response_format={"type": "json_schema", "schema": SCHEMA, "name": "triage"}
    )

    body = recorder.bodies()[0]
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["schema"] == SCHEMA
    assert body["response_format"]["json_schema"]["strict"] is True


async def test_gemini_translates_the_schema_into_its_own_dialect(monkeypatch):
    recorder = ai_stubs.install(
        monkeypatch,
        ai_stubs.routes({":generateContent": ai_stubs.gemini_completion(json.dumps(PAYLOAD))}),
    )
    await GeminiProvider(api_key="k").generate(
        prompt(), response_format={"type": "json_schema", "schema": SCHEMA}
    )

    config = recorder.bodies()[0]["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert config["responseSchema"]["type"] == "OBJECT"
    assert config["responseSchema"]["properties"]["categoria"]["type"] == "STRING"


async def test_gemini_lifts_the_system_turn_out_of_contents(monkeypatch):
    recorder = ai_stubs.install(
        monkeypatch, ai_stubs.routes({":generateContent": ai_stubs.gemini_completion("ok")})
    )
    await GeminiProvider(api_key="k").generate(
        [Message(role="system", content="eres util"), Message(role="user", content="hola")]
    )

    body = recorder.bodies()[0]
    assert body["systemInstruction"]["parts"][0]["text"] == "eres util"
    assert [c["role"] for c in body["contents"]] == ["user"]


async def test_the_base_url_is_configuration_not_a_constant(monkeypatch):
    """A self-hosted NIM answers the same API on its own host."""
    recorder = ai_stubs.install(
        monkeypatch, ai_stubs.routes({"/chat/completions": ai_stubs.openai_completion("ok")})
    )
    provider = NvidiaNimProvider(api_key="k", base_url="http://nim.internal:8000/v1")
    await provider.generate(prompt())

    assert recorder.urls()[0] == "http://nim.internal:8000/v1/chat/completions"


# ---------------------------------------------------------- error mapping ---


#: every provider is held to the same taxonomy - the fallback decision depends
#: on it, and a subclass could quietly override the mapping
PROVIDER_CLASSES = [NvidiaNimProvider, OpenRouterProvider, GeminiProvider]
ROUTE_FOR = {
    NvidiaNimProvider: "/chat/completions",
    OpenRouterProvider: "/chat/completions",
    GeminiProvider: ":generateContent",
}


@pytest.mark.parametrize("cls", PROVIDER_CLASSES, ids=lambda c: c.id)
@pytest.mark.parametrize(
    "status,expected,retryable",
    [
        (400, AIBadRequest, False),
        (401, AIAuthError, False),
        (403, AIAuthError, False),
        (404, AIBadRequest, False),
        (429, AIRateLimited, True),
        (500, AIUnavailable, True),
        (502, AIUnavailable, True),
        (503, AIUnavailable, True),
        (504, AIUnavailable, True),
    ],
)
async def test_status_codes_map_to_the_retryable_taxonomy(
    monkeypatch, cls, status, expected, retryable
):
    ai_stubs.install(monkeypatch, ai_stubs.routes({ROUTE_FOR[cls]: ai_stubs.error(status)}))
    with pytest.raises(expected) as excinfo:
        await cls(api_key="k").generate(prompt())
    assert excinfo.value.retryable is retryable
    assert excinfo.value.status_code == status
    assert excinfo.value.provider == cls.id


@pytest.mark.parametrize("cls", PROVIDER_CLASSES, ids=lambda c: c.id)
async def test_a_timeout_is_retryable(monkeypatch, cls):
    ai_stubs.install(monkeypatch, ai_stubs.routes({ROUTE_FOR[cls]: ai_stubs.timeout}))
    with pytest.raises(AITimeout) as excinfo:
        await cls(api_key="k").generate(prompt())
    assert excinfo.value.retryable is True


@pytest.mark.parametrize("cls", PROVIDER_CLASSES, ids=lambda c: c.id)
async def test_a_connection_failure_is_retryable(monkeypatch, cls):
    ai_stubs.install(monkeypatch, ai_stubs.routes({ROUTE_FOR[cls]: ai_stubs.connect_error}))
    with pytest.raises(AIUnavailable) as excinfo:
        await cls(api_key="k").generate(prompt())
    assert excinfo.value.retryable is True


@pytest.mark.parametrize("cls", PROVIDER_CLASSES, ids=lambda c: c.id)
async def test_a_rejected_key_is_never_retryable(monkeypatch, cls):
    """The single property the whole fallback policy rests on."""
    ai_stubs.install(monkeypatch, ai_stubs.routes({ROUTE_FOR[cls]: ai_stubs.error(401)}))
    with pytest.raises(AIAuthError) as excinfo:
        await cls(api_key="wrong").generate(prompt())
    assert excinfo.value.retryable is False
    assert "wrong" not in str(excinfo.value), "the rejected key must not be echoed back"


async def test_the_error_never_echoes_the_prompt_back(monkeypatch):
    """Provider errors quote the request; the prompt must not travel outwards."""
    secret_prompt = "el paciente se llama Alex y su NIF es 12345678Z"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={"error": {"message": "invalid request: " + request.content.decode()}},
        )

    ai_stubs.install(monkeypatch, handler)
    with pytest.raises(AIBadRequest) as excinfo:
        await NvidiaNimProvider(api_key="k").generate(
            [Message(role="user", content=secret_prompt)]
        )
    assert "12345678Z" not in str(excinfo.value)


# ------------------------------------------------------- response defects ---


async def test_non_json_output_is_an_invalid_response_not_a_silent_empty(monkeypatch):
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes({"/chat/completions": ai_stubs.openai_completion("lo siento, no puedo")}),
    )
    with pytest.raises(AIInvalidResponse):
        await NvidiaNimProvider(api_key="k").generate(
            prompt(), response_format={"type": "json_object"}
        )


async def test_a_markdown_fence_is_tolerated(monkeypatch):
    """Some models still wrap JSON in a fence; the contract must survive it."""
    fenced = "```json\n" + json.dumps(PAYLOAD) + "\n```"
    ai_stubs.install(
        monkeypatch, ai_stubs.routes({"/chat/completions": ai_stubs.openai_completion(fenced)})
    )
    response = await NvidiaNimProvider(api_key="k").generate(
        prompt(), response_format={"type": "json_object"}
    )
    assert response.data == PAYLOAD


async def test_a_missing_required_field_is_rejected(monkeypatch):
    """A provider swap that drops a field the workflow reads must be loud."""
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {"/chat/completions": ai_stubs.openai_completion(json.dumps({"categoria": "cita"}))}
        ),
    )
    with pytest.raises(AIInvalidResponse) as excinfo:
        await NvidiaNimProvider(api_key="k").generate(
            prompt(), response_format={"type": "json_schema", "schema": SCHEMA}
        )
    assert "prioridad" in str(excinfo.value)


async def test_an_empty_completion_is_an_error(monkeypatch):
    ai_stubs.install(
        monkeypatch, ai_stubs.routes({"/chat/completions": ai_stubs.openai_completion("")})
    )
    with pytest.raises(AIInvalidResponse):
        await NvidiaNimProvider(api_key="k").generate(prompt())


async def test_openrouter_reports_an_upstream_error_hidden_in_a_200(monkeypatch):
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {
                "/chat/completions": httpx.Response(
                    200, json={"error": {"message": "no allowed providers"}}
                )
            }
        ),
    )
    with pytest.raises(AIInvalidResponse) as excinfo:
        await OpenRouterProvider(api_key="k").generate(prompt())
    assert "no allowed providers" in str(excinfo.value)


async def test_gemini_reports_a_blocked_prompt(monkeypatch):
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {":generateContent": httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}})}
        ),
    )
    with pytest.raises(AIInvalidResponse) as excinfo:
        await GeminiProvider(api_key="k").generate(prompt())
    assert "SAFETY" in str(excinfo.value)


# ---------------------------------------------------------------- models ----


async def test_openai_style_model_listing(monkeypatch):
    ai_stubs.install(monkeypatch, ai_stubs.routes({"/models": ai_stubs.openai_models("a", "b")}))
    models = await NvidiaNimProvider(api_key="k").list_models()
    assert [m.id for m in models] == ["a", "b"]


async def test_gemini_model_listing_strips_the_prefix_and_embeddings(monkeypatch):
    ai_stubs.install(
        monkeypatch,
        ai_stubs.routes(
            {
                "/v1beta/models": httpx.Response(
                    200,
                    json={
                        "models": [
                            {
                                "name": "models/gemini-2.5-flash",
                                "supportedGenerationMethods": ["generateContent"],
                            },
                            {
                                "name": "models/text-embedding-004",
                                "supportedGenerationMethods": ["embedContent"],
                            },
                        ]
                    },
                )
            }
        ),
    )
    models = await GeminiProvider(api_key="k").list_models()
    assert [m.id for m in models] == ["gemini-2.5-flash"]


async def test_verify_is_a_real_authenticated_call(monkeypatch):
    ai_stubs.install(monkeypatch, ai_stubs.routes({"/models": ai_stubs.error(401)}))
    with pytest.raises(AIAuthError):
        await NvidiaNimProvider(api_key="wrong").verify()


# ------------------------------------------------------------ formatting ----


def test_response_format_coercion_is_forgiving():
    assert ResponseFormat.coerce(None).kind == "text"
    assert ResponseFormat.coerce({"type": "json_object"}).wants_json is True
    # a bare schema is enough to mean "structured"
    coerced = ResponseFormat.coerce({"schema": SCHEMA})
    assert coerced.kind == "json_schema"
    assert coerced.schema == SCHEMA
    # json_schema with no schema degrades to json_object rather than failing
    assert ResponseFormat.coerce({"type": "json_schema"}).kind == "json_object"
