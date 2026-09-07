"""Application settings, loaded from environment variables.

Every value that matters for a deployment comes from the environment (the web
control plane / installer writes them into `.env`). Nothing here is a secret
literal; placeholders are inert and rejected by `validate_runtime()`.
"""
from __future__ import annotations

import functools
from typing import Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "testing", "staging", "production"]

_PLACEHOLDER_MARKERS = ("CAMBIA", "PEGA_AQUI", "PLACEHOLDER", "CHANGE_ME")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AC_",
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        # Several fields carry a `validation_alias` so they also accept the
        # short legacy names (GEMINI_API_KEY, N8N_API_URL...). Without this,
        # constructing Settings(field_name=...) in a test would silently fall
        # back to the environment instead of the value passed in.
        populate_by_name=True,
    )

    environment: Environment = "development"
    debug: bool = False

    # --- API ---
    api_host: str = "0.0.0.0"
    api_port: int = 8080
    # Comma-separated list of allowed browser origins (the frontend).
    cors_origins: str = "http://localhost:3000"
    # Optional regex for allowed origins, used for Vercel preview deployments
    # e.g. r"https://automation-center-[a-z0-9-]+\.vercel\.app". Empty = disabled.
    # Keep this scoped to your own project; never use ".*".
    cors_origin_regex: str = ""

    # --- Database (Automation Center's own DB, separate from n8n's) ---
    database_url: str = "postgresql+psycopg://automation:automation@localhost:5432/automation_center"

    # --- Auth ---
    jwt_secret: str = "dev-only-insecure-change-me"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 14
    # Open registration: the first account always becomes admin. When locked
    # (installer does this after creating the admin), only admins create users.
    allow_open_registration: bool = True
    # Rate limits (slowapi syntax). Auth endpoints get the stricter one.
    rate_limit_auth: str = "10/minute"
    rate_limit_default: str = "120/minute"
    # Comma-separated CIDRs of reverse proxies we trust to set X-Forwarded-For.
    # Empty (default) = the backend is treated as directly exposed and the
    # X-Forwarded-For header is ignored for rate-limiting (it is client-spoofable).
    # Desktop install: leave empty. Behind nginx/Traefik on the same host:
    # "127.0.0.1/32,::1/128". Behind a cloud LB: that LB's egress range.
    trusted_proxies: str = ""
    # Password policy.
    password_min_length: int = 10

    # --- Credential encryption (phase 6). 32 url-safe base64 bytes = Fernet key. ---
    credential_encryption_key: str = ""

    # --- n8n integration ---
    # Also honours the plain N8N_API_URL / N8N_API_KEY names already in .env.
    n8n_base_url: str = Field(
        default="http://n8n:5678",
        validation_alias=AliasChoices("AC_N8N_BASE_URL", "N8N_API_URL", "N8N_URL"),
    )
    n8n_api_key: str = Field(
        default="", validation_alias=AliasChoices("AC_N8N_API_KEY", "N8N_API_KEY")
    )

    # --- AI providers -------------------------------------------------------
    # Nothing here is required: the panel writes the same settings into the
    # `service_configs` table, which wins over the environment. These values are
    # the installer / hosting fallback and keep existing deployments working.
    #
    # Selection. Empty `ai_provider` means "decide automatically": the first
    # provider (in registry preference order NVIDIA NIM -> OpenRouter -> Gemini)
    # that actually has a credential. That is what keeps a pre-existing
    # Gemini-only install running with no configuration change.
    ai_provider: str = Field(default="", validation_alias=AliasChoices("AC_AI_PROVIDER", "AI_PROVIDER"))
    ai_model: str = Field(default="", validation_alias=AliasChoices("AC_AI_MODEL", "AI_MODEL"))
    ai_temperature: float = 0.2
    ai_max_tokens: int = 2048
    ai_timeout_seconds: float = 60.0
    ai_fallback_enabled: bool = True
    ai_fallback_provider: str = Field(
        default="", validation_alias=AliasChoices("AC_AI_FALLBACK_PROVIDER", "AI_FALLBACK_PROVIDER")
    )
    ai_fallback_model: str = Field(
        default="", validation_alias=AliasChoices("AC_AI_FALLBACK_MODEL", "AI_FALLBACK_MODEL")
    )
    # How long a successful live provider verification is trusted before the
    # monitor calls it again. The monitor loop ticks every few seconds;
    # re-validating a key that often would waste provider quota.
    ai_verify_ttl_seconds: float = 300.0
    # How long a fetched model list is cached (the list changes rarely).
    ai_models_ttl_seconds: float = 900.0
    # Shared secret an automation (n8n) presents to POST /api/ai/generate.
    # Normally generated from the panel and stored encrypted in the database;
    # this is only the environment fallback.
    ai_service_token: str = Field(
        default="", validation_alias=AliasChoices("AC_AI_SERVICE_TOKEN", "AI_SERVICE_TOKEN")
    )

    # NVIDIA NIM (primary). The base URL is configuration, not a constant: a
    # self-hosted NIM container answers the same API on its own host.
    nvidia_nim_api_key: str = Field(
        default="", validation_alias=AliasChoices("AC_NVIDIA_NIM_API_KEY", "NVIDIA_NIM_API_KEY")
    )
    nvidia_nim_base_url: str = Field(
        default="", validation_alias=AliasChoices("AC_NVIDIA_NIM_BASE_URL", "NVIDIA_NIM_BASE_URL")
    )
    nvidia_nim_model: str = Field(
        default="", validation_alias=AliasChoices("AC_NVIDIA_NIM_MODEL", "NVIDIA_NIM_MODEL")
    )

    # OpenRouter (fallback).
    openrouter_api_key: str = Field(
        default="", validation_alias=AliasChoices("AC_OPENROUTER_API_KEY", "OPENROUTER_API_KEY")
    )
    openrouter_base_url: str = Field(
        default="", validation_alias=AliasChoices("AC_OPENROUTER_BASE_URL", "OPENROUTER_BASE_URL")
    )
    openrouter_model: str = Field(
        default="", validation_alias=AliasChoices("AC_OPENROUTER_MODEL", "OPENROUTER_MODEL")
    )

    # Gemini (optional). Also honours the plain GEMINI_API_KEY name the
    # workflows have always used, so no existing `.env` has to change.
    gemini_api_key: str = Field(
        default="", validation_alias=AliasChoices("AC_GEMINI_API_KEY", "GEMINI_API_KEY")
    )
    gemini_base_url: str = Field(
        default="", validation_alias=AliasChoices("AC_GEMINI_BASE_URL", "GEMINI_BASE_URL")
    )
    gemini_model: str = Field(
        default="gemini-2.5-flash",
        validation_alias=AliasChoices("AC_GEMINI_MODEL", "GEMINI_MODEL"),
    )
    # Deprecated alias of `ai_verify_ttl_seconds`, kept so an existing `.env`
    # carrying AC_GEMINI_VERIFY_TTL_SECONDS still loads.
    gemini_verify_ttl_seconds: float = 300.0

    # --- Optional sidecar services ---
    # Empty = not deployed in this environment -> the monitor reports
    # NOT_CONFIGURED instead of OFFLINE. Docker Compose sets this to the
    # in-network hostname; a stand-alone backend deploy leaves it unset.
    #
    # These are only the DEFAULT: `services.service_config` prefers the
    # `service_configs` table, which the web panel writes, so a user can change
    # the endpoint without an env edit or a redeploy.
    playwright_base_url: str = Field(
        default="", validation_alias=AliasChoices("AC_PLAYWRIGHT_BASE_URL", "PLAYWRIGHT_BASE_URL")
    )
    # Deprecated. The `profile` container is a local helper that maintains
    # config/user_profile.json for the n8n Code nodes; it is NOT what the
    # monitor means by PROFILE. Since v0.5 that state is computed from the
    # `profiles` table (see services/profiles.any_complete_profile), because a
    # reachable sidecar said nothing about whether usable profile data existed.
    # Kept so an existing .env with this key still loads.
    profile_base_url: str = ""

    # --- Monitoring ---
    monitor_interval_seconds: float = 5.0
    compose_project: str = "personal-assistant"

    @field_validator("cors_origins")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("database_url")
    @classmethod
    def _normalize_db_url(cls, v: str) -> str:
        """Pin the psycopg (v3) dialect.

        Managed Postgres providers (Render, Neon, Supabase, RDS) hand out a
        driver-less ``postgres://`` / ``postgresql://`` URL. SQLAlchemy would
        then default to psycopg2, which this backend does not ship. Rewrite the
        scheme so ``fromDatabase`` wiring works with no manual edit.
        """
        v = v.strip()
        if v.startswith("postgresql+") or v.startswith("sqlite"):
            return v
        if v.startswith("postgresql://"):
            return "postgresql+psycopg://" + v[len("postgresql://") :]
        if v.startswith("postgres://"):
            return "postgresql+psycopg://" + v[len("postgres://") :]
        return v

    @property
    def trusted_proxy_networks(self) -> list:
        import ipaddress

        nets = []
        for token in self.trusted_proxies.split(","):
            token = token.strip()
            if not token:
                continue
            try:
                nets.append(ipaddress.ip_network(token, strict=False))
            except ValueError:
                continue
        return nets

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def cors_origin_regex_or_none(self) -> str | None:
        return self.cors_origin_regex.strip() or None

    @property
    def is_production(self) -> bool:
        return self.environment in ("staging", "production")

    def validate_runtime(self) -> list[str]:
        """Return a list of human-readable problems that block a real deployment.

        Empty list == safe to serve. The installer surfaces these as BLOCKED BY.
        """
        problems: list[str] = []

        def looks_placeholder(value: str) -> bool:
            return (not value) or any(m in value for m in _PLACEHOLDER_MARKERS)

        if self.is_production:
            if looks_placeholder(self.jwt_secret) or self.jwt_secret == "dev-only-insecure-change-me":
                problems.append("AC_JWT_SECRET is unset or a placeholder")
            if len(self.jwt_secret) < 32:
                problems.append("AC_JWT_SECRET must be at least 32 characters")
            if looks_placeholder(self.credential_encryption_key):
                problems.append("AC_CREDENTIAL_ENCRYPTION_KEY is unset (needed to store credentials)")
            if self.debug:
                problems.append("AC_DEBUG must be false in production")
            # The API sends Allow-Credentials: true, so a wildcard origin is
            # rejected by every browser anyway. Failing here turns a confusing
            # "CORS is broken" into a message that names the cause.
            if "*" in self.cors_origin_list:
                problems.append(
                    "AC_CORS_ORIGINS cannot be '*' when credentials are allowed; "
                    "list the exact frontend origin(s)"
                )
            if not self.cors_origin_list and not self.cors_origin_regex.strip():
                problems.append("AC_CORS_ORIGINS is empty; no browser origin can reach the API")
            # A regex that matches everything re-opens the hole the check above
            # closes, so refuse the obvious catch-alls.
            if self.cors_origin_regex.strip() in (".*", "^.*$", ".+"):
                problems.append("AC_CORS_ORIGIN_REGEX is a catch-all; scope it to your own domain")
        if looks_placeholder(self.database_url):
            problems.append("AC_DATABASE_URL is unset or a placeholder")
        return problems


@functools.lru_cache
def get_settings() -> Settings:
    return Settings()
