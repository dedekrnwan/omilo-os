# apps/api/Makefile — developer shortcuts for the Omilo API
#
# Usage:
#   make dev    — start Postgres + Redis, migrate, seed, then run the API
#   make test   — run the full backend test suite
#
# Prerequisites:
#   - Docker (for the postgres/redis services)
#   - A Python virtualenv at .venv (see README for setup steps)
#   - The .env file must exist (copy .env.example and edit as needed)

SHELL := /bin/bash
PYTHON := .venv/bin/python3
COMPOSE_FILE := ../../deploy/docker-compose.dev.yml

.PHONY: dev test migrate seed

# ── dev: bring up infra, migrate, seed, run the API ──────────────────────────
dev:
	@echo "→ Starting Postgres + Redis …"
	docker compose -f $(COMPOSE_FILE) up -d postgres redis
	@echo "→ Running migrations …"
	$(PYTHON) -m alembic upgrade head
	@echo "→ Seeding demo data …"
	$(PYTHON) -m omilo.seed.run
	@echo "→ Starting omilo-api (Ctrl-C to stop) …"
	$(PYTHON) -m omilo.main

# ── test: run the full pytest suite ──────────────────────────────────────────
test:
	$(PYTHON) -m pytest apps/api/tests/ -v

# ── migrate: upgrade to head only ────────────────────────────────────────────
migrate:
	$(PYTHON) -m alembic upgrade head

# ── seed: insert demo fixtures only ──────────────────────────────────────────
seed:
	$(PYTHON) -m omilo.seed.run
