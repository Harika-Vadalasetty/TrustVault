"""Pydantic schemas for documents, shares, and audit records."""

from __future__ import annotations

import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DocumentResponse(BaseModel):
    id: UUID
    owner_id: UUID
    owner_email: str | None = None
    original_filename: str
    content_type: str
    size_bytes: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ShareCreateRequest(BaseModel):
    recipient_email: str = Field(..., max_length=320, description="Email of the user to share with")

    @field_validator("recipient_email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if not EMAIL_REGEX.match(cleaned):
            raise ValueError("Invalid recipient email address format")
        return cleaned


class ShareResponse(BaseModel):
    id: UUID
    document_id: UUID
    recipient_id: UUID
    recipient_email: str | None = None
    granted_by_id: UUID
    created_at: datetime
    revoked_at: datetime | None = None
    is_active: bool = True
    email_notification_sent: bool = False
    email_notification_note: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ShareRevokeResponse(BaseModel):
    message: str = "Share revoked successfully"
    share_id: UUID


class RecipientUserResponse(BaseModel):
    id: UUID
    email: str
    role: str

    model_config = ConfigDict(from_attributes=True)


class AuditLogResponse(BaseModel):
    id: UUID
    actor_id: UUID | None
    action: str
    document_id: UUID | None
    detail: dict | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
