#!/usr/bin/env bash
# Render the Homebrew formula from the release checksums and push it to the tap repo.
# Usage: update-tap.sh <version-without-v>    (CI runs this on a v* tag)
# Requires: GH_TOKEN with push access to the tap repo (secret HOMEBREW_TAP_TOKEN).
# Env: TAP_REPO (default dedekrnwan/homebrew-omilo)
set -euo pipefail

V="${1:?usage: update-tap.sh <version>}"
REPO="dedekrnwan/omilo-os"
TAP_REPO="${TAP_REPO:-dedekrnwan/homebrew-omilo}"
here="$(cd "$(dirname "$0")" && pwd)"

# Pull checksums.txt from the release (lines: "<sha256>  omilo_<goos>_<goarch>.tar.gz").
sums="$(curl -fsSL "https://github.com/$REPO/releases/download/v$V/checksums.txt")"
sha() { echo "$sums" | awk -v f="omilo_$1.tar.gz" '$2==f {print $1}'; }

darwin_arm64="$(sha darwin_arm64)"; darwin_amd64="$(sha darwin_amd64)"
linux_arm64="$(sha linux_arm64)"; linux_amd64="$(sha linux_amd64)"
for n in darwin_arm64 darwin_amd64 linux_arm64 linux_amd64; do
  eval "v=\$$n"; [ -n "$v" ] || { echo "missing sha256 for omilo_$n" >&2; exit 1; }
done

formula="$(sed \
  -e "s/__VERSION__/$V/g" \
  -e "s/__SHA_DARWIN_ARM64__/$darwin_arm64/" \
  -e "s/__SHA_DARWIN_AMD64__/$darwin_amd64/" \
  -e "s/__SHA_LINUX_ARM64__/$linux_arm64/" \
  -e "s/__SHA_LINUX_AMD64__/$linux_amd64/" \
  "$here/omilo.rb.tmpl")"

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
git clone --depth 1 "https://x-access-token:${GH_TOKEN}@github.com/${TAP_REPO}.git" "$tmp/tap"
mkdir -p "$tmp/tap/Formula"
printf '%s\n' "$formula" > "$tmp/tap/Formula/omilo.rb"
cd "$tmp/tap"
git config user.name "omilo-release"; git config user.email "release@omilo.local"
git add Formula/omilo.rb
git commit -m "omilo $V" || { echo "no change"; exit 0; }
git push origin HEAD
echo "tap updated: $TAP_REPO -> omilo $V"
