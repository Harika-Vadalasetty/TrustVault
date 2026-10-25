"""Automated security and functionality tests for Admin endpoints."""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_session
from app.main import app
from app.models.audit import AuditLog
from app.models.document import Document
from app.models.share import DocumentShare
from app.models.user import User, UserRole
from app.security import hash_password
from app.session import COOKIE_NAME_SESSION, create_session_data, generate_csrf_token

TEST_SECRET = "test_session_secret_at_least_32_chars_long_12345"


@pytest.fixture
def admin_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()

    def override_get_session():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_session] = override_get_session
    try:
        yield session
    finally:
        session.close()
        app.dependency_overrides.pop(get_session, None)


@pytest.fixture
def admin_client(monkeypatch: pytest.MonkeyPatch, admin_db: Session) -> TestClient:
    monkeypatch.setenv("SESSION_SECRET", TEST_SECRET)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    from app.config import get_settings

    get_settings.cache_clear()
    return TestClient(app)


def test_admin_endpoints_require_admin_role(admin_client: TestClient, admin_db: Session):
    viewer = User(
        email="viewer_unauth@trustvault.local",
        password_hash=hash_password("Password123!"),
        role=UserRole.VIEWER,
    )
    admin_db.add(viewer)
    admin_db.commit()

    cookie, csrf, _ = create_session_data(user_id=viewer.id, secret=TEST_SECRET)

    # Viewer cannot list users
    resp = admin_client.get("/admin/users", cookies={COOKIE_NAME_SESSION: cookie})
    assert resp.status_code == 403

    # Viewer cannot get stats
    resp = admin_client.get("/admin/stats", cookies={COOKIE_NAME_SESSION: cookie})
    assert resp.status_code == 403

    # Viewer cannot change role
    resp = admin_client.patch(
        f"/admin/users/{viewer.id}/role",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        json={"role": "ADMIN"},
    )
    assert resp.status_code == 403


def test_admin_can_list_users_and_see_document_counts(admin_client: TestClient, admin_db: Session):
    admin = User(
        email="superadmin@trustvault.local",
        password_hash=hash_password("Password123!"),
        role=UserRole.ADMIN,
    )
    owner = User(
        email="doc_owner@trustvault.local",
        password_hash=hash_password("Password123!"),
        role=UserRole.DOCUMENT_OWNER,
    )
    admin_db.add_all([admin, owner])
    admin_db.commit()

    doc = Document(
        owner_id=owner.id,
        original_filename="specs.pdf",
        storage_key="abcdef1234567890abcdef1234567890abcdef1234567890",
        content_type="application/pdf",
        size_bytes=1024,
    )
    admin_db.add(doc)
    admin_db.commit()

    cookie, _, _ = create_session_data(user_id=admin.id, secret=TEST_SECRET)
    resp = admin_client.get("/admin/users", cookies={COOKIE_NAME_SESSION: cookie})
    assert resp.status_code == 200
    users = resp.json()
    assert len(users) >= 2

    owner_entry = next(u for u in users if u["email"] == "doc_owner@trustvault.local")
    assert owner_entry["role"] == "DOCUMENT_OWNER"
    assert owner_entry["document_count"] == 1


def test_admin_can_change_user_role_with_csrf_and_audit(admin_client: TestClient, admin_db: Session):
    admin = User(
        email="admin_role_updater@trustvault.local",
        password_hash=hash_password("Password123!"),
        role=UserRole.ADMIN,
    )
    viewer = User(
        email="viewer_to_promote@trustvault.local",
        password_hash=hash_password("Password123!"),
        role=UserRole.VIEWER,
    )
    admin_db.add_all([admin, viewer])
    admin_db.commit()

    cookie, csrf, _ = create_session_data(user_id=admin.id, secret=TEST_SECRET)

    # Missing CSRF rejected
    resp = admin_client.patch(
        f"/admin/users/{viewer.id}/role",
        cookies={COOKIE_NAME_SESSION: cookie},
        json={"role": "DOCUMENT_OWNER"},
    )
    assert resp.status_code == 403

    # Valid CSRF accepted
    resp = admin_client.patch(
        f"/admin/users/{viewer.id}/role",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        json={"role": "DOCUMENT_OWNER"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "DOCUMENT_OWNER"

    # Verify audit event logged
    audit = admin_db.query(AuditLog).filter_by(action="admin_role_change").first()
    assert audit is not None
    assert audit.actor_id == admin.id
    assert audit.detail["old_role"] == "VIEWER"
    assert audit.detail["new_role"] == "DOCUMENT_OWNER"


def test_admin_cannot_demote_sole_admin(admin_client: TestClient, admin_db: Session):
    sole_admin = User(
        email="sole_admin@trustvault.local",
        password_hash=hash_password("Password123!"),
        role=UserRole.ADMIN,
    )
    admin_db.add(sole_admin)
    admin_db.commit()

    cookie, csrf, _ = create_session_data(user_id=sole_admin.id, secret=TEST_SECRET)

    resp = admin_client.patch(
        f"/admin/users/{sole_admin.id}/role",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
        json={"role": "VIEWER"},
    )
    assert resp.status_code == 400
    assert "sole active administrator" in resp.json()["detail"]


def test_admin_stats(admin_client: TestClient, admin_db: Session):
    admin = User(
        email="stats_admin@trustvault.local",
        password_hash=hash_password("Password123!"),
        role=UserRole.ADMIN,
    )
    admin_db.add(admin)
    admin_db.commit()

    cookie, _, _ = create_session_data(user_id=admin.id, secret=TEST_SECRET)
    resp = admin_client.get("/admin/stats", cookies={COOKIE_NAME_SESSION: cookie})
    assert resp.status_code == 200
    stats = resp.json()
    assert stats["total_users"] >= 1
    assert "role_breakdown" in stats
    assert stats["role_breakdown"]["ADMIN"] >= 1
    assert "storage_used_bytes" in stats
