# Local development on macOS / Linux (Windows: use WSL or run the commands by hand).
.PHONY: dev api venv web test cli image reset reset-password

dev: web api

# Python 3.11+ is needed (macOS ships 3.9: brew install python@3.12).
PYTHON ?= $(shell for p in python3.13 python3.12 python3.11 python3; do command -v $$p >/dev/null 2>&1 && $$p -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null && echo $$p && break; done)
VENV := apps/api/.venv

api: venv
	cd apps/api && .venv/bin/saga-api

# (Re)creates the virtualenv when it is missing or broken, e.g. after the folder was moved.
venv:
	@test -n "$(PYTHON)" || { echo "Saga OS needs Python 3.11 or newer. On macOS: brew install python@3.12"; exit 1; }
	@$(VENV)/bin/python -c 'import sys' 2>/dev/null && $(VENV)/bin/pip --version >/dev/null 2>&1 || { rm -rf $(VENV); $(PYTHON) -m venv $(VENV); }
	cd apps/api && .venv/bin/pip install -q -e ".[dev]"

web:
	cd apps/web && npm install --no-audit --no-fund && npm run build

test: venv
	cd apps/api && .venv/bin/ruff check saga_api tests && .venv/bin/pytest -q
	cd apps/web && npm run lint
	cd cli && go vet ./... && go build ./...

cli:
	cd cli && go build -o saga-os .

image:
	docker build -t ghcr.io/super-saga/saga-os:dev .

# Forgot your password? Sets a new one for the owner (run it on the computer that runs Saga OS).
reset-password: venv
	cd apps/api && .venv/bin/python -m saga_api.reset_password

# Start over: moves your Saga OS data (account, helpers, tasks, keys) aside. Stop the server first.
reset:
	@if lsof -nP -iTCP:$${SAGA_PORT:-7700} -sTCP:LISTEN >/dev/null 2>&1; then echo "Saga OS is still running on port $${SAGA_PORT:-7700}. Stop it (Ctrl+C) first."; exit 1; fi
	@d="$${SAGA_DATA_DIR:-$$HOME/.saga-os}"; if [ -d "$$d" ]; then mv "$$d" "$$d-old-$$(date +%Y%m%d-%H%M%S)" && echo "Moved $$d aside. Run make dev to start fresh."; else echo "Nothing to reset ($$d does not exist)."; fi
