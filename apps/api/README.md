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

## Quick start (make dev)

`make dev` performs the full startup sequence in one command:

1. Brings up Postgres + Redis via docker compose
2. Runs `alembic upgrade head` (migrations)
3. Runs `omilo-seed` (inserts demo data, idempotent)
4. Launches `omilo-api` (uvicorn on :8000)

```bash
cd apps/api
make dev
```

## Individual make targets

```bash
make test     # run full pytest suite
make migrate  # alembic upgrade head only
make seed     # insert/upsert demo fixtures only
```

## Run locally (manual)

```bash
# Start Postgres + Redis first
docker compose -f ../../deploy/docker-compose.dev.yml up -d

# Migrate
alembic upgrade head

# Seed demo data (idempotent)
omilo-seed

# Run the API
omilo-api
# or: uvicorn omilo.main:create_app --factory --reload
```

## Test

```bash
cd apps/api
pytest              # default order
pytest -p no:randomly  # alphabetical order (proves ordering fix)
```

## Database migrations

```bash
omilo-migrate   # runs Alembic upgrade head
omilo-seed      # inserts demo data (idempotent)
```

## Environment variables

See `.env.example` for the full list.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://omilo:omilo@localhost:5432/omilo` | Postgres connection string |
| `JWT_SECRET` | `change-me-in-production` | Secret for JWT signing |
| `JWT_ACCESS_TTL_S` | `3600` | Access token lifetime in seconds |
| `ENV` | `development` | Runtime environment |
