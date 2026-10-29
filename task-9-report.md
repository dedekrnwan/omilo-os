# Task 9 Report — End-to-End Integration

## STATUS: COMPLETE

## Commits

- `c7ec9ef` — feat(compute): Task 9 — end-to-end integration tests (real uvicorn + WorkerRuntime)

## Test Summary

**2 passed** (`tests/test_compute_e2e.py`), full suite: **64 passed** in 23.96 s, 0 failures, 0 regressions.

```
tests/test_compute_e2e.py::test_job_e2e_stub PASSED
tests/test_compute_e2e.py::test_no_worker_queues PASSED
```

## Transport path used

**Real uvicorn-in-thread + real WebSocket client.** The test fixture spins up the actual FastAPI app via `uvicorn.Server` on an ephemeral port in a background thread, then points a real `WorkerRuntime(StubExecutor)` at `ws://127.0.0.1:<port>/v1/compute/relay` with the paired token. httpx.AsyncClient is used for HTTP calls. The TestClient fallback was not needed.

## What each test exercises (composed pieces)

### `test_job_e2e_stub`
1. Signs up a company via the real auth API.
2. `POST /v1/compute/workers/pair` → `{worker_id, token}` (Task 3).
3. Starts `WorkerRuntime(StubExecutor)` as an asyncio task; polls DB until `ComputeWorker.status == 'online'` (Task 4 relay + Task 8 runtime).
4. Subscribes to the in-process SSE broker (Task 6).
5. `POST /v1/compute/jobs {spec:{steps:[…]}}` via httpx (Task 3).
6. Polls DB until `ComputeJob.status == 'done'` (Tasks 5+6 dispatch+settle).
7. Asserts `artifact` is set (Task 7 StubExecutor).
8. Asserts worker `in_use` returned to 0 (Task 6 `release()`).
9. Asserts SSE step events arrived in `seq` order, ending with a `job.done` event (Task 6 broker publish).

### `test_no_worker_queues`
1. Signs up a fresh company; pairs a worker (credentials only, no connect yet).
2. Submits a job — confirms it stays `queued` (no connected worker).
3. Connects the `WorkerRuntime` — polls until job progresses past `queued`, then to `done`.
   Exercises the relay's on-register queued-job dispatch path (relay.py §4b).

## Integration seams found and glue added

None. All the pieces composed cleanly on first attempt. The only friction was Python 3.14's stricter f-string parser rejecting `!r` inside ternary expressions — fixed by hoisting the expression to a local variable before formatting.

## Concerns

- The `BrokerCapture` runs a separate asyncio event loop in a background thread. The relay's `broker.publish()` captures the loop from the first `subscribe()` call. Since the uvicorn server has its own event loop (different from the test loop and the BrokerCapture loop), the broker's `_loop` attribute is captured by whichever subscriber registers first. In this test, `BrokerCapture` subscribes before the job is submitted, so it owns the loop that the relay publishes into — the events arrive correctly. This is the same pattern used in `test_compute_status_relay.py` and works reliably for a single-process pilot. A multi-process or multi-loop broker would require a different fan-out strategy (Plan #2 item).

- The `live_server` fixture is `scope="module"`, meaning both tests share one uvicorn instance and one in-process `WorkerRegistry`. Each test seeds its own company, so cross-company isolation holds. The uvicorn thread is daemon-mode and stops when `server.should_exit = True` is set in teardown.
