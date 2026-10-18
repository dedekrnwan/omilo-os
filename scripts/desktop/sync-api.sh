#!/usr/bin/env bash
# Put the current Omilo code (apps/api/omilo_api) into the runtime's Python, so `make desktop-app` always ships the
# code you have now without rebuilding the whole runtime. New or changed dependencies still need
# `ONLY=python scripts/desktop/build-runtime.sh`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RT="${1:-$ROOT/dist/runtime}"
PY="$RT/python/bin/python3"
dest="$("$PY" -c 'import omilo_api, os; print(os.path.dirname(omilo_api.__file__))')"
rsync -a --delete --exclude __pycache__ --exclude '*.pyc' "$ROOT/apps/api/omilo_api/" "$dest/"
# bytecode checked by nothing (the app is read-only), so rebuild it for every file
"$PY" -m compileall -q -f --invalidation-mode unchecked-hash "$dest" >/dev/null
"$PY" -c "import omilo_api.desktop, omilo_api.main" && echo "Omilo code in the runtime is up to date ($dest)"
