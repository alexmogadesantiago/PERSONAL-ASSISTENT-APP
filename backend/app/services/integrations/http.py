"""One HTTP client factory for every provider call.

Tests replace `_transport` with an `httpx.MockTransport`, which drives the real
client code (headers, form encoding, JSON parsing) without the network.
"""
from __future__ import annotations

import httpx

TIMEOUT = httpx.Timeout(15.0, connect=8.0)
_transport: httpx.AsyncBaseTransport | None = None


def client() -> httpx.AsyncClient:
    kw: dict = {"timeout": TIMEOUT, "headers": {"User-Agent": "PersonalAssistant/0.6"}}
    if _transport is not None:
        kw["transport"] = _transport
    return httpx.AsyncClient(**kw)


def set_transport(transport: httpx.AsyncBaseTransport | None) -> None:
    global _transport
    _transport = transport
