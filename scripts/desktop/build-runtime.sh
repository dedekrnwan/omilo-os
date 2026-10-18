#!/usr/bin/env bash
# Build the runtime the Omilo app carries inside it: Python with Omilo installed, Postgres with pgvector, Valkey,
# Node.js and the web app. Everything lands in dist/runtime and runs from wherever that folder ends up (inside
# Omilo.app/Contents/Resources). Run on the Mac you build for (Apple Silicon or Intel); Linux works too, for testing.
#
#   scripts/desktop/build-runtime.sh              # everything
#   ONLY=python scripts/desktop/build-runtime.sh  # one part: python | postgres | valkey | node | web | models
#
# Needs: a C compiler (Xcode Command Line Tools on macOS), make, curl, uv (https://docs.astral.sh/uv), npm.
# Downloads are cached in dist/cache, so a rebuild only redoes what changed. Versions and download addresses can be
# changed with PG_VERSION/PG_URL, PGVECTOR_VERSION/PGVECTOR_URL, VALKEY_VERSION/VALKEY_URL, NODE_VERSION/NODE_URL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/dist/runtime}"
CACHE="${CACHE:-$ROOT/dist/cache}"
PY_VERSION="${PY_VERSION:-3.12}"
PG_VERSION="${PG_VERSION:-17.6}"
PGVECTOR_VERSION="${PGVECTOR_VERSION:-0.8.1}"
VALKEY_VERSION="${VALKEY_VERSION:-8.1.4}"
NODE_VERSION="${NODE_VERSION:-22.20.0}"
WITH_NODE="${WITH_NODE:-1}"                     # Node.js, so helpers can run Claude Code (installed from Settings)
PRELOAD_EMBEDDINGS="${PRELOAD_EMBEDDINGS:-0}"   # 1: bake the knowledge-base model in (~220 MB, works offline at once)
ONLY="${ONLY:-}"
JOBS="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
OS="$(uname -s)"; ARCH="$(uname -m)"
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-12.0}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
want() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }
fetch() { # url file
  [ -s "$CACHE/$2" ] || { mkdir -p "$CACHE"; curl -fL --retry 3 -o "$CACHE/$2.part" "$1" && mv "$CACHE/$2.part" "$CACHE/$2"; }
}
mkdir -p "$OUT" "$CACHE"

# On macOS a moved binary must not point at the build folder for its libraries: point it at its neighbours instead.
relink() { # prefix dir...
  [ "$OS" = Darwin ] || return 0
  local prefix="$1"; shift
  find "$@" -type f \( -perm -u+x -o -name '*.dylib' -o -name '*.so' \) | while read -r f; do
    file -b "$f" | grep -q 'Mach-O' || continue
    local rel; rel="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[2], os.path.dirname(sys.argv[1])))' "$f" "$prefix/lib")"
    case "$f" in *.dylib) install_name_tool -id "@rpath/$(basename "$f")" "$f" 2>/dev/null || true ;; esac
    otool -L "$f" | tail -n +2 | awk '{print $1}' | grep "^$prefix/lib/" | while read -r dep; do
      install_name_tool -change "$dep" "@loader_path/$rel/$(basename "$dep")" "$f"
    done
  done
}

# ------------------------------------------------------------------ Python + Omilo
if want python; then
  say "Python $PY_VERSION with Omilo"
  rm -rf "$OUT/python"
  uv python install "$PY_VERSION" --install-dir "$CACHE/python" >/dev/null  # a relocatable build (python-build-standalone)
  pyhome="$(ls -d "$CACHE"/python/cpython-"$PY_VERSION".*/ | sort -V | tail -1)"
  cp -R "$pyhome" "$OUT/python"
  rm -f "$OUT/python/lib/python$PY_VERSION/EXTERNALLY-MANAGED"
  PY="$OUT/python/bin/python3"
  uv pip install --python "$PY" --no-cache "$ROOT/apps/api"
  # smaller and quieter: no tests, docs or the Tk GUI kit; headers only matter for building
  rm -rf "$OUT/python/include" "$OUT/python/share" "$OUT/python/lib/python$PY_VERSION"/{test,idlelib,tkinter,turtledemo,ensurepip} \
         "$OUT/python/lib"/libtcl* "$OUT/python/lib"/libtk* "$OUT/python/lib"/tcl* "$OUT/python/lib"/tk* "$OUT/python/lib"/itcl* "$OUT/python/lib"/thread*
  sp="$OUT/python/lib/python$PY_VERSION/site-packages"
  rm -rf "$sp/litellm/proxy/_experimental" "$sp"/pip "$sp"/pip-*.dist-info "$OUT/python/bin"/pip*  # LiteLLM's admin web UI; pip
  find "$OUT/python/lib/python$PY_VERSION/site-packages" -depth -type d \( -name tests -o -name test \) -prune -exec rm -rf {} + 2>/dev/null || true
  # compiled once here, used as is: the app bundle is read-only and copying it changes file times, so the bytecode is
  # checked by nothing (no time stamps) and Python never writes into the app (PYTHONDONTWRITEBYTECODE in the shell)
  find "$OUT/python" -name __pycache__ -type d -prune -exec rm -rf {} +
  "$PY" -m compileall -q -j0 --invalidation-mode unchecked-hash "$OUT/python/lib" >/dev/null || true
  "$PY" -c "import omilo_api.desktop, omilo_api.main, psycopg, uvicorn; print('python ok')"
fi

# ------------------------------------------------------------------ Postgres + pgvector
if want postgres; then
  say "Postgres $PG_VERSION + pgvector $PGVECTOR_VERSION"
  fetch "${PG_URL:-https://ftp.postgresql.org/pub/source/v$PG_VERSION/postgresql-$PG_VERSION.tar.bz2}" "postgresql-$PG_VERSION.tar"
  fetch "${PGVECTOR_URL:-https://github.com/pgvector/pgvector/archive/refs/tags/v$PGVECTOR_VERSION.tar.gz}" "pgvector-$PGVECTOR_VERSION.tar"
  work="$CACHE/build-pg"; rm -rf "$work" "$OUT/pgsql"; mkdir -p "$work/pg" "$work/vector"
  tar -xf "$CACHE/postgresql-$PG_VERSION.tar" -C "$work/pg" --strip-components=1
  tar -xf "$CACHE/pgvector-$PGVECTOR_VERSION.tar" -C "$work/vector" --strip-components=1
  # Only what a private, local database needs: no ICU, readline or OpenSSL (it listens on 127.0.0.1 only), so the
  # binaries depend on nothing outside the bundle and the system.
  (cd "$work/pg" && ./configure --prefix="$OUT/pgsql" --without-icu --without-readline --without-openssl \
      --without-gssapi --without-ldap --without-pam --without-libxml --without-libxslt --without-lz4 --without-zstd >/dev/null \
    && make -j"$JOBS" >/dev/null && make install >/dev/null)
  (cd "$work/vector" && make -j"$JOBS" PG_CONFIG="$OUT/pgsql/bin/pg_config" OPTFLAGS="" >/dev/null \
    && make install PG_CONFIG="$OUT/pgsql/bin/pg_config" >/dev/null)
  rm -rf "$OUT/pgsql/include" "$OUT/pgsql/lib/pgxs" "$OUT/pgsql/lib/pkgconfig" "$OUT/pgsql/share/doc" "$OUT/pgsql/share/man"
  find "$OUT/pgsql/lib" -name '*.a' -delete
  relink "$OUT/pgsql" "$OUT/pgsql/bin" "$OUT/pgsql/lib"
  "$OUT/pgsql/bin/postgres" --version
  ls "$OUT/pgsql/share/extension/vector.control" >/dev/null
fi

# ------------------------------------------------------------------ Valkey (Redis, BSD-licensed)
if want valkey; then
  say "Valkey $VALKEY_VERSION"
  fetch "${VALKEY_URL:-https://github.com/valkey-io/valkey/archive/refs/tags/$VALKEY_VERSION.tar.gz}" "valkey-$VALKEY_VERSION.tar"
  work="$CACHE/build-valkey"; rm -rf "$work" "$OUT/valkey"; mkdir -p "$work" "$OUT/valkey/bin"
  tar -xf "$CACHE/valkey-$VALKEY_VERSION.tar" -C "$work" --strip-components=1
  (cd "$work" && make -j"$JOBS" BUILD_TLS=no USE_SYSTEMD=no MALLOC=libc >/dev/null)
  cp "$work/src/valkey-server" "$OUT/valkey/bin/"
  "$OUT/valkey/bin/valkey-server" --version
fi

# ------------------------------------------------------------------ Node.js
if want node && [ "$WITH_NODE" = 1 ]; then
  say "Node.js $NODE_VERSION"
  case "$OS-$ARCH" in
    Darwin-arm64) plat=darwin-arm64 ;; Darwin-x86_64) plat=darwin-x64 ;;
    Linux-x86_64) plat=linux-x64 ;; Linux-aarch64) plat=linux-arm64 ;; *) echo "no Node build for $OS-$ARCH"; exit 1 ;;
  esac
  fetch "${NODE_URL:-https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$plat.tar.gz}" "node-$NODE_VERSION-$plat.tar.gz"
  rm -rf "$OUT/node"; mkdir -p "$OUT/node"
  tar -xzf "$CACHE/node-$NODE_VERSION-$plat.tar.gz" -C "$OUT/node" --strip-components=1
  rm -rf "$OUT/node/include" "$OUT/node/share" "$OUT/node/lib/node_modules/corepack" "$OUT/node/bin/corepack" "$OUT/node"/{CHANGELOG.md,README.md}
  # npm and npx are symlinks into lib/; app bundlers may copy a symlink as a file, which breaks them: use tiny scripts
  for t in npm npx; do
    rm -f "$OUT/node/bin/$t"
    printf '#!/bin/sh
d="$(cd "$(dirname "$0")" && pwd)"
exec "$d/node" "$d/../lib/node_modules/npm/bin/%s-cli.js" "$@"
' "$t" > "$OUT/node/bin/$t"
    chmod +x "$OUT/node/bin/$t"
  done
  "$OUT/node/bin/node" --version
fi

# ------------------------------------------------------------------ the web app
if want web; then
  say "Web app"
  (cd "$ROOT/apps/web" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build >/dev/null)
  rm -rf "$OUT/web"; cp -R "$ROOT/apps/web/out" "$OUT/web"
fi

# ------------------------------------------------------------------ optional: the embedding model
if want models && [ "$PRELOAD_EMBEDDINGS" = 1 ]; then
  say "Knowledge-base model"
  "$OUT/python/bin/python3" -c "from fastembed import TextEmbedding; TextEmbedding('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', cache_dir='$OUT/models')"
fi

printf '%s\n' "omilo-runtime" "built=$(date -u +%FT%TZ)" "os=$OS" "arch=$ARCH" "python=$PY_VERSION" "postgres=$PG_VERSION" \
  "pgvector=$PGVECTOR_VERSION" "valkey=$VALKEY_VERSION" "node=$NODE_VERSION" > "$OUT/VERSION"
say "Runtime ready in $OUT ($(du -sh "$OUT" | cut -f1))"
