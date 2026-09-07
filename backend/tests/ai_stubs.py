"""Test doubles for the AI providers.

The provider is exercised end to end - real request building, real status-code
mapping, real response parsing - with only the socket replaced by an
``httpx.MockTransport``. Stubbing at ``AIProvider._client`` rather than at
``generate()`` is deliberate: it is the only way a test can prove that a 429
becomes a retryable error, that the key travels in a header and never in a URL,
and that the JSON contract survives a provider swap.
"""
from __future__ import annotations

import json

import httpx

from app.services.ai.base import AIProvider


class Recorder:
    """Every request the providers made, so a test can assert on the wire."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def urls(self) -> list[str]:
        return [str(r.url) for r in self.requests]

    def calls_to(self, fragment: str) -> list[httpx.Request]:
        return [r for r in self.requests if fragment in str(r.url)]

    def bodies(self) -> list[dict]:
        out = []
        for request in self.requests:
            try:
                out.append(json.loads(request.content.decode() or "{}"))
            except ValueError:
                out.append({})
        return out


def install(monkeypatch, handler) -> Recorder:
    """Route every provider call through ``handler(request) -> httpx.Response``."""
    recorder = Recorder()

    def _wrapped(request: httpx.Request) -> httpx.Response:
        recorder.requests.append(request)
        return handler(request)

    def _client(self: AIProvider) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.MockTransport(_wrapped), timeout=self.timeout
        )

    monkeypatch.setattr(AIProvider, "_client", _client, raising=False)
    return recorder


def routes(mapping: dict, default: int = 404) -> callable:
    """Build a handler from ``{url fragment: httpx.Response | callable}``."""

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        for fragment, response in mapping.items():
            if fragment in url:
                return response(request) if callable(response) else response
        return httpx.Response(default, json={"error": {"message": "no route"}})

    return handler


# ------------------------------------------------------------- responses ----


def openai_models(*ids: str) -> httpx.Response:
    return httpx.Response(200, json={"data": [{"id": i} for i in (ids or ("m1",))]})


def gemini_models(*ids: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "models": [
                {"name": f"models/{i}", "supportedGenerationMethods": ["generateContent"]}
                for i in (ids or ("gemini-2.5-flash",))
            ]
        },
    )


def openai_completion(text: str, *, model: str = "test-model") -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "id": "cmpl-1",
            "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        },
    )


def gemini_completion(text: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "candidates": [
                {"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}
            ],
            "usageMetadata": {
                "promptTokenCount": 10,
                "candidatesTokenCount": 5,
                "totalTokenCount": 15,
            },
        },
    )


def error(status: int, message: str = "nope") -> httpx.Response:
    return httpx.Response(status, json={"error": {"message": message}})


def timeout(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("timed out", request=request)


def connect_error(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("refused", request=request)


NIM = "integrate.api.nvidia.com"
OPENROUTER = "openrouter.ai"
GEMINI = "generativelanguage.googleapis.com"
