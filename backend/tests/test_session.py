"""Focused unit tests for Stage 3.1: Session cookie signing and session-bound CSRF."""

from datetime import datetime, timezone
import pytest

from app.config import Settings
from app.session import (
    create_session_data,
    generate_csrf_token,
    sign_session_payload,
    verify_csrf_token,
    verify_session_cookie,
)

# Test secret: at least 32 characters, used strictly for automated tests
TEST_SECRET = "test-secret-key-at-least-32-characters-long!!"
DIFFERENT_SECRET = "another-completely-different-test-secret-32-chars!"


def test_create_and_verify_valid_session():
    cookie, csrf, payload = create_session_data("user-1234", TEST_SECRET, ttl_minutes=60)
    assert cookie is not None
    assert csrf is not None
    assert payload["user_id"] == "user-1234"

    verified = verify_session_cookie(cookie, TEST_SECRET)
    assert verified is not None
    assert verified["user_id"] == "user-1234"
    assert verified["session_id"] == payload["session_id"]


def test_tampered_payload_rejected():
    cookie, _, _ = create_session_data("user-1234", TEST_SECRET)
    payload_b64, sig = cookie.split(".")
    tampered_cookie = ("b" if payload_b64[0] != "b" else "c") + payload_b64[1:] + "." + sig
    assert verify_session_cookie(tampered_cookie, TEST_SECRET) is None


def test_tampered_signature_rejected():
    cookie, _, _ = create_session_data("user-1234", TEST_SECRET)
    payload_b64, sig = cookie.split(".")
    tampered_cookie = payload_b64 + "." + ("b" if sig[0] != "b" else "c") + sig[1:]
    assert verify_session_cookie(tampered_cookie, TEST_SECRET) is None


def test_different_secret_rejected():
    cookie, _, _ = create_session_data("user-1234", TEST_SECRET)
    assert verify_session_cookie(cookie, DIFFERENT_SECRET) is None


def test_expired_session_rejected():
    # Construct a payload with a past timestamp
    past_exp = int(datetime.now(timezone.utc).timestamp()) - 100
    expired_payload = {
        "user_id": "user-1234",
        "session_id": "0123456789abcdef0123456789abcdef",
        "exp": past_exp,
    }
    signed_cookie = sign_session_payload(expired_payload, TEST_SECRET)
    assert verify_session_cookie(signed_cookie, TEST_SECRET) is None


def test_fail_closed_on_missing_or_short_secret():
    with pytest.raises(ValueError, match="cannot be empty"):
        create_session_data("user-1234", "")

    with pytest.raises(ValueError, match="at least 32 characters"):
        create_session_data("user-1234", "short-secret")

    with pytest.raises(ValueError, match="cannot be empty"):
        verify_session_cookie("fake.cookie", "")

    with pytest.raises(ValueError, match="at least 32 characters"):
        verify_session_cookie("fake.cookie", "short")


def test_secret_is_not_silently_altered():
    secret_with_trailing_space = TEST_SECRET + " "
    cookie, _, payload = create_session_data("user-1234", secret_with_trailing_space)
    # Verifying with the exact secret succeeds
    assert verify_session_cookie(cookie, secret_with_trailing_space) is not None
    # Verifying without the trailing space fails (proves secret was not stripped)
    assert verify_session_cookie(cookie, TEST_SECRET) is None


def test_reject_non_positive_ttl():
    with pytest.raises(ValueError, match="positive number"):
        create_session_data("user-1234", TEST_SECRET, ttl_minutes=0)

    with pytest.raises(ValueError, match="positive number"):
        create_session_data("user-1234", TEST_SECRET, ttl_minutes=-10)


def test_reject_invalid_payload_types_and_fields():
    # Extra unexpected fields (e.g. role injection)
    extra_field_payload = {
        "user_id": "user-1234",
        "session_id": "0123456789abcdef0123456789abcdef",
        "exp": int(datetime.now(timezone.utc).timestamp()) + 3600,
        "role": "ADMIN",
    }
    cookie = sign_session_payload(extra_field_payload, TEST_SECRET)
    assert verify_session_cookie(cookie, TEST_SECRET) is None

    # Missing session_id
    missing_session_id = {
        "user_id": "user-1234",
        "exp": int(datetime.now(timezone.utc).timestamp()) + 3600,
    }
    cookie2 = sign_session_payload(missing_session_id, TEST_SECRET)
    assert verify_session_cookie(cookie2, TEST_SECRET) is None

    # Invalid exp type (string instead of int)
    invalid_exp_type = {
        "user_id": "user-1234",
        "session_id": "0123456789abcdef0123456789abcdef",
        "exp": "never",
    }
    cookie3 = sign_session_payload(invalid_exp_type, TEST_SECRET)
    assert verify_session_cookie(cookie3, TEST_SECRET) is None


def test_reject_malformed_session_cookie():
    assert verify_session_cookie("not-a-cookie", TEST_SECRET) is None
    assert verify_session_cookie("too.many.dots.in.cookie", TEST_SECRET) is None
    assert verify_session_cookie(None, TEST_SECRET) is None
    assert verify_session_cookie("", TEST_SECRET) is None


def test_session_bound_csrf_success():
    _, csrf, payload = create_session_data("user-1234", TEST_SECRET)
    assert verify_csrf_token(csrf, payload["session_id"], TEST_SECRET) is True


def test_csrf_mismatch_rejected():
    _, _, payload = create_session_data("user-1234", TEST_SECRET)
    assert verify_csrf_token("invalid-csrf-token", payload["session_id"], TEST_SECRET) is False
    assert verify_csrf_token(None, payload["session_id"], TEST_SECRET) is False
    assert verify_csrf_token("", payload["session_id"], TEST_SECRET) is False


def test_csrf_cannot_be_reused_across_sessions():
    """CSRF token generated for session A must fail when presented with session B."""
    _, csrf_a, payload_a = create_session_data("user-a", TEST_SECRET)
    _, csrf_b, payload_b = create_session_data("user-b", TEST_SECRET)

    # Cross-session validation fails
    assert verify_csrf_token(csrf_a, payload_b["session_id"], TEST_SECRET) is False
    assert verify_csrf_token(csrf_b, payload_a["session_id"], TEST_SECRET) is False


def test_payload_contains_no_sensitive_or_role_data():
    _, _, payload = create_session_data("user-1234", TEST_SECRET)
    assert "password" not in payload
    assert "password_hash" not in payload
    assert "role" not in payload
    assert "email" not in payload
    assert set(payload.keys()) == {"user_id", "session_id", "exp"}


def test_settings_require_session_secret():
    # Unconfigured settings raises RuntimeError
    s = Settings(session_secret=None)
    with pytest.raises(RuntimeError, match="SESSION_SECRET is not configured"):
        s.require_session_secret()

    # Too short secret raises ValueError
    s_short = Settings(session_secret="too-short")
    with pytest.raises(ValueError, match="at least 32 characters"):
        s_short.require_session_secret()

    # Valid secret returns exact string without modification
    valid = "my-configured-secret-that-is-at-least-32-chars-long"
    s_valid = Settings(session_secret=valid)
    assert s_valid.require_session_secret() == valid
