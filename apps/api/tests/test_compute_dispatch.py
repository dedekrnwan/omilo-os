"""TDD — Task 5: Dispatch + capacity leases.

Tests:
1. test_dispatch_same_company_only
   A company-B worker NEVER receives a company-A job, even if it has free capacity.

2. test_dispatch_respects_capacity
   A worker with capacity=1, in_use=1 is not chosen for a new job.

3. test_no_worker_sets_queued
   When no eligible worker is found, the job stays 'queued'; dispatch returns None.

4. test_reap_expired_lease_frees_capacity
   A dispatched job whose lease_expires_at is in the past is errored, and the
   owning worker's in_use is decremented.

5. test_reap_orphaned_worker_id
   A dispatched job whose worker_id is NULL (ON DELETE SET NULL scenario) is
   errored without crashing (no worker to decrement).

6. test_release_frees_capacity
   release(job) decrements the owning worker's in_use and floors at 0.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from omilo.compute.dispatch import (
    LEASE_S,
    _db_pick_and_reserve,
    dispatch,
    reap_expired_leases,
    release,
)
from omilo.compute.relay import WorkerConn, WorkerRegistry
from omilo.db import SessionLocal
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
# DB seed helpers
# ---------------------------------------------------------------------------


def _make_worker(
    company_id: str,
    *,
    status: str = "online",
    capacity: int = 2,
    in_use: int = 0,
) -> ComputeWorker:
    """Insert a ComputeWorker row and return the ORM object (within a live session).
    Caller must supply an outer session/transaction."""
    with SessionLocal() as session:
        with session.begin():
            worker = ComputeWorker(
                id=prefixed_id("cwk"),
                company_id=company_id,
                status=status,
                capacity=capacity,
                in_use=in_use,
                token_hash="fakehash_" + prefixed_id("h"),
            )
            session.add(worker)
            session.flush()
            session.expunge(worker)
            return worker


def _make_job(
    company_id: str,
    *,
    status: str = "queued",
    worker_id: str | None = None,
    lease_expires_at: datetime | None = None,
) -> ComputeJob:
    """Insert a ComputeJob row and return the ORM object (detached)."""
    with SessionLocal() as session:
        with session.begin():
            job = ComputeJob(
                id=prefixed_id("cjb"),
                company_id=company_id,
                status=status,
                spec={"type": "test_dispatch"},
                worker_id=worker_id,
                lease_expires_at=lease_expires_at,
            )
            session.add(job)
            session.flush()
            session.expunge(job)
            return job


def _get_worker(worker_id: str) -> ComputeWorker | None:
    with SessionLocal() as session:
        w = session.get(ComputeWorker, worker_id)
        if w is not None:
            session.expunge(w)
        return w


def _get_job(job_id: str) -> ComputeJob | None:
    with SessionLocal() as session:
        j = session.get(ComputeJob, job_id)
        if j is not None:
            session.expunge(j)
        return j


def _fake_conn(worker: ComputeWorker) -> WorkerConn:
    """Build a WorkerConn with an outbox queue (no real socket needed)."""
    return WorkerConn(
        worker_id=worker.id,
        company_id=worker.company_id,
        capacity=worker.capacity,
    )


def _registry_with(conns: list[WorkerConn]) -> WorkerRegistry:
    """Build a fresh WorkerRegistry pre-populated with the given WorkerConns."""
    reg = WorkerRegistry()
    for conn in conns:
        reg.register(conn)
    return reg


# ---------------------------------------------------------------------------
# Test 1 — cross-company isolation: company-B worker never gets company-A job
# ---------------------------------------------------------------------------


def test_dispatch_same_company_only():
    """A company-B worker with free capacity must NOT receive a company-A job."""
    company_a = prefixed_id("cmp")
    company_b = prefixed_id("cmp")

    worker_b = _make_worker(company_b, capacity=4, in_use=0)
    job_a = _make_job(company_a)

    conn_b = _fake_conn(worker_b)
    reg = _registry_with([conn_b])

    result = asyncio.run(dispatch(job_a, registry=reg))

    assert result is None, (
        "dispatch must return None when no same-company worker is available; "
        f"got {result!r}"
    )

    # Job must remain 'queued', not assigned to the B-worker
    refreshed = _get_job(job_a.id)
    assert refreshed is not None
    assert refreshed.status == "queued", (
        f"Job should stay 'queued', got {refreshed.status!r}"
    )
    assert refreshed.worker_id is None, (
        f"Job must not be assigned to a cross-company worker, got worker_id={refreshed.worker_id!r}"
    )

    # The B-worker's in_use must not have changed
    refreshed_worker = _get_worker(worker_b.id)
    assert refreshed_worker is not None
    assert refreshed_worker.in_use == 0, (
        f"B-worker in_use should still be 0, got {refreshed_worker.in_use}"
    )


# ---------------------------------------------------------------------------
# Test 2 — capacity respected: full worker not chosen
# ---------------------------------------------------------------------------


def test_dispatch_respects_capacity():
    """A worker with in_use >= capacity must not be selected."""
    company_id = prefixed_id("cmp")

    # Worker at full capacity
    worker = _make_worker(company_id, capacity=1, in_use=1)
    job = _make_job(company_id)

    conn = _fake_conn(worker)
    reg = _registry_with([conn])

    result = asyncio.run(dispatch(job, registry=reg))

    assert result is None, (
        "dispatch must return None when the only worker is at capacity"
    )

    refreshed = _get_job(job.id)
    assert refreshed is not None
    assert refreshed.status == "queued", (
        f"Job should stay 'queued', got {refreshed.status!r}"
    )


# ---------------------------------------------------------------------------
# Test 3 — no worker → job stays queued, dispatch returns None
# ---------------------------------------------------------------------------


def test_no_worker_sets_queued():
    """When no worker is registered for the company, job stays 'queued'."""
    company_id = prefixed_id("cmp")
    job = _make_job(company_id)

    reg = _registry_with([])  # empty registry

    result = asyncio.run(dispatch(job, registry=reg))

    assert result is None
    refreshed = _get_job(job.id)
    assert refreshed is not None
    assert refreshed.status == "queued"
    assert refreshed.worker_id is None


# ---------------------------------------------------------------------------
# Test 4 — happy path: dispatch assigns job, increments in_use, sets lease
# ---------------------------------------------------------------------------


def test_dispatch_assigns_job_and_sets_lease():
    """When a free same-company worker exists, dispatch assigns the job."""
    company_id = prefixed_id("cmp")

    worker = _make_worker(company_id, capacity=2, in_use=0)
    job = _make_job(company_id)

    conn = _fake_conn(worker)
    reg = _registry_with([conn])

    result = asyncio.run(dispatch(job, registry=reg))

    assert result is not None, "dispatch must return the WorkerConn on success"
    assert result.worker_id == worker.id

    # DB: job.status='dispatched', worker_id set, lease_expires_at set
    refreshed_job = _get_job(job.id)
    assert refreshed_job is not None
    assert refreshed_job.status == "dispatched", (
        f"Expected status='dispatched', got {refreshed_job.status!r}"
    )
    assert refreshed_job.worker_id == worker.id, (
        f"Expected worker_id={worker.id!r}, got {refreshed_job.worker_id!r}"
    )
    assert refreshed_job.lease_expires_at is not None, (
        "lease_expires_at must be set after dispatch"
    )

    now_utc = datetime.now(timezone.utc)
    assert refreshed_job.lease_expires_at > now_utc, (
        "lease_expires_at must be in the future"
    )
    assert refreshed_job.lease_expires_at <= now_utc + timedelta(seconds=LEASE_S + 5), (
        "lease_expires_at must not be unreasonably far in the future"
    )

    # DB: worker.in_use incremented to 1
    refreshed_worker = _get_worker(worker.id)
    assert refreshed_worker is not None
    assert refreshed_worker.in_use == 1, (
        f"Expected worker in_use=1, got {refreshed_worker.in_use}"
    )


# ---------------------------------------------------------------------------
# Test 5 — reap expired leases frees capacity
# ---------------------------------------------------------------------------


def test_reap_expired_lease_frees_capacity():
    """A dispatched job with lease_expires_at in the past → status='error', in_use freed."""
    company_id = prefixed_id("cmp")

    # Worker with 1 slot in use
    worker = _make_worker(company_id, capacity=2, in_use=1)
    past = datetime.now(timezone.utc) - timedelta(seconds=10)
    job = _make_job(
        company_id,
        status="dispatched",
        worker_id=worker.id,
        lease_expires_at=past,
    )

    reaped = asyncio.run(
        reap_expired_leases(datetime.now(timezone.utc))
    )

    # Job must be errored
    refreshed_job = _get_job(job.id)
    assert refreshed_job is not None
    assert refreshed_job.status == "error", (
        f"Expected job status='error', got {refreshed_job.status!r}"
    )

    # Worker in_use must be freed (decremented from 1 → 0)
    refreshed_worker = _get_worker(worker.id)
    assert refreshed_worker is not None
    assert refreshed_worker.in_use == 0, (
        f"Expected worker in_use=0 after reap, got {refreshed_worker.in_use}"
    )


# ---------------------------------------------------------------------------
# Test 6 — reap running jobs with expired leases
# ---------------------------------------------------------------------------


def test_reap_running_job_with_expired_lease():
    """A running job whose lease is expired is also reaped (status='error')."""
    company_id = prefixed_id("cmp")

    worker = _make_worker(company_id, capacity=2, in_use=1)
    past = datetime.now(timezone.utc) - timedelta(seconds=5)
    job = _make_job(
        company_id,
        status="running",
        worker_id=worker.id,
        lease_expires_at=past,
    )

    asyncio.run(
        reap_expired_leases(datetime.now(timezone.utc))
    )

    refreshed_job = _get_job(job.id)
    assert refreshed_job is not None
    assert refreshed_job.status == "error"

    refreshed_worker = _get_worker(worker.id)
    assert refreshed_worker is not None
    assert refreshed_worker.in_use == 0


# ---------------------------------------------------------------------------
# Test 7 — reap orphaned (worker_id IS NULL) jobs
# ---------------------------------------------------------------------------


def test_reap_orphaned_worker_id():
    """A dispatched job with worker_id=NULL is reaped via the orphan branch.

    This test proves the *pure-orphan* path: lease_expires_at is in the FUTURE,
    so the expired-lease predicate alone would NOT trigger reaping.  Only the
    ``worker_id IS NULL`` branch catches this job — proving the DB query covers
    both conditions independently.
    """
    company_id = prefixed_id("cmp")

    # Lease is 10 minutes in the FUTURE — the expired-lease branch cannot fire.
    future = datetime.now(timezone.utc) + timedelta(seconds=600)
    job = _make_job(
        company_id,
        status="dispatched",
        worker_id=None,  # Simulates ON DELETE SET NULL — worker_id IS NULL
        lease_expires_at=future,
    )

    # Must not raise even though there is no owning worker row.
    asyncio.run(
        reap_expired_leases(datetime.now(timezone.utc))
    )

    refreshed_job = _get_job(job.id)
    assert refreshed_job is not None
    assert refreshed_job.status == "error", (
        f"Orphaned (worker_id=NULL) job must be errored via the null-worker branch, "
        f"got {refreshed_job.status!r}"
    )


# ---------------------------------------------------------------------------
# Test 8 — release frees capacity
# ---------------------------------------------------------------------------


def test_release_frees_capacity():
    """release(job) decrements the owning worker's in_use; floors at 0."""
    company_id = prefixed_id("cmp")

    worker = _make_worker(company_id, capacity=2, in_use=2)
    job = _make_job(
        company_id,
        status="done",
        worker_id=worker.id,
    )

    asyncio.run(release(job))

    refreshed_worker = _get_worker(worker.id)
    assert refreshed_worker is not None
    assert refreshed_worker.in_use == 1, (
        f"Expected in_use=1 after release, got {refreshed_worker.in_use}"
    )


def test_release_floors_at_zero():
    """release(job) never goes below in_use=0 (floor guard)."""
    company_id = prefixed_id("cmp")

    worker = _make_worker(company_id, capacity=2, in_use=0)
    job = _make_job(
        company_id,
        status="error",
        worker_id=worker.id,
    )

    asyncio.run(release(job))

    refreshed_worker = _get_worker(worker.id)
    assert refreshed_worker is not None
    assert refreshed_worker.in_use == 0, (
        f"in_use should floor at 0, got {refreshed_worker.in_use}"
    )


def test_release_no_worker_id_is_noop():
    """release(job) with worker_id=None must not raise."""
    company_id = prefixed_id("cmp")
    job = _make_job(company_id, status="error", worker_id=None)

    # Must not raise
    asyncio.run(release(job))


# ---------------------------------------------------------------------------
# C2 — DB-layer cross-company guard: _db_pick_and_reserve rejects cross-company
# ---------------------------------------------------------------------------


def test_db_pick_and_reserve_rejects_cross_company():
    """_db_pick_and_reserve itself must refuse a worker from a different company.

    This test calls the DB function directly — bypassing the registry — to prove
    the DB layer is the final guard, not just the in-memory registry snapshot.

    A company-B worker ID is supplied as a candidate for a company-A job.  Even
    though the worker has free capacity and is online, _db_pick_and_reserve must
    return None and leave the worker's in_use unchanged.
    """
    company_a = prefixed_id("cmp")
    company_b = prefixed_id("cmp")

    worker_b = _make_worker(company_b, capacity=4, in_use=0)
    job_a = _make_job(company_a)  # committed — visible to _db_pick_and_reserve

    lease_expires_at = datetime.now(timezone.utc) + timedelta(seconds=LEASE_S)

    # Pass the company-B worker ID directly to the DB function, paired with
    # a company-A job — simulating a scenario where the registry snapshot was
    # somehow wrong.
    chosen = _db_pick_and_reserve(
        job_a.id,
        job_a.company_id,
        [worker_b.id],
        lease_expires_at,
    )

    assert chosen is None, (
        f"_db_pick_and_reserve must return None for a cross-company candidate; "
        f"got {chosen!r}"
    )

    # Job must not have been dispatched
    refreshed_job = _get_job(job_a.id)
    assert refreshed_job is not None
    assert refreshed_job.status == "queued", (
        f"Job should stay 'queued'; got {refreshed_job.status!r}"
    )
    assert refreshed_job.worker_id is None, (
        f"Job must not be assigned to a cross-company worker; got {refreshed_job.worker_id!r}"
    )

    # Worker in_use must not have been incremented
    refreshed_worker = _get_worker(worker_b.id)
    assert refreshed_worker is not None
    assert refreshed_worker.in_use == 0, (
        f"Cross-company worker in_use should still be 0; got {refreshed_worker.in_use}"
    )


# ---------------------------------------------------------------------------
# I1 — create_job commit ordering: job visible to dispatch on a new connection
# ---------------------------------------------------------------------------


def test_create_job_dispatches_immediately_with_online_worker():
    """Creating a job while an online same-company worker has capacity must result
    in status='dispatched', not stuck 'queued'.

    This proves that the job row is committed (visible on a second DB connection)
    before dispatch() is called — fixing the READ-COMMITTED visibility race where
    _db_pick_and_reserve opened a separate SessionLocal and saw nothing.

    We drive this through the dispatch layer directly (not the HTTP endpoint) so
    the test stays self-contained without a running FastAPI app:
      1. Commit the job row explicitly (as create_job now does).
      2. Call dispatch() with an in-process WorkerRegistry.
      3. Assert the job's DB row reflects status='dispatched'.
    """
    company_id = prefixed_id("cmp")

    worker = _make_worker(company_id, capacity=2, in_use=0)
    # _make_job commits inside its own session — job row is immediately visible.
    job = _make_job(company_id, status="queued")

    conn = _fake_conn(worker)
    reg = _registry_with([conn])

    result = asyncio.run(dispatch(job, registry=reg))

    assert result is not None, (
        "dispatch must return a WorkerConn when an online same-company worker "
        "is available — job row must be committed and visible to _db_pick_and_reserve"
    )
    assert result.worker_id == worker.id

    refreshed_job = _get_job(job.id)
    assert refreshed_job is not None
    assert refreshed_job.status == "dispatched", (
        f"Job must be 'dispatched' (not stuck 'queued'); got {refreshed_job.status!r}"
    )
    assert refreshed_job.worker_id == worker.id

    refreshed_worker = _get_worker(worker.id)
    assert refreshed_worker is not None
    assert refreshed_worker.in_use == 1, (
        f"Worker in_use should be 1 after dispatch; got {refreshed_worker.in_use}"
    )
