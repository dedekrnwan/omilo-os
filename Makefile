# Local development on macOS / Linux (Windows: use WSL or run the commands by hand).
.PHONY: dev api venv web test cli image desktop desktop-runtime desktop-dev reset reset-password restore-connectors db db-stop db-logs import-sqlite

# Omilo needs Postgres (with pgvector) and Redis. `make dev` starts both in Docker first (docker-compose.dev.yml).
dev: db web api

DC := docker compose -f docker-compose.dev.yml

db:
	@command -v docker >/dev/null 2>&1 || { echo "Omilo needs Postgres and Redis. Install Docker Desktop (https://docker.com) and run make dev again,"; \
	  echo "or point OMILO_DATABASE_URL and OMILO_REDIS_URL at your own Postgres 16 + pgvector and Redis 7."; exit 1; }
	@$(DC) up -d --wait postgres redis && echo "Postgres (pgvector) and Redis are up."

db-stop:
	$(DC) stop

db-logs:
	$(DC) logs -f --tail 100

# Data from Omilo before 0.4 (SQLite files in ~/.omilo) moves in automatically on the first start; this does it by hand.
import-sqlite: venv
	cd apps/api && .venv/bin/python -m omilo_api.import_sqlite

# Python 3.11+ is needed (macOS ships 3.9: brew install python@3.12).
PYTHON ?= $(shell for p in python3.13 python3.12 python3.11 python3; do command -v $$p >/dev/null 2>&1 && $$p -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null && echo $$p && break; done)
VENV := apps/api/.venv

api: venv
	cd apps/api && .venv/bin/omilo-api

# (Re)creates the virtualenv when it is missing or broken, e.g. after the folder was moved.
venv:
	@test -n "$(PYTHON)" || { echo "Omilo needs Python 3.11 or newer. On macOS: brew install python@3.12"; exit 1; }
	@$(VENV)/bin/python -c 'import sys' 2>/dev/null && $(VENV)/bin/pip --version >/dev/null 2>&1 || { rm -rf $(VENV); $(PYTHON) -m venv $(VENV); }
	cd apps/api && .venv/bin/pip install -q -e ".[dev]"

web:
	cd apps/web && npm install --no-audit --no-fund && npm run build

# Tests use the database omilo_test (created if missing) and Redis db 15.
test: venv db
	@$(DC) exec -T postgres psql -U omilo -d omilo -tc "SELECT 1 FROM pg_database WHERE datname = 'omilo_test'" | grep -q 1 || $(DC) exec -T postgres createdb -U omilo omilo_test
	cd apps/api && .venv/bin/ruff check omilo_api tests && .venv/bin/pytest -q
	cd apps/web && npm run lint
	cd cli && go vet ./... && go build ./...

cli:
	cd cli && go build -o omilo .

image:
	docker build -t ghcr.io/super-saga/saga-os:dev .

# Omilo for macOS: one app with everything inside (Postgres, Valkey, Python, Node), no Docker. Run on a Mac with
# Xcode Command Line Tools, Rust (rustup.rs), uv and Node. The .dmg lands in apps/desktop/src-tauri/target/release/
# bundle/dmg. Set APPLE_SIGNING_IDENTITY to sign with your Developer ID (default: ad hoc). See docs/desktop.md.
desktop-runtime:
	scripts/desktop/build-runtime.sh
	scripts/desktop/sign-runtime.sh

desktop: desktop-runtime
	cd apps/desktop && npm install --no-audit --no-fund && npx tauri build --bundles app,dmg

# The app against the runtime in dist/runtime, without packaging (fast to try changes to the shell).
desktop-dev:
	@test -x dist/runtime/python/bin/python3 || { echo "Build the runtime first: make desktop-runtime"; exit 1; }
	cd apps/desktop && npm install --no-audit --no-fund && OMILO_RUNTIME_DIR=$(CURDIR)/dist/runtime npx tauri dev

# Forgot your password? Sets a new one for the owner (run it on the computer that runs Omilo).
reset-password: venv
	cd apps/api && .venv/bin/python -m omilo_api.reset_password

# Start over: moves your Omilo data (account, helpers, connectors, tasks, keys) aside, it is not deleted: the data
# folder to <data>-old-<date> and each company's Postgres schema to old<date>_co_<id>. Asks first; `make reset CONFIRM=yes`
# skips the question. Bring connectors back later with `make restore-connectors`.
reset: venv db
	@if lsof -nP -iTCP:$${OMILO_PORT:-7700} -sTCP:LISTEN >/dev/null 2>&1; then echo "Omilo is still running on port $${OMILO_PORT:-7700}. Stop it (Ctrl+C) first."; exit 1; fi
	@if [ "$(CONFIRM)" != "yes" ]; then \
	  echo "This starts Omilo from zero: a new account, onboarding again, no helpers, connectors or history."; \
	  echo "Your current data is moved aside (not deleted)."; \
	  printf "Type yes to continue: "; read a; [ "$$a" = "yes" ] || { echo "Cancelled. Nothing changed."; exit 1; }; fi; \
	cd apps/api && .venv/bin/python -m omilo_api.reset

# Bring back connectors from the newest folder a reset moved aside (or FROM=<folder>). Stop Omilo first.
restore-connectors: venv db
	cd apps/api && .venv/bin/python -m omilo_api.restore $(FROM)
