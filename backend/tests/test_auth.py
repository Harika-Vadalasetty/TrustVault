"""End-to-end tests for TrustVault Stage 3.3 authentication endpoints."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings, get_settings
from app.db import get_session
from app.main import app
from app.models.base import Base
from app.models.user import User, UserRole
from app.security import verify_password
from app.session import COOKIE_NAME_CSRF, COOKIE_NAME_SESSION, create_session_data

TEST_SECRET = "test-secret-key-at-least-32-characters-long!!"


@pytest.fixture
def db_session():
    """Isolated in-memory SQLite database for authentication endpoint tests."""
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
    """TestClient wired to in-memory database and test settings."""
    test_settings = Settings(
        session_secret=TEST_SECRET,
        session_ttl_minutes=60,
        cookie_secure=False,
        cookie_samesite="lax",
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


# ==========================================
# 1. Registration Tests
# ==========================================


def test_successful_registration(client):
    test_client, db, _ = client
    payload = {"email": "NewUser@TrustVault.com", "password": "SecurePassword123!"}
    response = test_client.post("/auth/register", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "newuser@trustvault.com"
    assert data["role"] == "VIEWER"
    assert "id" in data
    assert "password" not in data
    assert "password_hash" not in data

    # Verify user in database and Argon2id hash (never plaintext)
    user = db.query(User).filter_by(email="newuser@trustvault.com").first()
    assert user is not None
    assert user.password_hash.startswith("$argon2id$")
    assert verify_password("SecurePassword123!", user.password_hash)


def test_duplicate_email_registration_rejected(client):
    test_client, _, _ = client
    payload = {"email": "duplicate@test.com", "password": "SecurePassword123!"}
    resp1 = test_client.post("/auth/register", json=payload)
    assert resp1.status_code == 201

    # Second registration with case variation must fail with 409
    resp2 = test_client.post(
        "/auth/register", json={"email": "Duplicate@test.com", "password": "OtherPassword123!"}
    )
    assert resp2.status_code == 409
    assert "already registered" in resp2.json()["detail"]


def test_attempted_admin_registration_forbidden(client):
    test_client, db, _ = client
    payload = {
        "email": "hacker@test.com",
        "password": "Password123!",
        "role": "ADMIN",
    }
    response = test_client.post("/auth/register", json=payload)
    assert response.status_code == 403
    assert "cannot create an ADMIN account" in response.json()["detail"]

    # Verify no user created
    user = db.query(User).filter_by(email="hacker@test.com").first()
    assert user is None


def test_invalid_email_format_rejected(client):
    test_client, _, _ = client
    response = test_client.post(
        "/auth/register", json={"email": "not-an-email", "password": "Password123!"}
    )
    assert response.status_code == 422


def test_short_password_rejected(client):
    test_client, _, _ = client
    response = test_client.post(
        "/auth/register", json={"email": "valid@test.com", "password": "short"}
    )
    assert response.status_code == 422


# ==========================================
# 2. Login Tests
# ==========================================


def test_successful_login_and_cookie_attributes(client):
    test_client, _, _ = client
    # Register first
    test_client.post(
        "/auth/register", json={"email": "login@test.com", "password": "Password123!"}
    )

    # Login
    response = test_client.post(
        "/auth/login", json={"email": "login@test.com", "password": "Password123!"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == "login@test.com"
    assert "csrf_token" in body
    assert len(body["csrf_token"]) > 20
    assert "password" not in body["user"]
    assert "password_hash" not in body["user"]

    # Check cookies
    cookies = response.cookies
    assert COOKIE_NAME_SESSION in cookies
    assert COOKIE_NAME_CSRF in cookies

    # Verify session cookie raw header attributes
    set_cookie_headers = [v for k, v in response.headers.raw if k.lower() == b"set-cookie"]
    session_header = next(h.decode("utf-8") for h in set_cookie_headers if COOKIE_NAME_SESSION in h.decode("utf-8"))
    assert "HttpOnly" in session_header
    assert "SameSite=lax" in session_header or "samesite=lax" in session_header
    assert "Path=/" in session_header or "path=/" in session_header


def test_generic_error_for_unknown_email_and_wrong_password(client):
    test_client, _, _ = client
    test_client.post(
        "/auth/register", json={"email": "existing@test.com", "password": "CorrectPassword1!"}
    )

    # 1. Unknown email
    resp_unknown = test_client.post(
        "/auth/login", json={"email": "nobody@test.com", "password": "SomePassword1!"}
    )
    assert resp_unknown.status_code == 401
    assert resp_unknown.json()["detail"] == "Invalid email or password"

    # 2. Wrong password
    resp_wrong_pw = test_client.post(
        "/auth/login", json={"email": "existing@test.com", "password": "WrongPassword99!"}
    )
    assert resp_wrong_pw.status_code == 401
    assert resp_wrong_pw.json()["detail"] == "Invalid email or password"

    # Both return the identical status code and message
    assert resp_unknown.json() == resp_wrong_pw.json()


# ==========================================
# 3. /auth/me Tests
# ==========================================


def test_auth_me_unauthenticated_returns_401(client):
    test_client, _, _ = client
    response = test_client.get("/auth/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_auth_me_authenticated_returns_user_and_csrf(client):
    test_client, _, _ = client
    test_client.post(
        "/auth/register", json={"email": "me@test.com", "password": "MyPassword123!"}
    )
    login_resp = test_client.post(
        "/auth/login", json={"email": "me@test.com", "password": "MyPassword123!"}
    )
    session_cookie = login_resp.cookies.get(COOKIE_NAME_SESSION)

    # Call /auth/me with session cookie
    response = test_client.get("/auth/me", cookies={COOKIE_NAME_SESSION: session_cookie})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == "me@test.com"
    assert body["user"]["role"] == "VIEWER"
    assert "csrf_token" in body
    # The CSRF token matches the one issued at login for this session
    assert body["csrf_token"] == login_resp.json()["csrf_token"]


def test_auth_me_tampered_cookie_returns_401(client):
    test_client, _, _ = client
    test_client.post(
        "/auth/register", json={"email": "tamper@test.com", "password": "Password123!"}
    )
    login_resp = test_client.post(
        "/auth/login", json={"email": "tamper@test.com", "password": "Password123!"}
    )
    session_cookie = login_resp.cookies.get(COOKIE_NAME_SESSION)
    tampered = session_cookie[:-4] + "fake"

    response = test_client.get("/auth/me", cookies={COOKIE_NAME_SESSION: tampered})
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


# ==========================================
# 4. Logout Tests
# ==========================================


def test_logout_without_csrf_rejected(client):
    test_client, _, _ = client
    test_client.post(
        "/auth/register", json={"email": "logout1@test.com", "password": "Password123!"}
    )
    login_resp = test_client.post(
        "/auth/login", json={"email": "logout1@test.com", "password": "Password123!"}
    )
    session_cookie = login_resp.cookies.get(COOKIE_NAME_SESSION)

    # Logout without CSRF header -> 403
    resp_no_csrf = test_client.post(
        "/auth/logout", cookies={COOKIE_NAME_SESSION: session_cookie}
    )
    assert resp_no_csrf.status_code == 403
    assert resp_no_csrf.json()["detail"] == "CSRF token missing or invalid"

    # Logout with invalid CSRF header -> 403
    resp_bad_csrf = test_client.post(
        "/auth/logout",
        cookies={COOKIE_NAME_SESSION: session_cookie},
        headers={"X-CSRF-Token": "invalid-csrf-token"},
    )
    assert resp_bad_csrf.status_code == 403


def test_logout_with_valid_csrf_clears_cookies(client):
    test_client, _, _ = client
    test_client.post(
        "/auth/register", json={"email": "logout2@test.com", "password": "Password123!"}
    )
    login_resp = test_client.post(
        "/auth/login", json={"email": "logout2@test.com", "password": "Password123!"}
    )
    session_cookie = login_resp.cookies.get(COOKIE_NAME_SESSION)
    csrf_token = login_resp.json()["csrf_token"]

    # Logout with valid session cookie and matching CSRF header
    response = test_client.post(
        "/auth/logout",
        cookies={COOKIE_NAME_SESSION: session_cookie},
        headers={"X-CSRF-Token": csrf_token},
    )
    assert response.status_code == 200
    assert response.json()["message"] == "Logged out successfully"

    # Verify cookies are cleared (max-age=0 or deleted in response headers)
    set_cookie_headers = [v.decode("utf-8") for k, v in response.headers.raw if k.lower() == b"set-cookie"]
    cleared_cookies = [h for h in set_cookie_headers if 'max-age=0' in h.lower() or 'expires=' in h.lower()]
    assert any(COOKIE_NAME_SESSION in h for h in cleared_cookies)
    assert any(COOKIE_NAME_CSRF in h for h in cleared_cookies)
