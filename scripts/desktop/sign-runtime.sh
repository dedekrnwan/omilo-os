#!/usr/bin/env bash
# Sign every program and library in dist/runtime (macOS). Apple Silicon refuses to run unsigned code, and relinking
# (build-runtime.sh) breaks the signatures the tools came with, so this always runs: with your Developer ID when
# APPLE_SIGNING_IDENTITY is set (needed to notarize and to open without a warning), else ad hoc ("-").
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RT="${1:-$ROOT/dist/runtime}"
ID="${APPLE_SIGNING_IDENTITY:--}"
ENT="$ROOT/apps/desktop/src-tauri/entitlements.plist"
[ "$(uname -s)" = Darwin ] || { echo "signing is for macOS; skipped"; exit 0; }
opts=(--force --sign "$ID")
[ "$ID" != "-" ] && opts+=(--timestamp --options runtime --entitlements "$ENT")
n=0
# libraries first, programs after (a program's signature covers nothing else, but keep the order Apple documents)
while IFS= read -r -d '' f; do
  file -b "$f" | grep -q 'Mach-O' || continue
  codesign "${opts[@]}" "$f" 2>&1 | grep -v 'replacing existing signature' || true
  n=$((n + 1))
done < <(find "$RT" -type f \( -name '*.dylib' -o -name '*.so' -o -name '*.node' \) -print0; find "$RT" -type f -perm -u+x ! -name '*.dylib' ! -name '*.so' -print0)
echo "signed $n files in $RT with ${ID/#-/an ad-hoc signature}"
