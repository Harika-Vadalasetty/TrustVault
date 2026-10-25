"""Comprehensive security and functional tests for Stage 4: Documents, Sharing, Revocation & Audit."""

import io
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings, get_settings
from app.db import get_session
from app.main import app
from app.models.audit import AuditLog
from app.models.base import Base
from app.models.document import Document
from app.models.share import DocumentShare
from app.models.user import User, UserRole
from app.security import hash_password
from app.session import COOKIE_NAME_SESSION, create_session_data

TEST_SECRET = "test-secret-key-at-least-32-characters-long!!"


@pytest.fixture
def db_session():
    """Isolated in-memory SQLite database for document tests."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client_env(tmp_path, db_session: Session):
    """TestClient wired to a temporary storage directory and in-memory database."""
    storage_dir = str(tmp_path / "test_storage")

    test_settings = Settings(
        session_secret=TEST_SECRET,
        session_ttl_minutes=60,
        cookie_secure=False,
        cookie_samesite="lax",
        storage_dir=storage_dir,
        max_upload_bytes=1024 * 1024,  # 1 MB for testing
        environment="development",
    )

    def override_get_session():
        try:
            yield db_session
        finally:
            pass

    def override_get_settings():
        return test_settings

    app.dependency_overrides[get_session] = override_get_session
    app.dependency_overrides[get_settings] = override_get_settings

    with TestClient(app) as test_client:
        yield test_client, db_session, test_settings

    app.dependency_overrides.clear()


def _create_user(db: Session, email: str, role: UserRole) -> tuple[User, str, str]:
    """Helper to create a user and return (user, session_cookie, csrf_token)."""
    user = User(
        id=uuid4(),
        email=email,
        password_hash=hash_password("Passw0rd!123"),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    cookie, csrf, _ = create_session_data(user.id, TEST_SECRET)
    return user, cookie, csrf


# ==========================================
# 1. Document Upload & Storage Security Tests
# ==========================================


def test_unauthenticated_document_access_rejected(client_env):
    client, _, _ = client_env
    dummy_id = uuid4()

    # Upload requires auth
    assert client.post("/documents").status_code == 401
    # List requires auth
    assert client.get("/documents").status_code == 401
    # Metadata requires auth
    assert client.get(f"/documents/{dummy_id}").status_code == 401
    # Download requires auth
    assert client.get(f"/documents/{dummy_id}/download").status_code == 401
    # Shares require auth
    assert client.get(f"/documents/{dummy_id}/shares").status_code == 401
    assert client.post(f"/documents/{dummy_id}/shares").status_code == 401


def test_viewer_cannot_upload_document(client_env):
    client, db, _ = client_env
    viewer, cookie, csrf = _create_user(db, "viewer@test.com", UserRole.VIEWER)

    files = {"file": ("secret.txt", io.BytesIO(b"Hello world"), "text/plain")}
    resp = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        files=files,
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"


def test_owner_can_upload_valid_document(client_env):
    client, db, _ = client_env
    owner, cookie, csrf = _create_user(db, "owner@test.com", UserRole.DOCUMENT_OWNER)

    file_bytes = b"TrustVault confidential payload."
    files = {"file": ("report.pdf", io.BytesIO(file_bytes), "application/pdf")}
    resp = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        files=files,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["original_filename"] == "report.pdf"
    assert data["size_bytes"] == len(file_bytes)
    assert data["owner_id"] == str(owner.id)
    assert "id" in data
    # Ensure physical filesystem path is NEVER exposed in API response
    assert "path" not in data
    assert "storage_key" not in data
    assert "storage_dir" not in data

    # Verify upload audit event was recorded
    audit = db.query(AuditLog).filter_by(action="document_upload").first()
    assert audit is not None
    assert audit.actor_id == owner.id
    assert audit.document_id == uuid4() or str(audit.document_id) == data["id"]


def test_empty_file_upload_rejected(client_env):
    client, db, _ = client_env
    owner, cookie, csrf = _create_user(db, "owner_empty@test.com", UserRole.DOCUMENT_OWNER)

    files = {"file": ("empty.txt", io.BytesIO(b""), "text/plain")}
    resp = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        files=files,
    )
    assert resp.status_code == 400
    assert "Cannot upload an empty file" in resp.json()["detail"]


def test_oversized_file_upload_rejected(client_env):
    client, db, settings = client_env
    owner, cookie, csrf = _create_user(db, "owner_large@test.com", UserRole.DOCUMENT_OWNER)

    # test_settings.max_upload_bytes is 1 MB; send 1.1 MB
    huge_bytes = b"0" * (settings.max_upload_bytes + 100)
    files = {"file": ("huge.bin", io.BytesIO(huge_bytes), "application/octet-stream")}
    resp = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        files=files,
    )
    assert resp.status_code == 413
    assert "exceeds maximum allowed upload size" in resp.json()["detail"]


def test_path_traversal_in_filename_sanitized(client_env):
    client, db, _ = client_env
    owner, cookie, csrf = _create_user(db, "owner_traversal@test.com", UserRole.DOCUMENT_OWNER)

    # Malicious filename attempting directory traversal
    malicious_filename = "../../../etc/passwd.txt"
    files = {"file": (malicious_filename, io.BytesIO(b"safe content"), "text/plain")}
    resp = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        files=files,
    )
    assert resp.status_code == 201
    filename = resp.json()["original_filename"]
    # Path separators must be stripped
    assert "/" not in filename
    assert ".." not in filename
    assert "\\" not in filename


# ==========================================
# 2. Access Control, Sharing & Revocation Tests
# ==========================================


def test_owner_can_list_and_download_own_document(client_env):
    client, db, _ = client_env
    owner, cookie, csrf = _create_user(db, "owner_dl@test.com", UserRole.DOCUMENT_OWNER)

    # Upload
    content = b"Financial quarterly earnings"
    files = {"file": ("earnings.pdf", io.BytesIO(content), "application/pdf")}
    upload_resp = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        files=files,
    )
    doc_id = upload_resp.json()["id"]

    # List
    list_resp = client.get("/documents", cookies={COOKIE_NAME_SESSION: cookie})
    assert list_resp.status_code == 200
    docs = list_resp.json()
    assert len(docs) == 1
    assert docs[0]["id"] == doc_id

    # Download
    dl_resp = client.get(f"/documents/{doc_id}/download", cookies={COOKIE_NAME_SESSION: cookie})
    assert dl_resp.status_code == 200
    assert dl_resp.content == content
    assert dl_resp.headers["content-type"] == "application/pdf"
    assert "attachment" in dl_resp.headers["content-disposition"]


def test_another_owner_cannot_access_private_document(client_env):
    client, db, _ = client_env
    owner_a, cookie_a, csrf_a = _create_user(db, "owner_a@test.com", UserRole.DOCUMENT_OWNER)
    owner_b, cookie_b, _ = _create_user(db, "owner_b@test.com", UserRole.DOCUMENT_OWNER)

    # Owner A uploads
    files = {"file": ("a.txt", io.BytesIO(b"Owner A Private"), "text/plain")}
    upload_resp = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie_a},
        headers={"X-CSRF-Token": csrf_a},
        files=files,
    )
    doc_id = upload_resp.json()["id"]

    # Owner B lists -> empty
    list_resp = client.get("/documents", cookies={COOKIE_NAME_SESSION: cookie_b})
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 0

    # Owner B guesses UUID -> 404 (does not leak existence)
    meta_resp = client.get(f"/documents/{doc_id}", cookies={COOKIE_NAME_SESSION: cookie_b})
    assert meta_resp.status_code == 404

    dl_resp = client.get(f"/documents/{doc_id}/download", cookies={COOKIE_NAME_SESSION: cookie_b})
    assert dl_resp.status_code == 404

    # Access denied event logged
    denied = db.query(AuditLog).filter_by(action="access_denied", actor_id=owner_b.id).first()
    assert denied is not None


def test_document_sharing_and_immediate_revocation(client_env):
    client, db, _ = client_env
    owner, cookie_owner, csrf_owner = _create_user(db, "owner_share@test.com", UserRole.DOCUMENT_OWNER)
    viewer, cookie_viewer, _ = _create_user(db, "viewer_share@test.com", UserRole.VIEWER)

    # Step 1: Owner uploads doc
    content = b"Shared Project Proposal"
    files = {"file": ("proposal.pdf", io.BytesIO(content), "application/pdf")}
    upload_resp = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
        files=files,
    )
    doc_id = upload_resp.json()["id"]

    # Step 2: Before share, Viewer cannot see or download -> 404
    assert client.get(f"/documents/{doc_id}", cookies={COOKIE_NAME_SESSION: cookie_viewer}).status_code == 404
    assert client.get(f"/documents/{doc_id}/download", cookies={COOKIE_NAME_SESSION: cookie_viewer}).status_code == 404
    assert len(client.get("/documents", cookies={COOKIE_NAME_SESSION: cookie_viewer}).json()) == 0

    # Step 3: Owner shares with Viewer
    share_resp = client.post(
        f"/documents/{doc_id}/shares",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
        json={"recipient_email": "viewer_share@test.com"},
    )
    assert share_resp.status_code == 201
    share_data = share_resp.json()
    assert share_data["recipient_email"] == "viewer_share@test.com"
    assert share_data["is_active"] is True
    share_id = share_data["id"]

    # Step 4: Viewer can now list, view metadata, and download
    viewer_list = client.get("/documents", cookies={COOKIE_NAME_SESSION: cookie_viewer}).json()
    assert len(viewer_list) == 1
    assert viewer_list[0]["id"] == doc_id

    viewer_meta = client.get(f"/documents/{doc_id}", cookies={COOKIE_NAME_SESSION: cookie_viewer})
    assert viewer_meta.status_code == 200

    viewer_dl = client.get(f"/documents/{doc_id}/download", cookies={COOKIE_NAME_SESSION: cookie_viewer})
    assert viewer_dl.status_code == 200
    assert viewer_dl.content == content

    # Step 5: Duplicate active share request rejected with 409
    dup_resp = client.post(
        f"/documents/{doc_id}/shares",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
        json={"recipient_email": "viewer_share@test.com"},
    )
    assert dup_resp.status_code == 409

    # Step 6: Owner revokes share
    revoke_resp = client.delete(
        f"/documents/{doc_id}/shares/{share_id}",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
    )
    assert revoke_resp.status_code == 200
    assert "revoked successfully" in revoke_resp.json()["message"]

    # Step 7: Immediate revocation check — Viewer is immediately blocked on the very next request!
    assert client.get(f"/documents/{doc_id}", cookies={COOKIE_NAME_SESSION: cookie_viewer}).status_code == 404
    assert client.get(f"/documents/{doc_id}/download", cookies={COOKIE_NAME_SESSION: cookie_viewer}).status_code == 404
    assert len(client.get("/documents", cookies={COOKIE_NAME_SESSION: cookie_viewer}).json()) == 0


def test_invalid_and_self_sharing_rejected(client_env):
    client, db, _ = client_env
    owner, cookie, csrf = _create_user(db, "owner_invalid@test.com", UserRole.DOCUMENT_OWNER)

    # Upload
    files = {"file": ("doc.txt", io.BytesIO(b"data"), "text/plain")}
    doc_id = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        files=files,
    ).json()["id"]

    # 1. Non-existent recipient -> 404
    resp_unknown = client.post(
        f"/documents/{doc_id}/shares",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        json={"recipient_email": "nonexistent@test.com"},
    )
    assert resp_unknown.status_code == 404

    # 2. Self-sharing -> 400
    resp_self = client.post(
        f"/documents/{doc_id}/shares",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        json={"recipient_email": "owner_invalid@test.com"},
    )
    assert resp_self.status_code == 400
    assert "yourself" in resp_self.json()["detail"]


def test_non_owner_cannot_create_or_revoke_shares(client_env):
    client, db, _ = client_env
    owner, cookie_owner, csrf_owner = _create_user(db, "owner_perm@test.com", UserRole.DOCUMENT_OWNER)
    viewer, cookie_viewer, csrf_viewer = _create_user(db, "viewer_perm@test.com", UserRole.VIEWER)

    # Owner uploads
    files = {"file": ("file.txt", io.BytesIO(b"content"), "text/plain")}
    doc_id = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
        files=files,
    ).json()["id"]

    # Viewer attempts to share -> 403
    resp_share = client.post(
        f"/documents/{doc_id}/shares",
        cookies={COOKIE_NAME_SESSION: cookie_viewer},
        headers={"X-CSRF-Token": csrf_viewer},
        json={"recipient_email": "owner_perm@test.com"},
    )
    assert resp_share.status_code == 403

    # Owner shares with viewer
    share_id = client.post(
        f"/documents/{doc_id}/shares",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
        json={"recipient_email": "viewer_perm@test.com"},
    ).json()["id"]

    # Viewer attempts to revoke -> 403
    resp_revoke = client.delete(
        f"/documents/{doc_id}/shares/{share_id}",
        cookies={COOKIE_NAME_SESSION: cookie_viewer},
        headers={"X-CSRF-Token": csrf_viewer},
    )
    assert resp_revoke.status_code == 403


def test_admin_cannot_download_user_document_contents(client_env):
    """Verifies documented moderation separation: Admin sees metadata but cannot download private file contents."""
    client, db, _ = client_env
    owner, cookie_owner, csrf_owner = _create_user(db, "owner_priv@test.com", UserRole.DOCUMENT_OWNER)
    admin, cookie_admin, _ = _create_user(db, "admin_user@test.com", UserRole.ADMIN)

    # Owner uploads
    files = {"file": ("private.pdf", io.BytesIO(b"User secret notes"), "application/pdf")}
    doc_id = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
        files=files,
    ).json()["id"]

    # Admin can view metadata (moderation overview)
    meta = client.get(f"/documents/{doc_id}", cookies={COOKIE_NAME_SESSION: cookie_admin})
    assert meta.status_code == 200

    # Admin CANNOT download file content -> 403 Forbidden
    dl = client.get(f"/documents/{doc_id}/download", cookies={COOKIE_NAME_SESSION: cookie_admin})
    assert dl.status_code == 403
    assert "Admin cannot download user document contents" in dl.json()["detail"]


# ==========================================
# 3. Audit Log Tests
# ==========================================


def test_audit_logs_recording_and_scoping(client_env):
    client, db, _ = client_env
    owner, cookie_owner, csrf_owner = _create_user(db, "owner_audit@test.com", UserRole.DOCUMENT_OWNER)
    viewer, cookie_viewer, _ = _create_user(db, "viewer_audit@test.com", UserRole.VIEWER)

    # Owner uploads doc
    files = {"file": ("audit.txt", io.BytesIO(b"Audit test"), "text/plain")}
    doc_id = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
        files=files,
    ).json()["id"]

    # Owner shares with viewer
    client.post(
        f"/documents/{doc_id}/shares",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
        json={"recipient_email": "viewer_audit@test.com"},
    )

    # Viewer downloads
    client.get(f"/documents/{doc_id}/download", cookies={COOKIE_NAME_SESSION: cookie_viewer})

    # Owner checks audit logs -> sees upload, share_granted, and viewer's download for their document
    owner_logs = client.get("/audit-logs", cookies={COOKIE_NAME_SESSION: cookie_owner}).json()
    actions = [l["action"] for l in owner_logs]
    assert "document_upload" in actions
    assert "share_granted" in actions
    assert "document_download" in actions

    # Viewer checks audit logs -> sees only their own actions (the download), NOT the owner's upload
    viewer_logs = client.get("/audit-logs", cookies={COOKIE_NAME_SESSION: cookie_viewer}).json()
    viewer_actions = [l["action"] for l in viewer_logs]
    assert "document_download" in viewer_actions
    assert "document_upload" not in viewer_actions


def test_owner_can_delete_document_and_viewer_is_denied(client_env):
    client, db, _ = client_env
    owner, cookie_owner, csrf_owner = _create_user(db, "owner_del@test.com", UserRole.DOCUMENT_OWNER)
    viewer, cookie_viewer, csrf_viewer = _create_user(db, "viewer_del@test.com", UserRole.VIEWER)

    # Owner uploads doc
    files = {"file": ("to_delete.txt", io.BytesIO(b"Delete me"), "text/plain")}
    doc_id = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
        files=files,
    ).json()["id"]

    # Viewer cannot delete
    resp = client.delete(
        f"/documents/{doc_id}",
        cookies={COOKIE_NAME_SESSION: cookie_viewer},
        headers={"X-CSRF-Token": csrf_viewer},
    )
    assert resp.status_code == 403

    # Owner can delete
    resp = client.delete(
        f"/documents/{doc_id}",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
    )
    assert resp.status_code == 200

    # Document is now 404
    resp = client.get(f"/documents/{doc_id}", cookies={COOKIE_NAME_SESSION: cookie_owner})
    assert resp.status_code == 404


def test_share_email_notification_status_reported(client_env):
    """Verify that document sharing reports email status truthfully when SMTP is unconfigured vs configured."""
    client, db, _ = client_env
    owner, cookie_owner, csrf_owner = _create_user(db, "owner_mail@test.com", UserRole.DOCUMENT_OWNER)
    viewer, _, _ = _create_user(db, "viewer_mail@test.com", UserRole.VIEWER)

    # Owner uploads doc
    files = {"file": ("email_test.txt", io.BytesIO(b"Confidential Mail Doc"), "text/plain")}
    doc_id = client.post(
        "/documents",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
        files=files,
    ).json()["id"]

    # Share with viewer (unconfigured SMTP in default test environment)
    resp = client.post(
        f"/documents/{doc_id}/shares",
        cookies={COOKIE_NAME_SESSION: cookie_owner},
        headers={"X-CSRF-Token": csrf_owner},
        json={"recipient_email": viewer.email},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["is_active"] is True
    assert data["email_notification_sent"] is False
    assert "Email provider unconfigured" in data["email_notification_note"]

