"""Admin user management and system metrics endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.audit import log_audit_event
from app.db import get_session
from app.dependencies import require_csrf, require_role
from app.models.audit import AuditLog
from app.models.document import Document
from app.models.share import DocumentShare
from app.models.user import User, UserRole
from app.schemas.admin import AdminStatsResponse, AdminUserResponse, RoleUpdateRequest

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get(
    "/users",
    response_model=list[AdminUserResponse],
    status_code=status.HTTP_200_OK,
    summary="List all users (Admin only)",
)
def list_users(
    _admin: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_session),
) -> list[AdminUserResponse]:
    """Retrieve all users in the system with their uploaded document counts."""
    users = db.query(User).order_by(User.created_at.desc()).all()

    # Pre-aggregate document counts per user
    doc_counts = dict(
        db.query(Document.owner_id, func.count(Document.id))
        .group_by(Document.owner_id)
        .all()
    )

    results = []
    for u in users:
        results.append(
            AdminUserResponse(
                id=u.id,
                email=u.email,
                role=u.role,
                created_at=u.created_at,
                document_count=doc_counts.get(u.id, 0),
            )
        )
    return results


@router.patch(
    "/users/{user_id}/role",
    response_model=AdminUserResponse,
    status_code=status.HTTP_200_OK,
    summary="Update a user's role (Admin only)",
)
def update_user_role(
    user_id: UUID,
    body: RoleUpdateRequest,
    admin: User = Depends(require_role(UserRole.ADMIN)),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_session),
) -> AdminUserResponse:
    """Modify a user's system role. Protected by CSRF and audited."""
    target_user = db.get(User, user_id)
    if not target_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Safety check: prevent administrator from demoting themselves if they are the only admin
    if target_user.id == admin.id and body.role != UserRole.ADMIN:
        other_admins = (
            db.query(User)
            .filter(User.role == UserRole.ADMIN, User.id != admin.id)
            .count()
        )
        if other_admins == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot demote the sole active administrator account",
            )

    old_role = target_user.role
    target_user.role = body.role

    log_audit_event(
        db=db,
        action="admin_role_change",
        actor_id=admin.id,
        detail={
            "target_user_id": str(target_user.id),
            "target_email": target_user.email,
            "old_role": old_role.value,
            "new_role": body.role.value,
        },
    )
    db.commit()
    db.refresh(target_user)

    doc_count = db.query(func.count(Document.id)).filter(Document.owner_id == target_user.id).scalar() or 0

    return AdminUserResponse(
        id=target_user.id,
        email=target_user.email,
        role=target_user.role,
        created_at=target_user.created_at,
        document_count=doc_count,
    )


@router.get(
    "/stats",
    response_model=AdminStatsResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve system statistics and metrics (Admin only)",
)
def get_system_stats(
    _admin: User = Depends(require_role(UserRole.ADMIN)),
    db: Session = Depends(get_session),
) -> AdminStatsResponse:
    """Retrieve high-level system metrics for administrative oversight."""
    total_users = db.query(func.count(User.id)).scalar() or 0
    total_documents = db.query(func.count(Document.id)).scalar() or 0
    total_shares = db.query(func.count(DocumentShare.id)).scalar() or 0
    active_shares = (
        db.query(func.count(DocumentShare.id))
        .filter(DocumentShare.revoked_at.is_(None))
        .scalar()
        or 0
    )
    total_audit_events = db.query(func.count(AuditLog.id)).scalar() or 0
    storage_used_bytes = db.query(func.sum(Document.size_bytes)).scalar() or 0

    role_counts_raw = db.query(User.role, func.count(User.id)).group_by(User.role).all()
    role_breakdown = {r.value: cnt for r, cnt in role_counts_raw}

    # Ensure all defined roles exist in the breakdown
    for r in UserRole:
        role_breakdown.setdefault(r.value, 0)

    return AdminStatsResponse(
        total_users=total_users,
        total_documents=total_documents,
        total_shares=total_shares,
        active_shares=active_shares,
        total_audit_events=total_audit_events,
        storage_used_bytes=storage_used_bytes,
        role_breakdown=role_breakdown,
    )
