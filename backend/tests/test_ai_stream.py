"""Streamed answers: the wire format of each provider, the fallback policy
before the first token, and the SSE endpoint the chat reads.

Same approach as the rest of the AI suite: real request building and real
parsing, with only the socket replaced (see ``tests/ai_stubs.py``).
"""
from __future__ import annotations

import json

import httpx
import pytest

from app.models import SystemEvent
from app.services import usage
from app.services.ai import registry
from app.services.ai.base import AIProvider, AIResponse, Message, ModelInfo
from app.services.ai.errors import AIAuthError, AIInvalidResponse, AIUnavailable
from app.services.ai.gemini import GeminiProvider
from app.services.ai.openai_compatible import NvidiaNimProvider, OpenRouterProvider
from app.services.ai.service import AIService, reset_caches
from tests import ai_stubs

pytestmark = pytest.mark.anyio


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


HELLO = [Message(role="system", content="be brief"), Message(role="user", content="hola")]


async def _collect(stream) -> list:
    return [chunk async for chunk in stream]


# --------------------------------------------------------------- providers ---


async def test_openai_compatible_streams_deltas_then_usage(monkeypatch):
    recorder = ai_stubs.install(monkeypatch, ai_stubs.routes(
        {"/chat/completions": ai_stubs.openai_stream("Ho", "la ", "mundo", model="served/model")}))
    chunks = await _collect(NvidiaNimProvider(api_key="nvapi-secret").stream(HELLO, model="meta/x"))

    assert [c.text for c in chunks if not c.done] == ["Ho", "la ", "mundo"]
    final = chunks[-1]
    assert final.done and final.model == "served/model" and final.finish_reason == "stop"
    assert final.usage["completion_tokens"] == 3
    request = recorder.requests[0]
    body = json.loads(request.content)
    assert body["stream"] is True and body["model"] == "meta/x"
    assert "stream_options" not in body, "unknown fields make some engines reject the request"
    assert request.headers["accept"] == "text/event-stream"
    assert request.headers["authorization"] == "Bearer nvapi-secret"
    assert "nvapi-secret" not in str(request.url)


async def test_comment_lines_are_ignored_and_an_error_event_is_raised(monkeypatch):
    content = ai_stubs.sse(": OPENROUTER PROCESSING\n\n",
                           {"choices": [{"delta": {"content": "Parte"}}]},
                           {"error": {"message": "upstream   provider  died"}}, done=False)
    ai_stubs.install(monkeypatch, ai_stubs.routes(
        {"/chat/completions": httpx.Response(200, content=content)}))
    stream = OpenRouterProvider(api_key="sk-or-k").stream(HELLO)
    assert (await stream.__anext__()).text == "Parte"
    with pytest.raises(AIUnavailable) as excinfo:
        await stream.__anext__()
    assert "upstream provider died" in excinfo.value.message


@pytest.mark.parametrize("status,expected", [(401, AIAuthError), (503, AIUnavailable)])
async def test_a_refused_stream_maps_onto_the_error_taxonomy(monkeypatch, status, expected):
    ai_stubs.install(monkeypatch, ai_stubs.routes({"/chat/completions": ai_stubs.error(status)}))
    with pytest.raises(expected):
        await _collect(NvidiaNimProvider(api_key="nvapi-k").stream(HELLO))


async def test_a_stream_with_no_text_is_an_invalid_response(monkeypatch):
    ai_stubs.install(monkeypatch, ai_stubs.routes({"/chat/completions": ai_stubs.openai_stream()}))
    with pytest.raises(AIInvalidResponse):
        await _collect(NvidiaNimProvider(api_key="nvapi-k").stream(HELLO))


async def test_gemini_streams_from_stream_generate_content(monkeypatch):
    recorder = ai_stubs.install(monkeypatch, ai_stubs.routes(
        {":streamGenerateContent": ai_stubs.gemini_stream("Bon ", "dia")}))
    chunks = await _collect(GeminiProvider(api_key="AIza-secret").stream(HELLO, model="gemini-2.5-flash"))

    assert "".join(c.text for c in chunks) == "Bon dia"
    assert chunks[-1].done and chunks[-1].finish_reason == "STOP" and chunks[-1].usage["total_tokens"] == 6
    request = recorder.requests[0]
    assert request.url.path.endswith("/models/gemini-2.5-flash:streamGenerateContent")
    assert request.url.params["alt"] == "sse"
    assert request.headers["x-goog-api-key"] == "AIza-secret" and "AIza-secret" not in str(request.url)
    body = json.loads(request.content)
    assert body["systemInstruction"]["parts"][0]["text"] == "be brief"


async def test_a_provider_without_a_stream_dialect_sends_its_whole_answer_once():
    class OneShot(AIProvider):
        id = "one_shot"

        async def generate(self, messages, **kw):
            return AIResponse(text="todo de golpe", provider=self.id, model="m", latency_ms=1.0, finish_reason="stop")

        async def list_models(self):
            return [ModelInfo(id="m")]

    chunks = await _collect(OneShot(api_key="k", base_url="http://x").stream(HELLO))
    assert [c.text for c in chunks if not c.done] == ["todo de golpe"]
    assert chunks[-1].done and chunks[-1].finish_reason == "stop"


# ----------------------------------------------------------------- service ---


async def test_the_fallback_serves_the_stream_when_the_primary_fails_first(env_unset, db_session, monkeypatch):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    env_unset.openrouter_api_key = "sk-or-k"
    ai_stubs.install(monkeypatch, ai_stubs.routes({
        ai_stubs.NIM: ai_stubs.error(503),
        ai_stubs.OPENROUTER: ai_stubs.openai_stream("de ", "respaldo"),
    }))
    events = await _collect(AIService.from_db(db_session).stream([{"role": "user", "content": "hola"}]))

    assert events[0] == {"type": "start", "provider": registry.OPENROUTER, "model": events[0]["model"],
                         "used_fallback": True}
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "de respaldo"
    done = events[-1]
    assert done["type"] == "done" and done["used_fallback"] is True
    assert done["primary_provider"] == registry.NVIDIA_NIM and "503" in done["primary_error"]


async def test_a_rejected_key_is_not_replayed_on_the_fallback(env_unset, db_session, monkeypatch):
    env_unset.nvidia_nim_api_key = "nvapi-k"
    env_unset.openrouter_api_key = "sk-or-k"
    recorder = ai_stubs.install(monkeypatch, ai_stubs.routes({
        ai_stubs.NIM: ai_stubs.error(401), ai_stubs.OPENROUTER: ai_stubs.openai_stream("x")}))
    with pytest.raises(AIAuthError):
        await _collect(AIService.from_db(db_session).stream([{"role": "user", "content": "hola"}]))
    assert recorder.calls_to(ai_stubs.OPENROUTER) == []


async def test_a_failure_after_the_first_token_never_switches_provider(env_unset, db_session, monkeypatch):
    """Text already reached the reader: a second provider would repeat or contradict it."""
    env_unset.nvidia_nim_api_key = "nvapi-k"
    env_unset.openrouter_api_key = "sk-or-k"
    broken = ai_stubs.sse({"choices": [{"delta": {"content": "Empiezo"}}]}, {"error": {"message": "boom"}}, done=False)
    recorder = ai_stubs.install(monkeypatch, ai_stubs.routes({
        ai_stubs.NIM: httpx.Response(200, content=broken), ai_stubs.OPENROUTER: ai_stubs.openai_stream("otro")}))
    stream = AIService.from_db(db_session).stream([{"role": "user", "content": "hola"}])
    assert (await stream.__anext__())["type"] == "start"
    assert (await stream.__anext__()) == {"type": "delta", "text": "Empiezo"}
    with pytest.raises(AIUnavailable):
        await stream.__anext__()
    assert recorder.calls_to(ai_stubs.OPENROUTER) == []


# ---------------------------------------------------------------- endpoint ---


def _register(client) -> dict:
    r = client.post("/api/auth/register", json={"email": "s@example.com", "username": "streamer",
                                                "password": "Correct-Horse-9"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _events(text: str) -> list[dict]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        event = json.loads(lines["data"])
        assert lines["event"] == event["type"]
        out.append(event)
    return out


def test_the_endpoint_streams_server_sent_events_and_counts_the_request(client, settings_factory, monkeypatch,
                                                                         session_factory):
    settings_factory(nvidia_nim_api_key="nvapi-k", ai_provider="nvidia_nim")
    ai_stubs.install(monkeypatch, ai_stubs.routes({"/chat/completions": ai_stubs.openai_stream("Hola", ", ", "Alex")}))
    h = _register(client)

    with client.stream("POST", "/api/ai/generate/stream", headers=h,
                       json={"system": "be brief", "messages": [{"role": "user", "content": "hola"}]}) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        assert r.headers["cache-control"] == "no-cache"
        events = _events(r.read().decode())

    assert [e["type"] for e in events] == ["start", "delta", "delta", "delta", "done"]
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "Hola, Alex"
    assert events[-1]["provider"] == "nvidia_nim" and events[-1]["used_fallback"] is False
    with session_factory() as db:
        today = list(usage.read(db, 1).values())[0]
    assert today.get("ai_requests") == 1


def test_a_fallback_during_a_stream_is_audited(client, settings_factory, monkeypatch, session_factory):
    settings_factory(nvidia_nim_api_key="nvapi-k", openrouter_api_key="sk-or-k", ai_provider="nvidia_nim")
    ai_stubs.install(monkeypatch, ai_stubs.routes({
        ai_stubs.NIM: ai_stubs.error(429), ai_stubs.OPENROUTER: ai_stubs.openai_stream("ok")}))
    h = _register(client)
    with client.stream("POST", "/api/ai/generate/stream", headers=h, json={"prompt": "hola"}) as r:
        events = _events(r.read().decode())
    assert events[0]["used_fallback"] is True
    with session_factory() as db:
        trail = db.query(SystemEvent).filter(SystemEvent.type == "ai.fallback").all()
    assert len(trail) == 1 and trail[0].meta["fallback"] == "openrouter"


def test_errors_before_the_first_token_are_plain_http_errors(client, settings_factory, monkeypatch):
    settings_factory()
    h = _register(client)
    assert client.post("/api/ai/generate/stream", json={"prompt": "hola"}).status_code == 401
    assert client.post("/api/ai/generate/stream", headers=h, json={"prompt": "hola"}).status_code == 503
    settings_factory(nvidia_nim_api_key="nvapi-k", ai_provider="nvidia_nim")
    assert client.post("/api/ai/generate/stream", headers=h,
                       json={"prompt": "hola", "json_schema": {"type": "object"}}).status_code == 400
    ai_stubs.install(monkeypatch, ai_stubs.routes({"/chat/completions": ai_stubs.error(401)}))
    r = client.post("/api/ai/generate/stream", headers=h, json={"prompt": "hola"})
    assert r.status_code == 502 and "rejected" in r.json()["detail"]


def test_a_failure_mid_answer_arrives_as_an_error_event(client, settings_factory, monkeypatch, session_factory):
    settings_factory(nvidia_nim_api_key="nvapi-k", ai_provider="nvidia_nim")
    broken = ai_stubs.sse({"choices": [{"delta": {"content": "Empiezo"}}]}, {"error": {"message": "boom"}}, done=False)
    ai_stubs.install(monkeypatch, ai_stubs.routes({"/chat/completions": httpx.Response(200, content=broken)}))
    h = _register(client)
    with client.stream("POST", "/api/ai/generate/stream", headers=h, json={"prompt": "hola"}) as r:
        events = _events(r.read().decode())
    assert [e["type"] for e in events] == ["start", "delta", "error"]
    assert "boom" in events[-1]["message"]
    with session_factory() as db:
        today = list(usage.read(db, 1).values())[0]
    assert today.get("ai_errors") == 1 and not today.get("ai_requests")


def test_a_service_token_can_stream_too(client, settings_factory, monkeypatch):
    settings_factory(nvidia_nim_api_key="nvapi-k", ai_provider="nvidia_nim")
    ai_stubs.install(monkeypatch, ai_stubs.routes({"/chat/completions": ai_stubs.openai_stream("n8n")}))
    h = _register(client)
    token = client.post("/api/ai/service-token", headers=h).json()["token"]
    with client.stream("POST", "/api/ai/generate/stream", headers={"X-AC-Service-Token": token},
                       json={"prompt": "hola"}) as r:
        assert r.status_code == 200
        assert any(e["type"] == "delta" for e in _events(r.read().decode()))


async def test_stopping_the_reader_closes_the_provider_stream(env_unset, db_session, monkeypatch):
    """Stop must end the provider call itself, or the model keeps generating (and billing)."""
    from app.services.ai.base import StreamChunk

    closed: list[bool] = []

    class Endless(AIProvider):
        id = "nvidia_nim"

        async def generate(self, messages, **kw):  # pragma: no cover - not used
            raise AssertionError

        async def list_models(self):  # pragma: no cover - not used
            return []

        async def stream(self, messages, **kw):
            try:
                while True:
                    yield StreamChunk(text="palabra ")
            finally:
                closed.append(True)

    env_unset.nvidia_nim_api_key = "nvapi-k"
    monkeypatch.setattr(AIService, "_client", lambda self, provider, model="": Endless(api_key="k", base_url="http://x"))
    stream = AIService.from_db(db_session).stream([{"role": "user", "content": "hola"}])
    assert (await stream.__anext__())["type"] == "start"
    assert (await stream.__anext__())["type"] == "delta"
    await stream.aclose()
    assert closed == [True]
