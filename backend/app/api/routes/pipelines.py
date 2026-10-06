"""Results of the four automations, for the panel's assistant.

Read-only, and narrow on purpose: the response carries the items a module
produced, already projected onto a whitelist of fields and truncated, so the
caller can put them in front of a model without shipping an execution dump.

Authentication is the platform's existing session - the same dependency every
other read uses. There is no service-token door here: automations produce these
results, they do not consume them.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_current_user
from app.models import User
from app.services import pipelines
from app.services.n8n import N8nService, get_n8n_service

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


@router.get("")
def list_modules(_: User = Depends(get_current_user)) -> dict:
    """What can be asked for. Answers without calling n8n."""
    return {"data": pipelines.catalogue()}


@router.get("/{module}")
async def module_results(
    module: str,
    limit: int = Query(default=pipelines.DEFAULT_LIMIT, ge=1, le=pipelines.MAX_LIMIT),
    scan: int = Query(
        default=pipelines.DEFAULT_SCAN,
        ge=1,
        le=pipelines.MAX_SCAN,
        description="How many recent executions to inspect. Each one is a full fetch from n8n.",
    ),
    since: str | None = Query(
        default=None, description="ISO date/datetime; older executions are skipped."
    ),
    q: str = Query(default="", max_length=120, description="Substring filter, accent-insensitive."),
    _: User = Depends(get_current_user),
    n8n: N8nService = Depends(get_n8n_service),
) -> dict:
    key = module.strip().lower()
    if not pipelines.is_known(key):
        raise HTTPException(
            status_code=404,
            detail=f"unknown module '{module}' (known: {', '.join(pipelines.MODULES)})",
        )

    parsed_since: dt.datetime | None = None
    if since:
        try:
            parsed_since = dt.datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=422, detail="since must be an ISO date or datetime")
        if parsed_since.tzinfo is None:
            parsed_since = parsed_since.replace(tzinfo=dt.timezone.utc)

    try:
        return await pipelines.collect(
            n8n, key, limit=limit, scan=scan, since=parsed_since, query=q.strip()
        )
    except pipelines.PipelineError as exc:
        raise HTTPException(
            status_code=exc.status_code, detail={"code": exc.code, "message": exc.message}
        )
