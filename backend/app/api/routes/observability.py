"""User-facing observability: overview, activity, errors, notifications."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db import get_db
from app.models import User
from app.services import observability as obs
from app.services import service_config
from app.services.n8n import N8nService

router = APIRouter(tags=["observability"])


def _n8n(db: Session) -> N8nService | None:
    resolved = service_config.resolve(db, "n8n")
    if not resolved.configured:
        return None
    return N8nService(base_url=resolved.base_url, api_key=resolved.secret, timeout=8.0)


@router.get("/overview")
async def overview(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return await obs.overview(db, user, _n8n(db))


@router.get("/n8n-center")
async def n8n_center(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return await obs.n8n_center(db, user, _n8n(db))


@router.get("/activity")
async def activity(
    category: str = Query(default="all", pattern="^(all|automations|ai|integrations|errors|security|system)$"),
    limit: int = Query(default=100, ge=1, le=300),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return await obs.activity(db, user, _n8n(db), category=category, limit=limit)


@router.get("/errors")
async def errors(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return await obs.errors(db, user, _n8n(db))


@router.post("/errors/{key}/resolve")
def resolve(key: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    obs.resolve_error(db, user, key)
    return {"resolved": True}


@router.get("/notifications")
def notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return obs.notifications(db, user)


@router.post("/notifications/read")
def read_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    obs.mark_notifications_read(db, user)
    return {"ok": True}


@router.get("/executions/{execution_id}")
async def execution(execution_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from fastapi import HTTPException

    from app.services.n8n import N8nError

    try:
        return await obs.execution_detail(_n8n(db), execution_id)
    except N8nError as exc:
        raise HTTPException(exc.status_code, detail=exc.message)
