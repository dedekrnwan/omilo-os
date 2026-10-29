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
from omilo.compute.protocol import (
    JobDoneFrame,
    JobErrorFrame,
    JobStatusFrame,
    JobStepFrame,
    PingFrame,
    PongFrame,
    RegisterFrame,
    decode,
    encode,
)
from omilo.db import SessionLocal
from omilo.models.compute import ComputeJob, ComputeWorker
from omilo.realtime.events import broker

logger = logging.getLogger(__name__)

router = APIRouter(tags=["compute"])

# WS close code 4401 — application-level authentication failure
_WS_UNAUTHORIZED = 4401

# Default heartbeat interval in seconds (module constant — tests may patch it).
HEARTBEAT_S: float = 20.0


# ---------------------------------------------------------------------------
# WorkerConn — lightweight handle stored in the registry
# ---------------------------------------------------------------------------


@dataclass
class WorkerConn:
    """Handle for a connected worker stored in the registry.

    ``outbox`` is an asyncio.Queue onto which dispatch() enqueues encoded
    frames (e.g. start_job).  The WS send-loop drains it and calls
    ``websocket.send_text()`` for each frame, decoupling the async REST/dispatch
    context from the socket send without any locking.
    """

    worker_id: str
    company_id: str
    capacity: int
    outbox: asyncio.Queue = field(default_factory=asyncio.Queue)


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
# Status frame DB helpers — synchronous, for asyncio.to_thread()
# ---------------------------------------------------------------------------


def _handle_job_step_db(job_id: str, company_id: str) -> ComputeJob | None:
    """Transition job to 'running' and renew lease. Returns updated job or None.

    Security: only updates jobs whose company_id matches the worker's company_id.
    Lease renewal prevents the reaper from killing a long-running job mid-flight.
    """
    from datetime import timedelta

    from omilo.compute.dispatch import LEASE_S

    now = datetime.now(timezone.utc)
    with SessionLocal() as session:
        with session.begin():
            job = session.get(ComputeJob, job_id)
            if job is None:
                logger.warning("_handle_job_step_db: job %s not found", job_id)
                return None
            if job.company_id != company_id:
                logger.warning(
                    "_handle_job_step_db: cross-company attempt (job %s company=%s, "
                    "worker company=%s) — ignoring",
                    job_id,
                    job.company_id,
                    company_id,
                )
                return None

            # If the job is already terminal, skip — mirrors the done/error
            # handlers' idempotent return None so no stray SSE is published.
            if job.status in ("done", "error"):
                return None

            # Transition to running and renew lease so a long-running job
            # isn't reaped mid-flight.
            job.status = "running"
            job.lease_expires_at = now + timedelta(seconds=LEASE_S)

            # Return a detached snapshot for SSE publishing (outside session)
            session.flush()
            return ComputeJob(
                id=job.id,
                company_id=job.company_id,
                worker_id=job.worker_id,
                status=job.status,
                spec=job.spec,
                lease_expires_at=job.lease_expires_at,
                result=job.result,
                artifact=job.artifact,
                error=job.error,
            )


def _strip_secrets_recursive(obj: Any) -> Any:
    """Recursively remove any dict key named 'secrets' at any depth.

    Returns a new object (dicts/lists are copied; other values returned as-is).
    This is the canonical sanitiser: call it on any untrusted worker payload
    before persisting to the DB row or publishing to SSE.
    """
    if isinstance(obj, dict):
        return {k: _strip_secrets_recursive(v) for k, v in obj.items() if k != "secrets"}
    if isinstance(obj, list):
        return [_strip_secrets_recursive(item) for item in obj]
    return obj


def _handle_job_done_db(
    job_id: str,
    company_id: str,
    result: dict | None,
    artifact: str | None,
) -> ComputeJob | None:
    """Settle job as 'done'. Idempotent — no-op if already terminal.

    Security: only updates jobs whose company_id matches the worker's company_id.
    Secrets are NEVER stored here — 'secrets' keys are stripped **recursively**
    from the result before persisting and publishing (I1 fix: deep strip).

    Concurrency: the row is locked with SELECT … FOR UPDATE before the
    was_terminal check so that a concurrent double-delivery cannot race past
    the guard and double-settle (I2 fix: row lock for atomic read-then-write).

    Returns the updated job snapshot, or None on security/not-found rejection.
    Returns None if already terminal (idempotent replay — caller skips SSE).
    """
    with SessionLocal() as session:
        with session.begin():
            job = session.get(ComputeJob, job_id, with_for_update=True)
            if job is None:
                logger.warning("_handle_job_done_db: job %s not found", job_id)
                return None
            if job.company_id != company_id:
                logger.warning(
                    "_handle_job_done_db: cross-company attempt (job %s company=%s, "
                    "worker company=%s) — ignoring",
                    job_id,
                    job.company_id,
                    company_id,
                )
                return None

            was_terminal = job.status in ("done", "error")

            if was_terminal:
                # Idempotent replay — job is already settled, nothing to update.
                # Return None to signal the caller to skip SSE publish.
                return None

            # Strip 'secrets' **recursively** from result before persisting
            # (security invariant — nested secrets must not survive either).
            safe_result: dict | None = None
            if result is not None:
                safe_result = _strip_secrets_recursive(result)
            job.status = "done"
            job.result = safe_result
            job.artifact = artifact

            session.flush()
            return ComputeJob(
                id=job.id,
                company_id=job.company_id,
                worker_id=job.worker_id,
                status=job.status,
                spec=job.spec,
                lease_expires_at=job.lease_expires_at,
                result=job.result,
                artifact=job.artifact,
                error=job.error,
            )


def _handle_job_error_db(job_id: str, company_id: str, error: str) -> ComputeJob | None:
    """Settle job as 'error'. Idempotent — no-op if already terminal.

    Security: only updates jobs whose company_id matches the worker's company_id.

    Concurrency: the row is locked with SELECT … FOR UPDATE before the
    was_terminal check so that a concurrent double-delivery cannot race past
    the guard and double-settle (I2 fix: row lock for atomic read-then-write).

    Returns the updated job snapshot, or None on security/not-found rejection.
    """
    with SessionLocal() as session:
        with session.begin():
            job = session.get(ComputeJob, job_id, with_for_update=True)
            if job is None:
                logger.warning("_handle_job_error_db: job %s not found", job_id)
                return None
            if job.company_id != company_id:
                logger.warning(
                    "_handle_job_error_db: cross-company attempt (job %s company=%s, "
                    "worker company=%s) — ignoring",
                    job_id,
                    job.company_id,
                    company_id,
                )
                return None

            was_terminal = job.status in ("done", "error")

            if was_terminal:
                # Idempotent replay — job is already settled.
                # Return None to signal the caller to skip SSE publish.
                return None

            job.status = "error"
            job.error = error

            session.flush()
            return ComputeJob(
                id=job.id,
                company_id=job.company_id,
                worker_id=job.worker_id,
                status=job.status,
                spec=job.spec,
                lease_expires_at=job.lease_expires_at,
                result=job.result,
                artifact=job.artifact,
                error=job.error,
            )


def _handle_job_status_db(
    job_id: str,
    company_id: str,
    state: str,
    detail: str | None,
) -> ComputeJob | None:
    """Handle a job_status frame: transition to 'running' and renew lease.

    Behaviour mirrors job_step: if the job is not yet terminal, mark it running
    and renew the lease. Returns the updated snapshot, or None on rejection.
    """
    # job_status is treated like job_step for DB purposes: keep alive + running
    return _handle_job_step_db(job_id, company_id)


# ---------------------------------------------------------------------------
# SSE publish helpers — sanitize before broadcasting
# ---------------------------------------------------------------------------


def _publish_job_step(company_id: str, job_id: str, seq: int, stream: str, line: str) -> None:
    """Publish a job.step event to the company's SSE stream.

    Never includes 'secrets'. Called from a thread via asyncio.to_thread.
    """
    event: dict = {
        "type": "job.step",
        "job_id": job_id,
        "seq": seq,
        "stream": stream,
        "line": line,
        # Explicit: 'secrets' is NEVER included.
    }
    broker.publish(company_id, event)


def _publish_job_status(
    company_id: str,
    job_id: str,
    state: str,
    detail: str | None,
) -> None:
    """Publish a job.status event to the company's SSE stream."""
    event: dict = {
        "type": "job.status",
        "job_id": job_id,
        "state": state,
    }
    if detail is not None:
        event["detail"] = detail
    broker.publish(company_id, event)


def _publish_job_done(
    company_id: str,
    job_id: str,
    result: dict | None,
    artifact: str | None,
) -> None:
    """Publish a job.done event to the company's SSE stream.

    'result' here is already sanitized (secrets stripped) before this call.
    """
    event: dict = {
        "type": "job.done",
        "job_id": job_id,
        "ok": True,
        "result": result,
        "artifact": artifact,
        # Explicit: 'secrets' is NEVER included.
    }
    broker.publish(company_id, event)


def _publish_job_error(company_id: str, job_id: str, error: str) -> None:
    """Publish a job.error event to the company's SSE stream."""
    event: dict = {
        "type": "job.error",
        "job_id": job_id,
        "error": error,
        # Explicit: 'secrets' is NEVER included.
    }
    broker.publish(company_id, event)


# ---------------------------------------------------------------------------
# Async status frame dispatcher — called from the receive loop
# ---------------------------------------------------------------------------


async def _dispatch_status_frame(
    frame: JobStepFrame | JobStatusFrame | JobDoneFrame | JobErrorFrame,
    *,
    worker_company_id: str,
    worker_id: str,
) -> None:
    """Handle a status frame received from a worker.

    Steps for each frame type:
    1. Load + guard the job (company isolation — worker may only report on its
       own company's jobs).
    2. Update job state in DB (offloaded to thread).
    3. On terminal (done/error): call release(job) to free the capacity slot.
    4. Publish a sanitized event to the company's SSE stream.

    Idempotency: duplicate terminal frames (same job_id, already done/error)
    are detected by the DB helper returning a job with a terminal status that
    was already set. In that case, we skip SSE publish (no-op).
    """
    from omilo.compute.dispatch import release

    if isinstance(frame, JobStepFrame):
        updated = await asyncio.to_thread(
            _handle_job_step_db, frame.job_id, worker_company_id
        )
        if updated is None:
            return  # Security reject or not found

        await asyncio.to_thread(
            _publish_job_step,
            worker_company_id,
            frame.job_id,
            frame.seq,
            frame.stream,
            frame.line,
        )

    elif isinstance(frame, JobStatusFrame):
        updated = await asyncio.to_thread(
            _handle_job_status_db,
            frame.job_id,
            worker_company_id,
            frame.state,
            frame.detail,
        )
        if updated is None:
            return

        await asyncio.to_thread(
            _publish_job_status,
            worker_company_id,
            frame.job_id,
            frame.state,
            frame.detail,
        )

    elif isinstance(frame, JobDoneFrame):
        # _handle_job_done_db returns None if the job was already terminal
        # (idempotent replay — do not publish a second SSE event or double-release).
        updated = await asyncio.to_thread(
            _handle_job_done_db,
            frame.job_id,
            worker_company_id,
            frame.result,
            frame.artifact,
        )
        if updated is None:
            return  # Security reject, not found, or already terminal (idempotent)

        await asyncio.to_thread(
            _publish_job_done,
            worker_company_id,
            frame.job_id,
            updated.result,  # already sanitized (secrets stripped) by DB helper
            updated.artifact,
        )
        # Release capacity slot (terminal)
        try:
            await release(updated)
        except Exception:
            logger.exception(
                "_dispatch_status_frame: release failed for job %s", frame.job_id
            )

    elif isinstance(frame, JobErrorFrame):
        updated = await asyncio.to_thread(
            _handle_job_error_db,
            frame.job_id,
            worker_company_id,
            frame.error,
        )
        if updated is None:
            return  # Security reject, not found, or already terminal

        await asyncio.to_thread(
            _publish_job_error,
            worker_company_id,
            frame.job_id,
            frame.error,
        )
        # Release capacity slot (terminal)
        try:
            await release(updated)
        except Exception:
            logger.exception(
                "_dispatch_status_frame: release failed for job %s", frame.job_id
            )


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
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _mark_worker_online, worker_id)
    except Exception as exc:
        logger.warning("Worker %s: failed to mark online in DB: %s", worker_id, exc)

    # ── 4b. Dispatch any queued jobs for this company now that a worker is available
    try:
        from omilo.compute.dispatch import dispatch as _dispatch  # avoid circular at module load
        from omilo.db import SessionLocal as _SL
        from omilo.models.compute import ComputeJob as _CJ

        def _get_queued_jobs() -> list[_CJ]:
            with _SL() as _session:
                jobs = (
                    _session.query(_CJ)
                    .filter_by(company_id=company_id, status="queued")
                    .all()
                )
                for j in jobs:
                    _session.expunge(j)
                return jobs

        queued_jobs = await asyncio.to_thread(_get_queued_jobs)
        for queued_job in queued_jobs:
            try:
                await _dispatch(queued_job, registry=registry)
            except Exception as exc:
                logger.warning(
                    "Worker %s: dispatch of queued job %s failed: %s",
                    worker_id,
                    queued_job.id,
                    exc,
                )
    except Exception as exc:
        logger.warning("Worker %s: failed to dispatch queued jobs: %s", worker_id, exc)

    # ── 5. Heartbeat loop + message loop + outbox send-loop (concurrent tasks) ─
    # last_pong_at tracks the last received pong (monotonic time).
    # last_ping_sent_at tracks when the most recent ping was dispatched.
    # Dead-peer detection: after waiting `interval` for a pong, the worker is
    # dead if no pong has arrived SINCE the ping was sent, i.e.
    #   last_pong_at < last_ping_sent_at  AND  now() - last_ping_sent_at >= interval
    # This bounds detection to ≤ 2×interval from death:
    #   ≤ 1 interval until next ping + 1 interval awaiting pong.
    _SENTINEL = float("-inf")
    last_pong_at: float = _SENTINEL   # updated whenever a pong is received
    last_ping_sent_at: float = _SENTINEL  # updated when each ping is sent


    async def _heartbeat_loop() -> None:
        nonlocal last_pong_at, last_ping_sent_at
        while True:
            # Wait one heartbeat interval before sending the first/next ping
            await sleep(heartbeat_interval)

            # Record when we send the ping, then send it
            last_ping_sent_at = now()
            try:
                await websocket.send_text(encode(PingFrame()))
            except Exception:
                return  # Connection gone — outer loop will handle cleanup

            # Wait one interval for the pong to arrive
            await sleep(heartbeat_interval)

            # Dead-peer check: if no pong has arrived since we sent this ping,
            # and at least `interval` seconds have elapsed since we sent it,
            # the peer is considered dead.  Detection window ≤ 2×interval.
            if last_pong_at < last_ping_sent_at and now() - last_ping_sent_at >= heartbeat_interval:
                logger.info(
                    "Worker %s: missed pong (last_pong_at=%.3f < last_ping_sent_at=%.3f). Dropping.",
                    worker_id,
                    last_pong_at,
                    last_ping_sent_at,
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

                elif isinstance(
                    frame,
                    (JobStepFrame, JobStatusFrame, JobDoneFrame, JobErrorFrame),
                ):
                    # Dispatch status frames inline (awaited) so that:
                    # 1. DB persistence completes before the next frame is read.
                    # 2. The finally block's _drop_worker never races with an
                    #    in-progress status write.
                    # DB writes inside _dispatch_status_frame are already
                    # offloaded to asyncio.to_thread, so the event loop stays
                    # responsive while the thread pool handles the DB work.
                    try:
                        await _dispatch_status_frame(
                            frame,
                            worker_company_id=company_id,
                            worker_id=worker_id,
                        )
                    except Exception as exc:
                        logger.warning(
                            "Worker %s: error dispatching status frame: %s",
                            worker_id,
                            exc,
                        )

        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.debug("Worker %s: receive loop ended: %s", worker_id, exc)

    async def _send_loop() -> None:
        """Drain conn.outbox and forward each encoded frame to the worker socket.

        Running as a separate task decouples the async REST/dispatch context
        (which enqueues onto outbox) from the actual socket send, keeping both
        on the same event loop without any locking.
        """
        try:
            while True:
                raw_frame = await conn.outbox.get()
                try:
                    await websocket.send_text(raw_frame)
                except Exception as exc:
                    logger.debug(
                        "Worker %s: send_loop failed to send frame: %s", worker_id, exc
                    )
                    return  # Socket is gone; outer cleanup will handle it
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.debug("Worker %s: send_loop ended: %s", worker_id, exc)

    # Run all three loops concurrently; whichever exits first triggers cleanup
    heartbeat_task = asyncio.create_task(_heartbeat_loop())
    receive_task = asyncio.create_task(_receive_loop())
    send_task = asyncio.create_task(_send_loop())

    try:
        done, pending = await asyncio.wait(
            {heartbeat_task, receive_task, send_task},
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
        # Run in a thread pool so the DB round-trip doesn't block the event
        # loop, matching how _mark_worker_online is already offloaded.
        # _mark_worker_offline_and_error_inflight already sets in_use=0 and
        # errors all in-flight jobs, so release() is not needed separately here.
        try:
            await asyncio.to_thread(_drop_worker, worker_id)
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
