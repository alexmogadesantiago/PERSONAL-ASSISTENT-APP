"""Effective AI configuration: which provider, which model, what fallback.

Resolution order is the platform's existing one, unchanged:

    ``service_configs`` table  ->  environment  ->  built-in default

The credentials live in one ``service_configs`` row per provider (encrypted with
the same master key as every other secret - no second secret system), and the
*selection* lives in the ``meta`` of the ``ai`` row. Nothing new was added to the
schema, so no migration is required and an untouched deployment keeps working.

When no selection has ever been made, the provider is chosen automatically: the
first one in registry preference order that actually holds a credential. That is
what keeps a pre-existing ``GEMINI_API_KEY``-only installation running after this
migration without anybody editing anything.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.config import get_settings
from app.services import service_config as svc
from app.services.ai import registry
from app.services.ai.base import AIProvider

DATABASE = svc.DATABASE
ENVIRONMENT = svc.ENVIRONMENT
DEFAULT = "default"

#: what an admin may store on the "ai" row
SETTING_KEYS = (
    "provider",
    "model",
    "fallback_enabled",
    "fallback_provider",
    "fallback_model",
    "temperature",
    "max_tokens",
    "timeout_seconds",
)


@dataclass
class ProviderCredentials:
    """One provider's endpoint + credential, already resolved."""

    provider: str
    label: str
    api_key: str
    base_url: str
    model: str
    source: str
    enabled: bool
    secret_hint: str

    @property
    def configured(self) -> bool:
        return bool(self.enabled and self.api_key and self.base_url)

    def public_view(self) -> dict:
        """Browser-safe. Carries no key - only whether one is stored."""
        return {
            "provider": self.provider,
            "label": self.label,
            "configured": self.configured,
            "enabled": self.enabled,
            "source": self.source,
            "base_url": self.base_url,
            "model": self.model,
            "secret_configured": bool(self.api_key),
            "secret_hint": self.secret_hint,
        }


@dataclass
class AIConfig:
    provider: str
    model: str
    fallback_enabled: bool
    fallback_provider: str
    fallback_model: str
    temperature: float
    max_tokens: int
    timeout_seconds: float
    #: where the *selection* came from: database | environment | default
    source: str
    providers: dict[str, ProviderCredentials] = field(default_factory=dict)

    @property
    def configured(self) -> bool:
        creds = self.providers.get(self.provider)
        return bool(self.provider and creds is not None and creds.configured)

    @property
    def effective_fallback(self) -> str:
        """The fallback that would actually be used, or "" if there is none."""
        if not self.fallback_enabled or not self.fallback_provider:
            return ""
        if self.fallback_provider == self.provider:
            return ""
        creds = self.providers.get(self.fallback_provider)
        return self.fallback_provider if creds is not None and creds.configured else ""

    @property
    def missing(self) -> list[str]:
        if not self.provider:
            return ["an AI provider (none is configured)"]
        if self.configured:
            return []
        return [registry.meta(self.provider).label + " API key"]

    def build(self, provider: str, *, model: str = "") -> AIProvider | None:
        """Instantiate one provider client, or None when it has no credential."""
        creds = self.providers.get(provider)
        if creds is None or not creds.configured:
            return None
        return registry.meta(provider).cls(
            api_key=creds.api_key,
            base_url=creds.base_url,
            model=model or creds.model,
            timeout=self.timeout_seconds,
        )

    def public_view(self) -> dict:
        """Everything the panel needs and nothing it must not have."""
        return {
            "provider": self.provider,
            "model": self.model,
            "fallback_enabled": self.fallback_enabled,
            "fallback_provider": self.fallback_provider,
            "fallback_model": self.fallback_model,
            "effective_fallback_provider": self.effective_fallback,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "timeout_seconds": self.timeout_seconds,
            "source": self.source,
            "configured": self.configured,
            "missing": self.missing,
            "providers": [
                self.providers[p].public_view()
                for p in registry.PROVIDER_IDS
                if p in self.providers
            ],
        }


# ------------------------------------------------------------- resolution --


def _provider_credentials(db: Session | None, provider: str) -> ProviderCredentials:
    pmeta = registry.meta(provider)
    resolved = svc.resolve(db, pmeta.service_key)
    settings = get_settings()
    env_model_attr = {
        registry.NVIDIA_NIM: "nvidia_nim_model",
        registry.OPENROUTER: "openrouter_model",
        registry.GEMINI: "gemini_model",
    }[provider]
    model = (
        str(resolved.meta.get("model") or "").strip()
        or str(getattr(settings, env_model_attr, "") or "").strip()
        or pmeta.default_model
    )
    return ProviderCredentials(
        provider=provider,
        label=pmeta.label,
        api_key=resolved.secret,
        base_url=resolved.base_url or pmeta.default_base_url,
        model=model,
        source=resolved.source,
        enabled=resolved.enabled,
        secret_hint=resolved.secret_hint,
    )


def _stored_settings(db: Session | None) -> tuple[dict, bool]:
    """The ``meta`` of the ``ai`` row, plus whether that row exists at all."""
    resolved = svc.resolve(db, registry.AI_SETTINGS_KEY)
    meta = {k: v for k, v in (resolved.meta or {}).items() if k in SETTING_KEYS}
    return meta, resolved.source == svc.DATABASE or bool(meta)


def _as_bool(value: object, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return default


def _first_configured(providers: dict[str, ProviderCredentials]) -> str:
    for pid in registry.PROVIDER_IDS:
        creds = providers.get(pid)
        if creds is not None and creds.configured:
            return pid
    return ""


def _auto_fallback(primary: str, providers: dict[str, ProviderCredentials]) -> str:
    for pid in registry.PROVIDER_IDS:
        if pid == primary:
            continue
        creds = providers.get(pid)
        if creds is not None and creds.configured:
            return pid
    return ""


def resolve(db: Session | None) -> AIConfig:
    """Effective AI configuration. Never raises - an unusable configuration is
    reported through ``configured`` / ``missing``, not through an exception."""
    settings = get_settings()
    providers = {pid: _provider_credentials(db, pid) for pid in registry.PROVIDER_IDS}
    stored, from_db = _stored_settings(db)

    env_provider = (settings.ai_provider or "").strip().lower()
    db_provider = str(stored.get("provider") or "").strip().lower()

    if db_provider and registry.is_known(db_provider):
        provider, source = db_provider, DATABASE
    elif env_provider and registry.is_known(env_provider):
        provider, source = env_provider, ENVIRONMENT
    else:
        # Nobody chose: use whichever provider actually has a credential, in
        # preference order. This is what keeps existing installs running.
        provider, source = _first_configured(providers), DEFAULT

    if provider:
        default_model = providers[provider].model
        model = str(stored.get("model") or "").strip() if source == DATABASE else ""
        if not model and settings.ai_model and source != DATABASE:
            model = settings.ai_model.strip()
        model = model or default_model
    else:
        model = ""

    fallback_enabled = _as_bool(
        stored.get("fallback_enabled") if from_db else None, settings.ai_fallback_enabled
    )
    fallback_provider = str(
        stored.get("fallback_provider")
        if from_db and stored.get("fallback_provider") is not None
        else settings.ai_fallback_provider
        or ""
    ).strip().lower()
    if fallback_provider and not registry.is_known(fallback_provider):
        fallback_provider = ""
    if not fallback_provider and fallback_enabled and provider:
        fallback_provider = _auto_fallback(provider, providers)

    fallback_model = str(
        stored.get("fallback_model")
        if from_db and stored.get("fallback_model") is not None
        else settings.ai_fallback_model
        or ""
    ).strip()
    if fallback_provider and not fallback_model:
        fallback_model = providers[fallback_provider].model

    def _number(key: str, fallback: float) -> float:
        raw = stored.get(key)
        try:
            return float(raw) if raw is not None else float(fallback)
        except (TypeError, ValueError):
            return float(fallback)

    return AIConfig(
        provider=provider,
        model=model,
        fallback_enabled=fallback_enabled,
        fallback_provider=fallback_provider,
        fallback_model=fallback_model,
        temperature=_number("temperature", settings.ai_temperature),
        max_tokens=int(_number("max_tokens", settings.ai_max_tokens)),
        timeout_seconds=_number("timeout_seconds", settings.ai_timeout_seconds),
        source=source,
        providers=providers,
    )


class AIConfigError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def save(db: Session, changes: dict, *, actor_id: uuid.UUID | None = None) -> AIConfig:
    """Persist the AI selection on the ``ai`` row. Only known keys are stored."""
    current, _ = _stored_settings(db)
    meta = dict(current)

    for key in ("provider", "fallback_provider"):
        if key in changes and changes[key] is not None:
            value = str(changes[key]).strip().lower()
            if value and not registry.is_known(value):
                raise AIConfigError(f"unknown AI provider: {value}", 400)
            meta[key] = value

    if changes.get("model") is not None:
        meta["model"] = str(changes["model"]).strip()
    if changes.get("fallback_model") is not None:
        meta["fallback_model"] = str(changes["fallback_model"]).strip()
    if changes.get("fallback_enabled") is not None:
        meta["fallback_enabled"] = bool(changes["fallback_enabled"])

    if changes.get("temperature") is not None:
        temperature = float(changes["temperature"])
        if not 0.0 <= temperature <= 2.0:
            raise AIConfigError("temperature must be between 0 and 2", 400)
        meta["temperature"] = temperature
    if changes.get("max_tokens") is not None:
        max_tokens = int(changes["max_tokens"])
        if not 1 <= max_tokens <= 200_000:
            raise AIConfigError("max_tokens must be between 1 and 200000", 400)
        meta["max_tokens"] = max_tokens
    if changes.get("timeout_seconds") is not None:
        timeout = float(changes["timeout_seconds"])
        if not 1.0 <= timeout <= 600.0:
            raise AIConfigError("timeout_seconds must be between 1 and 600", 400)
        meta["timeout_seconds"] = timeout

    svc.upsert(db, registry.AI_SETTINGS_KEY, meta=meta, actor_id=actor_id)
    return resolve(db)


__all__ = [
    "AIConfig",
    "AIConfigError",
    "DATABASE",
    "DEFAULT",
    "ENVIRONMENT",
    "ProviderCredentials",
    "resolve",
    "save",
]
