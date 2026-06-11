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

## MVP Workflow

1. Create shipment
2. Accept shipment
3. Run optimization mode
4. Update status to in_transit or delivered
5. Review selected route and ETA
