# Known issue: full-suite test isolation (CI `api` job pytest red)

**Status:** parked / known pre-existing debt. Not blocking — the light-tier work and the
individual features are correct; this is a *test harness* problem, not a product bug.

## Symptom

`ci.yml` → `api` job: `ruff` ✅, collection ✅, but `pytest -q` fails with ~40–60 failures
across many files (`test_nudge`, `test_tune`, `test_workflows`, `test_teamchat`, `test_monitor`,
`test_settings`, `test_pieces_connect`, `test_harness`, `test_helper_access`, …). Errors are
auth/state-shaped: `invalid or missing staff MCP token`, `AttributeError: 'NoneType' ... mcp_token_enc`,
`401`, `AssertionError: condition not met in time`.

This only became visible recently: CI used to die at the `ruff` gate before pytest ran at all.
Fixing ruff + the pytest `pythonpath` let the suite execute for the first time, exposing debt that
had been latent in the merged pieces/oauth/chat/tune features.

## Root cause (confirmed)

**Cumulative shared-session state pollution.** The suite runs *all* ~471 tests against a single
session-scoped in-process server + one shared Postgres DB + one always-running embedded worker,
with **no per-test/per-module reset**. The `owner` fixture (conftest) is `scope="session"` and
seeds the owner/staff/MCP-tokens **once**. Over a long full run, destructive/stateful tests mutate
MAIN's shared state (staff roster, MCP tokens, KB/company state); once corrupted, downstream tests
that depend on the seed fail — either directly (`staff is None` / missing token / 401) or because
their task/KB-embed can never complete (`condition not met in time`).

### Evidence
- **Every failing file passes in isolation** (e.g. `pytest tests/test_nudge.py` → 11/11).
- **No pair or small group reproduces** it — only the full (or large) run fails. So it's
  *cumulative*, not a single discrete polluter.
- Fewer xdist workers → **more** failures (more files per worker-process → more accumulated
  pollution); more workers → fewer. Confirms per-process accumulation.
- A 60s wait-floor did **not** help → the waits aren't slow, the underlying state never becomes
  valid. One cause, two symptoms.
- Not caused by the light-tier work (its tests isolate cleanly) and not a ruff/pythonpath
  regression (those only let the suite run).

### Local-measurement caveat
CI gets a **fresh** Postgres container each run, so it never carries local cruft. Measuring locally
is unreliable once experiments leave leftover state (stale `owner`, orphan `omilo_test_gw*` DBs →
`409 "the owner already exists"`). To reset locally:
```bash
docker exec -i omilo-dev-postgres-1 psql -U omilo -d omilo \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE 'omilo_test%' AND pid<>pg_backend_pid()"
# then DROP DATABASE IF EXISTS each omilo_test* (top-level, not in a DO block) and CREATE DATABASE omilo_test
```

## Fix options (for the deliberate follow-up — verify on CI, not a hammered local box)

1. **Per-worker DB + xdist (C-lite, promising but worker-count-sensitive).** Give each xdist worker
   its own database so files sharing a run can't corrupt each other. Starting point for conftest
   (before `_fresh_database()`), no-op off xdist:
   ```python
   def _ensure_worker_database():
       global DB_URL
       w = os.environ.get("PYTEST_XDIST_WORKER")
       if not w or w == "master" or "OMILO_TEST_DATABASE_URL" in os.environ:
           return
       import sqlalchemy as sa
       base, _, name = DB_URL.rpartition("/")
       wname = f"{name}_{w}"
       admin = sa.create_engine(DB_URL, isolation_level="AUTOCOMMIT", poolclass=sa.pool.NullPool)
       with admin.connect() as c:
           if not c.exec_driver_sql(f"SELECT 1 FROM pg_database WHERE datname='{wname}'").first():
               c.exec_driver_sql(f'CREATE DATABASE "{wname}"')
       admin.dispose()
       DB_URL = f"{base}/{wname}"
   ```
   Run `pytest -n auto --dist loadfile`, add `pytest-xdist` to `[dev]`. **Caveat:** reliability
   depends on files-per-worker staying under the pollution threshold; on a 4-core CI (`-n auto`=4,
   ~118 files/worker) it was **not** green, and oversubscribing workers trades pollution for
   CPU-contention timing flakes. So this alone is fragile on constrained runners.

2. **Source-level per-module reset (the robust fix).** Make the shared seed self-heal between
   modules — e.g., a module-scoped `owner` (re-seed per file) plus dropping `co_*` schemas between
   modules — so worker count stops mattering. More work (the suite is built around session-scoped
   seed-once), but it's the durable answer.

3. **Process-per-file in CI.** Run each file in its own fresh process (every file passes alone).
   Reliable but slow and clunky; a fallback if (2) is too invasive.

**Recommendation:** pursue (2) for a real fix, or ship (1) tuned + verified on CI if a quick win is
acceptable. Either way, iterate against CI's clean DB.
