# TrustVault — Secure Document Sharing

TrustVault is a full-stack web application for secure document sharing, role-based access control, and audit logging. Built for the Snovasys Hackathon 2026.

## Features

- Role-based access: Admin, Document Owner, and Viewer.
- User authentication and protected API endpoints.
- Document upload, listing, download, and sharing.
- Permission revocation and access checks.
- Audit logs for security-relevant operations.
- Responsive React and TypeScript frontend.
- FastAPI backend with database integration.

## Technology Stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Python, FastAPI
- **Database:** PostgreSQL
- **Deployment:** Vercel (frontend), Render (backend)

## Live Demo

- **Website:** https://trust-vault-blond.vercel.app/
- **API:** https://trustvault-backend-harika.onrender.com/
- **API documentation:** https://trustvault-backend-harika.onrender.com/docs

Some endpoints may require authentication. Availability depends on the current deployment configuration.

## Local Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

Open a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Use the local URL printed by Vite. Configure the required environment variables and database before testing authenticated features.

## Testing

Run the backend tests from the `backend` directory:

```bash
python -m pytest
```

Build the frontend from the `frontend` directory:

```bash
npm run build
```

Report test results only after running the commands successfully in the current environment.

## Security

TrustVault is designed around server-side authorization, least privilege, private document access, and audit logging. Security guarantees depend on the deployed configuration and verified implementation.

Do not commit real credentials, `.env` files, session secrets, database passwords, or private documents.

See [SECURITY.md](SECURITY.md), [THREATS.md](THREATS.md), and [ARCHITECTURE.md](ARCHITECTURE.md) for additional details.

## Documentation

- [Architecture](ARCHITECTURE.md)
- [Threat Model](THREATS.md)
- [Security Policy](SECURITY.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Demo Script](DEMO_SCRIPT.md)
- [Submission Checklist](SUBMISSION_CHECKLIST.md)

## Author

Harika Vadalasetty

## License

[MIT License](LICENSE)
