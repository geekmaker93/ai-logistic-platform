# AI Logistics Platform Backend

This backend provides the MVP shipment workflow API using FastAPI.

## Features

- shipment creation
- carrier acceptance
- route optimization modes
- in-transit status updates
- persistent storage using SQLAlchemy

## Setup

1. Create and activate your Python environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Configure your database URL.

PowerShell:

```powershell
$env:DATABASE_URL="postgresql+psycopg://postgres:postgres@127.0.0.1:5432/ai_logistics"
```

If `DATABASE_URL` is not set, the backend falls back to a local SQLite file `logistics.db`.

Optional: configure Google Maps for real driving distance, address validation, and route optimization.

PowerShell:

```powershell
$env:GOOGLE_MAPS_API_KEY="your_server_restricted_google_key"
```

Optional override for route and distance endpoint URLs:

```powershell
$env:GOOGLE_DISTANCE_MATRIX_URL="https://maps.googleapis.com/maps/api/distancematrix/json"
$env:GOOGLE_DIRECTIONS_URL="https://maps.googleapis.com/maps/api/directions/json"
```

If `GOOGLE_MAPS_API_KEY` is not set or the API call fails, matching and route optimization automatically fall back to built-in heuristics.

Optional: configure EIA live fuel prices (U.S. Energy Information Administration) for route cost analysis.

```powershell
$env:EIA_API_KEY="your_eia_api_key"
$env:EIA_GAS_PRICE_URL="https://api.eia.gov/v2/petroleum/pri/gnd/data/"
$env:EIA_DUOAREA="R1X"
$env:EIA_PRODUCT="EPD2D"
```

If EIA pricing is unavailable, the backend falls back to `GAS_PRICE_FALLBACK_USD_PER_LITER` (default `1.2`).

Optional: configure signup email verification (6-digit code for shipper/carrier sign-up).

PowerShell:

```powershell
$env:SIGNUP_SMTP_HOST="smtp-relay.brevo.com"
$env:SIGNUP_SMTP_PORT="587"
$env:SIGNUP_SMTP_LOGIN="ae900c001@smtp-brevo.com"
$env:SIGNUP_SMTP_PASSWORD="your_brevo_smtp_key"
$env:SIGNUP_SMTP_FROM_EMAIL="ae900c001@smtp-brevo.com"
$env:SIGNUP_SMTP_FROM_NAME="FreightAxis"
$env:SIGNUP_EMAIL_CODE_TTL_MINUTES="10"
```

If SMTP variables are missing, signup code delivery will be unavailable.

4. Start the server:

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

4. Verify:

- API docs: http://127.0.0.1:8000/docs
- health: http://127.0.0.1:8000/health

## API Endpoints

- GET /health
- GET /shipments
- POST /shipments
- GET /shipments/{shipment_id}
- POST /shipments/{shipment_id}/accept
- POST /shipments/{shipment_id}/optimize-route
- POST /shipments/{shipment_id}/status

## Authorization Context (MVP)

All shipment endpoints require actor query params:

- `as=client|carrier`
- `name=<displayName>`

Enforced rules:

- clients only see and create their own shipments
- carriers only see open shipments or shipments assigned to them
- only carriers can accept shipments
- only assigned carriers can optimize routes or update shipment status

## Notes

This backend keeps the same MVP API contracts while persisting data in a database.
