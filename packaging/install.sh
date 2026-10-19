#!/bin/sh
# Install the omilo CLI from GitHub releases.
#   curl -fsSL https://raw.githubusercontent.com/dedekrnwan/omilo-os/main/packaging/install.sh | sh
# Options (env): OMILO_VERSION=v0.5.0 (default: latest), OMILO_INSTALL_DIR=~/.local/bin
set -eu

REPO="dedekrnwan/omilo-os"
VERSION="${OMILO_VERSION:-latest}"
INSTALL_DIR="${OMILO_INSTALL_DIR:-}"

say() { printf 'omilo: %s\n' "$1" >&2; }
die() { say "$1"; exit 1; }

os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Darwin) goos=darwin ;;
  Linux)  goos=linux ;;
  *) die "unsupported OS '$os' — on Windows use: npx omilo, or download from https://github.com/$REPO/releases" ;;
esac
case "$arch" in
  x86_64|amd64) goarch=amd64 ;;
  arm64|aarch64) goarch=arm64 ;;
  *) die "unsupported architecture '$arch'" ;;
esac

if [ "$VERSION" = "latest" ]; then
  # Resolve the latest release tag without jq.
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "$VERSION" ] || die "could not resolve the latest release"
fi

asset="omilo_${goos}_${goarch}.tar.gz"
url="https://github.com/$REPO/releases/download/$VERSION/$asset"
say "downloading $asset ($VERSION)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/$asset" || die "download failed: $url"
tar -xzf "$tmp/$asset" -C "$tmp"
bin="$tmp/omilo_${goos}_${goarch}"
[ -f "$bin" ] || die "archive did not contain the expected binary"
chmod +x "$bin"

# Choose an install dir on PATH, preferring a writable system dir, else ~/.local/bin.
if [ -z "$INSTALL_DIR" ]; then
  if [ -w /usr/local/bin ] 2>/dev/null; then INSTALL_DIR=/usr/local/bin
  else INSTALL_DIR="$HOME/.local/bin"; fi
fi
mkdir -p "$INSTALL_DIR"
mv "$bin" "$INSTALL_DIR/omilo"
say "installed to $INSTALL_DIR/omilo"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) say "add it to your PATH:  export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac
say "run 'omilo start' to launch Omilo on this machine (SQLite, no Docker)."
