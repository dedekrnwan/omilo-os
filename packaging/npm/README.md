# `@omilo/cli` — Omilo local runtime launcher

Run the Omilo local runtime on your machine with a single command.

> **Identity & billing are handled by the Omilo cloud control plane** (`OMILO_CONTROL_PLANE_URL`, default `https://api.omilo.app`). Your workspace data — messages, RAG, connectors, keys — stays on your machine and never leaves.

---

## Quickstart

```bash
npx omilo up
```

Then open **http://localhost:7700** in your browser.

---

## Prerequisites

**Docker Desktop** (Mac / Windows) or **Docker Engine + Compose plugin** (Linux).

- Install Docker Desktop: https://www.docker.com/products/docker-desktop/
- Install Docker Engine: https://docs.docker.com/engine/install/

No other dependencies are required. The CLI ships the full runtime Docker Compose stack.

---

## Commands

| Command | Description |
|---|---|
| `omilo up` | Build images and start the local runtime (detached, waits for healthy). |
| `omilo down` | Stop and remove the runtime containers. |
| `omilo logs` | Stream live logs from all containers (Ctrl-C to stop). |
| `omilo register` | Register this install with the Omilo cloud (required on first run). |
| `omilo --help` | Show command reference. |

---

## First-run setup

### 1. Start the stack

```bash
npx omilo up
```

The first start builds the Docker images (takes a few minutes). Subsequent starts are fast.

### 2. Register your install (first run only)

Omilo uses the cloud control plane for identity and billing. On first run, you need to link your local install to your Omilo account:

```bash
omilo register
```

This will:
1. Prompt you to sign in at **https://app.omilo.app** (or your self-hosted control plane).
2. Run `omilo-register` inside the `api` container to exchange your JWT for a company-scoped install token.
3. Print an **install token** — copy it into `deploy/.env.runtime`:
   ```
   OMILO_INSTALL_TOKEN=<your token>
   ```
4. Restart: `omilo down && omilo up`.

### 3. Open the app

Visit **http://localhost:7700** — sign in with your Omilo account. Your workspace is now running locally.

---

## Configuration (`deploy/.env.runtime`)

Copy the example file to configure your install:

```bash
cp deploy/.env.runtime.example deploy/.env.runtime
```

Key settings:

| Variable | Default | Purpose |
|---|---|---|
| `OMILO_CONTROL_PLANE_URL` | `https://api.omilo.app` | The cloud control plane for identity & billing. Change only if self-hosting the control plane. |
| `OMILO_INSTALL_TOKEN` | _(blank)_ | Your install token from `omilo register`. Required for cloud-metered AI credits. |
| `POSTGRES_PASSWORD` | `change-me-strong-password` | **Change this** before first start. |

---

## Control-plane / runtime model

For a full explanation of how identity, billing, and data residency work, see:

[docs/technical/12-control-plane-runtime-split.md](../../docs/technical/12-control-plane-runtime-split.md)

The short version:

- **Cloud (authoritative):** user identity, sign-in/JWT issuance, account registry, subscription, credit ledger.
- **Local runtime (your machine):** agent loop, chat, goals, flows, RAG, connectors, your data.
- JWTs issued by the cloud are **verified locally** against the cloud JWKS — works offline for BYO-key / local-model jobs.
- Pooled AI credit jobs require the control plane reachable (credits can only move in the cloud ledger — they are not forgeable locally).

---

## License

Elastic License 2.0 (ELv2). See [LICENSE](../../LICENSE).
