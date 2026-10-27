"""TDD: Task 7 — Inbox approval write path (idempotent).

Setup: drive the loop under autonomy 'ask' with a SEND: brief (via start_job)
to produce a REAL needs_owner Proposal + a waiting Job + a decision InboxItem.

Tests:
1. GET /v1/proposals/{id} → 200 with pending proposal + ≥1 revision.
2. POST approve → status approved/done, execution Job created (origin=execution,
   proposal_id set), original waiting Job becomes done, decision InboxItem done,
   returns execution_job_id.
3. Idempotency: approve again → SAME execution_job_id; exactly ONE execution Job.
4. POST reject (fresh proposal) → status rejected, no execution Job, original job done.
5. POST request-changes → new revision (n=2), current_revision=2, status changes_requested.
6. Tenancy: company B cannot GET/approve company A's proposal (404 via RLS).
"""
from __future__ import annotations

import subprocess
import sys
import uuid
from pathlib import Path

import pytest

from omilo.db import SessionLocal
from omilo.models.approvals import Proposal, ProposalRevision
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.execution import Job
from omilo.models.inbox import InboxItem
from omilo.models.tenancy import Company, Member, User

_API_DIR = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Module-scoped schema guard
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
# Session helpers
# ---------------------------------------------------------------------------

def _superuser_session():
    class _S:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _S()


def _tenant_session(company_id: str):
    from sqlalchemy import text
    from omilo.db import set_company

    class _S:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            self._sess.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(self._sess, company_id)
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _S()


# ---------------------------------------------------------------------------
# Data factories
# ---------------------------------------------------------------------------

def _make_company(db, *, autonomy_default: str = "ask") -> Company:
    cmp = Company(
        id=prefixed_id("cmp"),
        name=f"TestCo-{uuid.uuid4().hex[:6]}",
        color="#000000",
        autonomy_default=autonomy_default,
    )
    db.add(cmp)
    db.flush()
    return cmp


def _make_user(db, *, company_id: str) -> tuple[User, Member]:
    """Insert a User + Member in the *global* (superuser) session."""
    user = User(
        id=prefixed_id("usr"),
        email=f"tst_{uuid.uuid4().hex[:8]}@example.com",
        name="Test User",
        hashed_password="x",
    )
    db.add(user)
    db.flush()
    member = Member(
        id=prefixed_id("mem"),
        company_id=company_id,
        user_id=user.id,
        role="owner",
    )
    db.add(member)
    db.flush()
    return user, member


def _make_helper(db, *, company_id: str) -> Helper:
    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name="TestHelper",
        area="ops",
        is_chief=True,
        engine={"type": "fake"},
        autonomy_cap=None,
        permissions=[],
        status="active",
        channel_ids=[],
    )
    db.add(helper)
    db.flush()
    return helper


def _sign_in_token(client_sync, *, email: str, password: str = "testP4ss!") -> str:
    """Sign in synchronously and return the access token."""
    import httpx
    from omilo.main import create_app
    app = create_app()
    with httpx.Client(app=app, base_url="http://test", transport=httpx.ASGITransport(app=app)) as c:
        resp = c.post("/v1/auth/sign-in", json={"email": email, "password": password})
        assert resp.status_code == 200, resp.text
        return resp.json()["session"]["access"]


async def _sign_up_in(client, email=None, password="testP4ss!"):
    """Sign up a new user via the async client and return access token + company_id."""
    email = email or f"apr_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Approvals User", "password": password},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me = (await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})).json()
    company_id = me["company"]["id"]
    return token, company_id


def _make_ask_proposal(company_id: str, helper_id: str) -> tuple[str, str, str]:
    """Run the loop under 'ask' with a SEND: brief to get a real Proposal.

    Returns (job_id, proposal_id, inbox_item_id).
    """
    from omilo.loop.runner import start_job

    with _tenant_session(company_id) as db:
        job = start_job(
            db,
            company_id=company_id,
            helper_id=helper_id,
            origin="chat",
            brief="Reply\nSEND: test approval message",
        )
        assert job.status == "waiting", f"Expected waiting, got {job.status!r}"
        proposal_id = job.proposal_id
        assert proposal_id, "proposal_id must be set on waiting job"

        inbox = (
            db.query(InboxItem)
            .filter_by(company_id=company_id, kind="decision")
            .order_by(InboxItem.created_at.desc())
            .first()
        )
        assert inbox is not None
        return job.id, proposal_id, inbox.id


# ---------------------------------------------------------------------------
# Fixtures: two isolated tenants shared across all tests in this module
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def tenant_a():
    """Return (company_id, helper_id) for company A under autonomy='ask'."""
    with _superuser_session() as su:
        cmp = _make_company(su, autonomy_default="ask")
        company_id = cmp.id

    with _tenant_session(company_id) as db:
        helper = _make_helper(db, company_id=company_id)
        helper_id = helper.id

    return company_id, helper_id


@pytest.fixture(scope="module")
def tenant_b():
    """Return (company_id, helper_id) for company B — for tenancy isolation checks."""
    with _superuser_session() as su:
        cmp = _make_company(su, autonomy_default="ask")
        company_id = cmp.id

    with _tenant_session(company_id) as db:
        helper = _make_helper(db, company_id=company_id)
        helper_id = helper.id

    return company_id, helper_id


# ---------------------------------------------------------------------------
# HTTP auth helper: sign-up a user for a pre-created company
# ---------------------------------------------------------------------------

async def _get_token_for_company(client, company_id: str) -> str:
    """Sign up a fresh user attached to *company_id* and return its access token.

    We sign up normally (which auto-creates a company), then use the privileged
    session to insert a Member row linking the new user to the pre-created
    company_id.  We then forge the JWT claim by signing in with X-Company-Id.
    Since that path requires an existing Member row, the simpler approach is
    to INSERT a Member directly via the superuser session.
    """
    email = f"apr_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Apr User", "password": "testP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    token_original = resp.json()["session"]["access"]

    # Get this user's id via /me
    me = (
        await client.get("/v1/me", headers={"Authorization": f"Bearer {token_original}"})
    ).json()
    user_id = me["user"]["id"]
    # Their auto-created company (we don't care about this company)

    # Insert a Member row for the target company
    with _superuser_session() as su:
        mem = Member(
            id=prefixed_id("mem"),
            company_id=company_id,
            user_id=user_id,
            role="owner",
        )
        su.add(mem)

    # Sign in and request with X-Company-Id header to get a token scoped to the target company.
    # The JWT still points to their original company; we'll use X-Company-Id for all requests.
    return token_original, user_id, company_id


# ---------------------------------------------------------------------------
# Test 1: GET /v1/proposals/{id} → 200, pending, ≥1 revision
# ---------------------------------------------------------------------------

class TestGetProposal:
    @pytest.mark.asyncio
    async def test_get_proposal_pending_with_revision(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        # Create a fresh proposal
        _job_id, proposal_id, _inbox_id = _make_ask_proposal(company_id, helper_id)

        resp = await async_client.get(
            f"/v1/proposals/{proposal_id}",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "proposal" in body
        assert "revisions" in body
        assert body["proposal"]["status"] == "pending"
        assert len(body["revisions"]) >= 1


# ---------------------------------------------------------------------------
# Test 2: POST approve → execution Job created, original job done, inbox done
# ---------------------------------------------------------------------------

class TestApprove:
    @pytest.mark.asyncio
    async def test_approve_creates_execution_job(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        job_id, proposal_id, inbox_id = _make_ask_proposal(company_id, helper_id)

        resp = await async_client.post(
            f"/v1/proposals/{proposal_id}/approve",
            json={"note": "LGTM"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "execution_job_id" in body
        assert body["execution_job_id"] is not None
        exec_job_id = body["execution_job_id"]

        # Verify: execution job exists with origin=execution and proposal_id set
        with _tenant_session(company_id) as db:
            exec_job = db.query(Job).filter_by(id=exec_job_id).first()
            assert exec_job is not None
            assert exec_job.origin == "execution"
            assert exec_job.proposal_id == proposal_id

    @pytest.mark.asyncio
    async def test_approve_original_job_becomes_done(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        job_id, proposal_id, inbox_id = _make_ask_proposal(company_id, helper_id)

        await async_client.post(
            f"/v1/proposals/{proposal_id}/approve",
            json={},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )

        # Original waiting job must be done
        with _tenant_session(company_id) as db:
            orig_job = db.query(Job).filter_by(id=job_id).first()
            assert orig_job is not None
            assert orig_job.status == "done", f"Expected done, got {orig_job.status!r}"

    @pytest.mark.asyncio
    async def test_approve_inbox_item_becomes_done(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        job_id, proposal_id, inbox_id = _make_ask_proposal(company_id, helper_id)

        await async_client.post(
            f"/v1/proposals/{proposal_id}/approve",
            json={},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )

        with _tenant_session(company_id) as db:
            item = db.query(InboxItem).filter_by(id=inbox_id).first()
            assert item is not None
            assert item.status == "done", f"Expected done, got {item.status!r}"

    @pytest.mark.asyncio
    async def test_approve_proposal_status_done(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        _job_id, proposal_id, _inbox_id = _make_ask_proposal(company_id, helper_id)

        resp = await async_client.post(
            f"/v1/proposals/{proposal_id}/approve",
            json={},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        body = resp.json()
        assert body["proposal"]["status"] in ("approved", "executing", "done")


# ---------------------------------------------------------------------------
# Test 3: Idempotency — approve twice → SAME execution_job_id, count == 1
# ---------------------------------------------------------------------------

class TestApproveIdempotency:
    @pytest.mark.asyncio
    async def test_approve_twice_returns_same_execution_job_id(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        _job_id, proposal_id, _inbox_id = _make_ask_proposal(company_id, helper_id)

        headers = {"Authorization": f"Bearer {token}", "X-Company-Id": company_id,
                   "Idempotency-Key": f"idem-{proposal_id}"}

        r1 = await async_client.post(
            f"/v1/proposals/{proposal_id}/approve",
            json={"note": "first"},
            headers=headers,
        )
        assert r1.status_code == 200, r1.text

        r2 = await async_client.post(
            f"/v1/proposals/{proposal_id}/approve",
            json={"note": "second"},
            headers=headers,
        )
        assert r2.status_code == 200, r2.text

        assert r1.json()["execution_job_id"] == r2.json()["execution_job_id"], (
            "Idempotency failed: two different execution_job_ids returned"
        )

    @pytest.mark.asyncio
    async def test_approve_twice_exactly_one_execution_job(self, async_client, tenant_a):
        """Approve twice: exactly ONE execution Job must exist for this proposal."""
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        _job_id, proposal_id, _inbox_id = _make_ask_proposal(company_id, helper_id)

        headers = {"Authorization": f"Bearer {token}", "X-Company-Id": company_id}

        await async_client.post(
            f"/v1/proposals/{proposal_id}/approve",
            json={},
            headers=headers,
        )
        await async_client.post(
            f"/v1/proposals/{proposal_id}/approve",
            json={},
            headers=headers,
        )

        with _tenant_session(company_id) as db:
            count = (
                db.query(Job)
                .filter_by(proposal_id=proposal_id, origin="execution")
                .count()
            )
        assert count == 1, (
            f"Idempotency failed: expected exactly 1 execution Job, found {count}"
        )


# ---------------------------------------------------------------------------
# Test 4: POST reject → status rejected, no execution Job, original job done
# ---------------------------------------------------------------------------

class TestReject:
    @pytest.mark.asyncio
    async def test_reject_status_rejected(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        _job_id, proposal_id, _inbox_id = _make_ask_proposal(company_id, helper_id)

        resp = await async_client.post(
            f"/v1/proposals/{proposal_id}/reject",
            json={"note": "Not the right approach"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["proposal"]["status"] == "rejected"

    @pytest.mark.asyncio
    async def test_reject_no_execution_job(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        _job_id, proposal_id, _inbox_id = _make_ask_proposal(company_id, helper_id)

        await async_client.post(
            f"/v1/proposals/{proposal_id}/reject",
            json={"note": "No thanks"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )

        with _tenant_session(company_id) as db:
            count = (
                db.query(Job)
                .filter_by(proposal_id=proposal_id, origin="execution")
                .count()
            )
        assert count == 0, f"Reject must not create an execution Job; found {count}"

    @pytest.mark.asyncio
    async def test_reject_original_job_done(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        job_id, proposal_id, _inbox_id = _make_ask_proposal(company_id, helper_id)

        await async_client.post(
            f"/v1/proposals/{proposal_id}/reject",
            json={"note": "nope"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )

        with _tenant_session(company_id) as db:
            orig_job = db.query(Job).filter_by(id=job_id).first()
            assert orig_job is not None
            assert orig_job.status == "done", (
                f"Original job should be done after reject, got {orig_job.status!r}"
            )

    @pytest.mark.asyncio
    async def test_reject_idempotent(self, async_client, tenant_a):
        """Rejecting already-rejected proposal returns 200 without error."""
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        _job_id, proposal_id, _inbox_id = _make_ask_proposal(company_id, helper_id)
        headers = {"Authorization": f"Bearer {token}", "X-Company-Id": company_id}

        await async_client.post(
            f"/v1/proposals/{proposal_id}/reject",
            json={"note": "first rejection"},
            headers=headers,
        )
        r2 = await async_client.post(
            f"/v1/proposals/{proposal_id}/reject",
            json={"note": "second rejection"},
            headers=headers,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["proposal"]["status"] == "rejected"


# ---------------------------------------------------------------------------
# Test 5: POST request-changes → new revision n=2, current_revision=2, changes_requested
# ---------------------------------------------------------------------------

class TestRequestChanges:
    @pytest.mark.asyncio
    async def test_request_changes_new_revision(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        _job_id, proposal_id, _inbox_id = _make_ask_proposal(company_id, helper_id)

        resp = await async_client.post(
            f"/v1/proposals/{proposal_id}/request-changes",
            json={"note": "Please tighten the scope"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["proposal"]["status"] == "changes_requested"
        assert body["proposal"]["current_revision"] == 2
        assert len(body["revisions"]) >= 2

    @pytest.mark.asyncio
    async def test_request_changes_revision_author_is_operator(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token, _user_id, _cmp = await _get_token_for_company(async_client, company_id)

        _job_id, proposal_id, _inbox_id = _make_ask_proposal(company_id, helper_id)

        resp = await async_client.post(
            f"/v1/proposals/{proposal_id}/request-changes",
            json={"note": "needs work"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        body = resp.json()
        # The newest revision should be from operator
        revs = sorted(body["revisions"], key=lambda r: r["n"])
        assert revs[-1]["author"] == "operator"
        assert revs[-1]["n"] == 2


# ---------------------------------------------------------------------------
# Test 6: Tenancy — company B cannot GET or approve company A's proposal
# ---------------------------------------------------------------------------

class TestTenancy:
    @pytest.mark.asyncio
    async def test_company_b_cannot_get_company_a_proposal(
        self, async_client, tenant_a, tenant_b
    ):
        company_a_id, helper_a_id = tenant_a
        company_b_id, helper_b_id = tenant_b

        # Create a proposal in company A
        _job_id, proposal_id, _inbox_id = _make_ask_proposal(company_a_id, helper_a_id)

        # Sign up a user for company B
        token_b, _uid, _cmp = await _get_token_for_company(async_client, company_b_id)

        resp = await async_client.get(
            f"/v1/proposals/{proposal_id}",
            headers={"Authorization": f"Bearer {token_b}", "X-Company-Id": company_b_id},
        )
        assert resp.status_code == 404, (
            f"Company B must not see Company A's proposal; got {resp.status_code}: {resp.text}"
        )

    @pytest.mark.asyncio
    async def test_company_b_cannot_approve_company_a_proposal(
        self, async_client, tenant_a, tenant_b
    ):
        company_a_id, helper_a_id = tenant_a
        company_b_id, helper_b_id = tenant_b

        _job_id, proposal_id, _inbox_id = _make_ask_proposal(company_a_id, helper_a_id)
        token_b, _uid, _cmp = await _get_token_for_company(async_client, company_b_id)

        resp = await async_client.post(
            f"/v1/proposals/{proposal_id}/approve",
            json={},
            headers={"Authorization": f"Bearer {token_b}", "X-Company-Id": company_b_id},
        )
        assert resp.status_code == 404, (
            f"Company B must not approve Company A's proposal; got {resp.status_code}: {resp.text}"
        )
