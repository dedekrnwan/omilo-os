# Local development on macOS / Linux (Windows: use WSL or run the commands by hand).
.PHONY: dev api venv web test cli image

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
