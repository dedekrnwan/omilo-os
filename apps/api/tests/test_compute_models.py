"""TDD — Task 2: ComputeWorker + ComputeJob models + migration.

Tests (company-scoped tenant sessions, real DB):

1. test_tables_exist_after_migration — both compute_worker and compute_job
   tables are present in the DB after alembic upgrade head.
2. test_compute_tables_are_rls_scoped — a worker/job seeded in company A is
   invisible when queried from company B's tenant session.

RED → implement → GREEN.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
import sqlalchemy as sa
from sqlalchemy import inspect, select, text

from omilo.db import SessionLocal, set_company
from omilo.models.base import prefixed_id
from omilo.models.compute import ComputeJob, ComputeWorker
from omilo.models.tenancy import Company


# ---------------------------------------------------------------------------
# Session helpers (mirror test_mcp_token_model.py pattern)
# ---------------------------------------------------------------------------


def _superuser_session():
    """Open a privileged (superuser) session — bypasses RLS."""
    class _S:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type is not None:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _S()


def _tenant_session(company_id: str):
    """Open a company-scoped session (mimics get_db / RLS enforced)."""
    class _T:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            self._sess.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(self._sess, company_id)
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type is not None:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _T()


# ---------------------------------------------------------------------------
# Fixtures: two companies seeded via superuser
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def company_a():
    cmp = Company(
        id=prefixed_id("cmp"),
        name="Compute Test Co A",
        color="#0f3460",
        timezone="Asia/Jakarta",
    )
    with _superuser_session() as sess:
        sess.add(cmp)
    return cmp.id


@pytest.fixture(scope="module")
def company_b():
    cmp = Company(
        id=prefixed_id("cmp"),
        name="Compute Test Co B",
        color="#533483",
        timezone="Asia/Jakarta",
    )
    with _superuser_session() as sess:
        sess.add(cmp)
    return cmp.id


# ---------------------------------------------------------------------------
# Test 1: Tables exist after migration
# ---------------------------------------------------------------------------


def test_tables_exist_after_migration():
    """compute_worker and compute_job tables must exist in the DB after upgrade."""
    with _superuser_session() as sess:
        insp = inspect(sess.bind)
        table_names = insp.get_table_names()
    assert "compute_worker" in table_names, (
        f"compute_worker table not found in DB. Present tables: {table_names}"
    )
    assert "compute_job" in table_names, (
        f"compute_job table not found in DB. Present tables: {table_names}"
    )


# ---------------------------------------------------------------------------
# Test 2: RLS scoping — company B cannot see company A's rows
# ---------------------------------------------------------------------------


def test_compute_tables_are_rls_scoped(company_a, company_b):
    """A worker and job seeded in company A must be invisible from company B."""
    now = datetime.now(tz=timezone.utc)

    worker_id = prefixed_id("cwk")
    job_id = prefixed_id("cjb")

    # Seed a ComputeWorker in company A via superuser (bypass RLS for setup)
    with _superuser_session() as sess:
        worker = ComputeWorker(
            id=worker_id,
            company_id=company_a,
            status="online",
            capacity=4,
            in_use=0,
            last_seen_at=now,
            token_hash=f"rls_test_hash_{worker_id}",
        )
        sess.add(worker)
        sess.flush()

        job = ComputeJob(
            id=job_id,
            company_id=company_a,
            worker_id=worker_id,
            status="queued",
            spec={"type": "run_flow", "flow_id": "flw_test"},
        )
        sess.add(job)

    # Company B tenant session must see zero rows on both tables
    with _tenant_session(company_b) as sess:
        workers_b = sess.execute(select(ComputeWorker)).scalars().all()
        jobs_b = sess.execute(select(ComputeJob)).scalars().all()

    assert workers_b == [], (
        f"Company B should see zero ComputeWorker rows, got: {workers_b}"
    )
    assert jobs_b == [], (
        f"Company B should see zero ComputeJob rows, got: {jobs_b}"
    )

    # Company A tenant session must see the rows it owns
    with _tenant_session(company_a) as sess:
        workers_a = sess.execute(
            select(ComputeWorker).where(ComputeWorker.id == worker_id)
        ).scalars().all()
        jobs_a = sess.execute(
            select(ComputeJob).where(ComputeJob.id == job_id)
        ).scalars().all()

    assert len(workers_a) == 1, (
        f"Company A should see its own ComputeWorker, got: {workers_a}"
    )
    assert len(jobs_a) == 1, (
        f"Company A should see its own ComputeJob, got: {jobs_a}"
    )
