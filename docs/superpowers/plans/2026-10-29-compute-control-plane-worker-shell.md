# Compute Control Plane + Worker Shell — Implementation Plan (Plan #1 of the managed-compute series)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client can trigger a compute job that routes cloud → worker → executor and streams live status back, with workers that pair, dial out, heartbeat, reconnect, and release capacity via leases — using a `StubExecutor` where Plan #2's real gVisor/Claude-Code executor drops in.

**Architecture:** Workers dial OUT to a cloud WebSocket **relay** (NAT-friendly) and register per company. A client creates a `ComputeJob` over REST; the relay dispatches it to a registered worker (capacity-leased), and the worker streams `job_step`/`job_status`/`job_done` frames back, which the relay persists to `ComputeJob` and republishes to the existing SSE bus so the UI sees live status. The worker runs jobs through an `Executor` seam; this plan ships only a `StubExecutor`.

**Tech Stack:** Python 3.14, FastAPI + Starlette WebSockets, Pydantic v2, SQLAlchemy 2.0 + Alembic, the `websockets` client lib (worker), pytest. Reuses the existing `omilo` package, `get_tenant_db`/`get_context` RLS, and `omilo/realtime/sse.py`.

**Spec:** the managed-cloud compute design (private, `omilo-cloud/docs/specs/2026-10-29-omilo-managed-cloud-compute-design.md`; esp. §6, §6.1, §7, §9, §16 — the spike pinned the protocol + Executor seam this plan implements).

## Global Constraints

- **Relay protocol (from §16, verbatim frame set):** `register` · `start_job{job_id,company_id,spec,secrets}` · `job_queued{job_id,reason}` · `job_accepted{job_id,worker_id}` · `job_step{job_id,seq,stream,line}` · `job_status{job_id,state,detail}` · `job_done{job_id,ok,result,artifact}` · `job_error{job_id,error}` · `ping`/`pong`. One JSON object per frame, discriminated by `type`.
- **Workers dial OUT** and hold the connection; the cloud never dials a worker.
- **Heartbeat is mandatory** (spike finding): ping/pong on a fixed interval; a missed pong → worker marked offline and its in-flight jobs → `job_error`. No silent-dead-peer.
- **Capacity via leases** (spike finding): a dispatched job holds a lease with an expiry; freed on `job_done`/`job_error`/disconnect **or lease timeout** — never free-only-on-done.
- **Tenant isolation:** `ComputeWorker`/`ComputeJob` are tenant tables (`company_id` + RLS), same as every other domain table.
- **Secrets never persisted:** `start_job.secrets` are relayed to the worker and never written to `ComputeJob` or logs.
- **Executor is a seam:** this plan's worker only runs `StubExecutor`; the `Executor` interface is the contract Plan #2 implements. Do not build gVisor here.
- Migration chains after the current head (`0021_company_settings` / check `alembic heads`).
- Build gate per task: `cd apps/api && .venv/bin/python -m pytest -q` green.

## Review Focus

- **Silent-dead-relay / worker:** a dropped connection with no close frame must be caught by the heartbeat within one interval, not hang forever (owns: Task 4).
- **Lease leak on a wedged job:** a job whose worker never sends `job_done` must have its lease reaped so capacity isn't lost permanently (owns: Task 5).
- **Cross-company dispatch:** a job must only ever be dispatched to a worker of the **same** `company_id`, even if another company's worker has free capacity (owns: Task 5).
- **Secret leakage:** `secrets` must reach the worker but never land in `ComputeJob`, SSE payloads, or logs (owns: Task 6).
- **Out-of-order / duplicate steps:** `job_step.seq` must let the client render steps in order and ignore a replayed frame after reconnect (owns: Task 6).

---

### Task 1: Relay protocol module

**Files:**
- Create: `apps/api/omilo/compute/__init__.py`, `apps/api/omilo/compute/protocol.py`
- Test: `apps/api/tests/test_compute_protocol.py`

**Interfaces:**
- Produces: a Pydantic v2 discriminated union `Frame` (tagged by `type`) covering all Global-Constraints frame types, plus `encode(frame) -> str` and `decode(raw: str) -> Frame`.

- [ ] **Step 1: Write failing tests** — `test_roundtrip_each_frame` (every frame type survives `decode(encode(f)) == f`), `test_decode_unknown_type_raises`, `test_job_step_requires_seq`.
- [ ] **Step 2: Run → fail** (`pytest tests/test_compute_protocol.py -v`, module missing).
- [ ] **Step 3: Implement** the frame models + `encode`/`decode` in `protocol.py` (Pydantic `Field(discriminator="type")`).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.**

### Task 2: Compute models + migration

**Files:**
- Create: `apps/api/omilo/models/compute.py`, migration `apps/api/migrations/versions/0022_compute.py` (chain after current head)
- Test: `apps/api/tests/test_compute_models.py`

**Interfaces:**
- Produces: `ComputeWorker{id, company_id, status('online'|'offline'), capacity:int, in_use:int, last_seen_at, token_hash}` and `ComputeJob{id, company_id, worker_id|None, status('queued'|'dispatched'|'running'|'done'|'error'), spec:JSONB, lease_expires_at|None, result:JSONB|None, artifact:str|None, error:str|None, created_at}`. Both tenant tables (`company_id` + FORCE RLS, mirror an existing tenant model + migration).

- [ ] **Step 1: Failing tests** — `test_tables_exist_after_migration`, `test_compute_tables_are_rls_scoped` (a row for company A is invisible under company B's context — mirror an existing RLS test).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** models + migration (copy RLS/grant boilerplate from the newest tenant-table migration); `alembic upgrade head`.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.**

### Task 3: Worker pairing + job-create REST

**Files:**
- Create: `apps/api/omilo/api/compute.py`; Modify: `apps/api/omilo/main.py` (mount `compute_router` under `/v1`)
- Test: `apps/api/tests/test_compute_api.py`

**Interfaces:**
- Consumes: Task 2 models.
- Produces: `POST /v1/compute/workers/pair` (owner/admin) → `{worker_id, token}` (stores `token_hash`, raw token returned once — mirror `mcp_tokens.py`); `POST /v1/compute/jobs` body `{spec}` → creates a `ComputeJob(status='queued')` for the caller's company and returns it. A `verify_worker_token(token) -> ComputeWorker | None` helper used by Task 4.

- [ ] **Step 1: Failing tests** — `test_pair_issues_token_hash_not_raw`, `test_pair_requires_admin` (403 for member), `test_create_job_queued_for_company`, `test_verify_worker_token_roundtrip`.
- [ ] **Step 2–5:** fail → implement (role-guard via the `company.py` pattern; token hashing via the `mcp_tokens` helper) → pass → commit.

### Task 4: Worker relay WebSocket + registry + heartbeat

**Files:**
- Create: `apps/api/omilo/compute/relay.py` (in-process `WorkerRegistry` + connection handling); Modify: `apps/api/omilo/main.py` (add WS route `/v1/compute/relay`)
- Test: `apps/api/tests/test_compute_relay_worker.py`

**Interfaces:**
- Consumes: Task 1 `Frame`, Task 3 `verify_worker_token`.
- Produces: `WorkerRegistry` with `register(worker)`, `by_company(company_id) -> list[WorkerConn]`, `drop(worker_id)`; a WS handler that authenticates the first frame (token → `ComputeWorker`), marks the worker `online`, runs a **ping every `HEARTBEAT_S=20`** and drops the worker if no `pong` within `2×HEARTBEAT_S`. `HEARTBEAT_S` is a module constant.

- [ ] **Step 1: Failing tests** (FastAPI `TestClient.websocket_connect`) — `test_worker_registers_with_valid_token`, `test_bad_token_closes`, `test_missing_pong_marks_offline_and_errors_inflight` (use an injected fake clock / short interval so the test doesn't sleep 40 s).
- [ ] **Step 2–5:** fail → implement → pass → commit. *(Heartbeat timing must be test-injectable — pass the interval + a `now()` callable into the handler.)*

### Task 5: Dispatch + capacity leases

**Files:**
- Create: `apps/api/omilo/compute/dispatch.py`; Modify: `apps/api/omilo/compute/relay.py` (call dispatch on job-create + on worker-available)
- Test: `apps/api/tests/test_compute_dispatch.py`

**Interfaces:**
- Consumes: Task 2 models, Task 4 `WorkerRegistry`.
- Produces: `dispatch(job) -> WorkerConn | None` (pick an `online` worker of the **same company** with `in_use < capacity`; reserve a lease: `in_use += 1`, `job.worker_id`, `job.status='dispatched'`, `job.lease_expires_at = now + LEASE_S`; send `start_job`; none available → `job.status='queued'` + emit `job_queued`); `reap_expired_leases(now)` (dispatched/running jobs past `lease_expires_at` → `job.status='error'`, free the worker's `in_use`); `release(job)` (free `in_use` on done/error/disconnect).

- [ ] **Step 1: Failing tests** — `test_dispatch_same_company_only` (company-B worker never gets company-A's job), `test_dispatch_respects_capacity`, `test_no_worker_sets_queued`, `test_reap_expired_lease_frees_capacity`, `test_release_frees_capacity`.
- [ ] **Step 2–5:** fail → implement → pass → commit.

### Task 6: Status relay to client (persist + SSE republish)

**Files:**
- Modify: `apps/api/omilo/compute/relay.py` (handle worker→cloud `job_step`/`job_status`/`job_done`/`job_error`); reuse `apps/api/omilo/realtime/sse.py`
- Test: `apps/api/tests/test_compute_status_relay.py`

**Interfaces:**
- Consumes: Task 1 frames, Task 2 `ComputeJob`, the existing SSE publish function.
- Produces: on each worker status frame — update `ComputeJob` (`running`/`done`/`error`, `result`, `artifact`, `error`), call `release(job)` on terminal, and **publish a sanitized event to the company's SSE stream** (fields: job_id, seq, stream, line, state — **never `secrets`**). Steps carry `seq` so the client orders + dedups.

- [ ] **Step 1: Failing tests** — `test_job_step_persists_and_publishes_in_order`, `test_job_done_settles_and_releases`, `test_secrets_never_in_sse_or_job_row`, `test_duplicate_seq_is_idempotent`.
- [ ] **Step 2–5:** fail → implement → pass → commit.

### Task 7: Executor interface + StubExecutor

**Files:**
- Create: `apps/api/omilo/worker/__init__.py`, `apps/api/omilo/worker/executor.py`
- Test: `apps/api/tests/test_executor_stub.py`

**Interfaces:**
- Produces: `@dataclass JobContext{job_id, company_id, volume_path, spec:dict, secrets:dict}`; `class Executor` with `async def run(ctx) -> AsyncIterator[ExecEvent]` where `ExecEvent` is `("status",dict) | ("step",dict) | ("done",dict)` ending in **exactly one** `("done",{ok,result,artifact})`. `StubExecutor` emits a few `step`s from `ctx.spec["steps"]` and writes `artifact-<job_id>.json` into `ctx.volume_path` (created if absent), returning its path as `artifact`. **This signature is the contract Plan #2's `GvisorExecutor` implements.**

- [ ] **Step 1: Failing tests** — `test_stub_yields_steps_then_one_done`, `test_stub_writes_artifact_to_volume`, `test_volume_persists_across_two_runs` (same `volume_path`, both artifacts coexist).
- [ ] **Step 2–5:** fail → implement → pass → commit.

### Task 8: Worker runtime + `omilo-worker` console script

**Files:**
- Create: `apps/api/omilo/worker/runtime.py`; Modify: `apps/api/omilo/cli.py` (+ `worker()` entry), `apps/api/pyproject.toml` (`omilo-worker = "omilo.cli:worker"`)
- Test: `apps/api/tests/test_worker_runtime.py`

**Interfaces:**
- Consumes: Task 1 `Frame`, Task 7 `Executor`/`StubExecutor`.
- Produces: `WorkerRuntime(relay_url, token, company_id, capacity, executor)` with `async run()` — dials out, sends `register`, answers `ping` with `pong`, on `start_job` runs the executor and streams `job_accepted`→`job_step*`→`job_done`/`job_error`, and **reconnects with capped exponential backoff** on disconnect (1→2→4→8 s, cap 10 s). Uses `StubExecutor` by default.

- [ ] **Step 1: Failing tests** — `test_worker_registers_and_runs_job` (against an in-process fake relay: feed `start_job`, assert the accepted→steps→done sequence out), `test_worker_answers_ping_with_pong`, `test_worker_reconnects_with_backoff` (fake transport that drops once).
- [ ] **Step 2–5:** fail → implement → pass → commit.

### Task 9: End-to-end integration

**Files:**
- Test: `apps/api/tests/test_compute_e2e.py`

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Failing test** — `test_job_e2e_stub`: pair a worker; start a `WorkerRuntime(StubExecutor)` pointed at the TestClient relay; `POST /v1/compute/jobs`; assert the `ComputeJob` reaches `done`, an artifact path is set, SSE carried the ordered steps, and the worker's `in_use` returned to 0. Plus `test_no_worker_queues`: create a job with no worker → stays `queued`; connect a worker → it gets dispatched.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Wire any glue needed** (no new product logic — this test only composes existing tasks; fix integration seams it exposes).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit.**

---

## Self-Review

- **Spec coverage:** §6.1/§7 relay + pool-of-workers (Tasks 4–5), §9 job lifecycle + status (Task 6) + persistence substrate (Task 7 volume), §16 pinned protocol (Task 1) + Executor seam (Task 7) + heartbeat/leases gaps (Tasks 4/5). *Deferred to Plan #2 (correctly out of scope here): `GvisorExecutor`, Claude Code `HarnessSession`/resume, GitHub-App token mint, real scheduler/multi-worker fairness, durable (cross-process) relay registry, backpressure flow-control, CLI `--connect machine` pairing UX.*
- **Step scan:** each step writes one thing (a signature, a named test, a command). No bodies except where the spec pins exact frame fields.
- **Type consistency:** `Frame`/`JobContext`/`ExecEvent` names + `job_step.seq` + `lease_expires_at`/`in_use`/`capacity` are used identically across Tasks 1–9.
- **Review Focus:** silent-dead → T4; lease leak → T5; cross-company → T5; secret leak → T6; ordering/dup → T6. All five owned + tested.
- **Proportion:** plan is interface + test-intent only; shorter than the code it will produce. Executor body = Plan #2.
- **Known honest gap:** the in-process `WorkerRegistry` dies with the API process (spike's "durable job store" item) — acceptable for a single-process pilot; a durable registry is an explicit Plan-#2/Phase-2 task, noted above, not silently assumed.
