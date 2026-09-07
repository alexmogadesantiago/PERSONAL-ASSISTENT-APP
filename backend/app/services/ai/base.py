"""The provider-agnostic contract every AI backend implements.

An automation never imports a provider. It asks ``AIService`` for a completion
and receives an :class:`AIResponse` whose shape is identical whether the tokens
came from NVIDIA NIM, OpenRouter or Gemini.

Nothing in this module logs or returns a credential: the API key lives on the
instance, is attached to the outgoing request, and never reaches a log record,
an exception message or a response body.
"""
from __future__ import annotations

import abc
import time
from dataclasses import dataclass, field

import httpx

from app.services.ai.errors import (
    AIAuthError,
    AIBadRequest,
    AIError,
    AIRateLimited,
    AITimeout,
    AIUnavailable,
)

#: what a caller may ask for in ``response_format``
TEXT = "text"
JSON_OBJECT = "json_object"
JSON_SCHEMA = "json_schema"


@dataclass(frozen=True)
class Message:
    """One chat turn. ``role`` is ``system`` | ``user`` | ``assistant``."""

    role: str
    content: str

    @classmethod
    def coerce(cls, raw: "Message | dict[str, str]") -> "Message":
        if isinstance(raw, Message):
            return raw
        role = str(raw.get("role") or "user").strip().lower()
        if role not in ("system", "user", "assistant"):
            role = "user"
        return cls(role=role, content=str(raw.get("content") or ""))


@dataclass(frozen=True)
class ResponseFormat:
    """Normalised request for structured output.

    ``schema`` is plain JSON Schema; each provider translates it into its own
    dialect (or, when it has none, into a prompt instruction).
    """

    kind: str = TEXT
    schema: dict | None = None
    name: str = "response"

    @classmethod
    def coerce(cls, raw: "ResponseFormat | dict | None") -> "ResponseFormat":
        if raw is None:
            return cls()
        if isinstance(raw, ResponseFormat):
            return raw
        declared = str(raw.get("type") or raw.get("kind") or "").strip().lower()
        schema = raw.get("schema") or raw.get("json_schema")
        if isinstance(schema, dict) and "schema" in schema:  # OpenAI nesting
            schema = schema.get("schema")
        # A bare schema with no `type` still means "structured": callers should
        # not have to say it twice.
        kind = declared if declared in (TEXT, JSON_OBJECT, JSON_SCHEMA) else ""
        if not kind:
            kind = JSON_SCHEMA if isinstance(schema, dict) else TEXT
        if kind == JSON_SCHEMA and not isinstance(schema, dict):
            kind = JSON_OBJECT
        return cls(
            kind=kind,
            schema=schema if isinstance(schema, dict) else None,
            name=str(raw.get("name") or "response"),
        )

    @property
    def wants_json(self) -> bool:
        return self.kind in (JSON_OBJECT, JSON_SCHEMA)


@dataclass
class ModelInfo:
    id: str
    label: str = ""
    #: "live" when the provider listed it, "catalog" when it came from the
    #: maintained fallback list - the panel says which, instead of pretending.
    source: str = "live"

    def as_dict(self) -> dict:
        return {"id": self.id, "label": self.label or self.id, "source": self.source}


@dataclass
class AIResponse:
    """The single shape every automation consumes."""

    text: str
    provider: str
    model: str
    latency_ms: float
    finish_reason: str = ""
    usage: dict = field(default_factory=dict)
    #: parsed object when structured output was requested, else ``None``
    data: object | None = None

    def as_dict(self) -> dict:
        return {
            "text": self.text,
            "data": self.data,
            "provider": self.provider,
            "model": self.model,
            "latency_ms": self.latency_ms,
            "finish_reason": self.finish_reason,
            "usage": self.usage,
        }


class AIProvider(abc.ABC):
    """One AI backend. Subclasses differ only in wire format."""

    #: stable identifier used in configuration and in the API
    id: str = ""
    label: str = ""
    default_base_url: str = ""
    default_model: str = ""
    requires_key: bool = True

    def __init__(
        self,
        *,
        api_key: str = "",
        base_url: str = "",
        model: str = "",
        timeout: float = 60.0,
    ) -> None:
        self.api_key = (api_key or "").strip()
        self.base_url = (base_url or self.default_base_url).strip().rstrip("/")
        self.model = (model or self.default_model).strip()
        self.timeout = float(timeout)

    # ------------------------------------------------------------ contract --

    @abc.abstractmethod
    async def generate(
        self,
        messages: list[Message],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        response_format: ResponseFormat | None = None,
    ) -> AIResponse:
        """Run one completion and return the normalised response."""

    @abc.abstractmethod
    async def list_models(self) -> list[ModelInfo]:
        """Models this endpoint currently offers. Raises :class:`AIError`."""

    # ------------------------------------------------------------- helpers --

    @property
    def configured(self) -> bool:
        if self.requires_key and not self.api_key:
            return False
        return bool(self.base_url)

    async def verify(self) -> tuple[float, str]:
        """Cheap authenticated call proving the credential is accepted.

        Used by the monitor: unlike a generation it costs no tokens, so it can
        run on a timer without spending quota. Returns ``(latency_ms, detail)``
        or raises an :class:`AIError`.
        """
        started = time.perf_counter()
        models = await self.list_models()
        latency = round((time.perf_counter() - started) * 1000, 1)
        return latency, f"credential accepted ({len(models)} model(s) listed)"

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self.timeout, follow_redirects=True)

    def _raise_for_status(self, response: httpx.Response) -> None:
        """Map an HTTP status onto the retryable / non-retryable taxonomy.

        The provider's own error body is not echoed verbatim: it can quote the
        submitted request (and therefore the prompt). Only the status and a
        short, sanitised reason travel outwards.
        """
        code = response.status_code
        if 200 <= code < 300:
            return
        reason = _short_reason(response)
        if code in (401, 403):
            raise AIAuthError(
                f"the API key was rejected (HTTP {code})", provider=self.id, status_code=code
            )
        if code == 400:
            raise AIBadRequest(
                f"the provider rejected the request (HTTP 400{reason})",
                provider=self.id,
                status_code=code,
            )
        if code == 404:
            raise AIBadRequest(
                f"model or endpoint not found (HTTP 404{reason})",
                provider=self.id,
                status_code=code,
            )
        if code == 429:
            raise AIRateLimited(
                "rate limit or quota exceeded (HTTP 429)", provider=self.id, status_code=code
            )
        if code >= 500:
            raise AIUnavailable(f"provider error (HTTP {code})", provider=self.id, status_code=code)
        raise AIUnavailable(
            f"unexpected response (HTTP {code})", provider=self.id, status_code=code
        )

    def _wrap_transport_error(self, exc: httpx.HTTPError) -> AIError:
        if isinstance(exc, httpx.TimeoutException):
            return AITimeout(f"no response within {self.timeout:.0f}s", provider=self.id)
        return AIUnavailable(f"provider unreachable ({type(exc).__name__})", provider=self.id)


def _short_reason(response: httpx.Response) -> str:
    """A few words from the provider's error, with no prompt echo.

    Providers frequently include the offending request in the error body; only
    the ``message`` field is read, and it is hard-truncated.
    """
    try:
        body = response.json()
    except ValueError:
        return ""
    if not isinstance(body, dict):
        return ""
    error = body.get("error")
    message = ""
    if isinstance(error, dict):
        message = str(error.get("message") or "")
    elif isinstance(error, str):
        message = error
    elif isinstance(body.get("message"), str):
        message = body["message"]
    message = " ".join(message.split())[:120]
    return f": {message}" if message else ""


__all__ = [
    "AIProvider",
    "AIResponse",
    "JSON_OBJECT",
    "JSON_SCHEMA",
    "Message",
    "ModelInfo",
    "ResponseFormat",
    "TEXT",
]
