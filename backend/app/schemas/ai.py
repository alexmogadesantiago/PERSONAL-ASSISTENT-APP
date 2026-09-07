"""Request/response shapes for the AI API.

None of these models can carry an API key outbound: the only credential-shaped
fields are inbound (``api_key`` on an update) and the outbound views expose
``secret_configured`` plus a four-character hint, never a value.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ProviderInfo(BaseModel):
    """One selectable provider, as the panel renders it."""

    id: str
    label: str
    tagline: str
    recommended: bool
    api_style: str
    default_base_url: str
    default_model: str
    key_help: str
    console_url: str
    #: the `service_configs` row holding this provider's credential
    service_key: str
    configured: bool
    secret_configured: bool
    secret_hint: str
    base_url: str
    model: str
    source: str


class ProviderListOut(BaseModel):
    data: list[ProviderInfo]


class ProviderConfigOut(BaseModel):
    provider: str
    label: str
    configured: bool
    enabled: bool
    source: str
    base_url: str
    model: str
    secret_configured: bool
    secret_hint: str


class AIConfigOut(BaseModel):
    provider: str
    model: str
    fallback_enabled: bool
    fallback_provider: str
    fallback_model: str
    #: the fallback that would actually be used (configured and not the primary)
    effective_fallback_provider: str
    temperature: float
    max_tokens: int
    timeout_seconds: float
    source: str
    configured: bool
    missing: list[str]
    providers: list[ProviderConfigOut]
    #: state of the shared token automations use for /api/ai/generate
    service_token: dict


class ProviderCredentialUpdate(BaseModel):
    """Credential for one provider. ``api_key`` omitted = keep what is stored."""

    provider: str
    api_key: str | None = Field(default=None, max_length=4096)
    base_url: str | None = Field(default=None, max_length=500)
    model: str | None = Field(default=None, max_length=200)
    clear_api_key: bool = False
    enabled: bool | None = None


class AIConfigUpdate(BaseModel):
    """Partial update. Omitted fields are left untouched."""

    provider: str | None = None
    model: str | None = Field(default=None, max_length=200)
    fallback_enabled: bool | None = None
    fallback_provider: str | None = None
    fallback_model: str | None = Field(default=None, max_length=200)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=200_000)
    timeout_seconds: float | None = Field(default=None, ge=1.0, le=600.0)
    #: optional credential updates applied in the same request
    credentials: list[ProviderCredentialUpdate] = Field(default_factory=list)


class ModelOut(BaseModel):
    id: str
    label: str
    #: "live" when the provider listed it, "catalog" when it is our fallback list
    source: str


class ModelListOut(BaseModel):
    provider: str
    #: true when the list came from the provider itself
    live: bool
    detail: str = ""
    data: list[ModelOut]


class AITestRequest(BaseModel):
    provider: str | None = None
    model: str | None = Field(default=None, max_length=200)


class AITestResult(BaseModel):
    ok: bool
    provider: str
    model: str
    status: str
    detail: str
    latency_ms: float | None = None


class AIHealthOut(BaseModel):
    status: Literal["online", "degraded", "invalid", "offline", "not_configured", "unknown"]
    detail: str
    provider: str
    model: str
    latency_ms: float | None = None
    fallback_provider: str
    fallback_status: str
    error: str
    cached: bool
    checked_at: str


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"] = "user"
    content: str


class GenerateRequest(BaseModel):
    """One completion, as an automation asks for it.

    ``prompt`` is a shorthand for a single user turn, so an n8n HTTP node does
    not have to build a message array by hand.
    """

    messages: list[ChatMessage] = Field(default_factory=list)
    prompt: str | None = None
    system: str | None = None
    model: str | None = Field(default=None, max_length=200)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=1, le=200_000)
    #: {"type": "json_object"} or {"type": "json_schema", "schema": {...}}
    response_format: dict[str, Any] | None = None
    #: convenience: a bare JSON Schema is treated as response_format json_schema
    json_schema: dict[str, Any] | None = None


class GenerateResponse(BaseModel):
    text: str
    #: parsed object when structured output was requested
    data: Any | None = None
    provider: str
    model: str
    latency_ms: float
    finish_reason: str = ""
    usage: dict = Field(default_factory=dict)
    used_fallback: bool = False
    primary_provider: str = ""
    primary_error: str = ""


class ServiceTokenOut(BaseModel):
    configured: bool
    source: str
    hint: str


class ServiceTokenCreated(BaseModel):
    """The only response that ever carries the token in clear text."""

    token: str
    hint: str
    note: str = (
        "Copy this now - it is shown once. Set it as AC_SERVICE_TOKEN in your n8n "
        "environment so the automations can call /api/ai/generate."
    )


__all__ = [
    "AIConfigOut",
    "AIConfigUpdate",
    "AIHealthOut",
    "AITestRequest",
    "AITestResult",
    "ChatMessage",
    "GenerateRequest",
    "GenerateResponse",
    "ModelListOut",
    "ModelOut",
    "ProviderConfigOut",
    "ProviderCredentialUpdate",
    "ProviderInfo",
    "ProviderListOut",
    "ServiceTokenCreated",
    "ServiceTokenOut",
]
