"""Single source of truth for integration configuration (Phase 2).

Where configuration comes from, in priority order:

1. the ``service_configs`` table - written by an admin through the web panel;
2. the environment (``AC_*`` / legacy ``N8N_*``) - what the installer or the
   hosting provider injected;
3. nothing -> the service reports ``not_configured``.

Storing it in the database is what makes the panel usable without a redeploy:
pasting an n8n URL + API key flips the monitor to ONLINE on the next probe
(<= 5 s) instead of requiring an env change and a restart. An untouched
env-only deployment behaves exactly as before, because the table starts empty.

Secrets NEVER leave this module in clear text: ``Resolved.secret`` is consumed
by the probes and the API clients, while everything that reaches a browser goes
through ``public_view()``, which emits only a ``secret_hint``.
"""
from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.config import get_settings
from app.core import crypto
from app.core.ssrf import BlockedRequestError, assert_not_metadata_url
from app.models import ServiceConfig

DATABASE = "database"
ENVIRONMENT = "environment"
NONE = "none"


@dataclass(frozen=True)
class ServiceSpec:
    """What a service needs before it can be considered configured."""

    key: str
    label: str
    needs_url: bool
    needs_secret: bool
    #: settings attribute holding the env-provided URL (if any)
    settings_url_attr: str | None = None
    #: settings attribute holding the env-provided secret (if any)
    settings_secret_attr: str | None = None
    #: env var name shown to the user when the service is unconfigured
    env_url_name: str = ""
    env_secret_name: str = ""
    #: default URL used when the caller supplies none (e.g. the Google API host)
    default_url: str = ""
    health_path: str = "/health"
    #: "infra" services get a generic card in Settings; "ai" ones are driven by
    #: the dedicated Artificial Intelligence panel, and "internal" ones hold
    #: platform state a user never edits as a URL + key pair.
    category: str = "infra"


SPECS: dict[str, ServiceSpec] = {
    "n8n": ServiceSpec(
        key="n8n",
        label="n8n",
        needs_url=True,
        needs_secret=True,
        settings_url_attr="n8n_base_url",
        settings_secret_attr="n8n_api_key",
        env_url_name="AC_N8N_BASE_URL",
        env_secret_name="AC_N8N_API_KEY",
        health_path="/healthz",
    ),
    "playwright": ServiceSpec(
        key="playwright",
        label="Playwright",
        needs_url=True,
        needs_secret=False,
        settings_url_attr="playwright_base_url",
        env_url_name="AC_PLAYWRIGHT_BASE_URL",
        health_path="/health",
    ),
    # --- AI providers. One row each, holding only that provider's credential
    # and endpoint. Which of them is actually used is a separate decision,
    # stored on the "ai" row below and resolved by `services.ai.config`.
    "nvidia_nim": ServiceSpec(
        key="nvidia_nim",
        label="NVIDIA NIM",
        needs_url=False,
        needs_secret=True,
        settings_url_attr="nvidia_nim_base_url",
        settings_secret_attr="nvidia_nim_api_key",
        env_url_name="AC_NVIDIA_NIM_BASE_URL",
        env_secret_name="AC_NVIDIA_NIM_API_KEY",
        default_url="https://integrate.api.nvidia.com/v1",
        category="ai",
    ),
    "openrouter": ServiceSpec(
        key="openrouter",
        label="OpenRouter",
        needs_url=False,
        needs_secret=True,
        settings_url_attr="openrouter_base_url",
        settings_secret_attr="openrouter_api_key",
        env_url_name="AC_OPENROUTER_BASE_URL",
        env_secret_name="AC_OPENROUTER_API_KEY",
        default_url="https://openrouter.ai/api/v1",
        category="ai",
    ),
    "gemini": ServiceSpec(
        key="gemini",
        label="Gemini",
        needs_url=False,
        needs_secret=True,
        settings_url_attr="gemini_base_url",
        settings_secret_attr="gemini_api_key",
        env_url_name="AC_GEMINI_BASE_URL",
        env_secret_name="AC_GEMINI_API_KEY",
        default_url="https://generativelanguage.googleapis.com",
        category="ai",
    ),
    # --- OAuth apps. Admin-owned: the client secret is the encrypted secret,
    # the client id lives in `meta.client_id`. Users never see these; they
    # only "Sign in with Google". See services/integrations.
    "google_oauth": ServiceSpec(
        key="google_oauth", label="Google OAuth app", needs_url=False, needs_secret=True,
        settings_secret_attr="google_oauth_client_secret", env_secret_name="AC_GOOGLE_OAUTH_CLIENT_SECRET",
        category="oauth",
    ),
    "microsoft_oauth": ServiceSpec(
        key="microsoft_oauth", label="Microsoft OAuth app", needs_url=False, needs_secret=True,
        settings_secret_attr="microsoft_oauth_client_secret", env_secret_name="AC_MICROSOFT_OAUTH_CLIENT_SECRET",
        category="oauth",
    ),
    "github_oauth": ServiceSpec(
        key="github_oauth", label="GitHub OAuth app", needs_url=False, needs_secret=True,
        settings_secret_attr="github_oauth_client_secret", env_secret_name="AC_GITHUB_OAUTH_CLIENT_SECRET",
        category="oauth",
    ),
    # Not a service to reach: this row carries the AI *selection* (provider,
    # model, fallback) in `meta` and the automation service token in
    # `encrypted_secret`. It never appears as a card or a monitor tile.
    "ai": ServiceSpec(
        key="ai",
        label="Artificial Intelligence",
        needs_url=False,
        needs_secret=False,
        category="internal",
    ),
}

#: services a user may configure from the panel
CONFIGURABLE = tuple(SPECS)

#: services rendered as a generic URL + key card in Settings
INFRA_SERVICES = tuple(k for k, s in SPECS.items() if s.category == "infra")
#: services owned by the Artificial Intelligence panel
AI_SERVICES = tuple(k for k, s in SPECS.items() if s.category == "ai")


@dataclass
class Resolved:
    spec: ServiceSpec
    base_url: str
    secret: str
    source: str
    enabled: bool
    secret_hint: str
    meta: dict = field(default_factory=dict)
    last_tested_at: dt.datetime | None = None
    last_test_ok: bool | None = None
    last_test_detail: str = ""

    @property
    def service(self) -> str:
        return self.spec.key

    @property
    def configured(self) -> bool:
        """True only when everything the service actually needs is present."""
        if not self.enabled:
            return False
        if self.spec.needs_url and not self.base_url:
            return False
        if self.spec.needs_secret and not self.secret:
            return False
        return True

    @property
    def missing(self) -> list[str]:
        """What is still missing, in human terms. Never contains a value."""
        out: list[str] = []
        if self.spec.needs_url and not self.base_url:
            out.append(self.spec.env_url_name or f"{self.spec.label} URL")
        if self.spec.needs_secret and not self.secret:
            out.append(self.spec.env_secret_name or f"{self.spec.label} API key")
        return out


def _hint(secret: str) -> str:
    if not secret:
        return ""
    return f"...{secret[-4:]}" if len(secret) > 4 else "..."


def _env_value(attr: str | None) -> str:
    if not attr:
        return ""
    return str(getattr(get_settings(), attr, "") or "").strip()


def _row(db: Session, service: str) -> ServiceConfig | None:
    return db.get(ServiceConfig, service)


def _decrypt(row: ServiceConfig) -> str:
    """Best-effort decryption. A key mismatch must degrade to "no secret",
    never crash a health probe.
    """
    if not row.encrypted_secret:
        return ""
    try:
        return str(crypto.decrypt_secret(row.encrypted_secret).get("secret", "") or "")
    except (crypto.CipherNotConfigured, crypto.DecryptionError):
        return ""


def resolve(db: Session | None, service: str) -> Resolved:
    """Effective configuration for one service: database first, env second."""
    spec = SPECS[service]
    env_url = _env_value(spec.settings_url_attr) or spec.default_url
    env_secret = _env_value(spec.settings_secret_attr)

    row = _row(db, service) if db is not None else None
    if row is not None:
        db_secret = _decrypt(row)
        base_url = (row.base_url or "").strip() or env_url
        secret = db_secret or env_secret
        # "database" only when the row actually contributed something
        if row.base_url or db_secret:
            source = DATABASE
        elif env_url or env_secret:
            source = ENVIRONMENT
        else:
            source = NONE
        return Resolved(
            spec=spec,
            base_url=base_url.rstrip("/"),
            secret=secret,
            source=source,
            enabled=bool(row.is_enabled),
            secret_hint=row.secret_hint or _hint(secret),
            meta=dict(row.meta or {}),
            last_tested_at=row.last_tested_at,
            last_test_ok=row.last_test_ok,
            last_test_detail=row.last_test_detail or "",
        )

    source = ENVIRONMENT if (env_url or env_secret) else NONE
    return Resolved(
        spec=spec,
        base_url=env_url.rstrip("/"),
        secret=env_secret,
        source=source,
        enabled=True,
        secret_hint=_hint(env_secret),
    )


def resolve_all(db: Session | None) -> dict[str, Resolved]:
    return {name: resolve(db, name) for name in CONFIGURABLE}


def public_view(r: Resolved) -> dict:
    """Browser-safe projection. Contains no secret, only a hint."""
    return {
        "service": r.service,
        "label": r.spec.label,
        "category": r.spec.category,
        "configured": r.configured,
        "enabled": r.enabled,
        "source": r.source,
        "base_url": r.base_url,
        "requires_url": r.spec.needs_url,
        "requires_secret": r.spec.needs_secret,
        "secret_configured": bool(r.secret),
        "secret_hint": r.secret_hint,
        "missing": r.missing,
        "last_tested_at": r.last_tested_at.isoformat() if r.last_tested_at else None,
        "last_test_ok": r.last_test_ok,
        "last_test_detail": r.last_test_detail,
    }


class ServiceConfigError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def upsert(
    db: Session,
    service: str,
    *,
    base_url: str | None = None,
    secret: str | None = None,
    clear_secret: bool = False,
    enabled: bool | None = None,
    meta: dict | None = None,
    actor_id: uuid.UUID | None = None,
) -> Resolved:
    """Create or update one service configuration.

    ``secret=None`` leaves any stored secret untouched (so the panel can save a
    URL change without the user re-typing the key). ``clear_secret=True``
    removes it. Storing a secret requires the master encryption key.
    """
    if service not in SPECS:
        raise ServiceConfigError(f"unknown service: {service}", 404)

    row = _row(db, service)
    if row is None:
        row = ServiceConfig(service=service, base_url="", meta={})
        db.add(row)

    if base_url is not None:
        url = base_url.strip().rstrip("/")
        if url and not url.startswith(("http://", "https://")):
            raise ServiceConfigError("base_url must start with http:// or https://")
        if url:
            # Private addresses are legitimate here (a Docker sidecar, a Render
            # private service), so this only refuses cloud metadata endpoints -
            # nothing that could ever be a real service.
            try:
                assert_not_metadata_url(url)
            except BlockedRequestError as exc:
                raise ServiceConfigError(str(exc)) from exc
        row.base_url = url

    if clear_secret:
        row.encrypted_secret = None
        row.secret_hint = ""
    elif secret is not None:
        cleaned = secret.strip()
        if cleaned:
            if not crypto.is_configured():
                raise ServiceConfigError(
                    "AC_CREDENTIAL_ENCRYPTION_KEY is not set; cannot store a secret", 503
                )
            row.encrypted_secret = crypto.encrypt_secret({"secret": cleaned})
            row.secret_hint = _hint(cleaned)
        else:
            row.encrypted_secret = None
            row.secret_hint = ""

    if enabled is not None:
        row.is_enabled = bool(enabled)
    if meta is not None:
        row.meta = meta
    row.updated_by = actor_id

    db.commit()
    db.refresh(row)
    return resolve(db, service)


def record_test(db: Session, service: str, *, ok: bool, detail: str) -> None:
    """Persist the outcome of a real connection test (no secret in ``detail``)."""
    row = _row(db, service)
    if row is None:
        row = ServiceConfig(service=service, base_url="", meta={})
        db.add(row)
    row.last_tested_at = dt.datetime.now(dt.timezone.utc)
    row.last_test_ok = bool(ok)
    row.last_test_detail = (detail or "")[:500]
    db.commit()


def env_only_snapshot() -> dict[str, Resolved]:
    """Resolution with no database access - used by the installer pre-flight and
    by callers that must not open a session.
    """
    return {name: resolve(None, name) for name in CONFIGURABLE}


def has_any_configuration(db: Session | None) -> bool:
    return any(r.configured for r in resolve_all(db).values())


__all__ = [
    "AI_SERVICES",
    "CONFIGURABLE",
    "DATABASE",
    "INFRA_SERVICES",
    "ENVIRONMENT",
    "NONE",
    "Resolved",
    "ServiceConfigError",
    "ServiceSpec",
    "SPECS",
    "env_only_snapshot",
    "has_any_configuration",
    "public_view",
    "record_test",
    "resolve",
    "resolve_all",
    "upsert",
]
