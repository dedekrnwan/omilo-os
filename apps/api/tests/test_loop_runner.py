"""TDD: Task 4 — Agent loop runtime (supervisor→worker→gate→review).

Tests (fake engine, real DB, company-scoped session):

1. Plain brief → job.status 'done', a Report exists, ≥2 RunEvents recorded.
2. Company autonomy 'ask', brief with SEND: sentinel (medium risk) →
   Proposal created (pending) + decision InboxItem, job.status 'waiting'.
3. Company autonomy 'yolo', same SEND: brief → auto-approved (no blocking
   decision; an 'update' InboxItem instead), job.status 'done'.
4. A 'deploy' SafetyLimit (value=0, block) + brief 'DEPLOY: x' under 'yolo'
   → verdict refused, job.status 'failed', a failure InboxItem.
5. Tenant isolation: a job/proposal for company A is invisible to a
   company-B-scoped query.

RED → implement → GREEN.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text

from omilo.db import SessionLocal, set_company
from omilo.models.approvals import Proposal, SafetyLimit
from omilo.models.base import prefixed_id
from omilo.models.agents import Helper
from omilo.models.execution import Job, Report, RunEvent
from omilo.models.inbox import InboxItem
from omilo.models.tenancy import Company

_API_DIR = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Ensure schema is current (including 0003_company_autonomy_default)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=_API_DIR,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_company(db, *, autonomy_default: str = "ask") -> Company:
    """Create a Company (global table — insert as superuser, no RLS)."""
    company = Company(
        id=prefixed_id("cmp"),
        name=f"TestCo-{autonomy_default}",
        color="#000000",
        autonomy_default=autonomy_default,
    )
    db.add(company)
    db.flush()
    return company


def _make_helper(db, *, company_id: str, is_chief: bool = True) -> Helper:
    """Create a Helper within a company-scoped session."""
    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name="TestHelper",
        area="ops",
        is_chief=is_chief,
        engine={"type": "fake"},
        autonomy_cap=None,
        permissions=[],
        status="active",
        channel_ids=[],
    )
    db.add(helper)
    db.flush()
    return helper


def _tenant_session(company_id: str):
    """Context manager: open a company-scoped session (mimics get_db)."""
    class _TenantSession:
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

    return _TenantSession()


def _superuser_session():
    """Context manager: open a privileged (superuser) session for global tables."""
    class _SuperSession:
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

    return _SuperSession()


# ---------------------------------------------------------------------------
# Test 1: Plain brief → done + Report + ≥2 RunEvents
# ---------------------------------------------------------------------------

class TestPlainBriefDone:
    def test_job_status_done(self):
        from omilo.loop.runner import start_job

        # Insert company as superuser (global table)
        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="ask")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="Summarise today's tasks",
            )
            assert job.status == "done", f"Expected done, got {job.status!r}"

    def test_report_exists(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="ask")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="Write a brief summary",
            )
            report = db.query(Report).filter_by(job_id=job.id).first()
            assert report is not None, "A Report must exist after a done job"
            assert report.headline, "Report headline must be non-empty"

    def test_run_events_at_least_two(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="ask")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="Collect reports",
            )
            events = db.query(RunEvent).filter_by(job_id=job.id).all()
            assert len(events) >= 2, (
                f"Expected ≥2 RunEvents, got {len(events)}"
            )


# ---------------------------------------------------------------------------
# Test 2: 'ask' autonomy + SEND: brief → waiting + Proposal + decision InboxItem
# ---------------------------------------------------------------------------

class TestAskAutonomySendBrief:
    def test_job_status_waiting(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="ask")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="Reply\nSEND: hi",
            )
            assert job.status == "waiting", (
                f"Expected waiting, got {job.status!r}"
            )

    def test_proposal_created(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="ask")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="Reply\nSEND: hello world",
            )
            proposal = db.query(Proposal).filter_by(job_id=job.id).first()
            assert proposal is not None, "Proposal must be created"
            assert proposal.status == "pending"
            assert proposal.type == "message"

    def test_decision_inbox_item_created(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="ask")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="Reply\nSEND: test message",
            )
            item = db.query(InboxItem).filter_by(
                company_id=company_id, kind="decision"
            ).first()
            assert item is not None, "A decision InboxItem must be created"
            assert item.needs_you is True

    def test_no_blocking_report_when_waiting(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="ask")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="Reply\nSEND: waiting test",
            )
            report = db.query(Report).filter_by(job_id=job.id).first()
            assert report is None, "No Report should exist for a waiting job"


# ---------------------------------------------------------------------------
# Test 3: 'yolo' autonomy + SEND: brief → auto-approved + update InboxItem + done
# ---------------------------------------------------------------------------

class TestYoloAutonomySendBrief:
    def test_job_status_done(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="yolo")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="Reply\nSEND: hi",
            )
            assert job.status == "done", (
                f"Under yolo the job should be done, got {job.status!r}"
            )

    def test_no_decision_inbox_item(self):
        """Under yolo, no blocking 'decision' InboxItem should be created."""
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="yolo")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="Reply\nSEND: test yolo",
            )
            decision_item = db.query(InboxItem).filter_by(
                company_id=company_id, kind="decision"
            ).first()
            assert decision_item is None, (
                "No decision InboxItem expected under yolo"
            )

    def test_update_inbox_item_created(self):
        """Under yolo, an 'update' InboxItem should be created (Chief auto-approved)."""
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="yolo")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="Reply\nSEND: yolo message",
            )
            update_item = db.query(InboxItem).filter_by(
                company_id=company_id, kind="update"
            ).first()
            assert update_item is not None, (
                "An 'update' InboxItem should be created when Chief auto-approves"
            )

    def test_report_exists(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="yolo")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="Reply\nSEND: yolo report check",
            )
            report = db.query(Report).filter_by(job_id=job.id).first()
            assert report is not None, "A Report must exist for a done yolo job"


# ---------------------------------------------------------------------------
# Test 4: deploy SafetyLimit (block, value=0) beats yolo → refused + failed
# ---------------------------------------------------------------------------

class TestSafetyLimitRefuses:
    def test_job_status_failed(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="yolo")
            company_id = company.id

        with _tenant_session(company_id) as db:
            _make_helper(db, company_id=company_id)

            # Insert a deploy SafetyLimit (kind=deploy, value=0, block)
            limit = SafetyLimit(
                id=prefixed_id("lim"),
                company_id=company_id,
                kind="deploy",
                value=0,
                scope="workspace",
                block_or_warn="block",
            )
            db.add(limit)
            db.flush()

            helper = db.query(Helper).filter_by(company_id=company_id).first()
            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="DEPLOY: x",
            )
            assert job.status == "failed", (
                f"Expected failed (SafetyLimit refused), got {job.status!r}"
            )

    def test_job_error_is_refused(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="yolo")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            limit = SafetyLimit(
                id=prefixed_id("lim"),
                company_id=company_id,
                kind="deploy",
                value=0,
                scope="workspace",
                block_or_warn="block",
            )
            db.add(limit)
            db.flush()

            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="DEPLOY: x",
            )
            assert job.error == "refused by SafetyLimit"

    def test_failure_inbox_item_created(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="yolo")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            limit = SafetyLimit(
                id=prefixed_id("lim"),
                company_id=company_id,
                kind="deploy",
                value=0,
                scope="workspace",
                block_or_warn="block",
            )
            db.add(limit)
            db.flush()

            start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="DEPLOY: x",
            )
            item = db.query(InboxItem).filter_by(
                company_id=company_id, kind="failure"
            ).first()
            assert item is not None, (
                "A failure InboxItem must be created on a SafetyLimit refusal"
            )

    def test_no_proposal_on_refused(self):
        """Refused actions must NOT create a Proposal."""
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company = _make_company(su, autonomy_default="yolo")
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            limit = SafetyLimit(
                id=prefixed_id("lim"),
                company_id=company_id,
                kind="deploy",
                value=0,
                scope="workspace",
                block_or_warn="block",
            )
            db.add(limit)
            db.flush()

            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief="DEPLOY: x",
            )
            proposal = db.query(Proposal).filter_by(job_id=job.id).first()
            assert proposal is None, "No Proposal should be created on refusal"


# ---------------------------------------------------------------------------
# Test 5: Tenant isolation — company A's data is invisible to company B session
# ---------------------------------------------------------------------------

class TestTenantIsolation:
    def test_job_invisible_to_other_company(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company_a = _make_company(su, autonomy_default="ask")
            company_b = _make_company(su, autonomy_default="ask")
            cid_a = company_a.id
            cid_b = company_b.id

        # Create a job for company A
        with _tenant_session(cid_a) as db_a:
            helper_a = _make_helper(db_a, company_id=cid_a)
            job_a = start_job(
                db_a,
                company_id=cid_a,
                helper_id=helper_a.id,
                origin="chat",
                brief="Company A task",
            )
            job_a_id = job_a.id

        # Company B session must NOT see company A's job
        with _tenant_session(cid_b) as db_b:
            # First ensure helper_b exists (needed to satisfy any future query)
            _make_helper(db_b, company_id=cid_b)

            found = db_b.query(Job).filter_by(id=job_a_id).first()
            assert found is None, (
                "RLS must prevent company B from seeing company A's job"
            )

    def test_proposal_invisible_to_other_company(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company_a = _make_company(su, autonomy_default="ask")
            company_b = _make_company(su, autonomy_default="ask")
            cid_a = company_a.id
            cid_b = company_b.id

        # Create a waiting job (with Proposal) for company A
        with _tenant_session(cid_a) as db_a:
            helper_a = _make_helper(db_a, company_id=cid_a)
            job_a = start_job(
                db_a,
                company_id=cid_a,
                helper_id=helper_a.id,
                origin="chat",
                brief="Reply\nSEND: secret message",
            )
            proposal_id = job_a.proposal_id

        assert proposal_id is not None, "Should have a proposal_id for waiting job"

        # Company B session must NOT see company A's Proposal
        with _tenant_session(cid_b) as db_b:
            _make_helper(db_b, company_id=cid_b)
            found = db_b.query(Proposal).filter_by(id=proposal_id).first()
            assert found is None, (
                "RLS must prevent company B from seeing company A's Proposal"
            )

    def test_run_events_isolated(self):
        from omilo.loop.runner import start_job

        with _superuser_session() as su:
            company_a = _make_company(su, autonomy_default="ask")
            company_b = _make_company(su, autonomy_default="ask")
            cid_a = company_a.id
            cid_b = company_b.id

        # Run a job for company A
        with _tenant_session(cid_a) as db_a:
            helper_a = _make_helper(db_a, company_id=cid_a)
            job_a = start_job(
                db_a,
                company_id=cid_a,
                helper_id=helper_a.id,
                origin="routine",
                brief="Daily ops check",
            )
            job_a_id = job_a.id

        # Company B session should see 0 run_events for company A's job
        with _tenant_session(cid_b) as db_b:
            _make_helper(db_b, company_id=cid_b)
            events = db_b.query(RunEvent).filter_by(job_id=job_a_id).all()
            assert len(events) == 0, (
                "RLS must hide company A's RunEvents from company B"
            )
