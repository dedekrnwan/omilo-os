# Omilo v2

An open-source work OS — AI-native chat, goals, flows, routines, and connectors — with a
**control-plane / runtime split** so your data stays on your machine while identity and billing
remain cloud-authoritative.

See [docs/technical/12-control-plane-runtime-split.md](docs/technical/12-control-plane-runtime-split.md)
for the full architecture.

---

## Architecture in one paragraph

The same backend image runs in two modes via `OMILO_MODE`:

- **`cloud`** — the control plane. Owns authentication (JWT issuance), the credit ledger, and
  entitlements. This is what runs at `api.omilo.app`.
- **`runtime`** — the local runtime. Runs the agent loop and stores your data (messages, RAG,
  connectors, keys) locally. It verifies cloud-issued JWTs against the cloud's JWKS (offline-
  capable) and reports credit usage to the cloud ledger; it never owns auth or billing.

BYO-key and local-model jobs are always free and fully offline. Only pooled/cloud-inference
jobs require the control plane reachable (for credit gating).

---

## Install & run

### 1. `npx omilo up` — local runtime (data on your machine, identity via the cloud)

The quickest way to run Omilo locally. Pulls the runtime image and connects it to the Omilo
cloud control plane for sign-in and billing.

```bash
npx omilo up
```

Then register your install:

```bash
omilo register
```

Your workspace data lives locally. Identity and billing are handled by the cloud control plane.

---

### 2. `make dev` — local development

Starts a dev Postgres + Redis, runs the API in the foreground, and tells you to open a second
terminal for the frontend dev server.

```bash
make db       # start Postgres (pgvector) + Redis via Docker
make dev      # start the API (migrations run automatically)
# second terminal:
npm run dev   # start the Vite frontend dev server
```

Prerequisites: Docker, Python 3.11+, Node 22+, npm.

---

### 3. Self-host the runtime (Docker)

Run the local runtime stack against the Omilo cloud control plane. Your data stays on your
server; identity and billing stay cloud-authoritative.

```bash
cp deploy/.env.runtime.example deploy/.env.runtime
# Set in deploy/.env.runtime:
#   OMILO_CONTROL_PLANE_URL=https://api.omilo.app
#   OMILO_INSTALL_TOKEN=<token from omilo register>
docker compose -f deploy/docker-compose.runtime.yml up
```

---

### 4. Deploy the cloud control plane (vendor / self-hosted cloud)

Run the full control plane yourself — own auth, billing, and the credit ledger.

```bash
cp deploy/.env.cloud.example deploy/.env.cloud
# Set in deploy/.env.cloud:
#   JWT_SECRET=<strong random secret>
#   OMILO_JWT_PRIVATE_KEY=<Ed25519 private key PEM>
#   # ... see deploy/.env.cloud.example for all required vars
docker compose -f deploy/docker-compose.cloud.yml up
```

Point your runtime instances at this control plane with
`OMILO_CONTROL_PLANE_URL=https://<your-domain>`.

---

### 5. Desktop app — `.dmg` thin client

Build the Tauri desktop app (a thin client; connects to a local or self-hosted runtime):

```bash
make desktop
```

The resulting `.dmg` is at `src-tauri/target/release/bundle/dmg/*.dmg`.

By default the build is **ad-hoc signed** — macOS shows "Open Anyway" on first launch.
For a Developer ID-signed and notarized release, see
[docs/technical/10a-desktop-release.md](docs/technical/10a-desktop-release.md).

For Tauri live-reload against a dev backend:

```bash
make desktop-dev
```

CI builds the `.dmg` on every `v*` / `desktop-v*` tag push via
[`.github/workflows/desktop.yml`](.github/workflows/desktop.yml) — no cert secrets required
to produce the unsigned artifact.

---

## Quick reference

| Command | What it does |
|---|---|
| `make db` | Start dev Postgres + Redis |
| `make dev` | Start API (+ `npm run dev` for frontend) |
| `make test` | Backend + frontend + Rust checks |
| `make build` | Production frontend bundle |
| `make image` | Build Docker images |
| `make up-cloud` | Start cloud control-plane stack |
| `make up-runtime` | Start local runtime stack |
| `make desktop` | Build the macOS .dmg thin client |
| `make desktop-dev` | Tauri dev shell (live-reload) |
| `make migrate` | Run Alembic migrations |
| `make seed` | Seed dev data |

---

## Docs

- [Architecture: control-plane / runtime split](docs/technical/12-control-plane-runtime-split.md)
- [Desktop release runbook (signing + notarization)](docs/technical/10a-desktop-release.md)
- [Full technical docs](docs/technical/)
