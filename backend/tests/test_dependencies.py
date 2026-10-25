"""Focused unit tests for Stage 3.2: FastAPI authentication and authorization dependencies."""

from uuid import uuid4
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings, get_settings
from app.db import get_session
from app.dependencies import get_current_user, require_csrf, require_role
from app.models.base import Base
from app.models.user import User, UserRole
from app.security import hash_password
from app.session import COOKIE_NAME_SESSION, create_session_data, sign_session_payload

TEST_SECRET = "test-secret-key-at-least-32-characters-long!!"

# Create a sample FastAPI application with endpoints exercising the dependencies
sample_app = FastAPI(title="DependencySampleApp")


@sample_app.get("/api/me")
def me_endpoint(user: User = Depends(get_current_user)):
    return {
        "id": str(user.id),
        "email": user.email,
        "role": user.role.value,
    }


@sample_app.get("/api/admin-only")
def admin_endpoint(user: User = Depends(require_role(UserRole.ADMIN))):
    return {"status": "ok", "user": user.email, "role": user.role.value}


@sample_app.get("/api/owner-or-admin")
def owner_endpoint(user: User = Depends(require_role(UserRole.DOCUMENT_OWNER, UserRole.ADMIN))):
    return {"status": "ok", "user": user.email, "role": user.role.value}


@sample_app.post("/api/action-with-csrf")
def action_endpoint(
    user: User = Depends(get_current_user),
    _csrf: str = Depends(require_csrf),
):
    return {"status": "action_success", "user": user.email}


@sample_app.post("/api/csrf-only")
def csrf_only_endpoint(_csrf: str = Depends(require_csrf)):
    return {"status": "csrf_valid"}


@pytest.fixture
def db_session():
    """Isolated in-memory SQLite database with StaticPool for test session consistency."""
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
def client(db_session: Session):
    """FastAPI TestClient with overridden database and settings."""
    test_settings = Settings(
        session_secret=TEST_SECRET,
        environment="development",
    )

    def override_get_session():
        try:
            yield db_session
        finally:
            pass

    def override_get_settings():
        return test_settings

    sample_app.dependency_overrides[get_session] = override_get_session
    sample_app.dependency_overrides[get_settings] = override_get_settings

    with TestClient(sample_app) as test_client:
        yield test_client, db_session, test_settings

    sample_app.dependency_overrides.clear()


def _create_user(db: Session, email: str, role: UserRole) -> User:
    user = User(
        id=uuid4(),
        email=email,
        password_hash=hash_password("Passw0rd!123"),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_unauthenticated_request_returns_401(client):
    test_client, _, _ = client
    response = test_client.get("/api/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_invalid_cookie_format_returns_401(client):
    test_client, _, _ = client
    response = test_client.get("/api/me", cookies={COOKIE_NAME_SESSION: "garbage.token"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_tampered_signature_returns_401(client):
    test_client, db, _ = client
    user = _create_user(db, "user@test.com", UserRole.VIEWER)
    cookie, _, _ = create_session_data(user.id, TEST_SECRET)
    payload_b64, sig = cookie.split(".")
    tampered_cookie = f"{payload_b64}.tamperedSignature123"

    response = test_client.get("/api/me", cookies={COOKIE_NAME_SESSION: tampered_cookie})
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_expired_session_cookie_returns_401(client):
    test_client, db, _ = client
    user = _create_user(db, "user@test.com", UserRole.VIEWER)
    cookie = sign_session_payload(
        {"user_id": str(user.id), "session_id": "0123456789abcdef0123456789abcdef", "exp": 1000},
        TEST_SECRET,
    )
    response = test_client.get("/api/me", cookies={COOKIE_NAME_SESSION: cookie})
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_malformed_uuid_in_cookie_returns_401(client):
    test_client, _, _ = client
    cookie = sign_session_payload(
        {"user_id": "not-a-valid-uuid", "session_id": "0123456789abcdef0123456789abcdef", "exp": 9999999999},
        TEST_SECRET,
    )
    response = test_client.get("/api/me", cookies={COOKIE_NAME_SESSION: cookie})
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_unknown_user_in_db_returns_401(client):
    test_client, _, _ = client
    non_existent_id = uuid4()
    cookie, _, _ = create_session_data(non_existent_id, TEST_SECRET)
    response = test_client.get("/api/me", cookies={COOKIE_NAME_SESSION: cookie})
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_valid_session_returns_user(client):
    test_client, db, _ = client
    user = _create_user(db, "alice@trustvault.com", UserRole.VIEWER)
    cookie, _, _ = create_session_data(user.id, TEST_SECRET)

    response = test_client.get("/api/me", cookies={COOKIE_NAME_SESSION: cookie})
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == str(user.id)
    assert body["email"] == "alice@trustvault.com"
    assert body["role"] == "VIEWER"


def test_role_based_access_control(client):
    test_client, db, _ = client
    admin = _create_user(db, "admin@trustvault.com", UserRole.ADMIN)
    owner = _create_user(db, "owner@trustvault.com", UserRole.DOCUMENT_OWNER)
    viewer = _create_user(db, "viewer@trustvault.com", UserRole.VIEWER)

    cookie_admin, _, _ = create_session_data(admin.id, TEST_SECRET)
    cookie_owner, _, _ = create_session_data(owner.id, TEST_SECRET)
    cookie_viewer, _, _ = create_session_data(viewer.id, TEST_SECRET)

    # 1. Admin endpoint
    # Viewer -> 403
    resp = test_client.get("/api/admin-only", cookies={COOKIE_NAME_SESSION: cookie_viewer})
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Insufficient permissions"

    # Owner -> 403
    resp = test_client.get("/api/admin-only", cookies={COOKIE_NAME_SESSION: cookie_owner})
    assert resp.status_code == 403

    # Admin -> 200
    resp = test_client.get("/api/admin-only", cookies={COOKIE_NAME_SESSION: cookie_admin})
    assert resp.status_code == 200
    assert resp.json()["role"] == "ADMIN"

    # 2. Owner-or-Admin endpoint
    # Viewer -> 403
    resp = test_client.get("/api/owner-or-admin", cookies={COOKIE_NAME_SESSION: cookie_viewer})
    assert resp.status_code == 403

    # Owner -> 200
    resp = test_client.get("/api/owner-or-admin", cookies={COOKIE_NAME_SESSION: cookie_owner})
    assert resp.status_code == 200

    # Admin -> 200
    resp = test_client.get("/api/owner-or-admin", cookies={COOKIE_NAME_SESSION: cookie_admin})
    assert resp.status_code == 200


def test_role_authorization_uses_live_database_not_cookie(client):
    """Proves permissions reflect database role updates immediately without cookie changes."""
    test_client, db, _ = client
    user = _create_user(db, "dynamic@trustvault.com", UserRole.VIEWER)
    cookie, _, _ = create_session_data(user.id, TEST_SECRET)

    # Step 1: User is VIEWER -> Admin endpoint denied
    resp = test_client.get("/api/admin-only", cookies={COOKIE_NAME_SESSION: cookie})
    assert resp.status_code == 403

    # Step 2: Promote user in database to ADMIN
    user.role = UserRole.ADMIN
    db.commit()

    # Step 3: Same cookie now succeeds because live DB role is checked
    resp = test_client.get("/api/admin-only", cookies={COOKIE_NAME_SESSION: cookie})
    assert resp.status_code == 200
    assert resp.json()["role"] == "ADMIN"

    # Step 4: Demote user back to VIEWER in database
    user.role = UserRole.VIEWER
    db.commit()

    # Step 5: Same cookie is immediately blocked again
    resp = test_client.get("/api/admin-only", cookies={COOKIE_NAME_SESSION: cookie})
    assert resp.status_code == 403


def test_csrf_validation_success_and_failure(client):
    test_client, db, _ = client
    user_a = _create_user(db, "a@test.com", UserRole.VIEWER)
    user_b = _create_user(db, "b@test.com", UserRole.VIEWER)

    cookie_a, csrf_a, _ = create_session_data(user_a.id, TEST_SECRET)
    cookie_b, csrf_b, _ = create_session_data(user_b.id, TEST_SECRET)

    # 1. Valid matching session and CSRF header -> 200
    resp = test_client.post(
        "/api/action-with-csrf",
        cookies={COOKIE_NAME_SESSION: cookie_a},
        headers={"X-CSRF-Token": csrf_a},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "action_success"

    # 2. Missing CSRF header -> 403
    resp = test_client.post(
        "/api/action-with-csrf",
        cookies={COOKIE_NAME_SESSION: cookie_a},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "CSRF token missing or invalid"

    # 3. Invalid / random CSRF header -> 403
    resp = test_client.post(
        "/api/action-with-csrf",
        cookies={COOKIE_NAME_SESSION: cookie_a},
        headers={"X-CSRF-Token": "bad-csrf-token"},
    )
    assert resp.status_code == 403

    # 4. Cross-session CSRF token reuse (Session A with Session B's CSRF) -> 403
    resp = test_client.post(
        "/api/action-with-csrf",
        cookies={COOKIE_NAME_SESSION: cookie_a},
        headers={"X-CSRF-Token": csrf_b},
    )
    assert resp.status_code == 403


def test_missing_secret_fails_closed_safely(client):
    test_client, db, _ = client
    user = _create_user(db, "safe@test.com", UserRole.VIEWER)
    cookie, csrf, _ = create_session_data(user.id, TEST_SECRET)

    # Override settings with None for session_secret
    unconfigured_settings = Settings(session_secret=None, environment="development")
    sample_app.dependency_overrides[get_settings] = lambda: unconfigured_settings

    # Fails closed with 401/403 rather than crashing or leaking secrets
    resp_me = test_client.get("/api/me", cookies={COOKIE_NAME_SESSION: cookie})
    assert resp_me.status_code == 401
    assert resp_me.json()["detail"] == "Not authenticated"

    resp_csrf = test_client.post(
        "/api/csrf-only",
        cookies={COOKIE_NAME_SESSION: cookie},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp_csrf.status_code == 403
    assert resp_csrf.json()["detail"] == "CSRF token missing or invalid"
