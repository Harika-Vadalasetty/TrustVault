# TrustVault — Production Deployment Guide & Readiness

**Project:** TrustVault  
**Challenge:** Snovasys Fresher Hiring Challenge 2026  
**Status:** Deployment-Ready (Verified Build & Automated Test Suite Passing)  

---

## 1. Deployment Architecture

TrustVault is designed as a decoupled, modern multi-tier cloud application:
1. **Frontend Tier:** Single Page Application (SPA) built with React 19, Vite, and Tailwind CSS v4, deployed to **Vercel** or **Netlify**.
2. **Backend API Tier:** High-performance asynchronous FastAPI service deployed to **Render** or **Railway** (or Docker container).
3. **Database Tier:** Managed PostgreSQL database hosted on **Supabase** with connection pooling.
4. **Storage Tier:** Local path-traversal protected persistent disk volume, or private Supabase Storage bucket.

```
[ Web Browser ]
      │
      ├── HTTPS (Static Assets) ────────► [ Vercel / Netlify ] (React 19 SPA)
      │
      └── HTTPS + Secure Cookie + CSRF ──► [ Render / Railway ] (FastAPI API)
                                                   │
                                                   ├── SQL Pooler ────► [ Supabase PostgreSQL ]
                                                   └── Persistent FS ──► [ Encrypted Storage Volume ]
```

---

## 2. Production Environment Configuration

Set the following environment variables in your backend hosting provider (e.g., Render / Railway dashboard):

| Variable Name | Production Setting | Description |
|---|---|---|
| `ENVIRONMENT` | `production` | Enables production hardening and logging |
| `FRONTEND_ORIGIN` | `https://your-trustvault.vercel.app` | Allowed CORS origin matching frontend domain |
| `DATABASE_URL` | `postgresql+psycopg://postgres.<ref>:<pw>@aws-0-....pooler.supabase.com:6543/postgres` | PostgreSQL connection string |
| `SESSION_SECRET` | *Cryptographically random 32+ char string* | Used for HMAC-SHA256 session and CSRF token signing |
| `SESSION_TTL_MINUTES` | `480` | Session lifetime (8 hours) |
| `COOKIE_SECURE` | `true` | Ensures `tv_session` cookie is sent strictly over HTTPS |
| `COOKIE_SAMESITE` | `none` (cross-domain) or `lax` (same-domain) | Cookie SameSite policy |
| `MAX_UPLOAD_BYTES` | `10485760` | Maximum file upload limit (10MB) |
| `ALLOWED_EXTENSIONS`| `pdf,png,jpg,jpeg,docx,txt` | Whitelisted file extensions |
| `STORAGE_DIR` | `/var/data/storage_local` (or persistent mount) | Path to persistent storage disk |
| `DEMO_PASSWORD` | *Strong custom password* | Password for seeded demo accounts |

---

## 3. Step-by-Step Provider Deployment

### Step 3.1: Database Provisioning (Supabase)
1. In your [Supabase Dashboard](https://supabase.com), create a new project.
2. Under **Project Settings > Database**, copy the **Transaction Pooler URI** (`port 6543`).
3. Set `DATABASE_URL` in your environment.

### Step 3.2: Backend Deployment (Render / Railway)
1. Connect the TrustVault GitHub repository.
2. Configure service settings:
   - **Root Directory:** `backend`
   - **Build Command:** `pip install -r requirements.txt && alembic upgrade head`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path:** `/health`
3. Add a Persistent Disk mounted at `/var/data/storage_local` to persist uploaded documents across redeployments.
4. Input all production environment variables from the table above.
5. Deploy and verify health check: `curl https://<backend-service>.onrender.com/health`.

### Step 3.3: Frontend Deployment (Vercel)
1. Import the repository in [Vercel](https://vercel.com).
2. Configure project settings:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Add a `vercel.json` rewrites file in `frontend/` to route API calls to your live backend:
   ```json
   {
     "rewrites": [
       { "source": "/auth/(.*)", "destination": "https://<backend-service>.onrender.com/auth/$1" },
       { "source": "/documents/(.*)", "destination": "https://<backend-service>.onrender.com/documents/$1" },
       { "source": "/documents", "destination": "https://<backend-service>.onrender.com/documents" },
       { "source": "/admin/(.*)", "destination": "https://<backend-service>.onrender.com/admin/$1" },
       { "source": "/audit-logs", "destination": "https://<backend-service>.onrender.com/audit-logs" },
       { "source": "/health", "destination": "https://<backend-service>.onrender.com/health" }
     ]
   }
   ```
4. Deploy the frontend.

---

## 4. Verification & Health Probes

Once deployed:
1. **Liveness Check:** `GET https://<backend-url>/health` must return `{"status": "ok", "service": "trustvault-api"}`.
2. **Database Probe:** `GET https://<backend-url>/health/db` must return `{"status": "ok", "database": "reachable"}`.
3. **Seed Verification:** Run `python scripts/seed.py` via the host shell or CI/CD pipeline to initialize demo accounts.

---

## 5. Deployment Status & Boundaries

- **Local Verification:**
  - Backend test suite: **58 passed (100%)**.
  - Frontend production build: **Successful (`dist/index.html` generated in 895ms)**.
  - Database schema: **Migrated with all tables in place**.
- **Live Cloud Deployment:**
  - A live external deployment requires hosting credentials, provider authentication (e.g. Vercel / Render token), or manual repository linkage on your account.
  - Follow the steps in Section 3 above to link and trigger the automated live build.
