# TrustVault — Threat Model & Security Mitigations

**Document Version:** 1.1  
**Target Application:** TrustVault (Enterprise Secure Document Sharing & Zero-Trust Audit System)  
**Author:** [Harika Vadalasetty](https://github.com/Harika-Vadalasetty)  
**Repository:** [https://github.com/Harika-Vadalasetty/TrustVault](https://github.com/Harika-Vadalasetty/TrustVault)

---

## 1. Role-Based Access Control (RBAC) Matrix

TrustVault enforces a strict, server-side authorization model based on three system roles. Authorization checks always query the live database record for the authenticated user and never trust client-supplied tokens or cookie attributes.

| Capability / Resource | Administrator (`ADMIN`) | Document Owner (`DOCUMENT_OWNER`) | Viewer (`VIEWER`) | Unauthenticated User |
|---|:---:|:---:|:---:|:---:|
| **Public Registration** | ❌ (Forbidden) | ❌ (Forbidden) | ✅ (Default role) | ✅ |
| **Authentication / Login** | ✅ | ✅ | ✅ | ❌ |
| **Document Upload** | ✅ | ✅ | ❌ | ❌ |
| **List Own Documents** | ✅ | ✅ | ❌ | ❌ |
| **List Shared Documents** | ❌ (Own docs only) | ❌ (Own docs only) | ✅ (Active shares only) | ❌ |
| **View All Document Metadata** | ✅ (Compliance oversight) | ❌ (Own only) | ❌ (Shared only) | ❌ |
| **Download Owned Documents** | ✅ (Own docs only) | ✅ | ❌ | ❌ |
| **Download Shared Documents** | ❌ (Access forbidden) | ❌ (Access forbidden) | ✅ (While share is active) | ❌ |
| **Delete Owned Documents** | ❌ (Own docs only) | ✅ | ❌ | ❌ |
| **Grant Document Share** | ❌ (Owner only) | ✅ | ❌ | ❌ |
| **Revoke Document Share** | ❌ (Owner only) | ✅ (Instant termination) | ❌ | ❌ |
| **View Document Shares** | ✅ | ✅ | ❌ | ❌ |
| **List All Users** | ✅ | ❌ | ❌ | ❌ |
| **Modify User Roles** | ✅ (Audit logged) | ❌ | ❌ | ❌ |
| **View Full Enterprise Audit Trail** | ✅ | ❌ | ❌ | ❌ |
| **View Scoped Audit Trail** | ✅ (All events) | ✅ (Own docs + personal actions) | ✅ (Personal actions only) | ❌ |

---

## 2. Security Threat & Automated Test Verification Matrix

Each threat vector is guarded by active backend controls and verified by automated integration tests:

| Threat ID | Threat Vector | Implemented Defensive Control | Automated Test Verification |
|---|---|---|---|
| **T-01** | Privilege Escalation on Registration | Public endpoint enforces `VIEWER`; rejects role manipulation with HTTP 403 | `tests/test_auth.py::test_attempted_admin_registration_forbidden` |
| **T-02** | Session Cookie Forgery / Tampering | HMAC-SHA256 signature verification with constant-time comparison | `tests/test_session.py::test_tampered_signature_rejected`<br>`tests/test_dependencies.py::test_tampered_signature_returns_401` |
| **T-03** | Expired Session Hijacking | Strict timestamp expiration check on `exp` claim | `tests/test_session.py::test_expired_session_rejected`<br>`tests/test_dependencies.py::test_expired_session_cookie_returns_401` |
| **T-04** | Cross-Site Request Forgery (CSRF) | Session-bound HMAC tokens validated on mutating routes (`POST`, `PATCH`, `DELETE`) | `tests/test_dependencies.py::test_csrf_validation_success_and_failure`<br>`tests/test_session.py::test_csrf_mismatch_rejected` |
| **T-05** | CSRF Cross-Session Token Reuse | Tokens cryptographically tied to session UUID | `tests/test_session.py::test_csrf_cannot_be_reused_across_sessions` |
| **T-06** | Insecure Direct Object Reference (IDOR) | Mandatory SQL ownership and active share verification | `tests/test_documents.py::test_another_owner_cannot_access_private_document` |
| **T-07** | Directory Path Traversal | Files stored by 48-char hex keys; `_resolve_safe_path` sandboxing | `tests/test_documents.py::test_path_traversal_in_filename_sanitized` |
| **T-08** | Stale Permissions & Delayed Revocation | Immediate timestamp recording; instant database-level access cut-off | `tests/test_documents.py::test_document_sharing_and_immediate_revocation` |
| **T-09** | Unauthorized Share Delegation | Non-owners blocked from creating or revoking document shares | `tests/test_documents.py::test_non_owner_cannot_create_or_revoke_shares` |
| **T-10** | Admin Content Snoop (Least Privilege) | Administrators explicitly barred from downloading private user documents | `tests/test_documents.py::test_admin_cannot_download_user_document_contents` |
| **T-11** | Sole Admin Self-Demotion / Lockout | System prevents last admin from demoting themselves or leaving 0 admins | `tests/test_admin.py::test_admin_cannot_demote_sole_admin` |
| **T-12** | Audit Trail Tampering / Exposure | Append-only database table; strict user/document scoping | `tests/test_documents.py::test_audit_logs_recording_and_scoping` |
| **T-13** | File Upload Abuse (Empty / Oversized) | Enforced 10MB ceiling; empty payload rejection | `tests/test_documents.py::test_empty_file_upload_rejected`<br>`tests/test_documents.py::test_oversized_file_upload_rejected` |

---

## 2. Threat Analysis & Defensive Mitigations

### 2.1 Threat: Privilege Escalation via Public Registration
- **Threat Vector:** Malicious users register accounts while attempting to inject `role: "ADMIN"` or `role: "DOCUMENT_OWNER"` in the payload to gain unauthorized administrative or storage privileges.
- **Mitigation:**
  - `POST /auth/register` hardcodes new registrations strictly to `UserRole.VIEWER`.
  - If a client supplies `role="ADMIN"`, the backend explicitly rejects the request with `HTTP 403 Forbidden`.
  - Roles can only be elevated by an existing `ADMIN` via `PATCH /admin/users/{id}/role`.

### 2.2 Threat: Cookie Tampering & Session Forgery
- **Threat Vector:** An attacker tampers with the `tv_session` cookie to impersonate other users or extend expired session lifetimes.
- **Mitigation:**
  - Sessions are cryptographically signed using HMAC-SHA256 (`backend/app/session.py`).
  - Signature verification uses constant-time string comparison (`hmac.compare_digest`) to prevent timing attacks.
  - Payloads contain strictly minimal data: `user_id`, `session_id`, and `exp`. Roles, emails, and passwords are never included in the cookie payload.
  - If the cookie signature fails, the timestamp is expired, or the user is not found in the live database, the server fails closed with `HTTP 401 Unauthorized`.
  - Cookies are marked `HttpOnly` to eliminate client-side script access (mitigating XSS session theft).

### 2.3 Threat: Cross-Site Request Forgery (CSRF)
- **Threat Vector:** An attacker lures an authenticated user to a malicious site that executes unauthorized state-changing operations (such as revoking document shares, modifying user roles, or uploading rogue files).
- **Mitigation:**
  - CSRF tokens are cryptographically bound to the authenticated session ID: `HMAC-SHA256("trustvault-csrf:" + session_id, SESSION_SECRET)`.
  - The token is validated on all mutating requests (`POST`, `PATCH`, `DELETE`) via the `require_csrf` FastAPI dependency.
  - A stolen cookie alone cannot execute state changes without the matching session-bound `X-CSRF-Token` header.
  - CSRF tokens cannot be reused across different user sessions.

### 2.4 Threat: Insecure Direct Object References (IDOR)
- **Threat Vector:** A malicious user or viewer manipulates UUIDs in document URLs (`/documents/{id}/download` or `/documents/{id}/shares`) to access files belonging to other owners.
- **Mitigation:**
  - Every document and share endpoint performs server-side ownership and permission checks within the database transaction.
  - For download requests, the backend verifies that the caller is either the verified `owner_id` or has an active, non-revoked record in `document_shares`.
  - Unauthorized access attempts return `HTTP 404 Not Found` rather than `403` to prevent attackers from enumerating valid document IDs.
  - Access violations are immediately recorded in the append-only `AuditLog` table under `action="access_denied"`.

### 2.5 Threat: Directory Path Traversal & Unpredictable File Storage
- **Threat Vector:** Attackers upload files with malicious filenames (e.g., `../../etc/passwd` or `..\Windows\System32\cmd.exe`) to overwrite critical system files or read arbitrary server paths.
- **Mitigation:**
  - Uploaded files are never stored on disk using their original user-provided filenames.
  - Each file is assigned an unpredictable 48-character hexadecimal storage key generated via `secrets.token_hex(24)`.
  - Storage path resolution strictly enforces that the canonical path resides inside the configured `storage_dir`:
    ```python
    if not str(target_path).startswith(str(base_dir)):
        raise HTTPException(status_code=400, detail="Illegal storage path traversal detected")
    ```
  - When downloading, the original filename is sanitized (`SAFE_FILENAME_REGEX`) and returned with `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`.

### 2.6 Threat: Stale Permissions & Delayed Revocation
- **Threat Vector:** An owner revokes a user's document access, but the recipient continues to download or view the file due to cached access tokens or delayed cache invalidation.
- **Mitigation:**
  - Revocation is instantaneous: `DELETE /documents/{id}/shares/{share_id}` sets `revoked_at = datetime.now(timezone.utc)` in the database immediately.
  - Download queries check `revoked_at.is_(None)` on every single file request.
  - The revoked recipient is barred immediately on their very next request.

### 2.7 Threat: Administrative Overreach / Insider Threat
- **Threat Vector:** A rogue administrator attempts to read sensitive intellectual property or confidential files belonging to system users.
- **Mitigation:**
  - Principle of Least Privilege: Administrators have system oversight (viewing metadata, user management, and security audit logs), but are explicitly barred by the backend from downloading user file contents (`HTTP 403 Forbidden: Admin cannot download user document contents`).
  - Administrators cannot view file contents unless an owner explicitly shares the document with them as a recipient.

### 2.8 Threat: Audit Trail Tampering
- **Threat Vector:** An attacker attempts to modify or delete logs of their illicit actions.
- **Mitigation:**
  - The `AuditLog` table is append-only; no endpoints exist to update or delete audit records.
  - Audit records log the actor's UUID, target document UUID, action type, timestamp, and metadata.
  - Audit queries are strictly scoped: regular users cannot view other users' logs.
