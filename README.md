# TrustVault — Enterprise Secure Document Sharing & Zero-Trust Audit System

[![Python](https://img.shields.io/badge/Python-3.13-blue.svg?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB.svg?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4.0-38B2AC.svg?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Tests](https://img.shields.io/badge/Tests-60%2F60%20Passed-brightgreen.svg)]()
[![Security](https://img.shields.io/badge/Security-Zero--Trust%20RBAC-navy.svg)]()

> **Author:** [Harika Vadalasetty](https://github.com/Harika-Vadalasetty)  
> **Repository:** [https://github.com/Harika-Vadalasetty/TrustVault](https://github.com/Harika-Vadalasetty/TrustVault)

---

## 📖 Overview

**TrustVault** is a production-grade, secure document sharing and auditing platform built upon strict **Zero-Trust** principles and defense-in-depth security:
- **Server-Side Live Authorization:** Live database role checks on every single request; client state is never trusted.
- **Cryptographic Session Integrity:** Tamper-resistant HMAC-SHA256 signed session cookies with timestamp expirations.
- **Session-Bound Anti-CSRF Defense:** Double-submit cookie mitigation with constant-time verification (`hmac.compare_digest`).
- **Hardened File Lifecycle:** Unpredictable 48-character hexadecimal storage keys, strict MIME/signature inspection, safe path resolution (`_resolve_safe_path`), and SHA-256 integrity digests.
- **Separation of Duties:** Administrators manage accounts and inspect system telemetry, but **CANNOT** access or download private user document contents.
- **Instantaneous Revocation:** Revoking permissions terminates access immediately on the very next HTTP transaction.
- **Append-Only Audit Trail:** Comprehensive PostgreSQL audit logging of all logins, uploads, downloads, sharing grants, revocations, deletions, and access denials.

---

## 🚀 Key Features

- **Strict Server-Side Role-Based Access Control (RBAC):**
  - **Administrator (`ADMIN`):** Manages user accounts, promotes/demotes roles, inspects system telemetry, and audits security events. *Cannot access or download private user document contents (principle of least privilege).*
  - **Document Owner (`DOCUMENT_OWNER`):** Uploads documents, searches vault, downloads owned files, grants granular access by email, and revokes access immediately.
  - **Viewer (`VIEWER`):** Discovers and downloads only actively shared documents. Public registrations default strictly to Viewer.
- **Immediate Share Revocation:**
  - Revoking document access takes effect instantaneously on the very next HTTP request.
  - Revoked users cannot download or view document metadata.
- **Zero-Trust Audit Trail:**
  - Append-only security log recording: `document_upload`, `document_download`, `share_granted`, `share_revoked`, `access_denied`, `login_success`, `login_failed`, and `admin_role_change`.
  - Scoped retrieval: Owners see events for their documents; Viewers see their own actions; Admins inspect the full enterprise audit log.
- **Enterprise Session & CSRF Security:**
  - Signed HTTP-only session cookies (`tv_session`) using HMAC-SHA256 with timestamp expiration.
  - Session-bound CSRF tokens (`X-CSRF-Token`) validated via constant-time comparisons (`hmac.compare_digest`).
  - Passwords hashed with Argon2id using `pwdlib[argon2]`.
- **Protected File Storage:**
  - Files stored under 48-character unpredictable hexadecimal keys.
  - Path traversal protection (`_resolve_safe_path`) preventing directory traversal attacks.
  - Size enforcement (max 10MB) and empty file rejection.
  - Content-Disposition header sanitization (`X-Content-Type-Options: nosniff`).

---

## 🛠️ Architecture & Tech Stack

```
TrustVault/
├── backend/                  # FastAPI Application
│   ├── alembic/              # Database schema migrations
│   ├── app/
│   │   ├── api/routes/       # Endpoints: auth, documents, admin, health
│   │   ├── models/           # SQLAlchemy ORM models: User, Document, DocumentShare, AuditLog
│   │   ├── schemas/          # Pydantic v2 validation models
│   │   ├── config.py         # Pydantic BaseSettings loaded from .env
│   │   ├── db.py             # Engine & Session factory (PostgreSQL / SQLite)
│   │   ├── dependencies.py   # Auth, live-role verification & CSRF dependencies
│   │   ├── security.py       # Argon2 password hashing utilities
│   │   ├── session.py        # Cryptographic session & CSRF primitives
│   │   ├── storage.py        # Path-safe local file adapter & multipart extractor
│   │   └── audit.py          # Append-only audit logger
│   ├── scripts/
│   │   └── seed.py           # Safe, idempotent demo account seeder
│   └── tests/                # 58 automated security and functionality tests
└── frontend/                 # React 19 + TypeScript + Vite + Tailwind CSS v4
    ├── src/
    │   ├── api.ts            # Typed API client with CSRF token management
    │   ├── App.tsx           # Role-based dashboard interfaces
    │   └── main.tsx          # Application entrypoint
    └── vite.config.ts        # Vite build & local dev reverse-proxy
```

### Technology Highlights
- **Backend:** Python 3.13, FastAPI, SQLAlchemy 2.x, Alembic, PostgreSQL / Psycopg3, Argon2 (`pwdlib`).
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React icons.
- **Testing:** Pytest, HTTPX TestClient (58 passing tests, 100% pass rate).

---

## ⚡ Quick Start: Running Locally

### 1. Prerequisites
- Python 3.11+ (Python 3.13 supported)
- Node.js 18+ and npm
- A PostgreSQL database (e.g., Supabase or local PostgreSQL)

### 2. Environment Setup
Copy `.env.example` to `backend/.env` (or root `.env`):
```bash
cp .env.example backend/.env
```
Ensure `SESSION_SECRET` is set to at least 32 characters, and `DATABASE_URL` points to your PostgreSQL database.

### 3. Database Migration & Safe Demo Accounts
Activate the virtual environment and apply migrations:
```powershell
# In PowerShell:
Set-Location "C:\Users\BHARGAVI\TrustVault\backend"
..\.venv\Scripts\Activate.ps1

# Run Alembic migrations
alembic upgrade head

# Seed demo accounts (safe & idempotent - does not overwrite existing data)
python scripts/seed.py
```

#### Pre-Configured Demo Accounts:
| Role | Email | Default Demo Password |
|---|---|---|
| **Administrator** | `admin@trustvault.local` | `TrustVaultDemo@2026!` |
| **Document Owner** | `owner@trustvault.local` | `TrustVaultDemo@2026!` |
| **Viewer** | `viewer@trustvault.local` | `TrustVaultDemo@2026!` |

*(You can also click the 1-click Quick Demo buttons on the login screen).*

### 4. Running the Backend Server
```powershell
Set-Location "C:\Users\BHARGAVI\TrustVault\backend"
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```
- API Base URL: `http://127.0.0.1:8000`
- Interactive OpenAPI Docs: `http://127.0.0.1:8000/docs`

### 5. Running the Frontend Website
```powershell
Set-Location "C:\Users\BHARGAVI\TrustVault\frontend"
npm run dev
```
Open `http://localhost:5173` in your browser. The Vite dev server proxies `/auth`, `/documents`, `/admin`, and `/audit-logs` directly to port 8000.

---

## 🧪 Verification & Testing

### Run Full Backend Test Suite
```powershell
Set-Location "C:\Users\BHARGAVI\TrustVault\backend"
..\.venv\Scripts\python.exe -m pytest -v
```
**Results:** **60 passed, 0 failed (100% pass rate)** (covers sessions, CSRF, live database role authorization, auth, uploads, downloads, sharing, immediate revocation, document deletion, truthful email reporting, admin role modifications, and health probes).

### Run Frontend Production Build
```powershell
Set-Location "C:\Users\BHARGAVI\TrustVault\frontend"
npm run build
```
**Results:** Production bundle successfully compiled with zero TypeScript errors.

---

## 📡 API Endpoint Summary

### Authentication (`/auth`)
- `POST /auth/register` — Public user registration (creates `VIEWER` account; Argon2 hashed).
- `POST /auth/login` — Authenticates user, issues HTTP-only `tv_session` cookie and CSRF token.
- `POST /auth/logout` — Clears session cookie (CSRF protected).
- `GET /auth/me` — Returns current authenticated user and refreshes CSRF token.

### Documents & Sharing (`/documents`)
- `POST /documents` — Upload new document (`DOCUMENT_OWNER` or `ADMIN`; CSRF protected; max 10MB).
- `GET /documents` — Scoped document list (Owner sees own; Viewer sees active shares; Admin sees all metadata).
- `GET /documents/recipients` — List eligible share recipient emails (`DOCUMENT_OWNER` only).
- `GET /documents/{id}` — Scoped metadata retrieval.
- `GET /documents/{id}/download` — Scoped file download (Owner & active share recipients only; Admin content denied).
- `DELETE /documents/{id}` — Delete document and associated shares/files (Owner only; CSRF protected).
- `POST /documents/{id}/shares` — Share document with recipient email (Owner only; CSRF protected).
- `GET /documents/{id}/shares` — List all shares for a document (Owner only).
- `DELETE /documents/{id}/shares/{share_id}` — Revoke share immediately (Owner only; CSRF protected).

### Administration (`/admin`)
- `GET /admin/users` — List all registered users and their document counts (`ADMIN` only).
- `PATCH /admin/users/{id}/role` — Modify user role (`ADMIN` only; CSRF protected; prevents self-demoting sole admin).
- `GET /admin/stats` — System telemetry: user counts, documents, storage used, share counts, audit events (`ADMIN` only).

### Audit Logs & Health
- `GET /audit-logs` — Scoped audit logs (Owner sees own/doc events; Viewer sees own actions; Admin sees all).
- `GET /health` — Service liveness check (independent of database).
- `GET /health/db` — PostgreSQL connectivity probe.

---

## 🔒 Security Design & Safeguards
Refer to [`THREATS.md`](./THREATS.md) for the comprehensive Threat Model, Role/Access-Control Matrix, and mitigation strategies covering IDOR, CSRF, session tampering, and file upload vulnerabilities.
