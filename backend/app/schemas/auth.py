"""Authentication and user schemas."""

from __future__ import annotations

import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import UserRole

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterRequest(BaseModel):
    email: str = Field(..., max_length=320, description="User email address")
    password: str = Field(..., min_length=8, max_length=128, description="User password")
    role: str | None = Field(default=None, description="Optional role request")

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if not EMAIL_REGEX.match(cleaned) or len(cleaned) > 320:
            raise ValueError("Invalid email address format")
        return cleaned

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v.strip()) < 8:
            raise ValueError("Password must be at least 8 characters long")
        return v


class LoginRequest(BaseModel):
    email: str = Field(..., max_length=320)
    password: str = Field(..., min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if not EMAIL_REGEX.match(cleaned):
            raise ValueError("Invalid email address format")
        return cleaned


class UserResponse(BaseModel):
    id: UUID
    email: str
    role: UserRole
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuthSuccessResponse(BaseModel):
    user: UserResponse
    csrf_token: str


class LogoutResponse(BaseModel):
    message: str = "Logged out successfully"
