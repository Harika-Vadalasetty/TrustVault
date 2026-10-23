"""TrustVault FastAPI entrypoint (Stage 2 skeleton)."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.config import get_settings

logger = logging.getLogger("trustvault")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    pending: list[str] = []
    if not settings.database_configured:
        pending.append("DATABASE_URL (needed for Alembic, /health/db, and all data APIs)")
    if not settings.storage_configured:
        pending.append("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (needed from Stage 4 for file storage)")
    if not settings.session_secret:
        pending.append("SESSION_SECRET (needed from Stage 3 for authentication)")
    if pending:
        logger.warning("Starting without complete runtime config: %s", "; ".join(pending))
    else:
        logger.info("All primary runtime settings are present.")
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="TrustVault API",
        description="Secure document sharing with a real audit trail.",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "X-Request-ID"],
    )
    application.include_router(health_router)
    return application


app = create_app()
