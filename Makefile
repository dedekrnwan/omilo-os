# Local development on macOS / Linux (Windows: use WSL or run the commands by hand).
.PHONY: dev api web test cli image

dev: web api

api:
	cd apps/api && python3 -m venv .venv && . .venv/bin/activate && pip install -q -e ".[dev]" && saga-api

web:
	cd apps/web && npm install --no-audit --no-fund && npm run build

test:
	cd apps/api && . .venv/bin/activate && ruff check saga_api tests && pytest -q
	cd apps/web && npm run lint
	cd cli && go vet ./... && go build ./...

cli:
	cd cli && go build -o saga-os .

image:
	docker build -t ghcr.io/super-saga/saga-os:dev .
