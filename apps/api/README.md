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

## Production configuration

### RLS depends on a non-superuser database role

Omilo's tenant isolation is enforced by Postgres Row-Level Security (RLS).
Each request handler calls `SET LOCAL ROLE omilo_app` and
`SET LOCAL app.company_id = '<id>'`; every RLS policy on every table
checks `current_setting('app.company_id')` and allows access only to that
tenant's rows.  All tables are created with `ALTER TABLE … FORCE ROW LEVEL
SECURITY`, which applies RLS even to the table owner.

**Critical invariant:** Postgres superusers bypass RLS unconditionally —
`FORCE RLS` does not help.  In development the app connects as the `omilo`
superuser, which is safe only because the code always issues `SET LOCAL ROLE
omilo_app` before any query.  **In production the application's database
login MUST be a dedicated non-superuser role that holds membership in
`omilo_app`**, for example:

```sql
CREATE ROLE omilo_app_login LOGIN PASSWORD '…' IN ROLE omilo_app;
```

Set `DATABASE_URL` to connect as `omilo_app_login` (or equivalent).
If the app ever connects as a superuser in production, any future code change
that omits the `SET LOCAL ROLE` call will silently bypass tenant isolation
with no error.

### `JWT_SECRET` must be a strong secret

The default value `change-me-in-production` must never be used outside a
local dev environment.  Generate a production secret with at least 32 random
bytes, for example:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Set the result as `JWT_SECRET` in your production environment.

## Environment variables

See `.env.example` for the full list.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg://omilo:omilo@localhost:5432/omilo` | Postgres connection string |
| `JWT_SECRET` | `change-me-in-production` | Secret for JWT signing |
| `JWT_ACCESS_TTL_S` | `3600` | Access token lifetime in seconds |
| `ENV` | `development` | Runtime environment |
