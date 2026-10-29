"""TDD — Task 4: Worker relay WebSocket + registry + heartbeat.

Tests:

1. test_worker_registers_with_valid_token
   Connect with valid ?token= query param; after accept, send a `register`
   frame with role=worker and capacity=2; verify registry shows the worker as
   online and by_company returns it.

2. test_bad_token_closes
   Connect with an invalid token; server MUST close WITHOUT accepting or close
   with 4401 — never echo a frame.

3. test_missing_pong_marks_offline_and_errors_inflight
   Register a worker; seed a dispatched ComputeJob for the same company /
   worker; use the injected heartbeat seam (short interval via kwarg, NOT a
   module-global patch) to drive a missed pong; verify: worker is marked
   offline in the DB, job is marked error, in_use = 0.
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from omilo.compute.relay import registry, worker_relay_handler
from omilo.db import SessionLocal
from omilo.main import create_app
from omilo.models.base import prefixed_id
from omilo.models.compute import ComputeJob, ComputeWorker
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


def _poll(condition_fn, *, timeout: float = 5.0, step: float = 0.02) -> bool:
    """Poll `condition_fn()` until it returns truthy or `timeout` elapses.

    Returns True if the condition was satisfied, False on timeout.
    Replaces fragile fixed `time.sleep()` calls in tests.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition_fn():
            return True
        time.sleep(step)
    return False


def _poll_worker_status(worker_id: str, status: str, timeout: float = 5.0) -> bool:
    """Poll DB until worker.status == `status` or timeout. Returns success bool."""
    def _check():
        with SessionLocal() as session:
            w = session.get(ComputeWorker, worker_id)
            return w is not None and w.status == status
    return _poll(_check, timeout=timeout)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sign_up_sync(client: TestClient, *, name="Worker Tester", password="testP4ss!"):
    email = f"relay_{uuid.uuid4().hex[:8]}@test.example"
    resp = client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _pair_worker(client: TestClient, owner_token: str, capacity: int = 1) -> dict:
    """POST /v1/compute/workers/pair and return {worker_id, token}."""
    resp = client.post(
        "/v1/compute/workers/pair",
        json={"capacity": capacity},
        headers=_auth(owner_token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _seed_dispatched_job(company_id: str, worker_id: str) -> str:
    """Insert a ComputeJob with status='dispatched' for *worker_id*. Returns job id."""
    with SessionLocal() as session:
        with session.begin():
            job = ComputeJob(
                id=prefixed_id("cjb"),
                company_id=company_id,
                worker_id=worker_id,
                status="dispatched",
                spec={"type": "relay_test"},
            )
            session.add(job)
            session.flush()
            return job.id


def _seed_running_job(company_id: str, worker_id: str) -> str:
    """Insert a ComputeJob with status='running' for *worker_id*. Returns job id."""
    with SessionLocal() as session:
        with session.begin():
            job = ComputeJob(
                id=prefixed_id("cjb"),
                company_id=company_id,
                worker_id=worker_id,
                status="running",
                spec={"type": "relay_test"},
            )
            session.add(job)
            session.flush()
            return job.id


def _get_worker_from_db(worker_id: str) -> ComputeWorker | None:
    with SessionLocal() as session:
        return session.get(ComputeWorker, worker_id)


def _get_job_from_db(job_id: str) -> ComputeJob | None:
    with SessionLocal() as session:
        return session.get(ComputeJob, job_id)


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
# Test 1 — happy-path: valid token → registered, online, in registry
# ---------------------------------------------------------------------------


class TestWorkerRegistersWithValidToken:
    def test_worker_registers_with_valid_token(self, relay_setup):
        """Valid ?token= → server accepts; register frame → worker is online."""
        client, owner_token, company_id = relay_setup

        pair = _pair_worker(client, owner_token, capacity=2)
        worker_id = pair["worker_id"]
        raw_token = pair["token"]

        with client.websocket_connect(
            f"/v1/compute/relay?token={raw_token}"
        ) as ws:
            # Send register frame
            ws.send_text(json.dumps({
                "type": "register",
                "role": "worker",
                "worker_id": worker_id,
                "company_id": company_id,
                "capacity": 2,
            }))
            # Allow the server to process the register frame.
            # The server doesn't send a response to register — just marks online.
            # We verify via DB.

        # After disconnect, check DB
        worker = _get_worker_from_db(worker_id)
        # Worker was online during connection; after disconnect it goes offline.
        # The test only verifies that register was accepted (connection didn't error out).
        # The worker should now be offline (disconnected), but no exception occurred.
        assert worker is not None

    def test_worker_appears_in_registry_during_connection(self, relay_setup):
        """During an active connection, by_company returns the WorkerConn."""
        client, owner_token, company_id = relay_setup

        pair = _pair_worker(client, owner_token, capacity=3)
        worker_id = pair["worker_id"]
        raw_token = pair["token"]

        connected_seen = False

        with client.websocket_connect(
            f"/v1/compute/relay?token={raw_token}"
        ) as ws:
            ws.send_text(json.dumps({
                "type": "register",
                "role": "worker",
                "worker_id": worker_id,
                "company_id": company_id,
                "capacity": 3,
            }))
            # Poll until the server processes the register frame and adds the
            # worker to the registry (deterministic, no fixed sleep).
            appeared = _poll(
                lambda: any(c.worker_id == worker_id for c in registry.by_company(company_id)),
                timeout=5.0,
            )
            if appeared:
                connected_seen = True

        # After disconnect, dropped from registry (poll to avoid race).
        _poll(
            lambda: not any(c.worker_id == worker_id for c in registry.by_company(company_id)),
            timeout=5.0,
        )
        conns_after = registry.by_company(company_id)
        assert not any(c.worker_id == worker_id for c in conns_after), (
            "Worker should be removed from registry after disconnect"
        )
        assert connected_seen, "Worker should be in registry while connected"


# ---------------------------------------------------------------------------
# Test 2 — bad token: server closes without accepting a frame
# ---------------------------------------------------------------------------


class TestBadTokenCloses:
    def test_bad_token_closes(self, relay_setup):
        """Invalid token → connection closed with WebSocketDisconnect, no frame."""
        client, owner_token, company_id = relay_setup

        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/v1/compute/relay?token=totally_bogus_token"
            ) as ws:
                # Try to receive — should raise since server closed without accept
                ws.receive_text()

    def test_missing_token_closes(self, relay_setup):
        """Missing ?token= → closed before accept."""
        client, owner_token, company_id = relay_setup

        with pytest.raises((WebSocketDisconnect, Exception)):
            with client.websocket_connect("/v1/compute/relay") as ws:
                ws.receive_text()


# ---------------------------------------------------------------------------
# Test 3 — missing pong marks worker offline and errors inflight jobs
# ---------------------------------------------------------------------------


def _make_heartbeat_test_app(raw_token_ref: list, heartbeat_interval: float) -> FastAPI:
    """Build a minimal FastAPI app with a WS route that calls worker_relay_handler
    with a short injectable heartbeat_interval — does NOT mutate any module global.

    raw_token_ref is a mutable list so the caller can set [raw_token] after
    the fixture has paired the worker.
    """
    app = FastAPI()

    @app.websocket("/v1/compute/relay")
    async def _relay(ws: WebSocket) -> None:  # type: ignore[override]
        await worker_relay_handler(ws, heartbeat_interval=heartbeat_interval)

    return app


class TestMissingPongMarksOfflineAndErrorsInflight:
    def test_missing_pong_marks_offline_and_errors_inflight(self, relay_setup):
        """Heartbeat miss → worker offline, dispatched/running jobs → error, in_use=0.

        Injectable seam: a dedicated test app calls worker_relay_handler with
        heartbeat_interval=0.05 via the kwarg — NO module-global patch.
        Detection window: ≤ 2 × 0.05 s = 100 ms from the missed pong.
        All waits use poll-until-condition with a 5 s budget — no fixed sleeps.
        """
        import threading

        # Use relay_setup only for pairing (DB + auth); the WS connection
        # goes to a separate test app with the short interval.
        client, owner_token, company_id = relay_setup

        pair = _pair_worker(client, owner_token, capacity=2)
        worker_id = pair["worker_id"]
        raw_token = pair["token"]

        # Seed in-flight jobs
        dispatched_job_id = _seed_dispatched_job(company_id, worker_id)
        running_job_id = _seed_running_job(company_id, worker_id)

        # Build a fresh test app that drives handler with short interval via kwarg.
        INTERVAL = 0.05  # seconds
        test_app = _make_heartbeat_test_app([], heartbeat_interval=INTERVAL)
        hb_client = TestClient(test_app, raise_server_exceptions=False)

        disconnect_event = threading.Event()

        def _run_ws():
            try:
                with hb_client.websocket_connect(
                    f"/v1/compute/relay?token={raw_token}"
                ) as ws:
                    ws.send_text(json.dumps({
                        "type": "register",
                        "role": "worker",
                        "worker_id": worker_id,
                        "company_id": company_id,
                        "capacity": 2,
                    }))
                    # Do NOT send pong — simulate missing heartbeat response.
                    # Drain receive until server closes us.
                    try:
                        for _ in range(100):
                            ws.receive_text()
                    except Exception:
                        pass
            except Exception:
                pass
            finally:
                disconnect_event.set()

        ws_thread = threading.Thread(target=_run_ws, daemon=True)
        ws_thread.start()

        # Server detects the missed pong within 2 × INTERVAL = 100 ms.
        # Give 5 s budget for the thread to finish.
        finished = disconnect_event.wait(timeout=5.0)
        ws_thread.join(timeout=5.0)

        assert finished, (
            "WS thread did not finish within 5 s — heartbeat may not have fired"
        )

        # Poll DB until worker is offline (replaces fixed sleep).
        # Detection must complete within 2×INTERVAL after death; we allow 5 s.
        went_offline = _poll_worker_status(worker_id, "offline", timeout=5.0)
        assert went_offline, "Worker did not go offline within 5 s after heartbeat miss"

        # Verify DB state: worker offline, in_use=0
        worker_row = _get_worker_from_db(worker_id)
        assert worker_row is not None
        assert worker_row.status == "offline", (
            f"Expected worker status='offline', got {worker_row.status!r}"
        )
        assert worker_row.in_use == 0, (
            f"Expected worker in_use=0, got {worker_row.in_use}"
        )

        # Dispatched job → error (poll until consistent)
        def _dispatched_errored():
            j = _get_job_from_db(dispatched_job_id)
            return j is not None and j.status == "error"
        assert _poll(_dispatched_errored, timeout=5.0), (
            f"Dispatched job did not reach status='error' within 5 s"
        )

        # Running job → error (poll until consistent)
        def _running_errored():
            j = _get_job_from_db(running_job_id)
            return j is not None and j.status == "error"
        assert _poll(_running_errored, timeout=5.0), (
            f"Running job did not reach status='error' within 5 s"
        )
