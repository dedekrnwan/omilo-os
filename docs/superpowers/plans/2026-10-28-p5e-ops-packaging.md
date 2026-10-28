# P5e — Ops & Packaging (make + CI + two-deployable self-host + npx + dmg) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give omilo-v2 the install/dev/CI ergonomics of omilo-os, adapted to its **control-plane / runtime split** (P6). One API image runs as either a **cloud control plane** (`OMILO_MODE=cloud`) or a **local runtime** (`OMILO_MODE=runtime` + `OMILO_CONTROL_PLANE_URL`). Deliver: a root `Makefile`, one API `Dockerfile` + two compose files (cloud + runtime), GitHub Actions CI, an `npx` launcher that runs the **local runtime** against the cloud, and a `make desktop` thin-client dmg.

**Architecture:** Per P6 (docs/technical/12), self-host = **two deployables from one image**: (1) the vendor-hosted **control plane** (auth + billing + `/control/*`), (2) the user's **local runtime** (private workspace + execution, federating identity/billing to the control plane). `npx omilo up` + the runtime compose run mode=runtime pointing at `OMILO_CONTROL_PLANE_URL` (default the hosted cloud); the user registers an install token (`omilo-register`). The `.dmg` is the thin Tauri client (P5c) pointing at a local runtime. Nothing in app code changes; this is additive ops.

**Tech Stack:** GNU Make, Docker + Compose v2, GitHub Actions, Node (launcher), Tauri CLI. Backend = one Python package image (console scripts `omilo-api`/`omilo-migrate`/`omilo-seed`/`omilo-register`); frontend = Vite at repo root (`npm run build` → `dist/`); desktop = `src-tauri`. Builds on merged P0–P6 (`main @ 95b9fa5`).

**Spec:** omilo-os ops (`../omilo-os/{Makefile,.github/workflows,Dockerfile,packaging/npm}`) as ergonomic reference; docs/technical/12-control-plane-runtime-split.md §7 (deployment shapes) is the authority for the two-deployable model; 10/10a for desktop.

## Global Constraints

- Builds on merged P0–P6; branch off fresh `main` (`95b9fa5`). Ops/config only — **do NOT touch app source** under `src/`, `apps/api/omilo/`, `src-tauri/src/` (a start-script/env wiring is the only exception, noted). Suites stay green (backend 719, frontend 395, cargo 0).
- **Verify what's verifiable (docker daemon is UP):** `docker compose -f <file> config` succeeds for BOTH compose files; the API image `docker build`s; CI/compose/Makefile/launcher are valid (parse/`make -n`/`node`-run). No task claims a signed dmg or a pushed image.
- **One image, two modes — never two images for the app.** The cloud compose sets `OMILO_MODE=cloud`; the runtime compose sets `OMILO_MODE=runtime` + `OMILO_CONTROL_PLANE_URL` + `OMILO_INSTALL_TOKEN`. Same `Dockerfile.api`.
- **Data residency is the point of the runtime:** the runtime compose's Postgres holds only workspace data; it does NOT run `/control` and never owns the credit ledger. The cloud compose is the authoritative one (runs migrations that seed plans, exposes `/control/*` + the Doit webhook).
- **No secrets committed:** CI uses `${{ secrets.* }}`/`${{ github.token }}`; compose/Dockerfile read env (`OMILO_JWT_PRIVATE_KEY` for the cloud RS256 signer, `OMILO_INSTALL_TOKEN` for the runtime, DB creds) from documented `.env` files — never hardcoded. API image runs **non-root**; `.dockerignore` excludes node_modules/.venv/target/dist/.git.
- Pin action versions (checkout@v4, setup-python@v5, setup-node@v4) + `pgvector/pgvector:pg16` in CI/compose.

## Review Focus

- **Both compose files are coherent + mode-correct:** `config` valid for both; the **cloud** compose runs mode=cloud, migrations-before-serve, exposes `/control` + Doit webhook, web proxies to it; the **runtime** compose runs mode=runtime with `OMILO_CONTROL_PLANE_URL` + `OMILO_INSTALL_TOKEN`, does NOT expose `/control`, and its web proxies `/v1`,`/auth`,`/me`,`/v1/ws` to the local runtime. Healthchecks + depends_on on both. (T1)
- **API image secure + builds:** `docker build` succeeds; non-root user; no secret baked; only backend context copied. (T1)
- **CI gates the real things:** backend `pytest` (pgvector+redis service), frontend `vitest`+`tsc -b`+`oxlint`, `cargo check`+`cargo fmt --check` — a green CI means all four pass; no silent skip. (T3)
- **npx launcher is runtime-correct + safe:** `npx omilo up` runs the **runtime** stack against `OMILO_CONTROL_PLANE_URL` (default cloud), guides the `omilo-register` step for the install token; Docker-absent → clear message + non-zero exit (no hang); no `curl|sh` of an unverified binary. (T4)
- **No secret/fake cert committed** anywhere on the branch. (all)

---

### Task 1: API `Dockerfile` + web image + TWO compose files (cloud + runtime) + root `Makefile`

**Files:**
- Create: `deploy/Dockerfile.api`, `deploy/web/Dockerfile.web`, `deploy/web/nginx.conf`, `deploy/docker-compose.cloud.yml`, `deploy/docker-compose.runtime.yml`, `.dockerignore`, `deploy/.env.cloud.example`, `deploy/.env.runtime.example`, `Makefile` (root)
- (Reference: `apps/api/Makefile`, `deploy/docker-compose.dev.yml`, `apps/api/pyproject.toml` console scripts, `../omilo-os/{Dockerfile,Makefile}`.)

**Interfaces:**
- `deploy/Dockerfile.api`: python:3.12-slim; `pip install .` from copied `apps/api`; non-root user; entrypoint = a start script that runs `omilo-migrate` then `omilo-api` (both modes migrate their own DB — cloud seeds plans, runtime creates its workspace schema). Expose the API port. One image for both modes.
- `deploy/web/Dockerfile.web`: node:22 build stage (`npm ci && npm run build` → `dist/`, with `VITE_USE_HTTP=1` + same-origin API base) + `nginx:alpine` serving `dist/` via `nginx.conf`.
- `deploy/web/nginx.conf`: SPA `try_files … /index.html`; `proxy_pass` `/v1`,`/me`,`/auth` → `http://api:<port>`; WebSocket upgrade headers for `/v1/ws`.
- `deploy/docker-compose.cloud.yml` (the control plane we host): postgres(pgvector,healthcheck,volume) + redis(7,healthcheck) + api(build Dockerfile.api, `OMILO_MODE=cloud`, env: DB/REDIS/`OMILO_JWT_PRIVATE_KEY`/Doit keys, depends_on healthy) + web(publish 8080→80). This image runs `/control/*` + the Doit webhook.
- `deploy/docker-compose.runtime.yml` (what a self-host user runs): postgres(pgvector) + redis + api(same image, `OMILO_MODE=runtime`, env: `OMILO_CONTROL_PLANE_URL`, `OMILO_INSTALL_TOKEN`, DB/REDIS, depends_on healthy) + web(publish e.g. 7700→80). No `/control`. Its Postgres holds only workspace data.
- `deploy/.env.cloud.example` / `.env.runtime.example`: document each mode's env (cloud: RS256 private key ≥, DB creds, Doit; runtime: control-plane URL default `https://api.omilo.app`, install token from `omilo-register`, DB creds). No real secrets.
- Root `Makefile` (frontend at root, backend apps/api): `dev` (dev db + api + web, delegate to apps/api), `db`/`db-stop`/`db-logs` (compose.dev), `test` (backend pytest + frontend vitest+tsc+oxlint + cargo check), `build` (npm run build), `image` (docker build api+web), `up-cloud`/`up-runtime`/`down`/`logs` (the two compose files), `register` (runtime install registration: `omilo-register`), `desktop` (placeholder filled in T4), `migrate`/`seed` (delegate). `.PHONY`, venv/PYTHON detection.

- [ ] **Step 1: Write** the Dockerfiles, nginx.conf, BOTH compose files, .dockerignore, .env examples, root Makefile.
- [ ] **Step 2: Validate** — `docker compose -f deploy/docker-compose.cloud.yml config >/dev/null` AND `… runtime.yml config >/dev/null` both exit 0; `docker build -f deploy/Dockerfile.api -t omilo-api:test apps/api` (correct context) succeeds; confirm non-root `USER`; `make -n test`/`-n up-cloud`/`-n up-runtime` expand sanely; the runtime compose has NO `/control` env/exposure and sets OMILO_MODE=runtime + control-plane URL; the cloud compose sets OMILO_MODE=cloud.
- [ ] **Step 3: Commit.**

### Task 2: GitHub Actions CI (backend + frontend + rust + image)

**Files:** Create `.github/workflows/ci.yml` (reference `../omilo-os/.github/workflows/ci.yml`).

**Interfaces:** `ci.yml` on `[push, pull_request]`, jobs: **api** (ubuntu, working-dir apps/api, services pgvector/pgvector:pg16 + redis:7-alpine with healthchecks, setup-python@v5 3.12, `pip install -e ".[dev]"`, the backend linter if configured, `pytest -q`); **web** (setup-node@v4 22 + npm cache, `npm ci`, `npm run lint` [oxlint], `npx tsc -b`, `npm run test`, `npm run build`); **rust** (rust toolchain + the Linux Tauri system deps [libgtk/webkit2gtk — mirror omilo-os desktop.yml if present], `cd src-tauri`, `cargo fmt --check` + `cargo check` — pin whatever reliably passes on Linux); **image** (needs [api, web], `if: github.ref=='refs/heads/main'`, packages:write, login ghcr, build-push `ghcr.io/${{ github.repository_owner }}/omilo-v2-api:latest` from Dockerfile.api, `${{ secrets.GITHUB_TOKEN }}`). Pin action majors, no hardcoded secrets.

- [ ] **Step 1: Write** `.github/workflows/ci.yml`.
- [ ] **Step 2: Validate** — `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` exits 0; each job runs the REAL gate (pytest / vitest+tsc+oxlint / cargo check); services/healthchecks correct; cross-check vs omilo-os ci.yml.
- [ ] **Step 3: Commit.**

### Task 3: npx launcher (runs the local runtime against the cloud)

**Files:** Create `packaging/npm/package.json`, `packaging/npm/bin/omilo.js`, `packaging/npm/README.md` (reference `../omilo-os/packaging/npm` — but v2 drives `docker compose`, no downloaded binary).

**Interfaces:** `package.json` (`bin: {omilo: "bin/omilo.js"}`, ships `deploy/docker-compose.runtime.yml`, engines node>=18, SEE-LICENSE). `bin/omilo.js` (Node, no deps): `omilo up` → `docker compose -f <bundled runtime compose> up -d --wait` then print the local URL + a reminder to `omilo register` if no install token; `omilo register` → runs the registration (guide the user through sign-in → install token, or shell `omilo-register` in the api container); `omilo down`/`omilo logs`; `omilo --help`. The runtime points at `OMILO_CONTROL_PLANE_URL` (default the hosted cloud, overridable). **Docker-absent → clear message + exit 1** (never hang). No `curl|sh`/unverified downloads. README: `npx omilo up` quickstart + prerequisites + that identity/billing go to the cloud while data stays local.

- [ ] **Step 1: Write** the launcher + package.json + README.
- [ ] **Step 2: Validate** — `node packaging/npm/bin/omilo.js --help` prints usage, exits 0; unknown command → non-zero + help; docker-absent path → clear message + exit 1 (assert the branch, don't actually `up`); `node -c bin/omilo.js` syntax passes.
- [ ] **Step 3: Commit.**

### Task 4: `make desktop` thin-client dmg + CI desktop job + install docs (both modes)

**Files:** Modify `Makefile` (desktop target), add `.github/workflows/desktop.yml`, create/modify root `README.md` (Install & run) (reference `../omilo-os/.github/workflows/desktop.yml`).

**Interfaces:** `Makefile` `desktop` = `npm ci && npm run build && npx tauri build --bundles app,dmg` (thin client; echo the dmg path; signing via `APPLE_SIGNING_IDENTITY`, ad-hoc by default — see 10a); `desktop-dev` = `npx tauri dev`. `.github/workflows/desktop.yml` (on tag/`workflow_dispatch`, macos-latest): checkout, setup-node, rust, `npm ci && npm run build && npx tauri build` (unsigned — no cert secrets needed to build), upload the `.dmg`/`.app` artifact; building-only (no publish without certs). `README.md` "Install & run": (1) `npx omilo up` (local runtime → cloud), (2) `make dev` (local dev), (3) cloud deploy `docker compose -f deploy/docker-compose.cloud.yml up` (vendor/control plane), (4) `docker compose -f deploy/docker-compose.runtime.yml up` (self-host runtime), (5) desktop `make desktop` — explain the control-plane/runtime split + that identity/billing are cloud. Link 10a (signing) + docs/technical/12.

- [ ] **Step 1: Write** the desktop Makefile targets, desktop.yml, README Install section.
- [ ] **Step 2: Validate** — `make -n desktop` expands sanely; `desktop.yml` parses (python yaml.safe_load exit 0); README renders (no broken fences); the P6/P5c suites still green (quick: don't full-build the dmg).
- [ ] **Step 3: Commit.**

---

## Self-Review notes (author)

- **Coverage:** make (T1 root Makefile), CI (T3? no — T2 ci.yml + T4 desktop.yml), self-host two-deployable (T1 cloud+runtime compose, one image), npx runtime-launcher (T3), dmg (T4) — the full omilo-os ops surface, adapted to the P6 split.
- **The split is honored:** two compose files from ONE image (cloud vs runtime via env); npx runs the runtime against the cloud; identity/billing cloud, data local — matches docs/technical/12 §7. A reader won't be surprised the self-host user runs runtime mode, not a self-contained backend.
- **Verification is real:** docker UP → T1 builds the image + `config`-validates BOTH compose files; CI/desktop YAML parse-checked; launcher runs. No signed release / pushed image claimed.
- **Security:** no secrets/certs committed (CI `secrets.*`, env-driven compose, `.env.*.example` only); non-root API image + `.dockerignore`; launcher never downloads/execs an unverified binary; runtime compose never exposes `/control` or owns the ledger.
- **Proportion:** 4 config-centric tasks; reviews check correctness + the security-focus items (no secrets, non-root image, mode-correct compose, WS proxy, CI runs the real gates), not business logic.
