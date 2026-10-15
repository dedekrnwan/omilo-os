# Loop: ops-health (operations, hourly)

Goal: catch production problems before residents or pengurus notice.

1. Read `ops/docs/runbook.md` (once per run, skim) so your advice matches the real setup.
2. Check, read-only:
   - Firing alerts: `curl -s "$PROM_URL/api/v1/alerts"`
   - Targets down: `curl -s "$PROM_URL/api/v1/targets?state=active"` (look for health != "up")
   - Swarm: `docker service ls` (replicas below desired), `docker service ps <svc> --no-trunc` for failing ones,
     last 50 log lines of any failing service.
   - Disk/memory: `df -h`, `free -m`.
   If a data source is unavailable, say so in the report. That is itself a finding.
3. Decide a status: **OK**, **DEGRADED** or **DOWN**. Put it at the start of the report headline, e.g. `# OK: all 9 services healthy`.
4. For anything not OK, write a proposal (`type: ops`) with: symptom, likely cause, evidence (log lines),
   and the exact command(s) the founder should run or approve. Rate the risk.
5. Do not restart, scale, deploy or delete anything yourself.

Keep the report under 15 lines when status is OK.
