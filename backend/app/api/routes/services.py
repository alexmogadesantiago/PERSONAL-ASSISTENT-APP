"""Service configuration API (Phase 2 / Phase 6).

Lets an admin point the platform at a real n8n or Playwright from the web panel
instead of editing `.env` and redeploying. Reading is open to any authenticated
user (the dashboard shows configuration state); writing and testing are
admin-only, because both change what the backend connects to and make it
originate outbound requests.

AI providers are also stored here (one row each), but they are driven by the
dedicated `/api/ai` endpoints rather than by this generic URL + key surface -
picking a provider and a model is a different decision from pointing at a
sidecar. They are still listed by `GET /config`, tagged `category: "ai"`, so
the panel can group them.

No response from this module ever contains a secret - only `secret_hint`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.db import get_db
from app.models import EventSeverity, User
from app.schemas.service_config import (
    ServiceConfigListOut,
    ServiceConfigOut,
    ServiceConfigUpdate,
    ServiceTestResult,
)
from app.services import audit
from app.services import service_config as svc
from app.services import services_probe as probe

router = APIRouter(prefix="/services", tags=["services"])


def _cid(request: Request) -> str | None:
    return getattr(request.state, "correlation_id", None)


def _known(service: str) -> None:
    if service not in svc.SPECS:
        raise HTTPException(
            status_code=404,
            detail=f"unknown service '{service}' (known: {', '.join(svc.CONFIGURABLE)})",
        )


@router.get("/config", response_model=ServiceConfigListOut)
def list_config(
    _: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ServiceConfigListOut:
    """Configuration state of every configurable service."""
    resolved = svc.resolve_all(db)
    return ServiceConfigListOut(
        data=[ServiceConfigOut.model_validate(svc.public_view(r)) for r in resolved.values()]
    )


@router.get("/config/{service}", response_model=ServiceConfigOut)
def get_config(
    service: str, _: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ServiceConfigOut:
    _known(service)
    return ServiceConfigOut.model_validate(svc.public_view(svc.resolve(db, service)))


@router.put("/config/{service}", response_model=ServiceConfigOut)
def update_config(
    service: str,
    body: ServiceConfigUpdate,
    request: Request,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ServiceConfigOut:
    """Store this service configuration in the database (takes precedence over
    the environment). Takes effect on the next probe - no restart."""
    _known(service)
    try:
        resolved = svc.upsert(
            db,
            service,
            base_url=body.base_url,
            secret=body.secret,
            clear_secret=body.clear_secret,
            enabled=body.enabled,
            actor_id=user.id,
        )
    except svc.ServiceConfigError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    # The audit trail records *that* a secret changed, never the value.
    audit.record(
        db,
        type="service_config.update",
        message=f"service configuration updated: {service}",
        actor_id=user.id,
        correlation_id=_cid(request),
        meta={
            "service": service,
            "base_url_set": bool(resolved.base_url),
            "secret_set": bool(resolved.secret),
            "enabled": resolved.enabled,
        },
    )
    return ServiceConfigOut.model_validate(svc.public_view(resolved))


@router.post("/config/{service}/test", response_model=ServiceTestResult)
async def test_config(
    service: str,
    request: Request,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ServiceTestResult:
    """Run this service real probe now and persist the outcome.

    Same code path the monitor uses, so a green result here means the dashboard
    will agree - there is no separate, friendlier test.
    """
    _known(service)
    resolved = svc.resolve(db, service)
    try:
        state = await probe.probe_one(resolved, force=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    ok = state.status in probe.HEALTHY
    svc.record_test(db, service, ok=ok, detail=state.detail)
    audit.record(
        db,
        type="service_config.test",
        message=f"service test {service}: {state.status}",
        severity=EventSeverity.info if ok else EventSeverity.warning,
        actor_id=user.id,
        correlation_id=_cid(request),
        meta={"service": service, "status": state.status},
    )
    return ServiceTestResult(
        service=service,
        ok=ok,
        status=state.status,
        detail=state.detail,
        latency_ms=state.latency_ms,
    )
