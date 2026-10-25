# TrustVault — Hackathon Demo Video Script & Walkthrough

**Challenge:** Snovasys Fresher Hiring Challenge 2026  
**Project:** TrustVault (Enterprise Secure Document Sharing & Zero-Trust Audit System)  
**Target Duration:** 2 minutes 30 seconds to 3 minutes  
**Format:** Screen recording with voiceover narration  

---

## 📋 Pre-Demo Preparation Checklist

1. **Terminal 1 (Backend):**
   ```powershell
   Set-Location "C:\Users\BHARGAVI\TrustVault\backend"
   ..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
   ```
2. **Terminal 2 (Frontend):**
   ```powershell
   Set-Location "C:\Users\BHARGAVI\TrustVault\frontend"
   npm run dev
   ```
3. **Browser Setup:**
   - Open browser to `http://localhost:5173`.
   - Prepare a sample PDF or document (e.g., `Financial_Audit_Q4.pdf` or `Project_Specs.pdf`).
   - Have a private/incognito window ready or use the quick sign-out button to demonstrate role switching.

---

## 🎬 Minute-by-Minute Demonstration Script

### Scene 1: Introduction & The Core Problem (0:00 – 0:30)
- **Visual:** Open on the TrustVault login screen showing the sleek header, zero-trust badge, and quick demo logins.
- **Narration:**
  > *"Hello everyone! In modern organizations, document sharing is broken. Sensitive contracts, intellectual property, and compliance reports are often shared through static links or email attachments that cannot be revoked once sent, and administrators often have unrestricted access to private files.  
  > Welcome to **TrustVault** — an enterprise-grade document sharing system designed with zero-trust architecture, cryptographic session security, instantaneous access revocation, and an append-only audit trail."*

---

### Scene 2: Role-Based Access & Document Upload (0:30 – 1:05)
- **Action:** Click the **📁 Owner** quick login button (`owner@trustvault.local`), then click **Sign In Securely**.
- **Visual:** The Document Owner Dashboard appears showing "My Vault", search bar, and "Upload Document" button.
- **Action:** Click **Upload Document**, select `Financial_Audit_Q4.pdf`, and click **Upload**.
- **Narration:**
  > *"Let's sign in as our Document Owner. Behind the scenes, TrustVault verifies an Argon2id password hash, issues an HMAC-SHA256 signed HTTP-only cookie, and establishes a session-bound CSRF token.  
  > When I upload this document, TrustVault parses the multipart stream safely, validates the 10MB limit and file type, and assigns an unpredictable 48-character hexadecimal storage key while enforcing path-traversal boundaries. The file appears immediately in our vault."*

---

### Scene 3: Granular Sharing & Instant Revocation (1:05 – 1:50)
- **Action:** Click the **Share** button next to the uploaded document.
- **Visual:** The "Manage Document Access" modal opens.
- **Action:** Enter `viewer@trustvault.local` into the recipient field and click **Grant Access**.
- **Narration:**
  > *"Now I want to grant access to an auditor with the email `viewer@trustvault.local`. The share is granted, and an audit event is logged.  
  > Let's verify: I'll log out and sign in as our **Viewer** using the quick demo login.  
  > Notice the Viewer dashboard only displays 'Shared with Me' — viewers cannot upload files or view unshared documents. The viewer can click 'Download' to inspect the file."*
- **Action:** Log back in as **Owner**, open the share modal, and click **Revoke Access**.
- **Action:** Switch back to the **Viewer** and attempt to access or refresh the document list.
- **Narration:**
  > *"Now watch the true power of TrustVault: when the Owner clicks **Revoke Access**, revocation is instantaneous. On the very next request, the database enforces that `revoked_at` is set, immediately barring the Viewer from downloading or discovering the file."*

---

### Scene 4: Administrator Oversight & Least Privilege (1:50 – 2:25)
- **Action:** Sign in as **🛡️ Admin** (`admin@trustvault.local`).
- **Visual:** Admin dashboard opens with high-level metrics cards (Total Users, Total Documents, Active Shares, Audit Events).
- **Action:** Switch between **User Management** (showing user role dropdowns) and **Audit Trail** (showing event filter).
- **Narration:**
  > *"Finally, let's examine the Administrator role. Admins have access to system metrics, user role governance, and the full append-only audit trail.  
  > Notice every upload, download, share, and revocation event is logged with actor IDs and timestamps.  
  > Crucially, adhering to the principle of least privilege, Administrators can monitor document metadata for compliance, but are strictly barred by the backend from downloading private document contents."*

---

### Scene 5: Security Architecture & Closing (2:25 – 2:45)
- **Visual:** Show the test suite report in terminal (58 tests passing) or the GitHub repository with documentation.
- **Narration:**
  > *"TrustVault is built on FastAPI, PostgreSQL, SQLAlchemy, React 19, and Tailwind CSS. The entire platform is backed by 58 automated security tests covering IDOR, CSRF, session tampering, and RBAC restrictions.  
  > TrustVault proves that enterprise document sharing can be frictionless, private, and mathematically verifiable. Thank you!"*

---

## 🎥 Recording Instructions
1. Use OBS Studio, Windows Game Bar (`Win + G`), or Loom to record at 1080p (1920x1080).
2. Record system audio and clear microphone narration following the script above.
3. Save the resulting recording as `TrustVault_Demo.mp4`.
