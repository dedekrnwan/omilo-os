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
   - Stream the real SSE HTTP endpoint (/v1/stream?token=...) until job.done.
   - Assert all 3 step events arrived in seq order, then job.done.
   - Assert artifact is set and worker in_use returned to 0.

2. test_no_worker_queues
   - Assert no ComputeWorker is online for the company (deterministic, no sleep).
   - POST /v1/compute/jobs with NO worker connected → job stays 'queued'.
   - Connect a WorkerRuntime → poll until job becomes 'dispatched'/'done'.

Strategy: uvicorn-in-thread with a real ephemeral port + real WorkerRuntime.
This is the preferred real-e2e path (not the TestClient fallback).

The uvicorn server runs in a background thread (with its own asyncio event
loop, as uvicorn.Server.run() starts one internally). The WorkerRuntime runs
in a separate asyncio task inside the test's own event loop. httpx.AsyncClient
is used for HTTP calls and real SSE streaming.
"""
from __future__ import annotations

import asyncio
import json
import socket
import threading
import time
import uuid
from typing import AsyncGenerator

import httpx
import pytest
import uvicorn

from omilo.db import SessionLocal
from omilo.main import create_app
from omilo.models.compute import ComputeJob, ComputeWorker
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


def _has_online_worker(company_id: str) -> bool:
    """Return True if any ComputeWorker is online for this company."""
    with SessionLocal() as session:
        count = (
            session.query(ComputeWorker)
            .filter_by(company_id=company_id, status="online")
            .count()
        )
        return count > 0


# ---------------------------------------------------------------------------
# SSE streaming helper — collect events from the real HTTP SSE endpoint
# ---------------------------------------------------------------------------


async def _collect_sse_events(
    base_url: str,
    token: str,
    *,
    until_job_done_id: str,
    timeout: float = 15.0,
    connected_event: asyncio.Event | None = None,
) -> list[dict]:
    """Stream GET /v1/stream?token=<token> and collect events until job.done.

    Opens a real HTTP SSE connection through the uvicorn TCP stack — no
    in-process event loop sharing. Collects all events and returns when a
    ``job.done`` event for ``until_job_done_id`` arrives or ``timeout``
    elapses.

    If *connected_event* is provided it is set as soon as the server sends the
    initial ``: connected`` comment, which the SSE endpoint emits immediately
    after ``broker.subscribe()`` completes.  Callers can ``await`` that event
    before submitting work so the subscription is guaranteed to be live.

    Each SSE frame is ``data: {json}``; this parser ignores comments and
    empty lines, and yields the parsed JSON dicts.
    """
    sse_url = f"{base_url}/v1/stream"
    collected: list[dict] = []

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout + 5.0)) as sse_client:
        async with sse_client.stream(
            "GET", sse_url, params={"token": token}
        ) as response:
            assert response.status_code == 200, (
                f"SSE endpoint returned {response.status_code}: {await response.aread()}"
            )

            deadline = time.monotonic() + timeout
            async for line in response.aiter_lines():
                # Signal "connected" on the initial ": connected" server comment
                if connected_event is not None and not connected_event.is_set():
                    if line.startswith(": "):
                        connected_event.set()
                # SSE frame lines start with "data: "
                if line.startswith("data: "):
                    raw = line[6:]
                    try:
                        ev = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    collected.append(ev)
                    # Stop once we receive job.done for our specific job
                    if (
                        ev.get("type") == "job.done"
                        and ev.get("job_id") == until_job_done_id
                    ):
                        return collected
                # Enforce timeout even if no done event arrives
                if time.monotonic() > deadline:
                    break

    return collected


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
    """Full round-trip: pair worker → connect → submit job → SSE stream until done."""
    base_url = live_server["base_url"]
    port = live_server["port"]
    relay_url = f"ws://127.0.0.1:{port}/v1/compute/relay"

    worker_task: asyncio.Task | None = None
    sse_task: asyncio.Task | None = None

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

            # 4. Open the SSE stream BEFORE submitting the job so that no
            #    job.step events can be missed even on a fast/CI box.
            #
            #    The SSE endpoint emits ": connected" immediately after
            #    broker.subscribe() completes.  We await that signal (via
            #    connected_event) before POSTing the job so the subscription
            #    is guaranteed to be live when the worker starts publishing.
            #
            #    _stream() opens the SSE connection, signals connected_event on
            #    the first comment line, then waits for job_id_box to be
            #    populated (filled just after POST) before collecting events.
            steps_from_spec = ["echo e2e step 1", "echo e2e step 2", "echo e2e step 3"]
            sse_events: list[dict] = []
            connected_event: asyncio.Event = asyncio.Event()
            # Mutable box so the test can pass job_id to the already-open stream
            job_id_box: list[str] = []

            async def _stream() -> None:
                """Open SSE, signal connected, then collect until job.done."""
                nonlocal sse_events
                sse_url = f"{base_url}/v1/stream"
                collected: list[dict] = []
                deadline = time.monotonic() + 25.0  # generous outer timeout

                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(30.0)
                ) as sse_client:
                    async with sse_client.stream(
                        "GET", sse_url, params={"token": token}
                    ) as response:
                        assert response.status_code == 200, (
                            f"SSE endpoint returned {response.status_code}"
                        )
                        async for line in response.aiter_lines():
                            # Server emits ": connected" immediately on subscribe
                            if not connected_event.is_set() and line.startswith(": "):
                                connected_event.set()

                            if line.startswith("data: "):
                                raw = line[6:]
                                try:
                                    ev = json.loads(raw)
                                except json.JSONDecodeError:
                                    continue
                                collected.append(ev)
                                # Wait until we know which job to stop on
                                while not job_id_box:
                                    await asyncio.sleep(0)
                                target = job_id_box[0]
                                if (
                                    ev.get("type") == "job.done"
                                    and ev.get("job_id") == target
                                ):
                                    break

                            if time.monotonic() > deadline:
                                break

                sse_events = collected

            sse_task = asyncio.create_task(_stream())

            # Wait until the SSE stream is open and the broker subscription is
            # live (signalled by the ": connected" server comment).
            try:
                await asyncio.wait_for(connected_event.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                assert False, (
                    "SSE stream did not emit the ':connected' comment within 10 s"
                )

            # 5. NOW submit the job — subscription is live, no events will be missed.
            job_resp = await client.post(
                "/v1/compute/jobs",
                json={"spec": {"steps": steps_from_spec}},
                headers=_auth(token),
            )
            assert job_resp.status_code == 200, f"create_job failed: {job_resp.text}"
            job_id = job_resp.json()["id"]
            # Unblock _stream() so it knows which job to stop on
            job_id_box.append(job_id)

            # 6. Poll DB until job is 'done' (independent of SSE)
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

            # 7. Wait for the SSE collector to finish (it should stop on job.done)
            try:
                await asyncio.wait_for(sse_task, timeout=10.0)
            except asyncio.TimeoutError:
                sse_task.cancel()
                try:
                    await sse_task
                except (asyncio.CancelledError, Exception):
                    pass

            # 8. Assert artifact is set
            job_row = _get_job(job_id)
            assert job_row is not None
            assert job_row.status == "done", f"Expected 'done', got {job_row.status!r}"
            assert job_row.artifact is not None and job_row.artifact != "", (
                f"Expected artifact to be set, got {job_row.artifact!r}"
            )

            # 9. Assert worker's in_use returned to 0
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

            # 10. Assert SSE events: all 3 step events in seq order, then job.done
            step_events = [e for e in sse_events if e.get("type") == "job.step"]
            done_events = [e for e in sse_events if e.get("type") == "job.done"]

            # Must have exactly 3 step events (one per spec step)
            assert len(step_events) == len(steps_from_spec), (
                f"Expected {len(steps_from_spec)} job.step SSE events, "
                f"got {len(step_events)}: {sse_events}"
            )
            assert len(done_events) >= 1, (
                f"Expected at least 1 job.done SSE event, got: {sse_events}"
            )

            # Verify steps are in order by seq
            seqs = [e.get("seq") for e in step_events]
            assert seqs == sorted(seqs), (
                f"Step events not in seq order: {seqs}"
            )
            # seq should start at 0
            assert seqs[0] == 0, f"First step seq must be 0, got {seqs[0]}"
            # seq should be consecutive 0..N-1
            assert seqs == list(range(len(steps_from_spec))), (
                f"Expected seqs {list(range(len(steps_from_spec)))}, got {seqs}"
            )

            # The 'done' event should report the right job
            assert done_events[0].get("job_id") == job_id, (
                f"done event job_id mismatch: {done_events[0]}"
            )

            # No secrets in any SSE event
            for ev in sse_events:
                assert "secrets" not in ev, f"'secrets' key in SSE event: {ev}"

        finally:
            if sse_task is not None and not sse_task.done():
                sse_task.cancel()
                try:
                    await sse_task
                except (asyncio.CancelledError, Exception):
                    pass
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

        # 3. Verify deterministically that no online worker exists for this company.
        #    The worker was just paired (status != 'online') and never connected, so
        #    this must be false before we submit the job.
        assert not _has_online_worker(company_id), (
            "Expected no online worker for the fresh company before submitting the job"
        )

        # 4. Submit a job — no worker is online, so dispatch must leave it 'queued'.
        job_resp = await client.post(
            "/v1/compute/jobs",
            json={"spec": {"steps": ["echo queued-test"]}},
            headers=_auth(token),
        )
        assert job_resp.status_code == 200, f"create_job failed: {job_resp.text}"
        job_id = job_resp.json()["id"]

        # 5. Assert the job is 'queued' — deterministic because we confirmed no
        #    online worker exists.  Read straight from the DB (no sleep needed).
        job_initial = _get_job(job_id)
        assert job_initial is not None
        assert job_initial.status == "queued", (
            f"Expected job to be 'queued' with no online worker, "
            f"got {job_initial.status!r}"
        )

        # 6. Now connect the WorkerRuntime
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
            # 7. Wait until the worker is online
            def _worker_online():
                w = _get_worker(worker_id)
                return w is not None and w.status == "online"

            online = await _apoll(_worker_online, timeout=10.0)
            assert online, f"Worker {worker_id} did not come online within 10 s"

            # 8. Poll until the job transitions to 'dispatched' or 'done'
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

            # 9. Wait for the job to fully complete ('done')
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
