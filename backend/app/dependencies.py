"""FastAPI authentication and authorization dependencies for TrustVault.

Implements server-side session authentication, live database role authorization,
and session-bound CSRF validation. Fails closed and never exposes secrets.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_session
from app.models.user import User, UserRole
from app.session import (
    COOKIE_NAME_SESSION,
    verify_csrf_token,
    verify_session_cookie,
)


def _get_configured_secret(settings: Settings) -> str | None:
    """Retrieve session secret safely; return None if unset or invalid."""
    try:
        return settings.require_session_secret()
    except (RuntimeError, ValueError):
        return None


def get_current_user(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> User:
    """Validate the session cookie and return the active User from the database.

    Fails closed with HTTP 401 if the session is missing, tampered, expired,
    unconfigured, or if the user no longer exists in the database.
    """
    cookie_value = request.cookies.get(COOKIE_NAME_SESSION)
    if not cookie_value:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    secret = _get_configured_secret(settings)
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    payload = verify_session_cookie(cookie_value, secret)
    if not payload or not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    raw_user_id = payload.get("user_id")
    if not raw_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        user_id = UUID(raw_user_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    user = db.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    return user


def require_role(*allowed_roles: UserRole):
    """Enforce role-based access control using the user's current database role.

    Always queries the database for the user's live role and rejects unauthorized
    requests with HTTP 403 Forbidden.
    """

    def role_checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return role_checker


def require_csrf(
    request: Request,
    csrf_token: str | None = Header(None, alias="X-CSRF-Token"),
    settings: Settings = Depends(get_settings),
) -> str:
    """Validate that the incoming CSRF token is cryptographically bound to the active session.

    Fails closed with HTTP 403 Forbidden if the header, cookie, or signature is missing or mismatched.
    """
    if not csrf_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing or invalid",
        )

    cookie_value = request.cookies.get(COOKIE_NAME_SESSION)
    if not cookie_value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing or invalid",
        )

    secret = _get_configured_secret(settings)
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing or invalid",
        )

    payload = verify_session_cookie(cookie_value, secret)
    if not payload or not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing or invalid",
        )

    session_id = payload.get("session_id")
    if not session_id or not verify_csrf_token(csrf_token, session_id, secret):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token missing or invalid",
        )

    return csrf_token
