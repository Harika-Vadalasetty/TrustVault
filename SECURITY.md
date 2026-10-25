# TrustVault — Security Policy & Disclosure

## 1. Security Overview

**TrustVault** is engineered following defense-in-depth principles:
- Server-side Zero-Trust authorization querying the live database on every request.
- Cryptographically signed HMAC-SHA256 session cookies (`HttpOnly`, `SameSite=Lax`).
- Session-bound anti-CSRF token verification (`hmac.compare_digest`).
- Argon2id password hashing via `pwdlib`.
- Safe path resolution and 48-character randomized storage keys preventing path traversal.
- Append-only PostgreSQL audit trail.

---

## 2. Reporting a Vulnerability

We welcome responsible security disclosures. If you discover a security vulnerability or weakness in TrustVault, please report it privately:

- **Security Contact:** Harika Vadalasetty
- **Email:** [vadalasettyharika07@gmail.com](mailto:vadalasettyharika07@gmail.com)
- **Subject:** `[Vulnerability Report] TrustVault - <Brief Description>`

### Please include:
1. Steps to reproduce the issue (including sample payloads or HTTP requests).
2. The affected endpoint or component.
3. Potential impact or severity assessment.
4. Proof of Concept (PoC) code or screenshots, if available.

We commit to acknowledging your submission within 48 hours and providing a remediation timeline.

---

## 3. Scope & Threat Boundaries

### Covered in Scope:
- Privilege escalation (e.g., standard users elevating to Admin or Owner).
- Authentication bypasses or session forgery/tampering.
- Insecure Direct Object References (IDOR) on document access or download.
- Cross-Site Request Forgery (CSRF) on state-changing endpoints.
- Path traversal or arbitrary file read/write vulnerabilities.
- Information disclosure or secret leakage in responses.

### Out of Scope:
- Attacks requiring physical access to the server or developer workstation.
- Distributed Denial of Service (DDoS) against unhardened local development servers.
- Social engineering or phishing targeting system administrators.

---

## 4. Security Boundaries & Architectural Limitations

To maintain full engineering transparency and truth in documentation:

1. **Independent Certifications:**
   - TrustVault implements controls inspired by enterprise best practices (separation of duties, immutable audit logs, least-privilege RBAC).
   - *TrustVault has not undergone formal independent external audits for SOC 2 Type II or HIPAA compliance.* Production deployments requiring regulatory compliance must perform independent penetration testing and compliance assessments.
2. **Local Storage vs. Cloud Object Storage:**
   - In local development, files are stored on disk under `STORAGE_DIR` with random hexadecimal keys. In production, persistent encrypted volumes or AWS S3 / Supabase Storage with bucket encryption-at-rest should be enabled.
3. **Transport Security:**
   - Production deployments **must** enforce HTTPS/TLS termination at the reverse proxy or ingress layer to protect session cookies in transit (`COOKIE_SECURE=true`).
4. **Rate Limiting:**
   - While login and upload endpoints implement backend validation, production multi-tenant environments should configure ingress-level rate limiting (e.g., via NGINX, Cloudflare, or FastAPI-Limiter) to mitigate brute-force attacks.
