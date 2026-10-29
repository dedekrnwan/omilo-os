#!/bin/sh
# deploy/start-api.sh — entrypoint for the omilo API image.
# Runs migrations first (both cloud and runtime modes migrate their own DB),
# then starts the API server. No secrets; configuration is injected via env.
set -eu

echo "[omilo] Running migrations..."
omilo-migrate

# Index the global pieces catalog (connectors + MCP). Idempotent; best-effort so
# a transient indexing issue never blocks the API from starting.
echo "[omilo] Indexing pieces catalog..."
omilo-index || echo "[omilo] WARN: pieces indexing failed; marketplace may be empty until re-run"

echo "[omilo] Starting API (mode: ${OMILO_MODE:-cloud})..."
exec omilo-api
