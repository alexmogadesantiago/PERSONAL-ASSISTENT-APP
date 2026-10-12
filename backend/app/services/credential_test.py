"""Real connection tests for stored credentials.

Each provider hits a cheap, read-only endpoint with the decrypted secret. No
mocks: an unknown provider with no `test_url` in meta returns "not testable"
rather than a fake success.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.ssrf import BlockedRequestError, guarded_get
from app.models import CredentialType


@dataclass
class TestResult:
    ok: bool
    detail: str
    latency_ms: float | None = None


_TIMEOUT_SECONDS = 8.0


async def _get(url: str, *, headers: dict | None = None, params: dict | None = None) -> TestResult:
    try:
        r = await guarded_get(
            url, headers=headers or {}, params=params or {}, timeout=_TIMEOUT_SECONDS
        )
        ms = round(r.elapsed.total_seconds() * 1000, 1)
        if 200 <= r.status_code < 300:
            return TestResult(True, f"HTTP {r.status_code}", ms)
        if r.status_code in (401, 403):
            return TestResult(False, f"auth rejected (HTTP {r.status_code})", ms)
        return TestResult(False, f"HTTP {r.status_code}", ms)
    except BlockedRequestError as exc:
        return TestResult(False, f"blocked: {exc}")
    except httpx.HTTPError as exc:
        return TestResult(False, f"{type(exc).__name__}: {exc}")


async def run_test(provider: str, ctype: CredentialType, secret: dict, meta: dict) -> TestResult:
    provider = (provider or "").strip().lower()
    key = secret.get("api_key") or secret.get("token") or secret.get("value") or ""

    if provider in ("openai",):
        return await _get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {key}"})
    if provider in ("anthropic", "claude"):
        return await _get(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        )
    if provider in ("gemini", "google_ai", "google-ai", "googleai"):
        # Header, not `?key=`: query strings are logged by proxies, headers are not.
        return await _get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            headers={"x-goog-api-key": key},
        )
    if provider in ("openrouter",):
        return await _get(
            "https://openrouter.ai/api/v1/models", headers={"Authorization": f"Bearer {key}"}
        )
    if provider in ("telegram", "telegram_bot"):
        token = secret.get("token") or key
        from app.config import get_settings

        return await _get(f"{get_settings().telegram_api_url}/bot{token}/getMe")

    # Generic path: caller supplied a URL in meta -> apply the credential and GET.
    test_url = meta.get("test_url")
    if test_url:
        headers: dict = {}
        params: dict = {}
        if ctype == CredentialType.api_key:
            header_name = meta.get("header_name", "Authorization")
            prefix = meta.get("header_prefix", "")
            headers[header_name] = f"{prefix}{key}".strip()
        elif ctype == CredentialType.bearer:
            headers["Authorization"] = f"Bearer {key}"
        elif ctype == CredentialType.basic_auth:
            import base64

            raw = f"{secret.get('username','')}:{secret.get('password','')}".encode()
            headers["Authorization"] = "Basic " + base64.b64encode(raw).decode()
        elif ctype == CredentialType.oauth2:
            headers["Authorization"] = f"Bearer {secret.get('access_token', key)}"
        return await _get(test_url, headers=headers, params=params)

    return TestResult(False, "no connection test available for this provider (set meta.test_url)")
