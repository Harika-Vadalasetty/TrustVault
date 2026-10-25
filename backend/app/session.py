"""Session cookie signing and session-bound CSRF token utilities.

Uses only Python standard library cryptography (hmac, hashlib, secrets).
Fails closed if the secret is missing or invalid.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

COOKIE_NAME_SESSION = "tv_session"
COOKIE_NAME_CSRF = "tv_csrf"
MIN_SECRET_LENGTH = 32


def _validate_secret(secret: str | None) -> str:
    """Ensure the session secret is present and sufficiently long without altering it."""
    if not secret or not isinstance(secret, str):
        raise ValueError("SESSION_SECRET must be configured and cannot be empty.")
    if len(secret) < MIN_SECRET_LENGTH:
        raise ValueError(
            f"SESSION_SECRET must be at least {MIN_SECRET_LENGTH} characters long."
        )
    return secret


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("utf-8"))


def generate_csrf_token(session_id: str, secret: str) -> str:
    """Generate a CSRF token cryptographically bound to a specific session."""
    valid_secret = _validate_secret(secret)
    if not session_id or not isinstance(session_id, str):
        raise ValueError("session_id must be provided as a non-empty string.")
    message = f"trustvault-csrf:{session_id}".encode("utf-8")
    return hmac.new(valid_secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_csrf_token(
    csrf_token: str | None, session_id: str | None, secret: str
) -> bool:
    """Verify a CSRF token against the session using constant-time comparison."""
    if not csrf_token or not isinstance(csrf_token, str):
        return False
    if not session_id or not isinstance(session_id, str):
        return False
    try:
        expected = generate_csrf_token(session_id, secret)
    except ValueError:
        return False
    return hmac.compare_digest(csrf_token, expected)


def sign_session_payload(payload: dict[str, Any], secret: str) -> str:
    """Encode and sign a session dictionary with HMAC-SHA256."""
    valid_secret = _validate_secret(secret)
    if not isinstance(payload, dict):
        raise ValueError("Payload must be a dictionary.")
    raw_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = _b64url_encode(raw_json)
    signature = hmac.new(
        valid_secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256
    ).digest()
    sig_b64 = _b64url_encode(signature)
    return f"{payload_b64}.{sig_b64}"


def create_session_data(
    user_id: str | UUID,
    secret: str,
    ttl_minutes: int = 480,
) -> tuple[str, str, dict[str, Any]]:
    """Create signed session cookie value, session-bound CSRF token, and raw payload.

    Returns:
        (signed_cookie_value, csrf_token, payload)
    """
    valid_secret = _validate_secret(secret)
    if not isinstance(ttl_minutes, (int, float)) or ttl_minutes <= 0:
        raise ValueError("ttl_minutes must be a positive number.")
    if not user_id:
        raise ValueError("user_id must be provided.")

    now = int(datetime.now(timezone.utc).timestamp())
    exp = now + int(ttl_minutes * 60)
    session_id = secrets.token_hex(16)

    payload = {
        "user_id": str(user_id),
        "session_id": session_id,
        "exp": exp,
    }

    signed_cookie = sign_session_payload(payload, valid_secret)
    csrf_token = generate_csrf_token(session_id, valid_secret)
    return signed_cookie, csrf_token, payload


def verify_session_cookie(
    cookie_value: str | None,
    secret: str,
) -> dict[str, Any] | None:
    """Verify signature and expiry of a session cookie.

    Returns verified payload dictionary if valid, or None if invalid, malformed, or expired.
    """
    valid_secret = _validate_secret(secret)
    if not cookie_value or not isinstance(cookie_value, str):
        return None

    parts = cookie_value.split(".")
    if len(parts) != 2:
        return None

    payload_b64, sig_b64 = parts

    try:
        expected_sig = hmac.new(
            valid_secret.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256
        ).digest()
        expected_sig_b64 = _b64url_encode(expected_sig)
        if not hmac.compare_digest(sig_b64, expected_sig_b64):
            return None

        raw_json = _b64url_decode(payload_b64)
        payload = json.loads(raw_json.decode("utf-8"))
    except Exception:
        return None

    # Enforce minimal required fields and valid types
    if not isinstance(payload, dict):
        return None
    if set(payload.keys()) != {"user_id", "session_id", "exp"}:
        return None

    user_id = payload.get("user_id")
    session_id = payload.get("session_id")
    exp = payload.get("exp")

    if not isinstance(user_id, str) or not user_id:
        return None
    if not isinstance(session_id, str) or len(session_id) < 16:
        return None
    if not isinstance(exp, int):
        return None

    # Check expiry against UTC now
    now = int(datetime.now(timezone.utc).timestamp())
    if exp <= now:
        return None

    return payload
