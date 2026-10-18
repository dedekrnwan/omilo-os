# Embedded dependencies (all-in-one image) — Design

**Date:** 2026-10-18
**Status:** Draft for approval (no code until approved)

## Intent

A non-IT founder should be able to run one command and get a working Omilo, with no
separate database to set up:

```bash
docker run -v omilo-data:/data -p 7700:7700 ghcr.io/dedekrnwan/omilo-os
```

Production can override that and point at managed Postgres and Redis. The choice is one
environment variable.

## Decisions (settled)

1. **All-in-one image.** Postgres (with pgvector) and Redis run inside the same container as
   the API and worker.
2. **`OMILO_DEPS=embedded | external`**, read at container start.
3. **Default is `embedded`**, so a bare `docker run` works out of the box.

## How it works

The container entrypoint is a small supervisor (PID 1) that branches on `OMILO_DEPS`.

### `OMILO_DEPS=embedded` (default)

On start the entrypoint:

1. Uses `/data` (the mounted volume) for everything: `/data/postgres` (PGDATA),
   `/data/redis`, and the existing Omilo data (`/data`).
2. **First run only:** `initdb` on `/data/postgres`, start Postgres, create the `omilo` role
   and `omilo` database, and `CREATE EXTENSION IF NOT EXISTS vector`. A marker file
   (`/data/postgres/PG_VERSION`) tells first-run from restart, so this never re-runs.
3. Starts `redis-server` (appendonly, data under `/data/redis`).
4. Sets `OMILO_DATABASE_URL=postgresql+psycopg://omilo:omilo@127.0.0.1:5432/omilo` and
   `OMILO_REDIS_URL=redis://127.0.0.1:6379/0` **unless the user already set them** (an
   explicit URL always wins, so a user can embed Redis but use external Postgres, etc.).
5. Starts `omilo-api` (and the worker, via the existing `OMILO_EMBEDDED_WORKER`, default on
   for this image).

Schema creation is unchanged: the app runs `Base.metadata.create_all` on boot (`db.py`), so
no migration step is added here.

### `OMILO_DEPS=external`

The entrypoint starts nothing local. It runs `omilo-api` against the provided
`OMILO_DATABASE_URL` / `OMILO_REDIS_URL`, exactly as the image does today. This is what the
`deploy/` compose and any managed-database setup use.

## Process supervision (PID 1)

A container with three long-lived processes needs a real init, or signals and zombies are
mishandled:

- Use **`tini`** as the image entrypoint for signal forwarding and zombie reaping.
- A `start.sh` script under `tini` launches the local services (embedded mode), then runs
  `omilo-api` in the foreground as the main process.
- On `SIGTERM`/`SIGINT`, the script stops Postgres cleanly (`pg_ctl stop -m fast`) before
  exit, so a `docker stop` never corrupts the database. Redis persists its AOF on shutdown.

(If supervision grows beyond this, `s6-overlay` is the next step; `tini` + one script is
enough for v1.)

## Data persistence (the one thing a user must get right)

Everything lives under a single mount, `/data`: app data, Postgres, and Redis. One volume to
back up, one to mount.

- **The image refuses to lose data silently.** In embedded mode, if `/data` is not a mount
  (a bare `docker run` with no `-v`), the entrypoint prints a loud warning that data will be
  lost when the container is removed, and the docs lead with `-v omilo-data:/data`.
- Backups are `pg_dump` inside the container (documented), or back up the `/data` volume with
  the container stopped.

## Image

- Base stays `python:3.12-slim`; add the Postgres 16 client+server and the `pgvector`
  extension from the PGDG apt repo, `redis-server`, and `tini`. The web build stage is
  unchanged.
- The image runs as a non-root user that owns `/data`; Postgres and Redis run as that same
  user (data dir under `/data`).
- This image is larger than the app-only image. That is the accepted cost of the one-command
  path. (A lean app-only image can still be published later if we want both; not in v1.)

## Compose and existing files

- `deploy/docker-compose.yml` keeps its separate Postgres/Redis services and sets
  `OMILO_DEPS=external` on the app service (no behavior change).
- `cli/compose.yml` (laptop) can switch to the all-in-one image with `OMILO_DEPS=embedded`
  and drop its sidecars, or stay as-is. Proposed: switch it, so the laptop path matches the
  one-command story. (Confirm in the plan.)
- `docker-compose.dev.yml` (source development) is unchanged: `make dev` still runs sidecar
  Postgres/Redis for working on the code.

## Config

Add `deps: str = "embedded"` to `Settings` (`OMILO_DEPS`), used only by the entrypoint for
clarity and so `/healthz` / `system/info` can report the mode. The app itself still only
reads `OMILO_DATABASE_URL` / `OMILO_REDIS_URL`; the entrypoint sets them in embedded mode.

## Risks and mitigations

- **Data loss from a missing volume** → loud first-run warning + docs lead with the volume.
- **Corruption on shutdown** → `pg_ctl stop -m fast` on signal, under `tini`.
- **First-run init races** (app connects before Postgres is ready) → the entrypoint waits for
  `pg_isready` before starting the API.
- **Image size / memory on small VPS** → documented; external mode is the escape hatch.
- **Upgrades** couple Postgres to the app version → documented; external mode decouples them.

## Non-goals (v1)

- Automatic scheduled backups (document `pg_dump`).
- Scaling the embedded database (external mode is the path to that).
- A separate lean app-only image (can follow later).

## Verification

- `docker build` succeeds; `docker run -v data:/data` (embedded) reaches `/healthz = ok`, the
  catalog reindexes, onboarding works, data survives `docker stop` + `docker start`.
- `OMILO_DEPS=external` with URLs set starts the API and connects, starting no local services.
- `docker stop` shuts Postgres down cleanly (no "database was not properly shut down" on next
  start).
