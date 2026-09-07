from fastapi import APIRouter

from app.api.routes import ai, auth, credentials, n8n, profiles, services, system

api_router = APIRouter(prefix="/api")
api_router.include_router(system.router)
api_router.include_router(auth.router)
api_router.include_router(profiles.router)
api_router.include_router(credentials.router)
api_router.include_router(services.router)
api_router.include_router(ai.router)
api_router.include_router(n8n.router)
