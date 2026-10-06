from fastapi import APIRouter

from app.api.routes import (
    ai,
    assistant,
    auth,
    automation_builder,
    automation_events,
    credentials,
    integrations,
    n8n,
    observability,
    pipelines,
    profiles,
    services,
    system,
)

api_router = APIRouter(prefix="/api")
api_router.include_router(system.router)
api_router.include_router(auth.router)
api_router.include_router(profiles.router)
api_router.include_router(credentials.router)
api_router.include_router(services.router)
api_router.include_router(ai.router)
api_router.include_router(n8n.router)
api_router.include_router(pipelines.router)
api_router.include_router(automation_events.router)
api_router.include_router(integrations.router)
api_router.include_router(automation_builder.router)
api_router.include_router(observability.router)
api_router.include_router(assistant.router)
