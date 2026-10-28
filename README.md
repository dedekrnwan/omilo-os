# Omilo v2

An open-source work OS — AI-native chat, goals, flows, routines, and connectors — with a
**control-plane / runtime split** so your data stays on your machine while identity and billing
remain cloud-authoritative.

See [docs/technical/12-control-plane-runtime-split.md](docs/technical/12-control-plane-runtime-split.md)
for the full architecture (§10 covers the local / hybrid / cloud modes).

---

## Architecture in one paragraph

The same backend image runs in three modes via `OMILO_MODE`:

- **`local`** (default self-host) — fully local, privacy-first, no cloud env required. BYO AI
  keys (set in the UI). Pooled/metered inference is disabled. No account needed.
- **`hybrid`** — cloud identity + pooled credits, data stays on your machine. Upgrade via
  `omilo connect`; the connect flow signs you in, issues an install token, and re-keys the stack.
- **`cloud`** — the vendor control plane. Owns JWT issuance, the credit ledger, and entitlements.
  This is what runs at `api.omilo.app`.

BYO-key and local-model jobs are always free and fully offline. Only pooled/cloud-inference
jobs require the control plane (hybrid or cloud mode).

---

## Install & run

### Mode 1 — Local (default): free, BYO AI, no cloud account needed

The quickest way to run Omilo. Starts in **local mode**: fully private, no cloud required,
bring your own AI provider key in the UI.

```bash
npx omilo up
# Then open: http://localhost:7700
# Add your AI provider key in Settings → AI Keys.
```

Everything runs on your machine. No Omilo account required. Pooled inference is disabled;
BYO-key and local-model jobs work out of the box.

---

### Mode 2 — Hybrid: cloud identity + pooled credits (via `omilo connect`)

Start in local mode first, then upgrade to hybrid. The connect flow signs you in to the
Omilo cloud, issues an install token, and switches `OMILO_MODE` to `hybrid`. Your workspace
data stays on your machine.

```bash
npx omilo up          # start locally first
npx omilo connect     # upgrade: sign in to cloud → pooled credits enabled
```

Or with Docker Compose directly (after the connect flow writes your `.env.runtime`):

```bash
docker compose -f deploy/docker-compose.runtime.yml --env-file deploy/.env.runtime up -d
```

---

### Mode 3 — Cloud (vendor / self-hosted control plane)

Run the full Omilo control plane yourself — own auth, billing, and the credit ledger.

```bash
cp deploy/.env.cloud.example deploy/.env.cloud
# Set in deploy/.env.cloud:
#   JWT_SECRET=<strong random secret>
#   OMILO_JWT_PRIVATE_KEY=<Ed25519 private key PEM>
#   # ... see deploy/.env.cloud.example for all required vars
docker compose -f deploy/docker-compose.cloud.yml up
```

Point your runtime instances at this control plane:
`OMILO_CONTROL_PLANE_URL=https://<your-domain>`.

---

### 4. `make dev` — local development (full stack)

One command starts the whole stack: dev Postgres + Redis, migrations + seed, the API
(`:8000`), and the Vite web dev server (`:5173`) — run concurrently; **Ctrl-C stops both**.
The web talks to the API through a dev-only Vite proxy (no CORS), so it's wired end-to-end.

```bash
make dev        # DB + API + web, all together → open http://localhost:5173
# or run one side:
make dev-api    # just the API (migrate + serve)
make dev-web    # just the web dev server (expects a running API)
```

Prerequisites: Docker, Python 3.11+, Node 22+, npm.

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
| `make up` | Start self-host runtime (local mode, free, BYO AI) |
| `make connect` | Upgrade to hybrid mode (cloud identity + pooled credits) |
| `make db` | Start dev Postgres + Redis |
| `make dev` | Full stack: DB + API (:8000) + web (:5173), Ctrl-C stops both |
| `make test` | Backend + frontend + Rust checks |
| `make build` | Production frontend bundle |
| `make image` | Build Docker images |
| `make up-cloud` | Start cloud control-plane stack |
| `make up-runtime` | Start self-host runtime stack (alias for `make up`) |
| `make desktop` | Build the macOS .dmg thin client |
| `make desktop-dev` | Tauri dev shell (live-reload) |
| `make migrate` | Run Alembic migrations |
| `make seed` | Seed dev data |

---

## Telemetry

Omilo collects **content-free usage analytics** via PostHog to support product improvement.
Privacy design: `local` mode is **off by default** (no events leave the process); hybrid/cloud
mode sends events only when `POSTHOG_API_KEY` is configured. A property allowlist ensures no
message content, PII, API keys, or free-text ever reaches PostHog. Companies can opt out at any
time via Settings or `POST /v1/telemetry-config {opted_out: true}`.

To configure or disable telemetry:
```bash
# Disable (default — leave POSTHOG_API_KEY unset)
# No events leave the process in any mode.

# Enable (PostHog Cloud US)
POSTHOG_API_KEY=phc_xxxxxx

# Enable with EU data residency
POSTHOG_API_KEY=phc_xxxxxx
POSTHOG_HOST=https://eu.i.posthog.com

# Enable with self-hosted PostHog
POSTHOG_API_KEY=phc_xxxxxx
POSTHOG_HOST=https://posthog.your-domain.com
```

See [docs/technical/13-telemetry.md](docs/technical/13-telemetry.md) for the full event taxonomy,
no-content guarantee, mode behaviour, opt-out API, and self-host configuration.

---

## Docs

- [Architecture: control-plane / runtime split](docs/technical/12-control-plane-runtime-split.md)
- [Product telemetry (PostHog, mode-aware, privacy)](docs/technical/13-telemetry.md)
- [Desktop release runbook (signing + notarization)](docs/technical/10a-desktop-release.md)
- [Full technical docs](docs/technical/)
