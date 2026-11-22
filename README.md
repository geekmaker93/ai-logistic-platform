# AI Logistics Platform MVP

This repository contains a two-part MVP:

- backend: FastAPI service for shipment operations and route optimization
- frontend: Next.js dashboard for shipment workflow management

## Start Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

To run with PostgreSQL instead of the local SQLite fallback, set `DATABASE_URL` first:

```powershell
$env:DATABASE_URL="postgresql+psycopg://postgres:postgres@127.0.0.1:5432/ai_logistics"
```

## Start Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend expects the backend at http://127.0.0.1:8000 by default.

## Deploy on Vercel

Import the repository as a Vercel project with the repository root as the project
root. The root `vercel.json` builds the Next.js frontend and FastAPI backend as
separate services, routing `/api/*` requests to FastAPI and other requests to
Next.js. Browser API requests use `/api` on deployed domains; local development
continues to use port 8000.

Set the required application environment variables in Vercel. In particular,
configure `DATABASE_URL` with a persistent hosted PostgreSQL database; the
backend's SQLite fallback is local and is not suitable for persistent Vercel
deployments. Add the production Stripe, email, and other integration credentials
as needed in Vercel's environment settings.

## MVP Workflow

1. Create shipment
2. Accept shipment
3. Run optimization mode
4. Update status to in_transit or delivered
5. Review selected route and ETA
