"""Authentication routes for TrustVault: register, login, current user, and logout.

Follows strict least-privilege principles, session-bound CSRF protection,
HTTP-only session cookies, and Argon2id password hashing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_session
from app.dependencies import get_current_user, require_csrf
from app.models.user import User, UserRole
from app.schemas.auth import (
    AuthSuccessResponse,
    LoginRequest,
    LogoutResponse,
    RegisterRequest,
    UserResponse,
)
from app.security import hash_password, verify_password
from app.session import (
    COOKIE_NAME_CSRF,
    COOKIE_NAME_SESSION,
    create_session_data,
    generate_csrf_token,
    verify_session_cookie,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
)
def register(
    body: RegisterRequest,
    db: Session = Depends(get_session),
) -> UserResponse:
    """Public registration endpoint.

    Strictly forbids creating ADMIN accounts. Public accounts are created as VIEWER.
    """
    if body.role:
        normalized_role = body.role.strip().upper()
        if normalized_role == "ADMIN" or normalized_role == UserRole.ADMIN.value:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Public registration cannot create an ADMIN account",
            )

    # Check for existing user with the same email
    existing_user = db.query(User).filter(User.email == body.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email is already registered",
        )

    # Hash password securely using Argon2id (never store plaintext)
    hashed = hash_password(body.password)

    # All public registrations default strictly to VIEWER
    new_user = User(
        email=body.email,
        password_hash=hashed,
        role=UserRole.VIEWER,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return UserResponse.model_validate(new_user)


@router.post(
    "/login",
    response_model=AuthSuccessResponse,
    status_code=status.HTTP_200_OK,
    summary="Log in and establish a secure session",
)
def login(
    body: LoginRequest,
    response: Response,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AuthSuccessResponse:
    """Authenticate with email and password.

    Returns generic 401 for both unknown emails and incorrect passwords.
    Sets HTTP-only session cookie and readable CSRF cookie.
    """
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    try:
        secret = settings.require_session_secret()
    except (RuntimeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service is currently misconfigured",
        )

    signed_cookie, csrf_token, _ = create_session_data(
        user_id=user.id,
        secret=secret,
        ttl_minutes=settings.session_ttl_minutes,
    )

    max_age_seconds = int(settings.session_ttl_minutes * 60)

    # HTTP-only session cookie (protected against JavaScript/XSS theft)
    response.set_cookie(
        key=COOKIE_NAME_SESSION,
        value=signed_cookie,
        max_age=max_age_seconds,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )

    # Readable CSRF cookie for client-side single-page applications
    response.set_cookie(
        key=COOKIE_NAME_CSRF,
        value=csrf_token,
        max_age=max_age_seconds,
        httponly=False,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )

    return AuthSuccessResponse(
        user=UserResponse.model_validate(user),
        csrf_token=csrf_token,
    )


@router.get(
    "/me",
    response_model=AuthSuccessResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve current user profile and session CSRF token",
)
def get_me(
    request: Request,
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
) -> AuthSuccessResponse:
    """Return the authenticated user's profile and active session-bound CSRF token."""
    cookie_value = request.cookies.get(COOKIE_NAME_SESSION)
    try:
        secret = settings.require_session_secret()
    except (RuntimeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service is currently misconfigured",
        )

    payload = verify_session_cookie(cookie_value, secret)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    session_id = payload["session_id"]
    csrf_token = generate_csrf_token(session_id, secret)

    return AuthSuccessResponse(
        user=UserResponse.model_validate(user),
        csrf_token=csrf_token,
    )


@router.post(
    "/logout",
    response_model=LogoutResponse,
    status_code=status.HTTP_200_OK,
    summary="Log out and clear session cookies",
)
def logout(
    response: Response,
    user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    settings: Settings = Depends(get_settings),
) -> LogoutResponse:
    """Log out the current user after validating CSRF, clearing all session cookies."""
    response.delete_cookie(
        key=COOKIE_NAME_SESSION,
        path="/",
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
    )
    response.delete_cookie(
        key=COOKIE_NAME_CSRF,
        path="/",
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
    )

    return LogoutResponse(message="Logged out successfully")
