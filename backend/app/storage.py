"""Secure local storage adapter for TrustVault.

Handles unpredictable key generation, standard-library multipart extraction,
size enforcement, path-traversal protection, and cleanup.
"""

from __future__ import annotations

import os
import re
import secrets
from email import policy
from email.parser import BytesParser
from pathlib import Path

from fastapi import HTTPException, status

HEX_KEY_REGEX = re.compile(r"^[0-9a-f]{32,64}$")
SAFE_FILENAME_REGEX = re.compile(r"[^A-Za-z0-9._-]")


def generate_storage_key() -> str:
    """Generate a 48-character unpredictable hexadecimal storage key."""
    return secrets.token_hex(24)


def sanitize_filename(filename: str | None) -> str:
    """Sanitize original filename for safe use in HTTP response headers."""
    if not filename:
        return "document"
    base = os.path.basename(filename.replace("\\", "/")).strip()
    safe = SAFE_FILENAME_REGEX.sub("_", base)
    safe = safe.strip("._")
    return safe[:100] or "document"


def _resolve_safe_path(storage_key: str, storage_dir: str) -> Path:
    """Resolve and validate the absolute file path inside storage_dir."""
    if not HEX_KEY_REGEX.match(storage_key):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid storage key format",
        )
    base_dir = Path(storage_dir).resolve()
    target_path = (base_dir / storage_key).resolve()

    # Prevent directory traversal attacks
    if not str(target_path).startswith(str(base_dir)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Illegal storage path traversal detected",
        )
    return target_path


def extract_uploaded_file(content_type_header: str, body_bytes: bytes) -> tuple[str, str, bytes]:
    """Parse multipart/form-data upload using standard library without external dependencies.

    Returns:
        (filename, content_type, data_bytes)
    """
    if "multipart/form-data" not in content_type_header.lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Expected multipart/form-data request",
        )

    header_line = f"Content-Type: {content_type_header}\r\n\r\n".encode("utf-8")
    try:
        msg = BytesParser(policy=policy.default).parsebytes(header_line + body_bytes)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Malformed multipart payload",
        )

    for part in msg.iter_parts():
        filename = part.get_filename()
        disp_name = part.get_param("name", header="content-disposition")
        if filename or disp_name == "file":
            payload = part.get_payload(decode=True)
            if payload is None:
                payload = b""
            ct = part.get_content_type() or "application/octet-stream"
            return filename or "document", ct, payload

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No file found in multipart upload",
    )


def save_file_bytes(
    data: bytes,
    storage_dir: str,
    max_bytes: int = 10 * 1024 * 1024,
) -> tuple[str, int]:
    """Save bytes to storage_dir, enforcing empty and size limits.

    Returns:
        (storage_key, size_bytes)
    """
    if len(data) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot upload an empty file",
        )
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="File exceeds maximum allowed upload size",
        )

    base_dir = Path(storage_dir).resolve()
    base_dir.mkdir(parents=True, exist_ok=True)

    storage_key = generate_storage_key()
    target_path = _resolve_safe_path(storage_key, storage_dir)

    try:
        with open(target_path, "wb") as f:
            f.write(data)
    except Exception:
        target_path.unlink(missing_ok=True)
        raise

    return storage_key, len(data)


def get_file_path(storage_key: str, storage_dir: str) -> Path:
    """Retrieve verified file path or raise HTTP 404."""
    path = _resolve_safe_path(storage_key, storage_dir)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File content not found",
        )
    return path


def delete_stored_file(storage_key: str, storage_dir: str) -> bool:
    """Safely delete stored file by key. Returns True if deleted, False otherwise."""
    try:
        path = _resolve_safe_path(storage_key, storage_dir)
        if path.is_file():
            path.unlink(missing_ok=True)
            return True
        return False
    except Exception:
        return False
