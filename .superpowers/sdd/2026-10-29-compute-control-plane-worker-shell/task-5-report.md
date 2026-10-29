# Task 5 Report — Dispatch + Capacity Leases

## STATUS: DONE

## What was built

### `apps/api/omilo/compute/dispatch.py` (new)

- `LEASE_S = 300.0` — 5 minute default lease.
- `dispatch(job, *, registry=None) -> WorkerConn | None`  
  Reads the in-process registry for same-company workers, then atomically
  reserves a slot in the DB (`_db_pick_and_reserve` — single transaction,
  prevents double-booking under concurrent dispatches).  Enqueues the encoded
  `start_job` frame onto `conn.outbox` if present; skips silently for fake
  conns in tests.  Returns `None` (job stays `queued`) if no eligible worker.
- `reap_expired_leases(now: datetime) -> int`  
  Errors all `dispatched`/`running` jobs with `lease_expires_at <= now` OR
  `worker_id IS NULL` (ON DELETE SET NULL orphan).  Frees owning worker's
  `in_use` (floor 0).
- `release(job) -> None`  
  Decrements owning worker `in_use` (floor 0); no-op if `worker_id` is None.

### `apps/api/omilo/compute/relay.py` (modified)

- `WorkerConn` changed from `frozen=True` dataclass to a mutable dataclass with
  `outbox: asyncio.Queue = field(default_factory=asyncio.Queue)`.
- Added `_send_loop()` async task alongside the existing heartbeat and receive
  loops — drains `conn.outbox` and calls `websocket.send_text()` each frame.
  All three tasks run under `asyncio.wait(FIRST_COMPLETED)`.
- After marking worker online (step 4), fetches queued jobs for that company
  and calls `dispatch()` on each — so jobs enqueued before a worker connects
  are delivered on first registration.
- `_mark_worker_offline_and_error_inflight` already sets `in_use=0` and errors
  all in-flight jobs; the drop path is unchanged.

### `apps/api/omilo/api/compute.py` (modified)

- `create_job` converted from `def` to `async def` (FastAPI supports both;
  sync deps like `get_tenant_db` still work unchanged).
- After `db.flush()`, calls `await _dispatch(job)` — non-fatal on failure
  (job stays queued).
- Response now includes `lease_expires_at` as an ISO string (was a raw datetime
  object before, which would have caused serialisation errors).
- `db.refresh(job)` before building the response so `status`/`worker_id`
  reflect any dispatch update.

### `apps/api/tests/test_compute_dispatch.py` (new)

10 tests covering:

| Test | Focus |
|------|-------|
| `test_dispatch_same_company_only` | Cross-company isolation — B-worker never gets A-job |
| `test_dispatch_respects_capacity` | `in_use >= capacity` → worker skipped |
| `test_no_worker_sets_queued` | Empty registry → job stays queued, returns None |
| `test_dispatch_assigns_job_and_sets_lease` | Happy path — status, worker_id, lease set |
| `test_reap_expired_lease_frees_capacity` | Dispatched+expired → error, in_use freed |
| `test_reap_running_job_with_expired_lease` | Running+expired → error, in_use freed |
| `test_reap_orphaned_worker_id` | NULL worker_id → errored without crash |
| `test_release_frees_capacity` | release() decrements in_use |
| `test_release_floors_at_zero` | release() never goes below 0 |
| `test_release_no_worker_id_is_noop` | release() with NULL worker_id safe |

## Design notes

- **Atomic capacity check**: `_db_pick_and_reserve` checks `in_use < capacity`
  inside a transaction, so concurrent `dispatch()` calls cannot double-book a slot.
- **In_use source of truth is the DB**: the registry snapshot supplies candidate
  worker IDs (same-company filter); the DB does the actual capacity check.
  `WorkerConn.capacity` is informational (used by relay, available if needed).
- **Circular import avoidance**: `dispatch.py` uses deferred imports inside
  functions for relay types; relay.py likewise defers its `dispatch` import to
  inside the handler body.
- **Outbox queue**: added to `WorkerConn` as a `default_factory=asyncio.Queue`
  field; test fakes (no outbox needed) have `outbox=None` gracefully handled.

---

## Fix round 1 — 2026-10-30

### Findings addressed

**C1 (Critical) — DB-layer cross-company guard**

`_db_pick_and_reserve` now checks `worker.company_id != job.company_id` inside
the transaction before any capacity check.  Cross-company candidates are skipped
with a warning log.  The in-memory registry pre-filter remains the primary guard;
the DB check is defense-in-depth that fires independently on the committed row.

File: `apps/api/omilo/compute/dispatch.py`

**C2 (Critical) — direct DB-layer cross-company test**

Added `test_db_pick_and_reserve_rejects_cross_company` which calls
`_db_pick_and_reserve` directly — bypassing the registry — passing a company-B
worker ID against a company-A job.  Asserts `chosen is None`, `job.status ==
'queued'`, `job.worker_id is None`, and `worker.in_use == 0`.

File: `apps/api/tests/test_compute_dispatch.py`

**I1 (Important) — commit-ordering race in `create_job`**

`create_job` previously did `db.flush()` then called `dispatch()`, which opened
a separate `SessionLocal` connection that (READ COMMITTED) could not see the
uncommitted job row → `session.get(ComputeJob, job_id)` returned None → job
silently stayed `queued`.

Fix: the job row is now written in a **dedicated `SessionLocal` session** (its
own `with session.begin()` block) before dispatch is called.  The request-scoped
`db` session is only used at the end to read back the final state via `db.get()`.
Calling `db.commit()` inside the `get_tenant_db` managed transaction would have
closed the transaction context and broken subsequent session use — hence the
dedicated inner session approach.

Also added `test_create_job_dispatches_immediately_with_online_worker` which
exercises the dispatch path end-to-end (commit → dispatch → assert
`status='dispatched'`) without going through the HTTP layer.

File: `apps/api/omilo/api/compute.py`, `apps/api/tests/test_compute_dispatch.py`

**I2 (Important) — pure-orphan reap test**

`test_reap_orphaned_worker_id` previously used `lease_expires_at=past`, so the
expired-lease predicate alone satisfied the reap — the `worker_id IS NULL` branch
was never independently proven.

Fixed: test now uses `lease_expires_at = now + 600s` (future).  The
expired-lease predicate cannot fire; only the `worker_id IS NULL` OR-branch reaps
the job.  Asserts `status == 'error'`.

File: `apps/api/tests/test_compute_dispatch.py`

**Minor — removed dead `_db_mark_queued`**

The function was never called anywhere.  Removed from `dispatch.py`.

File: `apps/api/omilo/compute/dispatch.py`

### Covering tests

```
tests/test_compute_dispatch.py::test_db_pick_and_reserve_rejects_cross_company  (C2)
tests/test_compute_dispatch.py::test_create_job_dispatches_immediately_with_online_worker  (I1)
tests/test_compute_dispatch.py::test_reap_orphaned_worker_id  (I2 — fixed)
```

### Command + result

```
cd apps/api && .venv/bin/python -m pytest tests/test_compute_dispatch.py tests/test_compute_api.py -v
```

```
18 passed, 19 warnings in 2.09s
```

All 18 tests pass (12 dispatch + 6 API).

---

## Concerns / future work

- **Lease renewal**: workers running long jobs will hit the 5-minute lease.
  A `job_status` frame handler should extend `lease_expires_at` on heartbeat.
  `reap_expired_leases` is already callable on a cron schedule.
- **Fair dispatch policy**: current `dispatch` is greedy (first free worker).
  A round-robin or least-loaded policy can be added inside `_db_pick_and_reserve`.
- **`job_queued` frame**: the brief mentions emitting a `job_queued` frame to
  the requester when no worker is available.  The REST response already
  communicates `status='queued'`; a WebSocket client push path is future work
  (needs a client registry analogous to the worker registry).
- **Reap cron**: `reap_expired_leases` exists but is not wired to a periodic
  task yet — it should be called on a background schedule (e.g. every 60 s).
