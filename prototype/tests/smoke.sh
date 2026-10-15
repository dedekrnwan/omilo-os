#!/usr/bin/env bash
# Offline smoke test with a fake agent: no Claude account needed.  Usage: tests/smoke.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; cp -r "$SRC" "$T/cos"; cd "$T/cos"
rm -rf state/runs state/approvals state/accounts.json; mkdir -p accounts/claude-code/acc-0{1,2,3} "$T/ops"
python3 - <<PY
import json;p='config/settings.json';s=json.load(open(p));s['harnesses']['claude-code']['bin']='$T/cos/tests/mock_claude.py';json.dump(s,open(p,'w'),indent=2)
PY
export COS_ROOT="$T/cos" WORKSPACE_DIR="$T"
for l in ops-health content-weekly sales-prospecting finance-scorecard dev-builder; do bin/cos run $l; done
MOCK_MODE=ratelimit MOCK_LIMITED=acc-01,acc-02,acc-03 bin/cos run support-digest || true
MOCK_MODE=noreport bin/cos run retro-weekly || true
bin/cos status; bin/cos accounts; bin/cos approvals
echo; echo "Dashboard against this test data:"
echo "  COS_ROOT=$T/cos COS_DASHBOARD_TOKEN=test python3 $T/cos/dashboard/server.py"
