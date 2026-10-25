# TrustVault — AI-Assisted Development Prompts Log

**Project:** TrustVault (Snovasys Fresher Hiring Challenge 2026)  
**Repository:** `C:\Users\BHARGAVI\TrustVault`  
**Engineer:** Bhargavi  

This log contains five truthful, dated development entries documenting AI-assisted engineering prompts and architectural decisions during the development of TrustVault, including multiple security-focused implementations.

---

### Entry 1 — Baseline Architecture, Environment Boundaries & Dependencies
- **Date:** October 24, 2026
- **Category:** Architecture & Build Safeguards
- **Prompt:**
  > *"Inspect the TrustVault project directory, ensure strict .gitignore rules to prevent accidental leaks of .env, *.db, *.sqlite, and storage files. Verify that pwdlib[argon2]==0.3.1 is included in backend/requirements.txt for password hashing and confirm no sensitive files will be committed before establishing the initial baseline commit."*
- **Outcome & Engineering Action:**
  - Configured comprehensive `.gitignore` preventing `.env`, Python bytecode, SQLite databases, and uploaded files from being tracked.
  - Verified dependency requirements, pinned `pwdlib[argon2]==0.3.1`, and created baseline commit `9bb9fbb` (`chore: baseline setup and dependencies`).

---

### Entry 2 — Cryptographic Session Signing & Session-Bound CSRF Architecture (Security Focus)
- **Date:** October 24, 2026
- **Category:** Authentication & Cryptographic Integrity
- **Prompt:**
  > *"Implement Stage 3.1 session and CSRF utilities in backend/app/session.py using only Python standard library cryptography. Use HMAC-SHA256 for cookie integrity, enforce timestamp expiration, bind CSRF tokens cryptographically to the session ID, fail closed if SESSION_SECRET is shorter than 32 characters, and ensure cookies contain minimal payloads without sensitive data or roles."*
- **Outcome & Engineering Action:**
  - Implemented `backend/app/session.py` using `hmac`, `hashlib`, and `secrets`.
  - Implemented `create_session_data`, `verify_session_cookie`, and `generate_csrf_token`.
  - Applied constant-time comparison via `hmac.compare_digest` to prevent side-channel timing attacks.
  - Added 15 comprehensive unit tests in `backend/tests/test_session.py` verifying tampered signatures, expired sessions, and invalid inputs fail closed.

---

### Entry 3 — Server-Side RBAC Enforcement & Secure Authentication Routes (Security Focus)
- **Date:** October 24, 2026
- **Category:** Authorization & Defense-in-Depth
- **Prompt:**
  > *"Implement FastAPI authentication dependencies and endpoints in backend/app/dependencies.py and backend/app/api/routes/auth.py. Enforce live database role checks (never trust roles stored in client cookies), restrict public registration strictly to VIEWER accounts while forbidding ADMIN registration attempts, hash passwords with Argon2, and issue HTTP-only SameSite session cookies."*
- **Outcome & Engineering Action:**
  - Built `get_current_user`, `require_role`, and `require_csrf` dependencies.
  - Built `/auth/register`, `/auth/login`, `/auth/logout`, and `/auth/me`.
  - Enforced that public registrations can never self-assign the `ADMIN` role.
  - Wrote automated tests in `test_dependencies.py` and `test_auth.py` ensuring authorization fails closed on unauthorized role access.

---

### Entry 4 — Path-Safe Local File Adapter & Immediate Revocation Mechanism (Security Focus)
- **Date:** October 24, 2026
- **Category:** Secure File Storage & Permission Revocation
- **Prompt:**
  > *"Implement the document storage adapter and routes in backend/app/storage.py and backend/app/api/routes/documents.py. Generate 48-character unpredictable hexadecimal storage keys, prevent path traversal attacks by resolving canonical paths within storage_dir, enforce file size limits, parse multipart uploads using the standard library without extra dependencies, and ensure share revocation terminates download access on the very next request."*
- **Outcome & Engineering Action:**
  - Implemented `_resolve_safe_path` with directory boundary enforcement and filename sanitization.
  - Extracted multipart files safely using Python's `email.parser.BytesParser`.
  - Implemented immediate access revocation: `/documents/{id}/shares/{share_id}` sets `revoked_at`, which is verified on every subsequent download request.
  - Enforced least privilege: administrators are forbidden from downloading private user document contents.
  - Added 13 automated security tests in `test_documents.py`.

---

### Entry 5 — Admin Management, Telemetry & Full-Stack Zero-Trust Integration
- **Date:** October 24, 2026
- **Category:** Full-Stack Integration & Governance
- **Prompt:**
  > *"Complete the missing admin management APIs in backend/app/api/routes/admin.py (user listing with document counts, CSRF-protected role modification, and system telemetry stats). Build the safe, repeatable demo account seed script. Then connect the React frontend to the real backend, replacing all mock data with authenticated API calls for Document Owners, Viewers, and Admins."*
- **Outcome & Engineering Action:**
  - Implemented `/admin/users`, `/admin/users/{id}/role` (with protection against demoting the sole administrator), and `/admin/stats`.
  - Created idempotent seed script `backend/scripts/seed.py` for Admin, Owner, and Viewer roles.
  - Created typed API client `frontend/src/api.ts` with automated CSRF token attachment and HTTP-only cookie support.
  - Implemented complete role-based dashboard UI in `frontend/src/App.tsx`, verified production build (`npm run build`), and verified all 58 backend tests passing.
