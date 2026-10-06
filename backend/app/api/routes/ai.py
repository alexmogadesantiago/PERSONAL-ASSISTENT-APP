"""Artificial Intelligence API.

Two audiences:

* the web panel - reads the provider catalogue, saves the selection and the
  credentials, lists models and runs a real connection test. Reads need any
  signed-in user; writes and tests are admin-only, because both change what the
  backend connects to and make it originate outbound requests.
* the automations - ``POST /api/ai/generate`` is the single door n8n uses. It
  authenticates with the shared service token (see ``services.ai.token``) or a
  normal user session, and it never reveals which provider is configured until
  after the call succeeds.

No response here contains an API key. The provider views carry
``secret_configured`` and a four-character hint; the one exception is the
service-token rotation endpoint, which must show its own freshly generated token
once so it can be pasted into n8n.
"""
from __future__ import annotations

import datetime as dt
import uuid

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.security import decode_access_token
from app.db import get_db
from app.models import EventSeverity, User, UserStatus
from app.schemas.ai import (
    AIConfigOut,
    AIConfigUpdate,
    AIHealthOut,
    AITestRequest,
    AITestResult,
    GenerateRequest,
    GenerateResponse,
    ModelListOut,
    ProviderInfo,
    ProviderListOut,
    ServiceTokenCreated,
    ServiceTokenOut,
)
from app.services import audit
from app.services import service_config as svc
from app.services.ai import config as ai_config
from app.services.ai import registry
from app.services.ai import token as ai_token
from app.services.ai.errors import AIAuthError, AIBadRequest, AIError, AINotConfigured
from app.services.ai.service import AIService, recent_fallback, reset_caches

router = APIRouter(prefix="/ai", tags=["ai"])

#: header an automation presents instead of a user session
SERVICE_TOKEN_HEADER = "x-ac-service-token"


def _cid(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _known(provider: str) -> None:
    if not registry.is_known(provider):
        raise HTTPException(
            status_code=404,
            detail=f"unknown provider '{provider}' (known: {', '.join(registry.PROVIDER_IDS)})",
        )


def _config_payload(db: Session) -> dict:
    payload = ai_config.resolve(db).public_view()
    payload["service_token"] = ai_token.status(db)
    return payload


# ------------------------------------------------------------- catalogue --


@router.get("/providers", response_model=ProviderListOut)
def list_providers(
    _: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ProviderListOut:
    """Every provider the platform can use, with its current configuration state."""
    cfg = ai_config.resolve(db)
    rows: list[ProviderInfo] = []
    for pid in registry.PROVIDER_IDS:
        pmeta = registry.meta(pid)
        creds = cfg.providers[pid]
        rows.append(
            ProviderInfo(
                id=pid,
                label=pmeta.label,
                tagline=pmeta.tagline,
                recommended=pmeta.recommended,
                api_style=pmeta.api_style,
                default_base_url=pmeta.default_base_url,
                default_model=pmeta.default_model,
                key_help=pmeta.key_help,
                console_url=pmeta.console_url,
                service_key=pmeta.service_key,
                configured=creds.configured,
                secret_configured=bool(creds.api_key),
                secret_hint=creds.secret_hint,
                base_url=creds.base_url,
                model=creds.model,
                source=creds.source,
            )
        )
    return ProviderListOut(data=rows)


# ---------------------------------------------------------- configuration --


@router.get("/config", response_model=AIConfigOut)
def get_config(_: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AIConfigOut:
    return AIConfigOut.model_validate(_config_payload(db))


@router.put("/config", response_model=AIConfigOut)
def update_config(
    body: AIConfigUpdate,
    request: Request,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AIConfigOut:
    """Store the AI selection, and optionally the provider credentials with it.

    Credentials go through the existing ``service_configs`` writer, so they are
    encrypted with the same master key as every other secret - this endpoint
    adds no second secret store.
    """
    for credential in body.credentials:
        _known(credential.provider)
        pmeta = registry.meta(credential.provider)
        meta_update = None
        if credential.model is not None:
            current = svc.resolve(db, pmeta.service_key)
            meta_update = {**(current.meta or {}), "model": credential.model.strip()}
        try:
            svc.upsert(
                db,
                pmeta.service_key,
                base_url=credential.base_url,
                secret=credential.api_key,
                clear_secret=credential.clear_api_key,
                enabled=credential.enabled,
                meta=meta_update,
                actor_id=user.id,
            )
        except svc.ServiceConfigError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.message)

    changes = body.model_dump(exclude_unset=True, exclude={"credentials"})
    try:
        ai_config.save(db, changes, actor_id=user.id)
    except ai_config.AIConfigError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    except svc.ServiceConfigError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    # A configuration change invalidates every memoised provider verdict.
    reset_caches()

    resolved = ai_config.resolve(db)
    audit.record(
        db,
        type="ai.config.update",
        message=f"AI configuration updated: provider={resolved.provider or 'none'}",
        actor_id=user.id,
        correlation_id=_cid(request),
        meta={
            "provider": resolved.provider,
            "model": resolved.model,
            "fallback_provider": resolved.effective_fallback,
            "credentials_changed": [c.provider for c in body.credentials],
        },
    )
    return AIConfigOut.model_validate(_config_payload(db))


# --------------------------------------------------------------- models ---


@router.get("/models", response_model=ModelListOut)
async def list_models(
    provider: str | None = None,
    refresh: bool = False,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ModelListOut:
    """Models available for a provider.

    Asks the provider itself whenever it can; falls back to the maintained
    catalogue and says so, rather than presenting a stale guess as live data.
    """
    service = AIService.from_db(db)
    target = (provider or service.config.provider or registry.PROVIDER_IDS[0]).strip().lower()
    _known(target)
    models = await service.list_models(target, force=refresh)
    live = bool(models) and all(m.source == "live" for m in models)
    if not live:
        detail = "the provider did not answer; showing the maintained catalogue"
    elif target == registry.NVIDIA_NIM:
        # Verified against the live endpoint: NIM's /models is a catalogue of
        # what exists, not of what this account may invoke - several entries
        # answer HTTP 404 on /chat/completions. Say so, rather than let someone
        # pick a dead model and discover it when an automation runs.
        detail = (
            "listed by the provider. Not every entry is available on every "
            "account - use Test connection to confirm the one you pick."
        )
    else:
        detail = ""
    return ModelListOut(
        provider=target, live=live, detail=detail, data=[m.as_dict() for m in models]
    )


# ----------------------------------------------------------------- test ---


@router.post("/test", response_model=AITestResult)
async def test_provider(
    body: AITestRequest,
    request: Request,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AITestResult:
    """Run a real generation against the provider. No mock, no fake success."""
    service = AIService.from_db(db)
    target = (body.provider or service.config.provider or "").strip().lower()
    if target:
        _known(target)
    try:
        result = await service.test(provider=target, model=(body.model or "").strip())
        status, ok, detail = "online", True, result["detail"]
        model, latency = result["model"], result["latency_ms"]
        target = result["provider"]
    except AINotConfigured as exc:
        status, ok, detail, model, latency = "not_configured", False, exc.message, "", None
    except (AIAuthError, AIBadRequest) as exc:
        status, ok, detail, model, latency = "invalid", False, exc.message, body.model or "", None
    except AIError as exc:
        status, ok, detail, model, latency = "offline", False, exc.message, body.model or "", None

    if target:
        pmeta = registry.meta(target)
        svc.record_test(db, pmeta.service_key, ok=ok, detail=detail)
    reset_caches()
    audit.record(
        db,
        type="ai.test",
        message=f"AI connection test ({target or 'none'}): {status}",
        severity=EventSeverity.info if ok else EventSeverity.warning,
        actor_id=user.id,
        correlation_id=_cid(request),
        meta={"provider": target, "status": status},
    )
    return AITestResult(
        ok=ok, provider=target, model=model, status=status, detail=detail, latency_ms=latency
    )


# --------------------------------------------------------------- health ---


@router.get("/health", response_model=AIHealthOut)
async def ai_health(
    force: bool = False,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AIHealthOut:
    health = await AIService.from_db(db).health(force=force)
    payload = health.as_dict()
    payload["checked_at"] = _now_iso()
    # Whether a generation actually fell back is a different question from
    # whether the primary answers right now; report both.
    payload["last_fallback"] = recent_fallback(db)
    return AIHealthOut.model_validate(payload)


# -------------------------------------------------------- service token ---


@router.get("/service-token", response_model=ServiceTokenOut)
def service_token_status(
    _: User = Depends(require_admin), db: Session = Depends(get_db)
) -> ServiceTokenOut:
    return ServiceTokenOut.model_validate(ai_token.status(db))


@router.post("/service-token", response_model=ServiceTokenCreated)
def rotate_service_token(
    request: Request,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ServiceTokenCreated:
    """Generate a new automation token. Shown once, then only as a hint."""
    try:
        token = ai_token.rotate(db, actor_id=user.id)
    except svc.ServiceConfigError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)
    audit.record(
        db,
        type="ai.service_token.rotate",
        message="AI automation service token rotated",
        severity=EventSeverity.warning,
        actor_id=user.id,
        correlation_id=_cid(request),
    )
    return ServiceTokenCreated(token=token, hint=f"...{token[-4:]}")


@router.delete("/service-token", response_model=ServiceTokenOut)
def revoke_service_token(
    request: Request,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ServiceTokenOut:
    ai_token.revoke(db, actor_id=user.id)
    audit.record(
        db,
        type="ai.service_token.revoke",
        message="AI automation service token revoked",
        severity=EventSeverity.warning,
        actor_id=user.id,
        correlation_id=_cid(request),
    )
    return ServiceTokenOut.model_validate(ai_token.status(db))


# ------------------------------------------------------------- generate ---


def _authorise_generation(
    db: Session,
    service_token: str | None,
    authorization: str | None,
) -> str:
    """Either a valid service token or a normal user session.

    Returns a short actor label for the audit trail. The token comparison is
    constant-time (see ``services.ai.token.verify``), so a wrong token cannot be
    discovered one character at a time.
    """
    if service_token and ai_token.verify(db, service_token.strip()):
        return "automation"

    scheme, _, credentials = (authorization or "").partition(" ")
    if scheme.lower() == "bearer" and credentials:
        # Same validation the rest of the API uses, so an operator can try the
        # endpoint from a signed-in session without minting a machine token.
        try:
            payload = decode_access_token(credentials)
            user = db.get(User, uuid.UUID(payload["sub"]))
        except (jwt.InvalidTokenError, KeyError, ValueError):
            user = None
        if user is not None and user.status == UserStatus.active:
            return f"user:{user.username}"

    raise HTTPException(
        status_code=401,
        detail="an automation must present X-AC-Service-Token, or a user must send a bearer token",
    )


@router.post("/generate", response_model=GenerateResponse)
async def generate(
    body: GenerateRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_ac_service_token: str | None = Header(default=None, alias="X-AC-Service-Token"),
    authorization: str | None = Header(default=None),
) -> GenerateResponse:
    """The automations' single door to a model.

    The caller says what it wants, never who should answer it: provider, model
    and fallback come from the platform configuration, so changing provider in
    the panel changes every automation at once with no workflow edit.
    """
    actor = _authorise_generation(db, x_ac_service_token, authorization)

    messages = [m.model_dump() for m in body.messages]
    if body.system:
        messages.insert(0, {"role": "system", "content": body.system})
    if body.prompt:
        messages.append({"role": "user", "content": body.prompt})
    if not messages:
        raise HTTPException(status_code=400, detail="supply `prompt` or `messages`")

    response_format = body.response_format
    if response_format is None and body.json_schema:
        response_format = {"type": "json_schema", "schema": body.json_schema}

    service = AIService.from_db(db)
    try:
        result = await service.generate(
            messages,
            model=(body.model or "").strip() or None,
            temperature=body.temperature,
            max_tokens=body.max_tokens,
            response_format=response_format,
        )
    except AINotConfigured as exc:
        raise HTTPException(status_code=503, detail=exc.message)
    except AIAuthError as exc:
        # The provider refused OUR credential; that is a server-side
        # misconfiguration, not the caller's fault.
        _count_ai_error(db)
        raise HTTPException(status_code=502, detail=exc.message)
    except AIBadRequest as exc:
        raise HTTPException(status_code=400, detail=exc.message)
    except AIError as exc:
        _count_ai_error(db)
        raise HTTPException(status_code=502, detail=exc.message)

    if result.used_fallback:
        audit.record(
            db,
            type="ai.fallback",
            message=(
                f"AI fallback used: {result.primary_provider} -> {result.response.provider}"
            ),
            severity=EventSeverity.warning,
            correlation_id=_cid(request),
            meta={
                "actor": actor,
                "primary": result.primary_provider,
                "fallback": result.response.provider,
                "reason": result.primary_error,
            },
        )
    from app.services import usage

    usage.bump(db, "ai_requests")
    usage.bump(db, "ai_latency_ms", int(result.response.latency_ms or 0))
    payload = result.as_dict()
    payload.pop("attempts", None)
    return GenerateResponse.model_validate(payload)


def _count_ai_error(db) -> None:
    from app.services import usage

    usage.bump(db, "ai_errors")
