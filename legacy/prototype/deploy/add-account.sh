#!/usr/bin/env bash
# Log one Claude Code account into the pool. Usage: add-account.sh acc-01
# Opens Claude Code with an isolated config dir; run /login inside, then /exit.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${1:?usage: add-account.sh <name, e.g. acc-01>}"
DIR="$ROOT/accounts/claude-code/$NAME"
mkdir -p "$DIR" && chmod 700 "$DIR"
echo "Config dir: $DIR"
echo "Inside Claude Code: run /login with the account for $NAME, then /exit."
CLAUDE_CONFIG_DIR="$DIR" env -u ANTHROPIC_API_KEY claude
echo "Check:  echo 'say ok' | CLAUDE_CONFIG_DIR=$DIR claude -p --output-format json"
