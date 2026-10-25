# TrustVault — Architecture & Engineering Design

This document details the architectural blueprints, component interactions, threat boundaries, and cryptographic models implemented across **TrustVault**.

---

## 1. High-Level System Architecture

TrustVault operates as a decoupled multi-tier web application structured around the **Zero-Trust principle**: *never trust, always verify*. Client-side state, tokens, or route guards are treated as untrusted user interface helpers; every mutating or data-fetching operation is independently verified at the server and database level.

```mermaid
graph TD
    subgraph Client["Client Tier (Browser)"]
        UI["React 19 + TypeScript SPA"]
        CookieJar["HTTP-Only Cookie Storage (tv_session)"]
        HeaderStore["Session-Bound Anti-CSRF Header (X-CSRF-Token)"]
    end

    subgraph Edge["Ingress & Transport"]
        TLS["HTTPS / TLS Termination"]
        Proxy["Vite Dev Proxy / Cloud Ingress"]
    end

    subgraph Backend["FastAPI Backend (Async ASGI)"]
        Deps["Live RBAC & Dependency Injection (dependencies.py)"]
        SessionEng["HMAC-SHA256 Session Validator (session.py)"]
        Routes["API Controllers: /auth, /documents, /admin, /audit-logs"]
        StorageAdapter["Safe Path Storage Abstraction (storage.py)"]
        AuditLogger["Append-Only Audit Engine (audit.py)"]
    end

    subgraph Data["Persistence Tier"]
        DB[(PostgreSQL / Supabase)]
        Disk[("Persistent Volume / Hex Storage (storage_local/)")]
    end

    UI -->|API Requests with Cookie & CSRF| TLS
    TLS --> Proxy
    Proxy --> Routes
    Routes --> Deps
    Deps --> SessionEng
    Deps --> DB
    Routes --> StorageAdapter
    StorageAdapter --> Disk
    Routes --> AuditLogger
    AuditLogger --> DB
```

---

## 2. Entity-Relationship Data Model

The relational persistence tier is managed via **SQLAlchemy 2.0 ORM** and declarative **Alembic migrations**.

```mermaid
erDiagram
    User {
        uuid id PK
        string email UK
        string password_hash
        string role
        boolean is_active
        timestamp created_at
        timestamp updated_at
    }

    Document {
        uuid id PK
        uuid owner_id FK
        string filename
        string storage_key UK
        string mime_type
        integer file_size
        string category
        string sha256_hash
        timestamp created_at
        timestamp updated_at
    }

    DocumentShare {
        uuid id PK
        uuid document_id FK
        uuid recipient_id FK
        string permission
        timestamp granted_at
        timestamp revoked_at
    }

    AuditLog {
        uuid id PK
        uuid actor_id FK
        uuid target_document_id FK
        string action
        string ip_address
        string user_agent
        json metadata
        timestamp created_at
    }

    User ||--o{ Document : "owns"
    User ||--o{ DocumentShare : "receives"
    User ||--o{ AuditLog : "initiates"
    Document ||--o{ DocumentShare : "shared via"
    Document ||--o{ AuditLog : "subject of"
```

---

## 3. Core Cryptographic & Security Workflows

### 3.1 Authentication & Session Issuance

1. The client posts credentials to `POST /auth/login`.
2. The server queries the database for the user record and verifies the Argon2id password hash using `pwdlib`.
3. If valid, the session subsystem generates an unpredictable UUID `session_id`.
4. The server creates an HMAC-SHA256 signature combining `user_id`, `session_id`, and `exp` timestamp using `SESSION_SECRET`.
5. The signed token is sent as an `HttpOnly`, `SameSite=Lax` cookie (`tv_session`).
6. A derived anti-CSRF token is generated from `HMAC-SHA256("trustvault-csrf:" + session_id, SESSION_SECRET)` and returned in the JSON payload for client header injection.

```mermaid
sequenceDiagram
    autonumber
    actor User as Client (Browser)
    participant Auth as Auth Controller (/auth/login)
    participant DB as PostgreSQL Database
    participant Sess as Session Engine (session.py)

    User->>Auth: POST /auth/login {email, password}
    Auth->>DB: SELECT * FROM users WHERE email = :email
    DB-->>Auth: User Record (Argon2 Hash)
    Auth->>Auth: Verify Argon2id Password Hash
    alt Credentials Invalid
        Auth-->>User: HTTP 401 Unauthorized (Generic Error)
    else Credentials Valid
        Auth->>Sess: create_session_cookie(user_id)
        Sess-->>Auth: HMAC-SHA256 Cookie & CSRF Token
        Auth->>DB: INSERT INTO audit_logs (LOGIN)
        Auth-->>User: HTTP 200 OK + Set-Cookie: tv_session + JSON {csrf_token}
    end
```

---

### 3.2 Granular Sharing & Instantaneous Revocation

When an owner shares a document:
- A new row is inserted into `document_shares` with `granted_at = NOW()` and `revoked_at = NULL`.
- If an email notification fails or SMTP is unconfigured, the share is still persisted, and `email_notification_sent: false` is truthfully returned.

When an owner revokes access:
- `DELETE /documents/{id}/shares/{share_id}` sets `revoked_at = NOW()`.
- Every subsequent file download query explicitly filters:
  ```sql
  WHERE document_shares.revoked_at IS NULL
  ```
- Because there is no intermediary token caching, revocation propagates instantly on the very next HTTP transaction.

```mermaid
sequenceDiagram
    autonumber
    actor Owner as Document Owner
    participant API as Documents Controller
    participant DB as PostgreSQL
    actor Viewer as Document Viewer

    Owner->>API: DELETE /documents/{id}/shares/{share_id} (Revoke)
    API->>DB: UPDATE document_shares SET revoked_at = NOW() WHERE id = :share_id
    API->>DB: INSERT INTO audit_logs (SHARE_REVOKED)
    API-->>Owner: HTTP 200 OK (Revocation confirmed)

    Note over Viewer,API: Viewer attempts immediate download
    Viewer->>API: GET /documents/{id}/download
    API->>DB: SELECT * FROM document_shares WHERE document_id = :id AND recipient_id = :viewer_id AND revoked_at IS NULL
    DB-->>API: 0 Rows Returned
    API->>DB: INSERT INTO audit_logs (ACCESS_DENIED)
    API-->>Viewer: HTTP 404 Not Found (Access Blocked)
```

---

### 3.3 Separation of Administrative Duties (Least Privilege)

TrustVault strictly enforces separation of duties:
- **Administrators (`ADMIN`)**: Can list users, update roles, view document counts, and inspect the complete enterprise audit trail.
- **Content Restriction**: When an administrator requests `GET /documents/{id}/download`, the backend explicitly denies access (`HTTP 403 Forbidden`) unless the document owner explicitly shared the file with the admin.

```mermaid
flowchart TD
    Req["Request: GET /documents/{id}/download"] --> LiveAuth{"Live DB Role Check"}
    LiveAuth -->|Role == DOCUMENT_OWNER| OwnerCheck{"Is Caller the Owner?"}
    LiveAuth -->|Role == VIEWER| ShareCheck{"Active Unrevoked Share?"}
    LiveAuth -->|Role == ADMIN| AdminDenial["Explicit Content Denial: HTTP 403 Forbidden"]

    OwnerCheck -->|Yes| ServeFile["Serve File Stream (Safe Storage Key)"]
    OwnerCheck -->|No| ShareCheck

    ShareCheck -->|Yes| ServeFile
    ShareCheck -->|No| Deny404["Fail Safe: HTTP 404 Not Found + Audit Log ACCESS_DENIED"]
```

---

## 4. Protected Storage Subsystem

1. **Unpredictable Storage Keys**: Files are written to disk using a 48-character random hexadecimal key (`secrets.token_hex(24)`), preventing enumeration.
2. **Path Traversal Defense**: The storage adapter resolves canonical file paths with `_resolve_safe_path` to guarantee that all operations remain bounded inside `STORAGE_DIR`.
3. **MIME & Signature Verification**: Uploads are inspected against a strict whitelist of content types (`PDF`, `PNG`, `JPEG`, `DOCX`, `TXT`) and capped at 10 MB.
4. **Header Hardening**: Download responses include `X-Content-Type-Options: nosniff` and `Cache-Control: no-store, no-cache, must-revalidate`.
