"""Admin schemas for user management and statistics."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.user import UserRole


class AdminUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    role: UserRole
    created_at: datetime
    document_count: int = 0


class RoleUpdateRequest(BaseModel):
    role: UserRole = Field(..., description="Target role to assign")


class AdminStatsResponse(BaseModel):
    total_users: int
    total_documents: int
    total_shares: int
    active_shares: int
    total_audit_events: int
    storage_used_bytes: int
    role_breakdown: dict[str, int]
