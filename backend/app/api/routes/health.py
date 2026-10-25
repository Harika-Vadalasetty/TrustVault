"""Liveness and optional database readiness checks."""

from fastapi import APIRouter, HTTPException, status

from app.config import get_settings
from app.db import check_database

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, object]:
    """Always available. Does not contact PostgreSQL or Supabase."""
    settings = get_settings()
    return {
        "status": "ok",
        "service": "trustvault-api",
        "environment": settings.environment,
        "database_configured": settings.database_configured,
        "storage_configured": settings.storage_configured,
    }


@router.get("/health/db")
def health_db() -> dict[str, str]:
    """Requires DATABASE_URL and a reachable PostgreSQL instance."""
    settings = get_settings()
    if not settings.database_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "DATABASE_URL is not configured. Set it in .env to enable "
                "database-dependent features. GET /health still works without it."
            ),
        )
    try:
        check_database()
    except Exception as exc:
        err_type = type(exc).__name__
        err_msg = str(exc)
        if settings.database_url and "@" in settings.database_url:
            try:
                pass_part = settings.database_url.split("@")[0].split(":")[-1]
                if pass_part and len(pass_part) > 2:
                    err_msg = err_msg.replace(pass_part, "******")
            except Exception:
                pass
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database is configured but the connection check failed ({err_type}): {err_msg[:120]}",
        ) from None
    return {"status": "ok", "database": "reachable"}
