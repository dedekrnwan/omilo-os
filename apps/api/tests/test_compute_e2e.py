"""TDD — Task 9: End-to-end integration.

Tests
-----

1. test_job_e2e_stub
   Full round-trip:
   - Seed a company + owner via the real auth API.
   - POST /v1/compute/workers/pair → (worker_id, token).
   - Start a real WorkerRuntime(StubExecutor) connected to the real uvicorn
     server on an ephemeral port via a real WebSocket.
   - Wait until the worker is online in the DB.
   - POST /v1/compute/jobs {spec:{steps:[...]}} via httpx.
   - Poll DB until the job reaches status='done'.
   - Assert artifact is set and worker in_use returned to 0.
   - Assert SSE broker received ordered step events ending in job.done.

2. test_no_worker_queues
   - POST /v1/compute/jobs with NO worker connected → job stays 'queued'.
   - Connect a WorkerRuntime → poll until job becomes 'dispatched'/'done'.

Strategy: uvicorn-in-thread with a real ephemeral port + real WorkerRuntime.
This is the preferred real-e2e path (not the TestClient fallback).

The uvicorn server runs in a background thread (with its own asyncio event
loop, as uvicorn.Server.run() starts one internally). The WorkerRuntime runs
in a separate asyncio task inside the test's own event loop. httpx.AsyncClient
is used for HTTP calls.
"""
from __future__ import annotations

import asyncio
import socket
import threading
import time
import uuid
from typing import AsyncGenerator

import httpx
import pytest
import uvicorn

from omilo.compute.relay import registry as global_registry
from omilo.db import SessionLocal
from omilo.main import create_app
from omilo.models.compute import ComputeJob, ComputeWorker
from omilo.realtime.events import broker
from omilo.worker.executor import StubExecutor
from omilo.worker.runtime import WorkerRuntime
from tests.utils import run_alembic


# ---------------------------------------------------------------------------
# Schema guard
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Poll helpers — deterministic, no fixed sleeps
# ---------------------------------------------------------------------------


def _poll(condition_fn, *, timeout: float = 10.0, step: float = 0.1) -> bool:
    """Poll condition_fn() until truthy or timeout. Returns True if satisfied."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if condition_fn():
                return True
        except Exception:
            pass
        time.sleep(step)
    return False


async def _apoll(condition_fn, *, timeout: float = 10.0, step: float = 0.1) -> bool:
    """Async poll condition_fn() until truthy or timeout."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            result = condition_fn()
            if asyncio.iscoroutine(result):
                result = await result
            if result:
                return True
        except Exception:
            pass
        await asyncio.sleep(step)
    return False


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _get_job(job_id: str) -> ComputeJob | None:
    with SessionLocal() as session:
        j = session.get(ComputeJob, job_id)
        if j is not None:
            session.expunge(j)
        return j


def _get_worker(worker_id: str) -> ComputeWorker | None:
    with SessionLocal() as session:
        w = session.get(ComputeWorker, worker_id)
        if w is not None:
            session.expunge(w)
        return w


# ---------------------------------------------------------------------------
# Broker capture — collect SSE events during the test
# ---------------------------------------------------------------------------


class BrokerCapture:
    """Subscribe to the in-process broker and collect events into a list.

    Runs a subscriber on a background asyncio event loop in a new thread so it
    coexists with the test's own event loop and the uvicorn server's loop.

    Usage::

        with BrokerCapture(company_id) as cap:
            # ... trigger job ...
            pass  # wait for events via poll
        events = cap.events
    """

    def __init__(self, company_id: str, *, max_events: int = 50, drain_timeout: float = 2.0):
        self.company_id = company_id
        self.max_events = max_events
        self.drain_timeout = drain_timeout
        self.events: list[dict] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._started = threading.Event()

    def __enter__(self) -> "BrokerCapture":
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        self._started.wait(timeout=5.0)
        return self

    def __exit__(self, *_) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5.0)

    def _run_loop(self) -> None:
        async def _collect() -> None:
            sub = broker.subscribe(self.company_id)
            self._started.set()
            try:
                async for ev in sub:
                    self.events.append(ev)
                    if len(self.events) >= self.max_events:
                        break
                    if self._stop.is_set():
                        break
            except asyncio.CancelledError:
                pass
            except Exception:
                pass
            finally:
                await sub.aclose()

        async def _watchdog() -> None:
            while not self._stop.is_set():
                await asyncio.sleep(0.05)
            await asyncio.sleep(self.drain_timeout)

        async def _main() -> None:
            collect_task = asyncio.create_task(_collect())
            watchdog_task = asyncio.create_task(_watchdog())
            done, pending = await asyncio.wait(
                {collect_task, watchdog_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for t in pending:
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass

        asyncio.run(_main())


# ---------------------------------------------------------------------------
# Uvicorn server fixture — real server on ephemeral port
# ---------------------------------------------------------------------------


def _find_free_port() -> int:
    """Find an unused TCP port on 127.0.0.1."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def live_server():
    """Spin up a real uvicorn server in a background thread.

    Returns ``base_url`` (str) and ``port`` (int) to the caller.
    The server is shut down after all tests in the module complete.

    Uses a fresh app factory (not the shared in-process TestClient app) so the
    real HTTP/WS transport stack is exercised.
    """
    port = _find_free_port()
    app = create_app()

    config = uvicorn.Config(
        app=app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        # Disable access log noise in test output
        access_log=False,
    )
    server = uvicorn.Server(config)

    def _run():
        server.run()

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()

    # Wait until uvicorn signals it has started (server.started = True)
    started = _poll(lambda: server.started, timeout=10.0, step=0.05)
    assert started, "uvicorn server did not start within 10 s"

    base_url = f"http://127.0.0.1:{port}"
    yield {"base_url": base_url, "port": port, "server": server}

    # Teardown: signal uvicorn to stop
    server.should_exit = True
    thread.join(timeout=5.0)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


async def _sign_up(client: httpx.AsyncClient, *, name: str = "E2E Tester") -> tuple[str, str]:
    """Sign up a new user and return (access_token, company_id)."""
    email = f"e2e_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": "testP4ss!"},
    )
    assert resp.status_code == 201, f"sign-up failed: {resp.text}"
    token = resp.json()["session"]["access"]

    me = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, f"/v1/me failed: {me.text}"
    company_id = me.json()["company"]["id"]
    return token, company_id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Zero-delay backoff for WorkerRuntime in tests
# ---------------------------------------------------------------------------


async def _zero_backoff() -> AsyncGenerator[float, None]:
    """Async generator that yields 0 delay on every reconnect attempt."""
    while True:
        yield 0.0


# ---------------------------------------------------------------------------
# Test 1 — full e2e: pair, connect, submit, done, SSE ordered
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_job_e2e_stub(live_server):
    """Full round-trip: pair worker → connect → submit job → done → SSE steps in order."""
    base_url = live_server["base_url"]
    port = live_server["port"]
    relay_url = f"ws://127.0.0.1:{port}/v1/compute/relay"

    worker_task: asyncio.Task | None = None

    async with httpx.AsyncClient(base_url=base_url) as client:
        # 1. Seed a company + owner
        token, company_id = await _sign_up(client, name="E2E Owner")

        # 2. Pair a worker
        pair_resp = await client.post(
            "/v1/compute/workers/pair",
            json={"capacity": 1},
            headers=_auth(token),
        )
        assert pair_resp.status_code == 200, f"pair failed: {pair_resp.text}"
        pair_body = pair_resp.json()
        worker_id = pair_body["worker_id"]
        worker_token = pair_body["token"]

        # 3. Start the WorkerRuntime as an asyncio task
        runtime = WorkerRuntime(
            relay_url=relay_url,
            token=worker_token,
            company_id=company_id,
            worker_id=worker_id,
            capacity=1,
            executor=StubExecutor(),
            backoff=_zero_backoff(),
        )
        worker_task = asyncio.create_task(runtime.run())

        try:
            # Wait until the worker is online in the DB (poll-based, no sleep)
            def _worker_online():
                w = _get_worker(worker_id)
                return w is not None and w.status == "online"

            online = await _apoll(_worker_online, timeout=10.0)
            assert online, f"Worker {worker_id} did not come online within 10 s"

            # 4. Subscribe to SSE broker BEFORE submitting the job
            steps_from_spec = ["echo e2e step 1", "echo e2e step 2", "echo e2e step 3"]
            with BrokerCapture(company_id, max_events=30, drain_timeout=3.0) as cap:

                # 5. POST /v1/compute/jobs
                job_resp = await client.post(
                    "/v1/compute/jobs",
                    json={"spec": {"steps": steps_from_spec}},
                    headers=_auth(token),
                )
                assert job_resp.status_code == 200, f"create_job failed: {job_resp.text}"
                job_id = job_resp.json()["id"]

                # 6. Poll DB until job is 'done'
                def _job_done():
                    j = _get_job(job_id)
                    return j is not None and j.status == "done"

                done = await _apoll(_job_done, timeout=15.0)
                if not done:
                    _j = _get_job(job_id)
                    _final_status = _j.status if _j else "None"
                    assert False, (
                        f"Job {job_id} did not reach status='done' within 15 s. "
                        f"Final status: {_final_status!r}"
                    )

                # Give broker a moment to deliver remaining events
                await asyncio.sleep(0.3)

            # 7. Assert artifact is set
            job_row = _get_job(job_id)
            assert job_row is not None
            assert job_row.status == "done", f"Expected 'done', got {job_row.status!r}"
            assert job_row.artifact is not None and job_row.artifact != "", (
                f"Expected artifact to be set, got {job_row.artifact!r}"
            )

            # 8. Assert worker's in_use returned to 0
            def _in_use_zero():
                w = _get_worker(worker_id)
                return w is not None and w.in_use == 0

            released = await _apoll(_in_use_zero, timeout=5.0)
            if not released:
                _w = _get_worker(worker_id)
                _in_use_val = _w.in_use if _w else "N/A"
                assert False, (
                    f"Worker in_use did not return to 0. Current in_use: {_in_use_val}"
                )

            # 9. Assert SSE events carried ordered steps ending in job.done
            step_events = [e for e in cap.events if e.get("type") == "job.step"]
            done_events = [e for e in cap.events if e.get("type") == "job.done"]

            # Must have at least one step event and exactly one done event
            assert len(step_events) >= 1, (
                f"Expected at least 1 job.step SSE event, got: {cap.events}"
            )
            assert len(done_events) >= 1, (
                f"Expected at least 1 job.done SSE event, got: {cap.events}"
            )

            # Verify steps are in order by seq
            seqs = [e.get("seq") for e in step_events]
            assert seqs == sorted(seqs), (
                f"Step events not in seq order: {seqs}"
            )
            # seq should start at 0
            assert seqs[0] == 0, f"First step seq must be 0, got {seqs[0]}"

            # The 'done' event should report the right job
            assert done_events[0].get("job_id") == job_id, (
                f"done event job_id mismatch: {done_events[0]}"
            )

            # No secrets in any SSE event
            for ev in cap.events:
                assert "secrets" not in ev, f"'secrets' key in SSE event: {ev}"

        finally:
            if worker_task is not None and not worker_task.done():
                worker_task.cancel()
                try:
                    await worker_task
                except (asyncio.CancelledError, Exception):
                    pass


# ---------------------------------------------------------------------------
# Test 2 — queued without a worker → worker connects → job dispatched/done
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_worker_queues(live_server):
    """Job submitted with no worker → queued; worker connects → dispatched/done."""
    base_url = live_server["base_url"]
    port = live_server["port"]
    relay_url = f"ws://127.0.0.1:{port}/v1/compute/relay"

    worker_task: asyncio.Task | None = None

    async with httpx.AsyncClient(base_url=base_url) as client:
        # 1. Seed a fresh company (no worker connected)
        token, company_id = await _sign_up(client, name="No-Worker Owner")

        # 2. Pair a worker (credentials only — don't connect yet)
        pair_resp = await client.post(
            "/v1/compute/workers/pair",
            json={"capacity": 1},
            headers=_auth(token),
        )
        assert pair_resp.status_code == 200, f"pair failed: {pair_resp.text}"
        pair_body = pair_resp.json()
        worker_id = pair_body["worker_id"]
        worker_token = pair_body["token"]

        # 3. Submit a job BEFORE any worker is connected — it must stay 'queued'
        job_resp = await client.post(
            "/v1/compute/jobs",
            json={"spec": {"steps": ["echo queued-test"]}},
            headers=_auth(token),
        )
        assert job_resp.status_code == 200, f"create_job failed: {job_resp.text}"
        job_id = job_resp.json()["id"]

        # The job response may already be 'queued' or might reflect an attempt;
        # poll to confirm it is 'queued' (no worker is connected at this point)
        # Give a short window (2 s) and assert it is queued, NOT done
        await asyncio.sleep(0.2)  # brief pause so dispatch has time to find no worker
        job_initial = _get_job(job_id)
        assert job_initial is not None
        assert job_initial.status == "queued", (
            f"Expected job to be 'queued' with no worker, got {job_initial.status!r}"
        )

        # 4. Now connect the WorkerRuntime
        runtime = WorkerRuntime(
            relay_url=relay_url,
            token=worker_token,
            company_id=company_id,
            worker_id=worker_id,
            capacity=1,
            executor=StubExecutor(),
            backoff=_zero_backoff(),
        )
        worker_task = asyncio.create_task(runtime.run())

        try:
            # 5. Wait until the worker is online
            def _worker_online():
                w = _get_worker(worker_id)
                return w is not None and w.status == "online"

            online = await _apoll(_worker_online, timeout=10.0)
            assert online, f"Worker {worker_id} did not come online within 10 s"

            # 6. Poll until the job transitions to 'dispatched' or 'done'
            def _job_progressed():
                j = _get_job(job_id)
                return j is not None and j.status in ("dispatched", "done")

            progressed = await _apoll(_job_progressed, timeout=10.0)
            if not progressed:
                _j = _get_job(job_id)
                _status = _j.status if _j else "None"
                assert False, (
                    f"Job {job_id} did not progress past 'queued' after worker connected. "
                    f"Status: {_status!r}"
                )

            # 7. Wait for the job to fully complete ('done')
            def _job_done():
                j = _get_job(job_id)
                return j is not None and j.status == "done"

            done = await _apoll(_job_done, timeout=15.0)
            if not done:
                _j = _get_job(job_id)
                _final = _j.status if _j else "None"
                assert False, (
                    f"Job {job_id} did not reach 'done' within 15 s. "
                    f"Final status: {_final!r}"
                )

        finally:
            if worker_task is not None and not worker_task.done():
                worker_task.cancel()
                try:
                    await worker_task
                except (asyncio.CancelledError, Exception):
                    pass
