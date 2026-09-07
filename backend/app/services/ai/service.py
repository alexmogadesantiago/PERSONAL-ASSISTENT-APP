"""The one entry point every automation uses to reach a model.

    Automation -> AIService -> provider -> NIM / OpenRouter / Gemini -> AIResponse

Callers never name a provider and never import one. They ask for a completion;
this layer resolves the configuration, picks the provider, applies the fallback
policy, normalises the answer and records what actually happened.

Fallback policy
---------------
The fallback is tried only for failures that another provider could plausibly
survive - timeout, HTTP 429, HTTP 5xx, connection refused. A rejected key
(401/403) or a malformed request (400) is raised immediately: replaying it
elsewhere would burn a second quota to reach the same conclusion, and would hide
the real fault from the operator.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import logging
import time
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.ai import config as ai_config
from app.services.ai import registry
from app.services.ai.base import AIProvider, AIResponse, Message, ModelInfo, ResponseFormat
from app.services.ai.errors import AIError, AINotConfigured

log = logging.getLogger("ai")

ONLINE = "online"
DEGRADED = "degraded"
INVALID = "invalid"
OFFLINE = "offline"
NOT_CONFIGURED = "not_configured"


@dataclass
class GenerationResult:
    """An :class:`AIResponse` plus how the platform got there."""

    response: AIResponse
    used_fallback: bool = False
    primary_provider: str = ""
    primary_error: str = ""
    attempts: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        payload = self.response.as_dict()
        payload.update(
            {
                "used_fallback": self.used_fallback,
                "primary_provider": self.primary_provider,
                "primary_error": self.primary_error,
                "attempts": self.attempts,
            }
        )
        return payload


@dataclass
class AIHealth:
    status: str
    detail: str
    provider: str = ""
    model: str = ""
    latency_ms: float | None = None
    fallback_provider: str = ""
    fallback_status: str = ""
    error: str = ""
    cached: bool = False

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "detail": self.detail,
            "provider": self.provider,
            "model": self.model,
            "latency_ms": self.latency_ms,
            "fallback_provider": self.fallback_provider,
            "fallback_status": self.fallback_status,
            "error": self.error,
            "cached": self.cached,
        }


def _fingerprint(*parts: str) -> str:
    """Stable, non-reversible id for a configuration, so a key rotation busts
    the cache without the key ever being held in it."""
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


# Health verdicts are memoised: the monitor loop ticks every few seconds and
# re-asking a provider that often would waste quota to re-learn something that
# changes almost never.
_health_cache: dict = {"fingerprint": None, "health": None, "at": 0.0}
# Model lists change rarely and the call is unauthenticated-cheap but not free.
_models_cache: dict[str, tuple[float, list[ModelInfo]]] = {}


def reset_caches() -> None:
    """Forget every memoised verdict (forced check, or a test)."""
    _health_cache.update(fingerprint=None, health=None, at=0.0)
    _models_cache.clear()


#: how far back a fallback still counts as "recent" for the dashboard
FALLBACK_LOOKBACK_SECONDS = 3600


def recent_fallback(db: Session | None, *, within_seconds: float = FALLBACK_LOOKBACK_SECONDS):
    """The last generation that actually fell back, if it was recent.

    Health answers "can the primary be reached right now". That is a different
    question from "did an automation just get served by the fallback": a 429 at
    08:04 is invisible to a probe at 08:05, yet it is exactly what an operator
    needs to see. The `ai.fallback` audit row already records it, so this reads
    that trail rather than inventing new state.

    Returns None when nothing recent, or a browser-safe dict - the audit `meta`
    holds provider ids and a sanitised reason, never a key or a prompt.
    """
    if db is None:
        return None
    from app.models import SystemEvent

    try:
        event = (
            db.query(SystemEvent)
            .filter(SystemEvent.type == "ai.fallback")
            .order_by(SystemEvent.created_at.desc())
            .first()
        )
    except Exception as exc:  # noqa: BLE001 - never let the dashboard fail on this
        log.warning("could not read the fallback trail: %s", type(exc).__name__)
        return None
    if event is None:
        return None

    occurred = event.created_at
    if occurred.tzinfo is None:  # SQLite hands back naive datetimes
        occurred = occurred.replace(tzinfo=dt.timezone.utc)
    age = (dt.datetime.now(dt.timezone.utc) - occurred).total_seconds()
    if age > within_seconds:
        return None

    meta = event.meta or {}
    return {
        "at": occurred.isoformat(),
        "age_seconds": round(age, 1),
        "primary": str(meta.get("primary") or ""),
        "fallback": str(meta.get("fallback") or ""),
        "reason": str(meta.get("reason") or ""),
    }


class AIService:
    """Provider-agnostic generation, health and model discovery."""

    def __init__(self, config: ai_config.AIConfig):
        self.config = config

    @classmethod
    def from_db(cls, db: Session | None) -> "AIService":
        return cls(ai_config.resolve(db))

    # ---------------------------------------------------------- generation --

    def _client(self, provider: str, model: str = "") -> AIProvider | None:
        return self.config.build(provider, model=model)

    async def generate(
        self,
        messages: list[Message] | list[dict],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: ResponseFormat | dict | None = None,
    ) -> GenerationResult:
        """Run one completion, applying the configured fallback policy."""
        turns = [Message.coerce(m) for m in messages]
        if not turns or not any(t.content.strip() for t in turns):
            raise AINotConfigured("no prompt was supplied")

        cfg = self.config
        if not cfg.configured:
            raise AINotConfigured(
                "no AI provider is configured: " + (", ".join(cfg.missing) or "none available")
            )

        fmt = ResponseFormat.coerce(response_format)
        temperature = cfg.temperature if temperature is None else temperature
        max_tokens = cfg.max_tokens if max_tokens is None else max_tokens

        attempts: list[dict] = []
        primary = self._client(cfg.provider, model or cfg.model)
        if primary is None:  # defensive: `configured` already covers this
            raise AINotConfigured(f"{cfg.provider} has no credential")

        try:
            response = await primary.generate(
                turns,
                model=model or cfg.model,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=fmt,
            )
            attempts.append({"provider": cfg.provider, "ok": True, "error": ""})
            return GenerationResult(
                response=response, primary_provider=cfg.provider, attempts=attempts
            )
        except AIError as exc:
            attempts.append({"provider": cfg.provider, "ok": False, "error": exc.message})
            fallback = cfg.effective_fallback
            # A wrong key or a malformed request will fail identically on the
            # next provider, so it is surfaced instead of being retried.
            if not exc.retryable or not fallback:
                # Provider ids and the failure class are not secrets; the key
                # and the prompt never appear in `exc.message` (see base.py).
                log.warning(
                    "ai generation failed on %s (retryable=%s): %s",
                    cfg.provider,
                    exc.retryable,
                    exc.message,
                    extra={"operation": "ai.generate", "status": "failed"},
                )
                raise
            log.warning(
                "ai primary %s failed, trying fallback %s: %s",
                cfg.provider,
                fallback,
                exc.message,
                extra={"operation": "ai.fallback", "status": "degraded"},
            )
            primary_error = exc.message

        secondary = self._client(fallback, cfg.fallback_model)
        if secondary is None:
            raise AINotConfigured(f"fallback provider {fallback} has no credential")
        try:
            response = await secondary.generate(
                turns,
                model=cfg.fallback_model or None,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=fmt,
            )
        except AIError as exc:
            attempts.append({"provider": fallback, "ok": False, "error": exc.message})
            exc.message = f"{exc.message} (primary {cfg.provider} also failed: {primary_error})"
            raise
        attempts.append({"provider": fallback, "ok": True, "error": ""})
        return GenerationResult(
            response=response,
            used_fallback=True,
            primary_provider=cfg.provider,
            primary_error=primary_error,
            attempts=attempts,
        )

    # -------------------------------------------------------------- models --

    async def list_models(self, provider: str, *, force: bool = False) -> list[ModelInfo]:
        """Live model list, falling back to the maintained catalogue.

        The catalogue entries are tagged ``source="catalog"`` so the panel can
        say the list is not live rather than presenting a guess as fact.
        """
        pmeta = registry.meta(provider)
        settings = get_settings()
        cached = _models_cache.get(provider)
        if not force and cached and (time.monotonic() - cached[0]) < settings.ai_models_ttl_seconds:
            return cached[1]

        client = self._client(provider)
        if client is not None:
            try:
                models = await client.list_models()
                if models:
                    _models_cache[provider] = (time.monotonic(), models)
                    return models
            except AIError as exc:
                log.info("model list unavailable for %s: %s", provider, exc.message)
        return [
            ModelInfo(id=m, label=m, source="catalog") for m in pmeta.catalog_models
        ]

    # -------------------------------------------------------------- health --

    def _health_fingerprint(self) -> str:
        cfg = self.config
        primary = cfg.providers.get(cfg.provider)
        fallback = cfg.providers.get(cfg.effective_fallback)
        return _fingerprint(
            cfg.provider,
            cfg.model,
            _fingerprint(primary.api_key) if primary else "",
            cfg.effective_fallback,
            _fingerprint(fallback.api_key) if fallback else "",
        )

    async def health(self, *, force: bool = False) -> AIHealth:
        """Real, cached provider verification.

        A stored key is never treated as proof: the provider is actually called
        (a cheap authenticated model listing, which costs no tokens). The verdict
        is then trusted for ``AC_AI_VERIFY_TTL_SECONDS``.
        """
        cfg = self.config
        settings = get_settings()

        if not cfg.provider:
            return AIHealth(
                status=NOT_CONFIGURED,
                detail="no AI provider is configured",
                fallback_provider="",
            )
        if not cfg.configured:
            return AIHealth(
                status=NOT_CONFIGURED,
                detail="not configured: " + ", ".join(cfg.missing),
                provider=cfg.provider,
                model=cfg.model,
            )

        fingerprint = self._health_fingerprint()
        age = time.monotonic() - _health_cache["at"]
        if (
            not force
            and _health_cache["fingerprint"] == fingerprint
            and _health_cache["health"] is not None
            and age < settings.ai_verify_ttl_seconds
        ):
            cached: AIHealth = _health_cache["health"]
            return AIHealth(
                status=cached.status,
                detail=f"{cached.detail} (cached {int(age)}s ago)",
                provider=cached.provider,
                model=cached.model,
                latency_ms=cached.latency_ms,
                fallback_provider=cached.fallback_provider,
                fallback_status=cached.fallback_status,
                error=cached.error,
                cached=True,
            )

        health = await self._probe(cfg)
        _health_cache.update(fingerprint=fingerprint, health=health, at=time.monotonic())
        return health

    async def _probe(self, cfg: ai_config.AIConfig) -> AIHealth:
        primary = self._client(cfg.provider, cfg.model)
        fallback_id = cfg.effective_fallback
        assert primary is not None  # guarded by cfg.configured

        try:
            latency, detail = await primary.verify()
            return AIHealth(
                status=ONLINE,
                detail=detail,
                provider=cfg.provider,
                model=cfg.model,
                latency_ms=latency,
                fallback_provider=fallback_id,
                fallback_status="ready" if fallback_id else "",
            )
        except AIError as exc:
            primary_error = exc.message
            primary_status = INVALID if not exc.retryable else OFFLINE

        # The primary is down. If a usable fallback answers, the platform is
        # degraded - not offline: the automations still run.
        if fallback_id:
            secondary = self._client(fallback_id, cfg.fallback_model)
            if secondary is not None:
                try:
                    latency, detail = await secondary.verify()
                    return AIHealth(
                        status=DEGRADED,
                        detail=(
                            f"primary {registry.meta(cfg.provider).label} unavailable, "
                            f"serving from {registry.meta(fallback_id).label}"
                        ),
                        provider=cfg.provider,
                        model=cfg.model,
                        latency_ms=latency,
                        fallback_provider=fallback_id,
                        fallback_status="online",
                        error=primary_error,
                    )
                except AIError as exc:
                    return AIHealth(
                        status=OFFLINE,
                        detail="primary and fallback both failed",
                        provider=cfg.provider,
                        model=cfg.model,
                        fallback_provider=fallback_id,
                        fallback_status="offline",
                        error=f"{primary_error}; fallback: {exc.message}",
                    )

        return AIHealth(
            status=primary_status,
            detail=primary_error,
            provider=cfg.provider,
            model=cfg.model,
            fallback_provider=fallback_id,
            fallback_status="",
            error=primary_error,
        )

    # ---------------------------------------------------------------- test --

    async def test(self, *, provider: str = "", model: str = "") -> dict:
        """A real end-to-end generation, used by the panel's TEST CONNECTION.

        Deliberately more than :meth:`health`: it proves the whole path - auth,
        the chosen model, and structured output - rather than only the key.
        """
        target = provider or self.config.provider
        if not target:
            raise AINotConfigured("no AI provider is configured")
        client = self._client(target, model)
        if client is None:
            raise AINotConfigured(f"{registry.meta(target).label} has no API key configured")

        started = time.perf_counter()
        response = await client.generate(
            [
                Message(
                    role="system",
                    content="You are a connectivity probe. Answer only with the requested JSON.",
                ),
                Message(role="user", content='Reply with {"ok": true}.'),
            ],
            model=model or None,
            temperature=0.0,
            # Generous on purpose. A reasoning model spends output tokens
            # thinking before it writes anything, so a tight budget returns an
            # empty completion and the panel would report a healthy provider as
            # broken. Verified against NVIDIA NIM's openai/gpt-oss-20b.
            max_tokens=512,
            response_format=ResponseFormat.coerce(
                {
                    "type": "json_schema",
                    "name": "probe",
                    "schema": {
                        "type": "object",
                        "properties": {"ok": {"type": "boolean"}},
                        "required": ["ok"],
                    },
                }
            ),
        )
        latency = round((time.perf_counter() - started) * 1000, 1)
        return {
            "ok": True,
            "provider": target,
            "model": response.model,
            "latency_ms": latency,
            "detail": f"{registry.meta(target).label} answered with valid structured JSON",
        }


__all__ = [
    "AIHealth",
    "AIService",
    "DEGRADED",
    "FALLBACK_LOOKBACK_SECONDS",
    "GenerationResult",
    "INVALID",
    "NOT_CONFIGURED",
    "OFFLINE",
    "ONLINE",
    "recent_fallback",
    "reset_caches",
]
