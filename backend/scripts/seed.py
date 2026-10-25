"""Idempotent and safe database seed script for TrustVault demo accounts.

Creates default demo accounts for all three roles:
  1. Admin: admin@trustvault.local
  2. Document Owner: owner@trustvault.local
  3. Viewer: viewer@trustvault.local

Safe to run multiple times: existing users and their data are preserved.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = str(Path(__file__).resolve().parent.parent)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.config import get_settings
from app.db import check_database, get_session
from app.models.user import User, UserRole
from app.security import hash_password

DEFAULT_DEMO_PASSWORD = "TrustVaultDemo@2026!"

DEMO_ACCOUNTS = [
    {
        "email": "admin@trustvault.local",
        "role": UserRole.ADMIN,
        "description": "System Administrator",
    },
    {
        "email": "owner@trustvault.local",
        "role": UserRole.DOCUMENT_OWNER,
        "description": "Document Owner",
    },
    {
        "email": "viewer@trustvault.local",
        "role": UserRole.VIEWER,
        "description": "Document Viewer",
    },
]


def seed_database() -> None:
    settings = get_settings()
    if not settings.database_configured:
        print("[ERROR] DATABASE_URL is not configured. Set it in .env before seeding.")
        sys.exit(1)

    try:
        check_database()
        print("[INFO] Database connection verified.")
    except Exception as e:
        print(f"[ERROR] Cannot connect to database: {e}")
        sys.exit(1)

    demo_password = settings.demo_password or DEFAULT_DEMO_PASSWORD
    hashed_pwd = hash_password(demo_password)

    session_gen = get_session()
    db = next(session_gen)
    created_count = 0
    existing_count = 0

    try:
        for acc in DEMO_ACCOUNTS:
            email = acc["email"]
            role = acc["role"]
            existing = db.query(User).filter(User.email == email).first()
            if existing:
                print(f"[SKIP] Account already exists: {email} (role: {existing.role.value})")
                existing_count += 1
            else:
                new_user = User(
                    email=email,
                    password_hash=hashed_pwd,
                    role=role,
                )
                db.add(new_user)
                created_count += 1
                print(f"[CREATE] Created demo account: {email} (role: {role.value})")

        db.commit()
        print(f"[SUCCESS] Seeding complete: {created_count} created, {existing_count} already existed.")
        print(f"[INFO] Default demo password: {demo_password}")
    except Exception as e:
        db.rollback()
        print(f"[ERROR] Failed to seed demo accounts: {e}")
        sys.exit(1)
    finally:
        try:
            next(session_gen)
        except StopIteration:
            pass


if __name__ == "__main__":
    seed_database()
