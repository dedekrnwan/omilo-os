"""omilo.compute.dispatch — Dispatch engine: capacity leases + reaping.

Public API
----------
dispatch(job, *, registry=None) -> WorkerConn | None
    Pick a free same-company worker, reserve a lease in DB, enqueue a
    start_job frame on the worker's outbox, and return the WorkerConn.
    Returns None (job stays 'queued') when no eligible worker is found.

reap_expired_leases(now: datetime) -> int
    Error all dispatched/running jobs whose lease_expires_at <= now, or
    whose worker_id is NULL (orphaned by ON DELETE SET NULL).  Frees the
    owning worker's in_use (floor 0).  Returns the count reaped.

release(job) -> None
    Decrement the owning worker's in_use by 1 (floor 0) when a job
    finishes (done/error) or when the worker disconnects.

LEASE_S: float
    Default lease duration in seconds (module constant).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from omilo.compute.protocol import JobQueuedFrame, StartJobFrame, encode
from omilo.db import SessionLocal
from omilo.models.compute import ComputeJob, ComputeWorker

if TYPE_CHECKING:
    from omilo.compute.relay import WorkerConn, WorkerRegistry

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------

LEASE_S: float = 300.0  # 5 minutes default lease


# ---------------------------------------------------------------------------
# DB helpers — synchronous, intended for asyncio.to_thread()
# ---------------------------------------------------------------------------


def _db_pick_and_reserve(
    job_id: str,
    company_id: str,
    candidate_worker_ids: list[str],
    lease_expires_at: datetime,
) -> str | None:
    """Atomically pick a free worker from candidates and reserve a lease.

    Reads in_use and capacity from the DB inside a transaction so concurrent
    dispatches don't double-book capacity.  Returns the chosen worker_id, or
    None if all candidates are at capacity.
    """
    with SessionLocal() as session:
        with session.begin():
            job = session.get(ComputeJob, job_id)
            if job is None:
                logger.warning("_db_pick_and_reserve: job %s not found", job_id)
                return None

            for wid in candidate_worker_ids:
                worker = session.get(ComputeWorker, wid)
                if worker is None:
                    continue
                if worker.status != "online":
                    continue
                if worker.in_use < worker.capacity:
                    # Reserve
                    worker.in_use += 1
                    job.status = "dispatched"
                    job.worker_id = wid
                    job.lease_expires_at = lease_expires_at
                    return wid

            return None


def _db_mark_queued(job_id: str) -> None:
    """Ensure job.status='queued' (no-op if already queued)."""
    with SessionLocal() as session:
        with session.begin():
            job = session.get(ComputeJob, job_id)
            if job is not None and job.status != "queued":
                job.status = "queued"


def _db_reap_expired(now: datetime) -> int:
    """Error all dispatched/running jobs that are past their lease or orphaned.

    Returns the number of jobs reaped.
    """
    with SessionLocal() as session:
        with session.begin():
            # Fetch jobs that are eligible for reaping:
            # - status in ('dispatched', 'running')
            # - AND ( lease_expires_at <= now  OR  worker_id IS NULL )
            from sqlalchemy import or_

            jobs = (
                session.query(ComputeJob)
                .filter(
                    ComputeJob.status.in_(["dispatched", "running"]),
                    or_(
                        ComputeJob.lease_expires_at <= now,
                        ComputeJob.worker_id.is_(None),
                    ),
                )
                .all()
            )

            reaped = 0
            for job in jobs:
                job.status = "error"
                job.error = "Lease expired or worker lost"

                if job.worker_id is not None:
                    worker = session.get(ComputeWorker, job.worker_id)
                    if worker is not None:
                        worker.in_use = max(0, worker.in_use - 1)

                reaped += 1

            return reaped


def _db_release(job_id: str) -> None:
    """Decrement the owning worker's in_use (floor 0) for the given job."""
    with SessionLocal() as session:
        with session.begin():
            job = session.get(ComputeJob, job_id)
            if job is None or job.worker_id is None:
                return  # Nothing to release — orphaned or already released
            worker = session.get(ComputeWorker, job.worker_id)
            if worker is not None:
                worker.in_use = max(0, worker.in_use - 1)


# ---------------------------------------------------------------------------
# Public async API
# ---------------------------------------------------------------------------


async def dispatch(
    job: ComputeJob,
    *,
    registry: "WorkerRegistry | None" = None,
) -> "WorkerConn | None":
    """Pick a free same-company worker, reserve a lease, and deliver start_job.

    Parameters
    ----------
    job:
        The ComputeJob (status='queued') to dispatch.
    registry:
        The WorkerRegistry to query.  Defaults to the module-level singleton
        (``omilo.compute.relay.registry``).  Pass an explicit registry in tests
        to avoid touching the global singleton.

    Returns
    -------
    WorkerConn
        The worker that was chosen (lease reserved, frame enqueued).
    None
        No eligible worker — job remains 'queued'.
    """
    if registry is None:
        from omilo.compute.relay import registry as _global_registry
        registry = _global_registry

    # Snapshot of connected workers for this company (registry is in-process,
    # thread-safe).  We only look at workers registered for the SAME company —
    # cross-company dispatch is explicitly forbidden.
    candidates = registry.by_company(job.company_id)

    if not candidates:
        logger.debug(
            "dispatch: no registered workers for job %s (company %s)",
            job.id,
            job.company_id,
        )
        return None

    # candidate_ids preserves registry order; DB will do the final capacity check
    # atomically (prevents double-booking under concurrent dispatches).
    candidate_ids = [conn.worker_id for conn in candidates]

    lease_expires_at = datetime.now(timezone.utc) + timedelta(seconds=LEASE_S)
    chosen_id: str | None = await asyncio.to_thread(
        _db_pick_and_reserve,
        job.id,
        job.company_id,
        candidate_ids,
        lease_expires_at,
    )

    if chosen_id is None:
        logger.debug(
            "dispatch: all workers at capacity for job %s (company %s)",
            job.id,
            job.company_id,
        )
        return None

    # Find the WorkerConn object for the chosen worker
    chosen = next((c for c in candidates if c.worker_id == chosen_id), None)
    if chosen is None:
        # Worker vanished from registry between snapshot and DB write — unusual
        logger.warning(
            "dispatch: chosen worker %s no longer in registry after DB reserve",
            chosen_id,
        )
        # The DB already reserved the lease; return None and let reap handle it
        return None

    # Enqueue start_job frame on the worker's outbox if it has one.
    # WorkerConn objects with an outbox queue (added to relay.py) get the frame;
    # fake WorkerConns in tests (no outbox) silently skip frame delivery.
    outbox = getattr(chosen, "outbox", None)
    if outbox is not None:
        frame = StartJobFrame(
            job_id=job.id,
            company_id=job.company_id,
            spec=job.spec,
            secrets={},  # BYO credentials forwarded separately (future work)
        )
        await outbox.put(encode(frame))
        logger.debug(
            "dispatch: enqueued start_job for job %s → worker %s",
            job.id,
            chosen_id,
        )
    else:
        logger.debug(
            "dispatch: WorkerConn %s has no outbox (test mode or legacy conn)",
            chosen_id,
        )

    logger.info(
        "dispatch: job %s → worker %s (company %s)",
        job.id,
        chosen_id,
        job.company_id,
    )
    return chosen


async def reap_expired_leases(now: datetime) -> int:
    """Error dispatched/running jobs whose lease is expired or whose worker is gone.

    Parameters
    ----------
    now:
        The current UTC datetime (caller-supplied so tests can inject a specific
        instant without patching time.  Use ``datetime.now(timezone.utc)``).

    Returns
    -------
    int
        Number of jobs reaped.
    """
    count = await asyncio.to_thread(_db_reap_expired, now)
    if count:
        logger.info("reap_expired_leases: reaped %d jobs", count)
    return count


async def release(job: ComputeJob) -> None:
    """Free the owning worker's in_use slot when a job reaches a terminal state.

    Safe to call even if job.worker_id is None (e.g. orphaned jobs).

    Parameters
    ----------
    job:
        The ComputeJob whose capacity slot should be released.
    """
    await asyncio.to_thread(_db_release, job.id)
    logger.debug(
        "release: freed capacity for job %s (worker %s)",
        job.id,
        job.worker_id,
    )
