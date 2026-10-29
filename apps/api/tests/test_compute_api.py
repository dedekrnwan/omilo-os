"""TDD — Task 3: Worker pairing + job-create REST + verify_worker_token helper.

Tests:

1. test_pair_issues_token_hash_not_raw
   POST /v1/compute/workers/pair → 200; response has ``worker_id`` + ``token``
   (raw, non-empty); ``token_hash`` is absent from response; DB row's
   token_hash == sha256(raw_token).

2. test_pair_requires_admin
   POST /v1/compute/workers/pair by a ``member``-role user → 403.

3. test_create_job_queued_for_company
   POST /v1/compute/jobs {spec: {"type": "run_flow"}} → 200; response has
   ``id`` (cjb_ prefix), ``status == "queued"``, ``company_id`` matches.

4. test_verify_worker_token_roundtrip
   After pairing a worker, call verify_worker_token(raw_token) and confirm
   the returned ComputeWorker id matches.  Passing a bogus token returns None.

RED → implement → GREEN.
"""
from __future__ import annotations

import hashlib
import uuid

import pytest
import pytest_asyncio

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Company, Member, User
from tests.utils import run_alembic


# ---------------------------------------------------------------------------
# Schema guard — ensure 0025 migration is applied before any test runs.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Session helpers (mirror test_mcp_tokens_api.py pattern)
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


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, name="Compute Tester", password="testP4ss!"):
    email = f"compute_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    token = body["session"]["access"]
    me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]
    return token, company_id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def owner(async_client):
    """An owner-role user in their own company."""
    token, company_id = await _sign_up(async_client, name="Compute Owner")
    return {"token": token, "company_id": company_id}


@pytest_asyncio.fixture
async def owner_and_member(async_client):
    """Owner + a member-role user in the same company."""
    owner_token, company_id = await _sign_up(async_client, name="Pairing Owner")

    # Create a second user and seed a Member row with role='member'
    member_token, member_company_id = await _sign_up(
        async_client, name="Pairing Member"
    )
    me_resp = await async_client.get(
        "/v1/me", headers={"Authorization": f"Bearer {member_token}"}
    )
    member_user_id = me_resp.json()["user"]["id"]

    with _superuser_session() as db:
        m = Member(
            id=prefixed_id("mem"),
            company_id=company_id,
            user_id=member_user_id,
            role="member",
        )
        db.add(m)
        db.flush()

    return {
        "owner_token": owner_token,
        "member_token": member_token,
        "company_id": company_id,
    }


# ---------------------------------------------------------------------------
# Test 1: pair — raw token returned, token_hash absent, DB stores hash
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pair_issues_token_hash_not_raw(async_client, owner):
    """POST /v1/compute/workers/pair → {worker_id, token}; no token_hash; hash stored."""
    from omilo.models.compute import ComputeWorker
    from sqlalchemy import select, text
    from omilo.db import set_company

    resp = await async_client.post(
        "/v1/compute/workers/pair",
        json={"capacity": 2},
        headers=_auth(owner["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Response shape: worker_id + token
    assert "worker_id" in body, "Response must contain 'worker_id'"
    assert "token" in body, "Response must contain 'token'"
    raw_token = body["token"]
    assert raw_token, "Raw token must be non-empty"
    worker_id = body["worker_id"]
    assert worker_id.startswith("cwk_"), f"worker_id should have cwk_ prefix, got {worker_id}"

    # token_hash must NOT be in response
    assert "token_hash" not in body, "Response must NOT expose 'token_hash'"

    # DB row: token_hash == sha256(raw_token); status offline; capacity 2; in_use 0
    expected_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    with _superuser_session() as db:
        row = db.get(ComputeWorker, worker_id)
        assert row is not None, f"ComputeWorker {worker_id} not found in DB"
        assert row.token_hash == expected_hash, (
            f"Stored hash {row.token_hash!r} != expected {expected_hash!r}"
        )
        assert row.status == "offline", f"Expected status='offline', got {row.status!r}"
        assert row.capacity == 2, f"Expected capacity=2, got {row.capacity}"
        assert row.in_use == 0, f"Expected in_use=0, got {row.in_use}"


# ---------------------------------------------------------------------------
# Test 2: pair — member role → 403
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pair_requires_admin(async_client, owner_and_member):
    """POST /v1/compute/workers/pair with a member role → 403."""
    resp = await async_client.post(
        "/v1/compute/workers/pair",
        json={"capacity": 1},
        headers={
            "Authorization": f"Bearer {owner_and_member['member_token']}",
            "X-Company-Id": owner_and_member["company_id"],
        },
    )
    assert resp.status_code == 403, (
        f"Expected 403 for member role, got {resp.status_code}: {resp.text}"
    )


# ---------------------------------------------------------------------------
# Test 3: create job — status queued, company scoped
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_job_queued_for_company(async_client, owner):
    """POST /v1/compute/jobs {spec: {...}} → id cjb_, status queued, company matches."""
    resp = await async_client.post(
        "/v1/compute/jobs",
        json={"spec": {"type": "run_flow", "flow_id": "flw_test"}},
        headers=_auth(owner["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "id" in body, "Response must contain 'id'"
    assert body["id"].startswith("cjb_"), (
        f"job id should have cjb_ prefix, got {body['id']}"
    )
    assert body["status"] == "queued", (
        f"Expected status='queued', got {body['status']!r}"
    )
    assert body["company_id"] == owner["company_id"], (
        f"Expected company_id={owner['company_id']!r}, got {body['company_id']!r}"
    )
    assert body["spec"] == {"type": "run_flow", "flow_id": "flw_test"}
    assert "created_at" in body


@pytest.mark.asyncio
async def test_create_job_rejects_non_dict_spec(async_client, owner):
    """POST /v1/compute/jobs with spec that is not a dict → 400."""
    resp = await async_client.post(
        "/v1/compute/jobs",
        json={"spec": ["not", "a", "dict"]},
        headers=_auth(owner["token"]),
    )
    assert resp.status_code == 400, (
        f"Expected 400 for non-dict spec, got {resp.status_code}: {resp.text}"
    )


# ---------------------------------------------------------------------------
# Test 4: verify_worker_token roundtrip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verify_worker_token_roundtrip(async_client, owner):
    """verify_worker_token(raw_token) returns the matching ComputeWorker; bogus → None."""
    from omilo.api.compute import verify_worker_token

    # Pair a worker
    pair_resp = await async_client.post(
        "/v1/compute/workers/pair",
        json={"capacity": 1},
        headers=_auth(owner["token"]),
    )
    assert pair_resp.status_code == 200, pair_resp.text
    body = pair_resp.json()
    worker_id = body["worker_id"]
    raw_token = body["token"]

    # verify_worker_token should return the ComputeWorker with matching id
    worker = verify_worker_token(raw_token)
    assert worker is not None, "verify_worker_token must return a ComputeWorker for a valid token"
    assert worker.id == worker_id, (
        f"Returned worker id {worker.id!r} != expected {worker_id!r}"
    )
    assert worker.company_id == owner["company_id"], (
        f"Worker company_id {worker.company_id!r} != {owner['company_id']!r}"
    )

    # Bogus token → None
    bogus = verify_worker_token("not-a-real-token")
    assert bogus is None, "verify_worker_token must return None for an unknown token"
