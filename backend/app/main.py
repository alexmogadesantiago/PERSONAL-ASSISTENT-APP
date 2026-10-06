from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import __version__
from app.api import api_router
from app.api.ws import router as ws_router
from app.config import get_settings
from app.core.logging import configure_logging
from app.services.logbus import bus as log_bus
from app.services.monitor import hub as metrics_hub

log = logging.getLogger("automation_center")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging("DEBUG" if settings.debug else "INFO")
    problems = settings.validate_runtime()
    if problems:
        for p in problems:
            log.warning("BLOCKED BY: %s", p)

    # wire the live-log stream and start the single metrics loop
    log_bus.attach_loop(asyncio.get_running_loop())
    logging.getLogger().addHandler(log_bus)
    if settings.environment != "testing":
        # tests start the hub on demand (first WS connect) to avoid a probe
        # delay on every TestClient spin-up
        await metrics_hub.start()
        # Telegram as a conversational channel: answers the linked chat only.
        from app.db import SessionLocal
        from app.services import assistant

        app.state.bot_task = asyncio.create_task(assistant.bot_loop(SessionLocal))

    log.info("Automation Center backend %s starting (env=%s)", __version__, settings.environment)
    yield
    task = getattr(app.state, "bot_task", None)
    if task is not None:
        task.cancel()
    await metrics_hub.stop()
    logging.getLogger().removeHandler(log_bus)
    log_bus.detach_loop()
    log.info("Automation Center backend stopping")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Automation Center API",
        version=__version__,
        description="Backend for the Automation Center control plane.",
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_origin_regex=settings.cors_origin_regex_or_none,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-request-id"],
    )

    @app.middleware("http")
    async def add_context(request: Request, call_next):
        correlation_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        request.state.correlation_id = correlation_id
        try:
            response = await call_next(request)
        except Exception:  # noqa: BLE001 - convert to a clean 500, keep the trace in logs
            log.exception("unhandled error", extra={"correlation_id": correlation_id})
            return JSONResponse(
                status_code=500,
                content={"detail": "internal error", "correlation_id": correlation_id},
            )
        response.headers["x-request-id"] = correlation_id
        response.headers.setdefault("x-content-type-options", "nosniff")
        response.headers.setdefault("x-frame-options", "DENY")
        response.headers.setdefault("referrer-policy", "no-referrer")
        return response

    app.include_router(api_router)
    app.include_router(ws_router)

    @app.get("/", include_in_schema=False)
    def root() -> dict:
        return {"service": "automation-center-backend", "version": __version__, "docs": "/docs"}

    return app


app = create_app()
