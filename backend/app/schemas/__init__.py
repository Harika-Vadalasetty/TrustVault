"""Pydantic request and response schemas for TrustVault."""

from app.schemas.admin import (
    AdminStatsResponse,
    AdminUserResponse,
    RoleUpdateRequest,
)
from app.schemas.auth import (
    AuthSuccessResponse,
    LoginRequest,
    LogoutResponse,
    RegisterRequest,
    UserResponse,
)
from app.schemas.document import (
    AuditLogResponse,
    DocumentResponse,
    RecipientUserResponse,
    ShareCreateRequest,
    ShareResponse,
    ShareRevokeResponse,
)

__all__ = [
    "AdminStatsResponse",
    "AdminUserResponse",
    "AuditLogResponse",
    "AuthSuccessResponse",
    "DocumentResponse",
    "LoginRequest",
    "LogoutResponse",
    "RecipientUserResponse",
    "RegisterRequest",
    "RoleUpdateRequest",
    "ShareCreateRequest",
    "ShareResponse",
    "ShareRevokeResponse",
    "UserResponse",
]
