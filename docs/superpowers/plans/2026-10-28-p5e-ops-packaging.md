# P5e — Ops & Packaging (make + CI + self-host + npx + dmg) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give omilo-v2 the same install/dev/CI ergonomics as omilo-os, adapted to v2's architecture (frontend at repo root, backend `apps/api`, thin Tauri client `src-tauri`): a root `Makefile`, a self-host Docker stack (API `Dockerfile` + prod `docker-compose.yml`), GitHub Actions CI, an `npx` launcher that runs the stack, and a `make desktop` thin-client dmg target.

**Architecture:** v2 is cloud-client-first — the desktop is a thin shell, not an embedded backend (docs/technical/10). So self-host = a Docker stack (pgvector + redis + api + nginx-served web), the `npx` launcher just drives that compose stack (a small Node CLI; no Go binary), and the `.dmg` is the Tauri shell pointing at a configurable backend URL (unsigned in CI until Apple certs are added). Nothing changes in app code; this is additive ops.

**Tech Stack:** GNU Make, Docker + Compose v2, GitHub Actions, Node (launcher), Tauri CLI. Backend = Python package (`apps/api`, console scripts `omilo-api`/`omilo-migrate`/`omilo-seed`); frontend = Vite at repo root (`npm run build` → `dist/`); desktop = `src-tauri`. Builds on merged P0–P5c (`main @ cbe6ea2`).

**Spec:** omilo-os is the reference (`../omilo-os/Makefile`, `.github/workflows/{ci,desktop,release}.yml`, `Dockerfile`, `packaging/npm`), adapted to v2's layout + cloud-client desktop. docs/technical/10-tauri-desktop.md + 10a-desktop-release.md.

## Global Constraints

- Builds on merged P0–P5c; branch off fresh `main` (`cbe6ea2`). This is ops/config only — **do NOT touch app source** under `src/`, `apps/api/omilo/`, or `src-tauri/src/` except where a start-script/env wiring is unavoidable (note it). The existing suites stay green (backend 619, frontend 395, cargo check 0).
- **Verify everything that can be verified in this env (docker daemon is UP):** `docker compose -f <file> config` must succeed (valid compose); the API image must `docker build` successfully; every CI workflow + compose + Makefile must be valid YAML/syntax (parse-check). `make -n <target>` must expand sanely. The npx launcher must run (`node bin/omilo.js --help` / a dry path) without throwing.
- **No secrets committed:** CI uses `${{ secrets.* }}` / `${{ github.token }}` only; the prod compose + Dockerfile read secrets from env (`OMILO_JWT_SECRET`, DB creds) with a documented `.env` — never a hardcoded JWT/key. The API image must NOT run as root (add a non-root user). `.dockerignore` excludes `node_modules`, `.venv`, `target`, `dist`, `.git`.
- **RLS prod note:** the app enforces tenant isolation by `SET LOCAL ROLE omilo_app` per transaction (P0 design), so the API may connect as the `omilo` DB role; this already works. The compose must run `omilo-migrate` (which creates the `omilo_app` role + FORCE RLS) before the API serves. Document that for a hardened deploy the API's own DB login should be a non-superuser member of `omilo_app`.
- **Layout facts (differ from omilo-os):** frontend is at the REPO ROOT (not `apps/web`); build = `npm run build` → `dist/`; backend dev already has `apps/api/Makefile` (reuse/My root Makefile delegates to it); dev infra = `deploy/docker-compose.dev.yml` (postgres+redis). Frontend lint = `oxlint` (`npm run lint`); backend test = `pytest` (check `apps/api/pyproject.toml` for a linter like ruff; run it only if configured).
- Pin action versions (checkout@v4, setup-python@v5, setup-node@v4) and the pgvector service image `pgvector/pgvector:pg16` in CI, mirroring omilo-os.

## Review Focus

- **Compose brings the stack up coherently:** `docker compose -f deploy/docker-compose.yml config` is valid; services have healthchecks + depends_on (api waits for a healthy postgres+redis); migrations run before the API serves; the web service proxies `/v1`, `/me`, `/auth`, and the `/v1/ws` WebSocket upgrade to the API. (T1)
- **API image is secure + builds:** `docker build` succeeds; runs as a non-root user; no secret baked in; only the backend context is copied (`.dockerignore`). (T1)
- **CI gates the real things:** the workflow actually runs backend `pytest` (against a pgvector+redis service), frontend `vitest` + `tsc -b` + `oxlint`, and `cargo check` + `cargo fmt --check` — a green CI must mean all four suites pass. No step silently skips. (T2)
- **npx launcher is safe + honest:** `npx <pkg> up/down/logs` shells `docker compose` with the shipped compose file; if Docker is absent it prints a clear message and exits non-zero (doesn't hang or pretend); `--help` lists commands. No `curl | sh` of an unverified binary. (T3)
- **No secret or fake cert committed** anywhere in the branch (CI, compose, Dockerfile, launcher, desktop workflow). (all)

---

### Task 1: Root Makefile + self-host Docker stack (API Dockerfile + prod compose + nginx web)

**Files:**
- Create: `Makefile` (root), `deploy/Dockerfile.api`, `deploy/docker-compose.yml` (prod/self-host), `deploy/web/nginx.conf`, `deploy/web/Dockerfile.web`, `.dockerignore`, `deploy/.env.example`
- (Reference, don't edit: `apps/api/Makefile`, `deploy/docker-compose.dev.yml`, `apps/api/pyproject.toml`.)

**Interfaces:**
- Root `Makefile` targets (delegate to the right dir; frontend at root, backend apps/api): `dev` (up dev db + run api + run web — or document the two-terminal flow), `db` / `db-stop` / `db-logs` (compose.dev up/stop/logs), `api` (apps/api venv + omilo-api), `web` (npm ci + npm run dev or build), `test` (backend pytest + frontend vitest + tsc + oxlint + cargo check), `build` (frontend `npm run build`), `image` (docker build the api + web images), `up` / `down` / `logs` (the self-host prod compose), `desktop` (deferred to T4 — a placeholder that T4 fills), `migrate` / `seed` (delegate to apps/api). Use a `PYTHON`/venv detection like omilo-os. `.PHONY` all.
- `deploy/Dockerfile.api`: python:3.12-slim base; install the `apps/api` package (`pip install .` from a copied `apps/api`); create + switch to a non-root user; entrypoint runs `omilo-migrate` then `omilo-api` (a small start script or `sh -c`); expose the API port. No secrets.
- `deploy/web/Dockerfile.web`: a build stage (node:22, `npm ci && npm run build` → `dist/`) + an `nginx:alpine` stage serving `dist/` with `deploy/web/nginx.conf`. The web build sets `VITE_USE_HTTP=1` and a same-origin API base so the SPA talks to the API via nginx.
- `deploy/web/nginx.conf`: serve the SPA (try_files → index.html for client routing) + `proxy_pass` `/v1`, `/me`, `/auth` to `http://api:<port>`; proxy the `/v1/ws` path with `Upgrade`/`Connection` headers for WebSocket.
- `deploy/docker-compose.yml` (prod/self-host): `postgres` (pgvector/pgvector:pg16, healthcheck, volume), `redis` (7, healthcheck), `api` (build Dockerfile.api, depends_on healthy postgres+redis, env from `.env`: OMILO_DATABASE_URL/OMILO_REDIS_URL/OMILO_JWT_SECRET), `web` (build Dockerfile.web, depends_on api, publish port 8080→80). `deploy/.env.example` documents the env (JWT_SECRET ≥32 bytes, DB creds).

- [ ] **Step 1: Write** the Makefile, Dockerfiles, nginx.conf, prod compose, .dockerignore, .env.example.
- [ ] **Step 2: Validate** — `docker compose -f deploy/docker-compose.yml config >/dev/null` exits 0 (valid); `docker build -f deploy/Dockerfile.api -t omilo-api:test apps/api` (or correct context) succeeds; `make -n test` / `make -n up` expand sanely; confirm the api image runs as non-root (`USER` in the Dockerfile).
- [ ] **Step 3: Commit.**

### Task 2: GitHub Actions CI (backend + frontend + rust + image)

**Files:**
- Create: `.github/workflows/ci.yml`
- (Reference: `../omilo-os/.github/workflows/ci.yml`.)

**Interfaces:**
- `ci.yml` on `[push, pull_request]`, jobs:
  - **api**: ubuntu, `defaults.run.working-directory: apps/api`; services `postgres` (pgvector/pgvector:pg16, env omilo_test/omilo/omilo, healthcheck) + `redis` (7-alpine, healthcheck); steps: checkout@v4, setup-python@v5 (3.12), `pip install -e ".[dev]"`, run the backend linter IF configured (ruff — check pyproject; else skip with a note), `alembic upgrade head` if the tests need it (check how the suite sets up the DB — the tests may create their own), `pytest -q`.
  - **web**: ubuntu; checkout@v4, setup-node@v4 (22, npm cache), `npm ci`, `npm run lint` (oxlint), `npx tsc -b`, `npm run test` (vitest), `npm run build`.
  - **rust**: ubuntu; checkout@v4, setup rust (dtolnay/rust-toolchain stable or actions), `cd src-tauri`, install the Linux Tauri system deps (libgtk/webkit2gtk — mirror omilo-os desktop.yml if it lists them; a Tauri cargo check on Linux needs them) OR scope the rust job to `cargo fmt --check` + `cargo check` with the apt deps; if the webkit deps make it flaky, at minimum `cargo fmt --check` + `cargo clippy`/`check` with the deps installed. Pin the approach that reliably passes.
  - **image** (needs [api, web], `if: github.ref == 'refs/heads/main'`, permissions packages: write): login ghcr, `docker/build-push-action@v6` building the api image (and optionally web) → `ghcr.io/${{ github.repository_owner }}/omilo-v2-api:latest`. Use `${{ secrets.GITHUB_TOKEN }}`.
- No secrets hardcoded; pin action majors.

- [ ] **Step 1: Write** `.github/workflows/ci.yml`.
- [ ] **Step 2: Validate** — the YAML parses (`node -e "require('js-yaml')"` isn't available; use `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` → exits 0). Confirm each job's steps run the REAL gate (pytest / vitest+tsc+oxlint / cargo check) and the service images/healthchecks are correct. Cross-check against omilo-os ci.yml structure.
- [ ] **Step 3: Commit.**

### Task 3: npx launcher (self-host stack runner)

**Files:**
- Create: `packaging/npm/package.json`, `packaging/npm/bin/omilo.js`, `packaging/npm/README.md`
- (Reference: `../omilo-os/packaging/npm/` — but v2's launcher drives `docker compose`, it does NOT download a binary.)

**Interfaces:**
- `packaging/npm/package.json`: name (e.g. `@omilo/v2` or `omilo-v2` — a scoped placeholder is fine, note it), `bin: { "omilo": "bin/omilo.js" }`, `files: ["bin/omilo.js", "deploy"]` or bundle the compose file, engines node >=18, license ELv2/SEE-LICENSE.
- `bin/omilo.js` (Node, no deps): a small CLI — `omilo up` (`docker compose -f <shipped compose> up -d --wait` then print the URL), `omilo down`, `omilo logs`, `omilo --help`/`-h` (usage), unknown/absent command → help + exit non-zero. **Docker-absence handling:** if `docker`/`docker compose` is missing, print a clear install message and exit 1 (never hang). The compose file is shipped inside the package (copy `deploy/docker-compose.yml` into the package, or resolve it relative to the launcher) so `npx` works standalone. No `curl|sh`, no unverified downloads.
- `README.md`: `npx omilo up` quickstart + prerequisites (Docker) + where it serves.

- [ ] **Step 1: Write** the launcher + package.json + README.
- [ ] **Step 2: Validate** — `node packaging/npm/bin/omilo.js --help` prints usage + exits 0; an unknown command exits non-zero with help; simulate docker-absent (e.g. temporarily PATH-shadow or assert the code path) → clear message + exit 1 (do NOT actually `up` the stack in the gate). `node -c packaging/npm/bin/omilo.js` (syntax) passes.
- [ ] **Step 3: Commit.**

### Task 4: `make desktop` thin-client dmg target + CI desktop job + install docs

**Files:**
- Modify: `Makefile` (fill the `desktop` target), `.github/workflows/` add `desktop.yml`
- Create/Modify: `README.md` (root) — an "Install & run" section (npx / self-host compose / `make dev` / desktop)
- (Reference: `../omilo-os/.github/workflows/desktop.yml` for the macOS Tauri build job + system deps.)

**Interfaces:**
- `Makefile` `desktop` target: `npm ci && npm run build && npx tauri build --bundles app,dmg` (the THIN client — no embedded runtime); echo the resulting `src-tauri/target/release/bundle/dmg/*.dmg` path; note that signing needs `APPLE_SIGNING_IDENTITY` (see 10a-desktop-release.md) and is ad-hoc/unsigned by default. A `desktop-dev` target = `npx tauri dev`.
- `.github/workflows/desktop.yml`: on tag/manual (`workflow_dispatch` + `push: tags: ['v*']`), a `macos-latest` job: checkout, setup-node, rust toolchain, `npm ci`, `npm run build`, `npx tauri build` (unsigned — NO cert secrets required to build the artifact; document that notarized release needs the secrets from 10a), upload the `.dmg`/`.app` as a build artifact (actions/upload-artifact@v4). Keep it building-only (no publish) unless certs are present.
- `README.md` "Install & run": (1) `npx omilo up` (Docker self-host), (2) `make dev` (local dev), (3) `docker compose -f deploy/docker-compose.yml up` (manual), (4) desktop `make desktop`. Link docs/technical/10a for signing.

- [ ] **Step 1: Write** the desktop Makefile targets, desktop.yml, README Install section.
- [ ] **Step 2: Validate** — `make -n desktop` expands sanely; `desktop.yml` parses (python yaml.safe_load exit 0); README renders (no broken fences). Do NOT run a full `tauri build` here (slow + needs the full toolchain); the gate is config validity + the earlier P5c `cargo check` still 0.
- [ ] **Step 3: Commit.**

---

## Self-Review notes (author)

- **Coverage:** make (T1 root Makefile), CI (T2 ci.yml + T4 desktop.yml), self-host image/compose (T1), npx (T3), dmg (T4) — the full omilo-os ops surface, adapted: frontend-at-root, thin-client desktop (no embedded runtime), compose-driven npx (no Go binary).
- **Verification is real:** docker is UP, so T1 genuinely `docker build`s the image + `compose config`-validates; CI/compose/desktop YAML are parse-checked; the launcher runs. No task claims a signed release or a pushed image.
- **Security:** no secrets/certs committed (CI uses `secrets.*`, compose/Dockerfile read env, `.env.example` only); API image non-root + `.dockerignore`; launcher never downloads/execs an unverified binary; RLS prod caveat documented.
- **Divergence from omilo-os is deliberate and noted** at each task (root frontend, thin desktop, compose-launcher) so a reader isn't surprised the two repos' ops differ.
- **Proportion:** 4 config-centric tasks; reviews check correctness + the security-focus items (no secrets, non-root image, WS proxy, CI runs the real gates), not business logic.
