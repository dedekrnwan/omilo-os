# Omilo API

FastAPI backend for omilo-v2.

## Setup

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # edit as needed
```

## Run locally

```bash
# Start Postgres + Redis first
docker compose -f ../../deploy/docker-compose.dev.yml up -d

# Run the API
omilo-api
# or: uvicorn omilo.main:create_app --factory --reload
```

## Test

```bash
pytest
```

## Database migrations (later tasks)

```bash
omilo-migrate   # runs Alembic upgrade head
omilo-seed      # inserts demo data
```

## Environment variables

See `.env.example` for the full list.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://omilo:omilo@localhost:5432/omilo` | Postgres connection string |
| `JWT_SECRET` | `change-me-in-production` | Secret for JWT signing |
| `JWT_ACCESS_TTL_S` | `3600` | Access token lifetime in seconds |
| `ENV` | `development` | Runtime environment |
