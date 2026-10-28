#!/bin/sh
# deploy/start-api.sh — entrypoint for the omilo API image.
# Runs migrations first (both cloud and runtime modes migrate their own DB),
# then starts the API server. No secrets; configuration is injected via env.
set -eu

echo "[omilo] Running migrations..."
omilo-migrate

echo "[omilo] Starting API (mode: ${OMILO_MODE:-cloud})..."
exec omilo-api
