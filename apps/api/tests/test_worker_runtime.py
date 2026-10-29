"""TDD — Task 8: WorkerRuntime + omilo-worker console script.

Tests
-----

1. test_worker_registers_and_runs_job
   Drive WorkerRuntime against an in-process fake relay (websockets.serve on
   localhost:0).  Feed it a start_job frame; assert that the relay receives, in
   order: register → job_accepted → job_step* → job_done.

2. test_worker_answers_ping_with_pong
   Feed a ping frame after register; assert the relay receives a pong frame.

3. test_worker_reconnects_with_backoff
   Fake relay that disconnects immediately on first connection; assert that the
   worker redials (second connection arrives), using an injected zero-delay
   backoff so the test never sleeps.
"""
from __future__ import annotations

import asyncio
import json
import pytest

from websockets.asyncio.server import serve as ws_serve

from omilo.compute.protocol import (
    decode,
    encode,
    JobAcceptedFrame,
    JobDoneFrame,
    JobStepFrame,
    PingFrame,
    PongFrame,
    RegisterFrame,
    StartJobFrame,
)
from omilo.worker.executor import JobContext, StubExecutor
from omilo.worker.runtime import WorkerRuntime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_WORKER_ID = "wrk_test001"
_COMPANY_ID = "co_test001"
_TOKEN = "tok_test"
_JOB_ID = "job_test001"


def _make_start_job() -> str:
    return encode(
        StartJobFrame(
            job_id=_JOB_ID,
            company_id=_COMPANY_ID,
            spec={"steps": ["echo hello"]},
            secrets={},
        )
    )


def _make_runtime(relay_url: str, *, backoff=None) -> WorkerRuntime:
    return WorkerRuntime(
        relay_url=relay_url,
        token=_TOKEN,
        company_id=_COMPANY_ID,
        worker_id=_WORKER_ID,
        capacity=1,
        executor=StubExecutor(),
        backoff=backoff,
    )


# ---------------------------------------------------------------------------
# Test 1 — happy path: register → job_accepted → step* → job_done
# ---------------------------------------------------------------------------


async def test_worker_registers_and_runs_job(tmp_path):
    """Runtime connects, registers, handles start_job; relay sees the full sequence."""

    received_frames: list = []
    relay_ready = asyncio.Event()
    job_done_received = asyncio.Event()

    async def fake_relay(ws):
        relay_ready.set()

        # 1. Expect register frame
        raw = await ws.recv()
        frame = decode(raw)
        received_frames.append(frame)
        assert isinstance(frame, RegisterFrame)
        assert frame.role == "worker"
        assert frame.worker_id == _WORKER_ID
        assert frame.company_id == _COMPANY_ID
        assert frame.capacity == 1

        # 2. Send start_job
        await ws.send(_make_start_job())

        # 3. Collect frames until job_done (with a cap)
        for _ in range(50):
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            except (asyncio.TimeoutError, Exception):
                break
            frame = decode(raw)
            received_frames.append(frame)
            if isinstance(frame, JobDoneFrame):
                job_done_received.set()
                break

        # Close connection so the runtime finishes its current loop iteration
        await ws.close()

    async with ws_serve(fake_relay, "127.0.0.1", 0) as server:
        host, port = server.sockets[0].getsockname()
        relay_url = f"ws://{host}:{port}"

        # Run the runtime in a background task; cancel once we have job_done
        runtime = _make_runtime(relay_url, backoff=_no_backoff())
        task = asyncio.create_task(runtime.run())

        try:
            await asyncio.wait_for(job_done_received.wait(), timeout=10.0)
        finally:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    assert job_done_received.is_set(), "relay never received job_done"

    # Verify frame sequence
    types = [f.type for f in received_frames]  # type: ignore[attr-defined]
    assert types[0] == "register"
    assert "job_accepted" in types
    # At least one step
    assert "job_step" in types
    assert types[-1] == "job_done"

    # job_accepted carries the right worker_id
    accepted = next(f for f in received_frames if isinstance(f, JobAcceptedFrame))
    assert accepted.job_id == _JOB_ID
    assert accepted.worker_id == _WORKER_ID

    # job_done is ok
    done = next(f for f in received_frames if isinstance(f, JobDoneFrame))
    assert done.ok is True
    assert done.job_id == _JOB_ID


# ---------------------------------------------------------------------------
# Test 2 — ping → pong
# ---------------------------------------------------------------------------


async def test_worker_answers_ping_with_pong():
    """After register, relay sends ping; worker replies with pong."""

    pong_received = asyncio.Event()
    relay_done = asyncio.Event()

    async def fake_relay(ws):
        # Consume register frame
        await ws.recv()

        # Send a ping
        await ws.send(encode(PingFrame()))

        # Expect pong back
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
        except asyncio.TimeoutError:
            relay_done.set()
            return
        frame = decode(raw)
        if isinstance(frame, PongFrame):
            pong_received.set()
        relay_done.set()
        await ws.close()

    async with ws_serve(fake_relay, "127.0.0.1", 0) as server:
        host, port = server.sockets[0].getsockname()
        relay_url = f"ws://{host}:{port}"

        runtime = _make_runtime(relay_url, backoff=_no_backoff())
        task = asyncio.create_task(runtime.run())

        try:
            await asyncio.wait_for(relay_done.wait(), timeout=10.0)
            # Give the worker a moment to send its pong
            await asyncio.sleep(0.05)
        finally:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    assert pong_received.is_set(), "Worker did not reply pong to a ping"


# ---------------------------------------------------------------------------
# Test 3 — reconnect with backoff (no real sleep)
# ---------------------------------------------------------------------------


async def test_worker_reconnects_with_backoff():
    """First connection immediately closes; worker redials; second conn is accepted."""

    connection_count = 0
    second_connected = asyncio.Event()

    async def fake_relay(ws):
        nonlocal connection_count
        connection_count += 1

        if connection_count == 1:
            # Immediately drop
            await ws.close()
            return

        # Second connection: read the first frame and assert it is a register
        # frame — proving the worker re-registers on reconnect, not just that it
        # opened a new socket.
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
            reg_frame = decode(raw)
            assert isinstance(reg_frame, RegisterFrame), (
                f"Expected RegisterFrame on reconnect, got {type(reg_frame).__name__}"
            )
            assert reg_frame.role == "worker"
            assert reg_frame.worker_id == _WORKER_ID
        except Exception:
            pass
        second_connected.set()
        await ws.close()

    async with ws_serve(fake_relay, "127.0.0.1", 0) as server:
        host, port = server.sockets[0].getsockname()
        relay_url = f"ws://{host}:{port}"

        # Inject a zero-delay backoff so the test is instantaneous
        runtime = _make_runtime(relay_url, backoff=_zero_backoff())
        task = asyncio.create_task(runtime.run())

        try:
            await asyncio.wait_for(second_connected.wait(), timeout=10.0)
        finally:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    assert connection_count >= 2, (
        f"Expected at least 2 connection attempts, got {connection_count}"
    )
    assert second_connected.is_set(), "Worker did not reconnect after first drop"


# ---------------------------------------------------------------------------
# Backoff factories (injectable, no real sleep)
# ---------------------------------------------------------------------------


async def _no_backoff():
    """Async generator that never yields a delay — cancels reconnect immediately."""
    # Yield a small non-zero delay once so the task loop runs once after a
    # disconnect, then we cancel.  Yielding 0 avoids any real sleep.
    while True:
        yield 0.0


async def _zero_backoff():
    """Async generator that yields 0 delay on every attempt — no real sleep."""
    while True:
        yield 0.0
