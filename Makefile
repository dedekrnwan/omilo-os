# Omilo v2 — Root Makefile
#
# Frontend sources live at the repo root (Vite/React).
# Backend lives at apps/api (Python/FastAPI).
# Docker infra: deploy/docker-compose.dev.yml (dev), deploy/docker-compose.cloud.yml,
#               deploy/docker-compose.runtime.yml.
#
# Quick start: make db && make dev

SHELL := /bin/bash
.PHONY: dev db db-stop db-logs test build image \
        up-cloud up-runtime down logs \
        migrate seed register desktop desktop-dev

# ── Python / venv detection ───────────────────────────────────────────────────
# Prefer the virtualenv binary; fall back to a system Python 3.11+.
VENV      := apps/api/.venv
VENV_BIN  := $(VENV)/bin
PYTHON    ?= $(shell for p in python3.13 python3.12 python3.11 python3; do \
               command -v $$p >/dev/null 2>&1 \
               && $$p -c 'import sys; sys.exit(sys.version_info < (3,11))' 2>/dev/null \
               && echo $$p && break; done)

# ── Compose shortcuts ─────────────────────────────────────────────────────────
DC_DEV     := docker compose -f deploy/docker-compose.dev.yml
DC_CLOUD   := docker compose -f deploy/docker-compose.cloud.yml
DC_RUNTIME := docker compose -f deploy/docker-compose.runtime.yml

# FILE can override the compose file for down/logs: make down FILE=deploy/docker-compose.cloud.yml
FILE ?= deploy/docker-compose.dev.yml

# ── venv: create / repair the api virtualenv ─────────────────────────────────
$(VENV_BIN)/python:
	@test -n "$(PYTHON)" || { echo "Omilo needs Python 3.11+. On macOS: brew install python@3.12"; exit 1; }
	@$(VENV_BIN)/python -c 'import sys' 2>/dev/null \
	  && $(VENV_BIN)/pip --version >/dev/null 2>&1 \
	  || { rm -rf $(VENV); $(PYTHON) -m venv $(VENV); }
	cd apps/api && $(VENV_BIN)/pip install -q -e ".[dev]"

venv: $(VENV_BIN)/python

# ── dev: start infra + api (two-terminal or background approach) ──────────────
# Terminal 1: make db && make api   (or: make dev starts db then api in foreground)
# Terminal 2: npm run dev           (frontend dev server)
dev: db
	@echo "→ DB is up. Starting API in foreground (Ctrl-C to stop)."
	@echo "→ Open a second terminal and run: npm run dev   (frontend)"
	$(MAKE) _api

_api: venv
	cd apps/api && $(VENV_BIN)/omilo-migrate && $(VENV_BIN)/omilo-api

# ── db: start dev Postgres + Redis ───────────────────────────────────────────
db:
	@command -v docker >/dev/null 2>&1 || { \
	  echo "Omilo needs Docker for local Postgres + Redis."; \
	  echo "Install Docker Desktop (https://docker.com) and re-run."; exit 1; }
	$(DC_DEV) up -d --wait postgres redis
	@echo "Postgres (pgvector) and Redis are up."

db-stop:
	$(DC_DEV) stop

db-logs:
	$(DC_DEV) logs -f --tail 100

# ── test: backend + frontend + Tauri ─────────────────────────────────────────
test: venv
	@echo "── backend: pytest ──────────────────────────────────────────────────"
	cd apps/api && $(VENV_BIN)/pytest tests/ -v
	@echo "── frontend: vitest ─────────────────────────────────────────────────"
	npm run test
	@echo "── frontend: tsc ────────────────────────────────────────────────────"
	npx tsc -b --noEmit
	@echo "── frontend: lint (oxlint) ──────────────────────────────────────────"
	npm run lint
	@echo "── Tauri: cargo check ───────────────────────────────────────────────"
	cd src-tauri && cargo check

# ── build: production frontend bundle ────────────────────────────────────────
build:
	npm run build

# ── image: build Docker images ───────────────────────────────────────────────
image:
	@echo "── building API image ───────────────────────────────────────────────"
	docker build -f deploy/Dockerfile.api -t omilo-api:dev .
	@echo "── building web image ───────────────────────────────────────────────"
	docker build -f deploy/web/Dockerfile.web -t omilo-web:dev .

# ── cloud stack ──────────────────────────────────────────────────────────────
up-cloud:
	@echo "Starting cloud control-plane stack (OMILO_MODE=cloud)…"
	$(DC_CLOUD) up -d

# ── runtime stack ─────────────────────────────────────────────────────────────
up-runtime:
	@echo "Starting local runtime stack (OMILO_MODE=runtime)…"
	$(DC_RUNTIME) up -d

# ── down / logs (default: dev stack; override with FILE=) ─────────────────────
down:
	docker compose -f $(FILE) down

logs:
	docker compose -f $(FILE) logs -f --tail 200

# ── register: register this runtime with the Omilo cloud ─────────────────────
# Requires the runtime stack to be running.  The printed install token goes into
# .env.runtime as OMILO_INSTALL_TOKEN, then restart the stack.
register:
	$(DC_RUNTIME) exec api omilo-register

# ── desktop: build the thin-client macOS .dmg ────────────────────────────────
# Thin client: the Tauri shell + the web frontend; no embedded runtime.
# The running app connects to a local or self-hosted Omilo runtime.
#
# Signing: ad-hoc by default (runs but shows "Open Anyway" on first launch).
# For a Developer ID-signed + notarized build set APPLE_SIGNING_IDENTITY and
# the Apple notarization secrets — see docs/technical/10a-desktop-release.md.
desktop:
	npm ci
	npm run build
	npx tauri build --bundles app,dmg
	@echo ""
	@echo "── .dmg artifact ────────────────────────────────────────────────────"
	@ls src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null || \
	  echo "  (no dmg found — check src-tauri/target/release/bundle/dmg/)"

# ── desktop-dev: run the Tauri shell against a local dev frontend/backend ────
desktop-dev:
	npx tauri dev

# ── migrate / seed: delegate to the api package via venv ─────────────────────
migrate: venv
	cd apps/api && $(VENV_BIN)/omilo-migrate

seed: venv
	cd apps/api && $(VENV_BIN)/omilo-seed
