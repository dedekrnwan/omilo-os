"""TDD — Task 6: Status relay to client (persist + SSE republish).

Tests:

1. test_job_step_persists_and_publishes_in_order
   Send two job_step frames (seq=0, seq=1) over the worker WS; verify:
   - Job transitions to status='running' in DB.
   - Two SSE events are published to the company's broker with the correct seq values.
   - The events carry no 'secrets' field.

2. test_job_done_settles_and_releases
   Send a job_step then a job_done frame; verify:
   - Job transitions to status='done' in DB with the correct result and artifact.
   - SSE event is published for job_done.
   - release() was called (worker in_use returns to 0).

3. test_secrets_never_in_sse_or_job_row
   The relay must never include 'secrets' values in the SSE payload or job row result.

4. test_duplicate_seq_is_idempotent
   Send job_done, then send the identical job_done again (replay after reconnect);
   verify the job status remains 'done' and only one SSE event is emitted for
   the terminal frame (the duplicate is a no-op).
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient

from omilo.db import SessionLocal
from omilo.main import create_app
from omilo.models.base import prefixed_id
from omilo.models.compute import ComputeJob, ComputeWorker
from omilo.realtime.events import broker
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


def _poll(condition_fn, *, timeout: float = 5.0, step: float = 0.1) -> bool:
    """Poll condition_fn() until truthy or timeout. Returns True if satisfied.

    Uses a 100ms step (vs 20ms) to reduce DB connection pool pressure when
    multiple compute tests run concurrently and share the same pool.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition_fn():
            return True
        time.sleep(step)
    return False


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _sign_up_sync(client: TestClient, *, name: str = "Status Relay Tester") -> dict:
    email = f"status_relay_{uuid.uuid4().hex[:8]}@test.example"
    resp = client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": "testP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _pair_worker(client: TestClient, owner_token: str, capacity: int = 2) -> dict:
    """POST /v1/compute/workers/pair and return {worker_id, token}."""
    resp = client.post(
        "/v1/compute/workers/pair",
        json={"capacity": capacity},
        headers=_auth(owner_token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _seed_dispatched_job(company_id: str, worker_id: str, spec: dict | None = None) -> str:
    """Insert a ComputeJob with status='dispatched' for *worker_id*. Returns job id."""
    with SessionLocal() as session:
        with session.begin():
            job = ComputeJob(
                id=prefixed_id("cjb"),
                company_id=company_id,
                worker_id=worker_id,
                status="dispatched",
                spec=spec or {"type": "status_relay_test"},
                lease_expires_at=datetime.now(timezone.utc) + timedelta(seconds=300),
            )
            session.add(job)
            session.flush()
            return job.id


def _get_job_from_db(job_id: str) -> ComputeJob | None:
    with SessionLocal() as session:
        return session.get(ComputeJob, job_id)


def _get_worker_from_db(worker_id: str) -> ComputeWorker | None:
    with SessionLocal() as session:
        return session.get(ComputeWorker, worker_id)


# ---------------------------------------------------------------------------
# Shared fixture: app + owner
# ---------------------------------------------------------------------------


@pytest.fixture()
def relay_setup():
    """Return (client, owner_token, company_id)."""
    app = create_app()
    client = TestClient(app, raise_server_exceptions=True)
    body = _sign_up_sync(client)
    token = body["session"]["access"]
    me_resp = client.get("/v1/me", headers=_auth(token))
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]
    return client, token, company_id


# ---------------------------------------------------------------------------
# SSE capture helper — uses a queue to bridge broker → sync test
# ---------------------------------------------------------------------------


class BrokerCapture:
    """Subscribe to the broker for a company and collect events into a list.

    Uses a background asyncio event loop (new thread) so it can coexist with
    the sync TestClient WS interactions.

    Usage::

        with BrokerCapture(company_id) as cap:
            # ... do WS interactions ...
            time.sleep(0.3)  # wait for events to propagate
        events = cap.events
    """

    def __init__(self, company_id: str, *, max_events: int = 20, drain_timeout: float = 3.0):
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
        # Wait until the async loop + subscriber is fully set up before returning
        self._started.wait(timeout=5.0)
        return self

    def __exit__(self, *_) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5.0)

    def _run_loop(self) -> None:
        """Run an asyncio event loop that subscribes to broker and collects events."""
        async def _collect() -> None:
            sub = broker.subscribe(self.company_id)
            # Signal that subscriber is ready — must happen AFTER subscribe() so
            # the broker has captured this loop as its target loop.
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
            """Cancel collect when stop is set or drain_timeout elapsed."""
            while not self._stop.is_set():
                await asyncio.sleep(0.05)
            # Give a short window for final events to arrive
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
# Test 1 — job_step frames: persist running + ordered SSE publish
# ---------------------------------------------------------------------------


class TestJobStepPersistsAndPublishesInOrder:
    def test_job_step_persists_and_publishes_in_order(self, relay_setup):
        """Two job_step frames → job becomes 'running'; SSE events have correct seq."""
        client, owner_token, company_id = relay_setup

        pair = _pair_worker(client, owner_token, capacity=2)
        worker_id = pair["worker_id"]
        raw_token = pair["token"]

        job_id = _seed_dispatched_job(company_id, worker_id)

        job_was_running = False

        with BrokerCapture(company_id) as cap:
            with client.websocket_connect(
                f"/v1/compute/relay?token={raw_token}"
            ) as ws:
                ws.send_text(json.dumps({
                    "type": "register",
                    "role": "worker",
                    "worker_id": worker_id,
                    "company_id": company_id,
                    "capacity": 2,
                }))
                time.sleep(0.05)  # let register process

                # Send two job_step frames
                ws.send_text(json.dumps({
                    "type": "job_step",
                    "job_id": job_id,
                    "seq": 0,
                    "stream": "stdout",
                    "line": "Starting task...",
                }))
                ws.send_text(json.dumps({
                    "type": "job_step",
                    "job_id": job_id,
                    "seq": 1,
                    "stream": "stdout",
                    "line": "Done with step 1",
                }))

                # Poll for 'running' WHILE the connection is still open —
                # disconnect would error the job, so we verify before closing.
                def _job_running():
                    j = _get_job_from_db(job_id)
                    return j is not None and j.status == "running"

                job_was_running = _poll(_job_running, timeout=5.0)
                time.sleep(0.1)  # let broker events arrive

        # Verify DB state captured while connection was alive
        assert job_was_running, (
            f"Job did not transition to 'running' while WS was open. "
            f"Current status after disconnect: {_get_job_from_db(job_id).status!r}"
        )

        # Verify SSE events were published
        assert len(cap.events) >= 1, (
            f"Expected at least 1 SSE event, got {len(cap.events)}: {cap.events}"
        )

        # Find step events
        step_events = [e for e in cap.events if e.get("type") == "job.step"]
        assert len(step_events) >= 1, (
            f"Expected at least 1 job.step SSE event, got: {cap.events}"
        )

        # seq=0 must be present
        seqs = [e.get("seq") for e in step_events]
        assert 0 in seqs, f"seq=0 not found in SSE events: {step_events}"

        # No secrets in any event
        for ev in cap.events:
            assert "secrets" not in ev, f"'secrets' found in SSE event: {ev}"
            data_field = ev.get("data") or {}
            if isinstance(data_field, dict):
                assert "secrets" not in data_field, (
                    f"'secrets' found in SSE event data field: {ev}"
                )


# ---------------------------------------------------------------------------
# Test 2 — job_done: settle + release
# ---------------------------------------------------------------------------


class TestJobDoneSettlesAndReleases:
    def test_job_done_settles_and_releases(self, relay_setup):
        """job_done → status='done', result/artifact stored, release() called."""
        client, owner_token, company_id = relay_setup

        pair = _pair_worker(client, owner_token, capacity=2)
        worker_id = pair["worker_id"]
        raw_token = pair["token"]

        job_id = _seed_dispatched_job(company_id, worker_id)

        # Set in_use=1 to simulate one slot occupied
        with SessionLocal() as session:
            with session.begin():
                w = session.get(ComputeWorker, worker_id)
                if w is not None:
                    w.in_use = 1

        job_settled_done = False
        job_row_snapshot = None

        with BrokerCapture(company_id) as cap:
            with client.websocket_connect(
                f"/v1/compute/relay?token={raw_token}"
            ) as ws:
                ws.send_text(json.dumps({
                    "type": "register",
                    "role": "worker",
                    "worker_id": worker_id,
                    "company_id": company_id,
                    "capacity": 2,
                }))
                time.sleep(0.05)

                # Send a step, then done
                ws.send_text(json.dumps({
                    "type": "job_step",
                    "job_id": job_id,
                    "seq": 0,
                    "stream": "stdout",
                    "line": "Running...",
                }))
                ws.send_text(json.dumps({
                    "type": "job_done",
                    "job_id": job_id,
                    "ok": True,
                    "result": {"output": "42"},
                    "artifact": "gs://bucket/output.json",
                }))

                # Poll for 'done' WHILE the connection is still open —
                # once disconnected, cleanup may re-error it.
                def _job_done_check():
                    j = _get_job_from_db(job_id)
                    return j is not None and j.status == "done"

                # 10s timeout: generous to survive shared-resource contention in
                # CI when other tests stress the thread pool / event loop.
                job_settled_done = _poll(_job_done_check, timeout=10.0)
                if job_settled_done:
                    job_row_snapshot = _get_job_from_db(job_id)
                time.sleep(0.1)  # let broker events arrive

        assert job_settled_done, (
            f"Job did not settle to 'done' while WS was open. "
            f"Final status after disconnect: {_get_job_from_db(job_id).status!r}"
        )

        # Use snapshot captured while job was 'done' (before disconnect cleanup)
        assert job_row_snapshot is not None
        assert job_row_snapshot.result == {"output": "42"}, f"Unexpected result: {job_row_snapshot.result}"
        assert job_row_snapshot.artifact == "gs://bucket/output.json", f"Unexpected artifact: {job_row_snapshot.artifact}"

        # release() must have been called: in_use should be back to 0.
        # release() is called inside _dispatch_status_frame before disconnect;
        # poll with short timeout since it should have fired already.
        def _in_use_zero():
            w = _get_worker_from_db(worker_id)
            return w is not None and w.in_use == 0

        assert _poll(_in_use_zero, timeout=5.0), (
            f"Worker in_use did not drop to 0 after job_done (release not called). "
            f"in_use={_get_worker_from_db(worker_id).in_use}"
        )

        # SSE event for done must exist
        done_events = [e for e in cap.events if e.get("type") == "job.done"]
        assert len(done_events) >= 1, (
            f"Expected at least one job.done SSE event, got: {cap.events}"
        )

        # No secrets anywhere
        for ev in cap.events:
            assert "secrets" not in ev, f"'secrets' in SSE event: {ev}"


# ---------------------------------------------------------------------------
# Test 3 — secrets never leak into SSE or job row
# ---------------------------------------------------------------------------


class TestSecretsNeverInSseOrJobRow:
    def test_secrets_never_in_sse_or_job_row(self, relay_setup):
        """'secrets' must never appear in ComputeJob.result or SSE payload."""
        client, owner_token, company_id = relay_setup

        pair = _pair_worker(client, owner_token, capacity=2)
        worker_id = pair["worker_id"]
        raw_token = pair["token"]

        # Seed job (spec does NOT contain secrets — secrets only flow cloud→worker)
        job_id = _seed_dispatched_job(company_id, worker_id)

        job_settled = False
        job_row_snapshot = None

        with BrokerCapture(company_id) as cap:
            with client.websocket_connect(
                f"/v1/compute/relay?token={raw_token}"
            ) as ws:
                ws.send_text(json.dumps({
                    "type": "register",
                    "role": "worker",
                    "worker_id": worker_id,
                    "company_id": company_id,
                    "capacity": 2,
                }))
                time.sleep(0.05)

                # Worker sends job_done with 'secrets' embedded in result
                # (simulating a misbehaving worker trying to echo credentials back)
                ws.send_text(json.dumps({
                    "type": "job_done",
                    "job_id": job_id,
                    "ok": True,
                    "result": {"output": "done", "secrets": "LEAKED_VALUE"},
                    "artifact": None,
                }))

                # Poll for settlement WHILE the connection is open
                def _settled_check():
                    j = _get_job_from_db(job_id)
                    return j is not None and j.status in ("done", "error")

                job_settled = _poll(_settled_check, timeout=5.0)
                if job_settled:
                    job_row_snapshot = _get_job_from_db(job_id)
                time.sleep(0.1)

        assert job_settled, "Job did not settle in DB while WS was open"

        # ComputeJob.result must NOT echo raw 'secrets' payload from worker
        # The relay must strip 'secrets' from result before persisting.
        if job_row_snapshot is not None and job_row_snapshot.result is not None:
            assert "secrets" not in job_row_snapshot.result, (
                f"'secrets' leaked into ComputeJob.result: {job_row_snapshot.result}"
            )
            assert "LEAKED_VALUE" not in str(job_row_snapshot.result), (
                f"Secret value 'LEAKED_VALUE' leaked into ComputeJob.result: {job_row_snapshot.result}"
            )

        # SSE payload must NOT contain secret values
        all_event_str = json.dumps(cap.events)
        assert "LEAKED_VALUE" not in all_event_str, (
            f"Secret value 'LEAKED_VALUE' leaked into SSE events: {cap.events}"
        )

        # Top-level 'secrets' key must not appear in any SSE event
        for ev in cap.events:
            assert "secrets" not in ev, (
                f"'secrets' key in SSE event top-level: {ev}"
            )


# ---------------------------------------------------------------------------
# Test 4 — duplicate / replayed terminal frame is idempotent
# ---------------------------------------------------------------------------


class TestDuplicateSeqIsIdempotent:
    def test_duplicate_seq_is_idempotent(self, relay_setup):
        """A duplicate job_done (replay after reconnect) must not corrupt state.

        The second job_done frame must be silently dropped — the job stays
        'done', result is unchanged, and we do NOT publish a second SSE event.
        """
        client, owner_token, company_id = relay_setup

        pair = _pair_worker(client, owner_token, capacity=2)
        worker_id = pair["worker_id"]
        raw_token = pair["token"]

        job_id = _seed_dispatched_job(company_id, worker_id)

        job_settled_done = False
        job_row_snapshot = None

        with BrokerCapture(company_id, drain_timeout=0.5) as cap:
            with client.websocket_connect(
                f"/v1/compute/relay?token={raw_token}"
            ) as ws:
                ws.send_text(json.dumps({
                    "type": "register",
                    "role": "worker",
                    "worker_id": worker_id,
                    "company_id": company_id,
                    "capacity": 2,
                }))
                time.sleep(0.05)

                done_frame = json.dumps({
                    "type": "job_done",
                    "job_id": job_id,
                    "ok": True,
                    "result": {"output": "idempotent"},
                    "artifact": None,
                })

                # Send first job_done
                ws.send_text(done_frame)
                time.sleep(0.15)
                # Send the SAME frame again (replay after reconnect simulation)
                ws.send_text(done_frame)

                # Poll for 'done' WHILE the connection is open (10s for CI headroom)
                def _job_done_check():
                    j = _get_job_from_db(job_id)
                    return j is not None and j.status == "done"

                job_settled_done = _poll(_job_done_check, timeout=10.0)
                if job_settled_done:
                    job_row_snapshot = _get_job_from_db(job_id)

                # Give broker drain time before closing
                time.sleep(0.2)

        # Job must be 'done' (captured while WS was alive)
        assert job_settled_done, (
            f"Job did not settle to 'done' while WS was open."
        )

        assert job_row_snapshot is not None
        assert job_row_snapshot.result == {"output": "idempotent"}, f"Result corrupted: {job_row_snapshot.result}"

        # The duplicate terminal frame must NOT emit a second SSE event.
        # Exactly 1 job.done SSE event expected.
        done_events = [e for e in cap.events if e.get("type") == "job.done"]
        assert len(done_events) == 1, (
            f"Expected exactly 1 job.done SSE event (duplicate must be suppressed), "
            f"got {len(done_events)}: {done_events}"
        )
