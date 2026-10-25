"""Document management, sharing, immediate revocation, and audit log endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.audit import log_audit_event
from app.config import Settings, get_settings
from app.db import get_session
from app.dependencies import get_current_user, require_csrf, require_role
from app.models.audit import AuditLog
from app.models.document import Document
from app.models.share import DocumentShare
from app.models.user import User, UserRole
from app.schemas.document import (
    AuditLogResponse,
    DocumentResponse,
    RecipientUserResponse,
    ShareCreateRequest,
    ShareResponse,
    ShareRevokeResponse,
)
from app.storage import (
    delete_stored_file,
    extract_uploaded_file,
    get_file_path,
    sanitize_filename,
    save_file_bytes,
)

router = APIRouter(tags=["documents"])


# ==========================================
# 1. Document Upload & Management
# ==========================================


@router.post(
    "/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a new document",
)
async def upload_document(
    request: Request,
    user: User = Depends(require_role(UserRole.DOCUMENT_OWNER, UserRole.ADMIN)),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> DocumentResponse:
    """Upload a new document. Strictly available to DOCUMENT_OWNER and ADMIN."""
    content_type_header = request.headers.get("content-type", "")
    body_bytes = await request.body()

    filename, content_type, file_data = extract_uploaded_file(content_type_header, body_bytes)

    storage_key, size_bytes = save_file_bytes(
        data=file_data,
        storage_dir=settings.storage_dir,
        max_bytes=settings.max_upload_bytes,
    )

    doc = Document(
        owner_id=user.id,
        original_filename=sanitize_filename(filename),
        storage_key=storage_key,
        content_type=content_type or "application/octet-stream",
        size_bytes=size_bytes,
    )

    try:
        db.add(doc)
        db.flush()
        log_audit_event(
            db=db,
            action="document_upload",
            actor_id=user.id,
            document_id=doc.id,
            detail={"filename": doc.original_filename, "size": size_bytes},
        )
        db.commit()
        db.refresh(doc)
    except Exception:
        db.rollback()
        delete_stored_file(storage_key, settings.storage_dir)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist document record",
        )

    return DocumentResponse.model_validate(doc)


@router.get(
    "/documents",
    response_model=list[DocumentResponse],
    status_code=status.HTTP_200_OK,
    summary="List accessible documents",
)
def list_documents(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> list[DocumentResponse]:
    """List documents accessible to the current user.

    DOCUMENT_OWNER sees own documents.
    VIEWER sees only documents currently shared with them.
    ADMIN sees all document metadata.
    """
    if user.role == UserRole.ADMIN:
        docs = db.query(Document).order_by(Document.created_at.desc()).all()
    elif user.role == UserRole.DOCUMENT_OWNER:
        docs = db.query(Document).filter(Document.owner_id == user.id).order_by(Document.created_at.desc()).all()
    else:  # VIEWER
        shared_doc_ids = select(DocumentShare.document_id).where(
            DocumentShare.recipient_id == user.id,
            DocumentShare.revoked_at.is_(None),
        )
        docs = db.query(Document).filter(Document.id.in_(shared_doc_ids)).order_by(Document.created_at.desc()).all()

    owner_ids = {d.owner_id for d in docs}
    owner_map = {}
    if owner_ids:
        users = db.query(User.id, User.email).filter(User.id.in_(owner_ids)).all()
        owner_map = {u.id: u.email for u in users}

    return [
        DocumentResponse(
            id=d.id,
            owner_id=d.owner_id,
            owner_email=owner_map.get(d.owner_id),
            original_filename=d.original_filename,
            content_type=d.content_type,
            size_bytes=d.size_bytes,
            created_at=d.created_at,
            updated_at=d.updated_at,
        )
        for d in docs
    ]


@router.get(
    "/documents/{document_id}",
    response_model=DocumentResponse,
    status_code=status.HTTP_200_OK,
    summary="Get document metadata",
)
def get_document_metadata(
    document_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> DocumentResponse:
    """Retrieve document metadata if the user is owner or an active share recipient."""
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    is_owner = doc.owner_id == user.id
    is_admin = user.role == UserRole.ADMIN
    is_shared = False

    if not is_owner and not is_admin:
        active_share = db.query(DocumentShare).filter(
            DocumentShare.document_id == doc.id,
            DocumentShare.recipient_id == user.id,
            DocumentShare.revoked_at.is_(None),
        ).first()
        is_shared = active_share is not None

    if not (is_owner or is_admin or is_shared):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    owner_user = db.get(User, doc.owner_id)
    return DocumentResponse(
        id=doc.id,
        owner_id=doc.owner_id,
        owner_email=owner_user.email if owner_user else None,
        original_filename=doc.original_filename,
        content_type=doc.content_type,
        size_bytes=doc.size_bytes,
        created_at=doc.created_at,
        updated_at=doc.updated_at,
    )


@router.get(
    "/documents/{document_id}/download",
    status_code=status.HTTP_200_OK,
    summary="Download document file content",
)
def download_document(
    document_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Download document content.

    Owner can download their own files.
    Viewer can download only while a valid share exists.
    Admin cannot download content unless explicitly granted (moderation separation).
    """
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    # Documented Admin Policy: Admin does NOT have content access to user files
    if user.role == UserRole.ADMIN and doc.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin cannot download user document contents",
        )

    # Check permission
    is_owner = doc.owner_id == user.id
    is_shared = False

    if not is_owner:
        active_share = db.query(DocumentShare).filter(
            DocumentShare.document_id == doc.id,
            DocumentShare.recipient_id == user.id,
            DocumentShare.revoked_at.is_(None),
        ).first()
        is_shared = active_share is not None

    if not (is_owner or is_shared):
        log_audit_event(db=db, action="access_denied", actor_id=user.id, document_id=doc.id)
        db.commit()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    file_path = get_file_path(doc.storage_key, settings.storage_dir)

    log_audit_event(
        db=db,
        action="document_download",
        actor_id=user.id,
        document_id=doc.id,
    )
    db.commit()

    safe_name = sanitize_filename(doc.original_filename)
    return FileResponse(
        path=str(file_path),
        media_type=doc.content_type,
        filename=safe_name,
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete(
    "/documents/{document_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete a document, stored file, and associated shares",
)
def delete_document(
    document_id: UUID,
    user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    """Delete a document. Available to DOCUMENT_OWNER and ADMIN. CSRF protected."""
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    if doc.owner_id != user.id and user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the document owner or admin can delete this document",
        )

    # Delete all associated shares
    db.query(DocumentShare).filter(DocumentShare.document_id == doc.id).delete()

    # Delete physical file from disk
    delete_stored_file(doc.storage_key, settings.storage_dir)

    log_audit_event(
        db=db,
        action="document_delete",
        actor_id=user.id,
        document_id=doc.id,
        detail={"filename": doc.original_filename, "size": doc.size_bytes},
    )

    db.delete(doc)
    db.commit()

    return {"message": "Document deleted successfully", "document_id": str(doc.id)}


# ==========================================
# 2. Sharing & Revocation
# ==========================================


@router.get(
    "/documents/recipients",
    response_model=list[RecipientUserResponse],
    status_code=status.HTTP_200_OK,
    summary="List available recipient users for sharing",
)
def list_available_recipients(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> list[RecipientUserResponse]:
    """Return all other registered users that can be selected for sharing."""
    users = db.query(User).filter(User.id != user.id).order_by(User.email.asc()).all()
    return [
        RecipientUserResponse(id=u.id, email=u.email, role=u.role.value)
        for u in users
    ]


@router.post(
    "/documents/{document_id}/shares",
    response_model=ShareResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Share document with a user",
)
def create_share(
    document_id: UUID,
    body: ShareCreateRequest,
    user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> ShareResponse:
    """Share document with a recipient by email. Only the document owner can share."""
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    if doc.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the document owner can share this document",
        )

    recipient = db.query(User).filter(User.email == body.recipient_email).first()
    if not recipient:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient user not found")

    if recipient.id == user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot share a document with yourself",
        )

    # Check for existing active share
    active_share = db.query(DocumentShare).filter(
        DocumentShare.document_id == doc.id,
        DocumentShare.recipient_id == recipient.id,
        DocumentShare.revoked_at.is_(None),
    ).first()

    if active_share:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Document is already actively shared with this user",
        )

    share = DocumentShare(
        document_id=doc.id,
        recipient_id=recipient.id,
        granted_by_id=user.id,
    )
    db.add(share)

    log_audit_event(
        db=db,
        action="share_granted",
        actor_id=user.id,
        document_id=doc.id,
        detail={"recipient_id": str(recipient.id), "recipient_email": recipient.email},
    )
    db.commit()
    db.refresh(share)

    email_sent = False
    email_note = "Email provider unconfigured (SMTP/Resend settings not present in environment). Access granted in vault."
    if settings.email_configured:
        try:
            import smtplib
            from email.mime.text import MIMEText
            msg = MIMEText(
                f"Hello,\n\nA confidential document '{doc.original_filename}' has been shared with you on TrustVault by {user.email}.\n\n"
                f"Log in to your authenticated TrustVault account to view or download it: {settings.frontend_origin}\n\n"
                f"Security Note: TrustVault does not send direct public download links in emails."
            )
            msg["Subject"] = f"[TrustVault] Document Access Granted: {doc.original_filename}"
            msg["From"] = settings.smtp_from_email
            msg["To"] = recipient.email

            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
                if settings.smtp_use_tls:
                    server.starttls()
                if settings.smtp_username and settings.smtp_password:
                    server.login(settings.smtp_username, settings.smtp_password)
                server.send_message(msg)
            email_sent = True
            email_note = f"Notification email sent to {recipient.email}"
        except Exception as exc:
            email_sent = False
            email_note = f"Access granted in vault, but email notification failed: {str(exc)}"

    return ShareResponse(
        id=share.id,
        document_id=share.document_id,
        recipient_id=share.recipient_id,
        recipient_email=recipient.email,
        granted_by_id=share.granted_by_id,
        created_at=share.created_at,
        revoked_at=share.revoked_at,
        is_active=True,
        email_notification_sent=email_sent,
        email_notification_note=email_note,
    )


@router.get(
    "/documents/{document_id}/shares",
    response_model=list[ShareResponse],
    status_code=status.HTTP_200_OK,
    summary="List shares for a document",
)
def list_document_shares(
    document_id: UUID,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> list[ShareResponse]:
    """List all shares for a document. Available strictly to the document owner."""
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    if doc.owner_id != user.id and user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the document owner can view shares",
        )

    shares_with_users = (
        db.query(DocumentShare, User.email)
        .join(User, User.id == DocumentShare.recipient_id)
        .filter(DocumentShare.document_id == doc.id)
        .order_by(DocumentShare.created_at.desc())
        .all()
    )

    results = []
    for share, email in shares_with_users:
        results.append(
            ShareResponse(
                id=share.id,
                document_id=share.document_id,
                recipient_id=share.recipient_id,
                recipient_email=email,
                granted_by_id=share.granted_by_id,
                created_at=share.created_at,
                revoked_at=share.revoked_at,
                is_active=(share.revoked_at is None),
            )
        )
    return results


@router.delete(
    "/documents/{document_id}/shares/{share_id}",
    response_model=ShareRevokeResponse,
    status_code=status.HTTP_200_OK,
    summary="Revoke a document share immediately",
)
def revoke_share(
    document_id: UUID,
    share_id: UUID,
    user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
    db: Session = Depends(get_session),
) -> ShareRevokeResponse:
    """Revoke document share. Access is immediately terminated on the next request."""
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    if doc.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the document owner can revoke shares",
        )

    share = db.query(DocumentShare).filter(
        DocumentShare.id == share_id,
        DocumentShare.document_id == doc.id,
    ).first()

    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share record not found")

    if share.revoked_at is not None:
        return ShareRevokeResponse(message="Share is already revoked", share_id=share.id)

    share.revoked_at = datetime.now(timezone.utc)
    log_audit_event(
        db=db,
        action="share_revoked",
        actor_id=user.id,
        document_id=doc.id,
        detail={"recipient_id": str(share.recipient_id), "share_id": str(share.id)},
    )
    db.commit()

    return ShareRevokeResponse(message="Share revoked successfully", share_id=share.id)


# ==========================================
# 3. Audit Logging
# ==========================================


@router.get(
    "/audit-logs",
    response_model=list[AuditLogResponse],
    status_code=status.HTTP_200_OK,
    summary="Retrieve audit trail",
)
def get_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_session),
) -> list[AuditLogResponse]:
    """Retrieve audit logs scoped to the user's authorization.

    DOCUMENT_OWNER sees events for their own documents or where they were the actor.
    ADMIN sees all audit records.
    VIEWER sees only their own actions.
    """
    if user.role == UserRole.ADMIN:
        logs = db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()
    elif user.role == UserRole.DOCUMENT_OWNER:
        owned_doc_ids = select(Document.id).where(Document.owner_id == user.id)
        logs = (
            db.query(AuditLog)
            .filter(
                or_(
                    AuditLog.actor_id == user.id,
                    AuditLog.document_id.in_(owned_doc_ids),
                )
            )
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
            .all()
        )
    else:  # VIEWER
        logs = (
            db.query(AuditLog)
            .filter(AuditLog.actor_id == user.id)
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
            .all()
        )

    return [AuditLogResponse.model_validate(l) for l in logs]
