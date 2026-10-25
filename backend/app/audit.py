"""Audit logging helper for TrustVault security events.

Appends tamper-evident audit records. Strictly excludes secrets, tokens,
cookies, passwords, and file contents.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.audit import AuditLog

# Keys that must never appear in audit details
DISALLOWED_DETAIL_KEYS = {
    "password",
    "password_hash",
    "secret",
    "csrf_token",
    "session",
    "token",
    "content",
    "data",
}


def log_audit_event(
    db: Session,
    action: str,
    actor_id: UUID | None = None,
    document_id: UUID | None = None,
    detail: dict[str, Any] | None = None,
) -> AuditLog:
    """Record an immutable audit event in the database transaction."""
    safe_detail: dict[str, Any] | None = None
    if detail:
        safe_detail = {
            k: v
            for k, v in detail.items()
            if k.lower() not in DISALLOWED_DETAIL_KEYS and not isinstance(v, (bytes, bytearray))
        }

    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        document_id=document_id,
        detail=safe_detail,
    )
    db.add(entry)
    return entry
