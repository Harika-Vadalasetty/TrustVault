# TrustVault — Threat Model & Security Mitigations

**Document Version:** 1.0  
**Target Application:** TrustVault (Enterprise Secure Document Sharing & Zero-Trust Audit System)  
**Author:** TrustVault Security Engineering  

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
| **Grant Document Share** | ❌ (Owner only) | ✅ | ❌ | ❌ |
| **Revoke Document Share** | ❌ (Owner only) | ✅ (Instant termination) | ❌ | ❌ |
| **View Document Shares** | ✅ | ✅ | ❌ | ❌ |
| **List All Users** | ✅ | ❌ | ❌ | ❌ |
| **Modify User Roles** | ✅ (Audit logged) | ❌ | ❌ | ❌ |
| **View Full Enterprise Audit Trail** | ✅ | ❌ | ❌ | ❌ |
| **View Scoped Audit Trail** | ✅ (All events) | ✅ (Own docs + personal actions) | ✅ (Personal actions only) | ❌ |

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
