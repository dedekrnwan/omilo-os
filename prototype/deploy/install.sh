#!/usr/bin/env bash
# Install Company OS on the Linux server. Run as root from inside the company-os folder.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_USER="${AGENT_USER:-agent}"

id "$AGENT_USER" &>/dev/null || useradd --create-home --shell /bin/bash "$AGENT_USER"
chown -R "$AGENT_USER":"$AGENT_USER" "$ROOT"
mkdir -p "$ROOT/accounts/claude-code" && chown -R "$AGENT_USER":"$AGENT_USER" "$ROOT/accounts"

if [ ! -f /etc/company-os.env ]; then
  sed "s#^COS_ROOT=.*#COS_ROOT=$ROOT#; s#^WORKSPACE_DIR=.*#WORKSPACE_DIR=$(dirname "$ROOT")#" \
      "$ROOT/deploy/company-os.env.example" > /etc/company-os.env
  chmod 600 /etc/company-os.env
  echo ">> Created /etc/company-os.env. Edit it (tokens, DB URL) before enabling timers."
fi

ln -sf "$ROOT/bin/cos" /usr/local/bin/cos
sed "s#\${COS_ROOT}#$ROOT#; s#^User=.*#User=$AGENT_USER#" "$ROOT/deploy/cos-dashboard.service" > /etc/systemd/system/cos-dashboard.service
COS_ROOT="$ROOT" python3 "$ROOT/bin/cos" install-timers --user "$AGENT_USER"
systemctl daemon-reload
systemctl enable --now cos-dashboard.service
echo
echo ">> Dashboard: http://127.0.0.1:8787  (tunnel: ssh -L 8787:127.0.0.1:8787 <server>)"
echo ">> Next: log in the Claude Code accounts:  sudo -u $AGENT_USER $ROOT/deploy/add-account.sh acc-01"
echo ">> Then test one loop by hand:            sudo -u $AGENT_USER cos run ops-health"
echo ">> Then enable schedules:                 systemctl enable --now cos-loop-*.timer"
