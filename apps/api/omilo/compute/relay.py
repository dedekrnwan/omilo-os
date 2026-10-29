"""omilo.compute.relay — Worker WebSocket relay + in-process registry + heartbeat.

Route:  WS /v1/compute/relay

Auth:
  Workers cannot send Authorization headers on WebSocket connections.
  Authenticate via ``?token=<worker_token>`` query param BEFORE accept.
  Call ``verify_worker_token(token)``; invalid → close with 4401 (do not accept).
  The returned ComputeWorker gives ``worker_id`` + ``company_id``.

Connection lifecycle:
  1. Auth from query param before accept().
  2. Accept.
  3. Expect a ``register`` frame (role=worker, capacity=N).
  4. Mark worker online in registry + DB (status='online', last_seen_at).
  5. Heartbeat loop: send ``ping`` every HEARTBEAT_S; if no ``pong`` within
     2 × HEARTBEAT_S, drop worker (offline + error in-flight jobs).
  6. On any disconnect or heartbeat miss: drop_worker().

Registry:
  WorkerRegistry is an in-process singleton (``registry``).  It is not
  persistent — workers must re-register on reconnect.

  WorkerConn: namedtuple with (worker_id, company_id, capacity).

Heartbeat seam (test-injectable):
  ``worker_relay_handler`` accepts keyword-only arguments:
    heartbeat_interval  — float seconds (default: HEARTBEAT_S module constant)
    now                 — callable() -> float (default: time.monotonic)
    sleep               — async callable(secs: float) -> None (default: asyncio.sleep)
  Pass short intervals + a fake clock in tests to avoid real sleeping.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from omilo.api.compute import verify_worker_token
from omilo.compute.protocol import PingFrame, PongFrame, RegisterFrame, decode, encode
from omilo.db import SessionLocal
from omilo.models.compute import ComputeJob, ComputeWorker

logger = logging.getLogger(__name__)

router = APIRouter(tags=["compute"])

# WS close code 4401 — application-level authentication failure
_WS_UNAUTHORIZED = 4401

# Default heartbeat interval in seconds (module constant — tests may patch it).
HEARTBEAT_S: float = 20.0


# ---------------------------------------------------------------------------
# WorkerConn — lightweight handle stored in the registry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WorkerConn:
    """Immutable snapshot of a connected worker's key attributes."""

    worker_id: str
    company_id: str
    capacity: int


# ---------------------------------------------------------------------------
# WorkerRegistry — in-process, thread-safe
# ---------------------------------------------------------------------------


class WorkerRegistry:
    """In-process registry of currently connected workers.

    Thread-safe (uses a Lock internally).  Lifetime is the process — workers
    must re-register on reconnect after a server restart.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        # company_id → {worker_id → WorkerConn}
        self._by_company: dict[str, dict[str, WorkerConn]] = {}

    # ── Public API ────────────────────────────────────────────────────────────

    def register(self, conn: WorkerConn) -> None:
        """Add (or update) a WorkerConn in the registry."""
        with self._lock:
            bucket = self._by_company.setdefault(conn.company_id, {})
            bucket[conn.worker_id] = conn

    def by_company(self, company_id: str) -> list[WorkerConn]:
        """Return all registered WorkerConns for a company (snapshot)."""
        with self._lock:
            return list(self._by_company.get(company_id, {}).values())

    def drop(self, worker_id: str) -> None:
        """Remove a worker from the registry (by worker_id)."""
        with self._lock:
            for bucket in self._by_company.values():
                if worker_id in bucket:
                    del bucket[worker_id]
                    break


# Module-level singleton — imported by tests to inspect state
registry = WorkerRegistry()


# ---------------------------------------------------------------------------
# DB helpers — run in a thread pool so they don't block the event loop
# ---------------------------------------------------------------------------


def _mark_worker_online(worker_id: str) -> None:
    """Set status='online', last_seen_at=now in the DB."""
    now = datetime.now(timezone.utc)
    with SessionLocal() as session:
        with session.begin():
            worker = session.get(ComputeWorker, worker_id)
            if worker is not None:
                worker.status = "online"
                worker.last_seen_at = now


def _mark_worker_offline_and_error_inflight(worker_id: str) -> None:
    """Mark worker offline + reset in_use; error all dispatched/running jobs."""
    with SessionLocal() as session:
        with session.begin():
            worker = session.get(ComputeWorker, worker_id)
            if worker is None:
                logger.warning("_mark_worker_offline: worker %s not found", worker_id)
                return
            worker.status = "offline"
            worker.in_use = 0

            # Error all dispatched or running jobs for this worker
            jobs = (
                session.query(ComputeJob)
                .filter(
                    ComputeJob.worker_id == worker_id,
                    ComputeJob.status.in_(["dispatched", "running"]),
                )
                .all()
            )
            logger.debug(
                "_mark_worker_offline: found %d in-flight jobs for worker %s",
                len(jobs),
                worker_id,
            )
            for job in jobs:
                job.status = "error"
                job.error = "Worker disconnected — heartbeat timeout"


def _drop_worker(worker_id: str) -> None:
    """Remove from registry and mark offline in DB."""
    registry.drop(worker_id)
    try:
        _mark_worker_offline_and_error_inflight(worker_id)
    except Exception:
        logger.exception("_drop_worker: exception in _mark_worker_offline_and_error_inflight")


# ---------------------------------------------------------------------------
# WebSocket handler (async, injectable seam for heartbeat testing)
# ---------------------------------------------------------------------------


async def worker_relay_handler(
    websocket: WebSocket,
    *,
    heartbeat_interval: float = HEARTBEAT_S,
    now: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], Any] = asyncio.sleep,
) -> None:
    """Handle a single worker WebSocket connection.

    Parameters
    ----------
    websocket:
        The FastAPI/Starlette WebSocket object.
    heartbeat_interval:
        Seconds between pings.  Inject a small value in tests.
    now:
        Callable returning the current monotonic time.  Inject a fake clock in
        tests to avoid real sleeping.
    sleep:
        Async callable(secs) used to wait between pings.  Inject a fake in
        tests to avoid real sleeping.
    """
    # ── 1. Authenticate BEFORE accepting ─────────────────────────────────────
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=_WS_UNAUTHORIZED)
        return

    worker = verify_worker_token(token)
    if worker is None:
        await websocket.close(code=_WS_UNAUTHORIZED)
        return

    worker_id = worker.id
    company_id = worker.company_id

    # ── 2. Accept connection ──────────────────────────────────────────────────
    await websocket.accept()

    # ── 3. Wait for register frame ────────────────────────────────────────────
    capacity = 1
    try:
        raw = await websocket.receive_text()
        frame = decode(raw)
    except Exception as exc:
        logger.warning("Worker %s: error reading register frame: %s", worker_id, exc)
        await websocket.close()
        return

    if not isinstance(frame, RegisterFrame) or frame.role != "worker":
        logger.warning(
            "Worker %s: expected register frame, got %s", worker_id, type(frame).__name__
        )
        await websocket.close()
        return

    capacity = frame.capacity or capacity

    # ── 4. Mark online in registry + DB ──────────────────────────────────────
    conn = WorkerConn(worker_id=worker_id, company_id=company_id, capacity=capacity)
    registry.register(conn)

    try:
        # Run in executor so we don't block the event loop on the DB round-trip
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _mark_worker_online, worker_id)
    except Exception as exc:
        logger.warning("Worker %s: failed to mark online in DB: %s", worker_id, exc)

    # ── 5. Heartbeat loop + message loop (concurrent tasks) ──────────────────
    last_pong_at = now()

    async def _heartbeat_loop() -> None:
        nonlocal last_pong_at
        while True:
            # Wait one heartbeat interval (the injectable `sleep` seam)
            await sleep(heartbeat_interval)

            # Send ping
            try:
                await websocket.send_text(encode(PingFrame()))
            except Exception:
                return  # Connection gone — outer loop will handle cleanup

            # Wait another interval for the pong to arrive
            await sleep(heartbeat_interval)

            # Check: did we receive a pong since the ping was sent?
            # last_pong_at is updated by the receive loop whenever a pong arrives.
            elapsed = now() - last_pong_at
            if elapsed > 2 * heartbeat_interval:
                logger.info(
                    "Worker %s: missed pong (elapsed=%.2fs > 2×%.2fs). Dropping.",
                    worker_id,
                    elapsed,
                    heartbeat_interval,
                )
                # Drop — close will stop the receive loop too
                try:
                    await websocket.close()
                except Exception:
                    pass
                return

    async def _receive_loop() -> None:
        nonlocal last_pong_at
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    frame = decode(raw)
                except Exception:
                    continue  # ignore malformed frames

                if isinstance(frame, PongFrame):
                    last_pong_at = now()
                # Other frame types (job_step, job_done, etc.) are ignored for now.

        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.debug("Worker %s: receive loop ended: %s", worker_id, exc)

    # Run both loops concurrently; whichever exits first triggers cleanup
    heartbeat_task = asyncio.create_task(_heartbeat_loop())
    receive_task = asyncio.create_task(_receive_loop())

    try:
        done, pending = await asyncio.wait(
            {heartbeat_task, receive_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
    except Exception as exc:
        logger.debug("Worker %s: handler error: %s", worker_id, exc)
    finally:
        # ── 6. Drop: remove from registry + mark offline in DB ────────────
        # Run synchronously in the finally block — we must not lose this work.
        # The DB call is fast (one UPDATE + one SELECT + UPDATE batch).
        try:
            _drop_worker(worker_id)
        except Exception as exc:
            logger.warning("Worker %s: drop failed: %s", worker_id, exc)


# ---------------------------------------------------------------------------
# Route binding
# ---------------------------------------------------------------------------


@router.websocket("/compute/relay")
async def ws_worker_relay(websocket: WebSocket) -> None:
    """Worker WebSocket relay endpoint.

    Auth: ``?token=<worker_token>`` query param (checked BEFORE accept).
    Closes with code 4401 on missing/invalid token.

    The heartbeat interval is read from the module-level ``HEARTBEAT_S``
    constant at call time (not at definition time), so tests can patch it.
    """
    await worker_relay_handler(websocket, heartbeat_interval=HEARTBEAT_S)
