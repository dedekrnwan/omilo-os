"""TDD — P5b Task 2: mint / list / revoke endpoints for McpAccessToken.

Tests (company-scoped, async HTTP client):

1. Mint: POST /v1/mcp-access-tokens → 200 with raw `token` present,
   `token_hash` ABSENT from response; DB row's token_hash == sha256(raw token).
2. List: GET /v1/mcp-access-tokens → token appears; `token`/`token_hash` absent;
   active=True, correct scopes/helper_id.
3. Revoke: DELETE /v1/mcp-access-tokens/{id} → ok; GET shows active=False,
   revoked_at set; re-DELETE is idempotent (still ok).
4. Cross-company helper: mint with helper_id from company B → 404.
5. Company-scoped list: company B's list excludes company A's tokens.
6. Company-scoped delete: company B DELETE of company A's token id → 404.
7. Role guard: non-owner/admin mint → 403; owner → ok.

RED → implement → GREEN.
"""
from __future__ import annotations

import hashlib
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.mcp_token import McpAccessToken
from omilo.models.tenancy import Company, Member, User
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
    class _T:
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

    return _T()


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, name="MCT Tester", password="testP4ss!"):
    email = f"mct_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    token = body["session"]["access"]
    # Resolve company_id from /me (sign-up response doesn't always embed company)
    me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]
    return token, company_id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_helper_db(company_id: str) -> str:
    with _superuser_session() as db:
        hlp = Helper(
            id=prefixed_id("hlp"),
            company_id=company_id,
            name="MCT Test Helper",
            area="ops",
            engine={},
            permissions=[],
            channel_ids=[],
        )
        db.add(hlp)
        db.flush()
        return hlp.id


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def company_a(async_client):
    """Company A: signed-up owner + a helper."""
    token, company_id = await _sign_up(async_client, name="MCT Owner A")
    helper_id = _make_helper_db(company_id)
    return {"token": token, "company_id": company_id, "helper_id": helper_id}


@pytest_asyncio.fixture
async def company_b(async_client):
    """Company B: signed-up owner + a helper."""
    token, company_id = await _sign_up(async_client, name="MCT Owner B")
    helper_id = _make_helper_db(company_id)
    return {"token": token, "company_id": company_id, "helper_id": helper_id}


# ---------------------------------------------------------------------------
# Test 1: Mint — raw token returned once, token_hash stored, token_hash absent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mint_returns_raw_token_once_and_stores_hash(async_client, company_a):
    """POST mint → 200 with `token` (raw, non-empty); `token_hash` absent;
    DB row's token_hash == sha256(token)."""
    resp = await async_client.post(
        "/v1/mcp-access-tokens",
        json={
            "label": "Claude Desktop",
            "helper_id": company_a["helper_id"],
            "scopes": ["goals"],
        },
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # raw token present, non-empty
    assert "token" in body, "Response must contain 'token'"
    raw_token = body["token"]
    assert raw_token, "Raw token must be non-empty"

    # token_hash must NOT be in response
    assert "token_hash" not in body, "Response must NOT expose 'token_hash'"

    # Other fields present
    assert "id" in body
    assert body["label"] == "Claude Desktop"
    assert body["helper_id"] == company_a["helper_id"]
    assert body["scopes"] == ["goals"]
    assert "created_at" in body

    # DB row: token_hash == sha256(raw_token)
    token_id = body["id"]
    expected_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    with _tenant_session(company_a["company_id"]) as db:
        row = db.get(McpAccessToken, token_id)
        assert row is not None
        assert row.token_hash == expected_hash, (
            f"Stored hash {row.token_hash!r} != expected {expected_hash!r}"
        )


# ---------------------------------------------------------------------------
# Test 2: List — secret absent, active=True, correct fields
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_excludes_secret_shows_active(async_client, company_a):
    """GET list → token appears without token/token_hash, active=True."""
    # Mint one
    mint_resp = await async_client.post(
        "/v1/mcp-access-tokens",
        json={
            "label": "Test List Token",
            "helper_id": company_a["helper_id"],
            "scopes": ["goals", "docs"],
        },
        headers=_auth(company_a["token"]),
    )
    assert mint_resp.status_code == 200, mint_resp.text
    token_id = mint_resp.json()["id"]

    list_resp = await async_client.get(
        "/v1/mcp-access-tokens",
        headers=_auth(company_a["token"]),
    )
    assert list_resp.status_code == 200, list_resp.text
    items = list_resp.json()
    assert isinstance(items, list)

    # Find our minted token
    found = next((t for t in items if t["id"] == token_id), None)
    assert found is not None, f"Token {token_id} not found in list"

    # Secret absent
    assert "token" not in found, "GET list must NOT expose raw token"
    assert "token_hash" not in found, "GET list must NOT expose token_hash"

    # Required fields
    assert found["label"] == "Test List Token"
    assert found["helper_id"] == company_a["helper_id"]
    assert found["scopes"] == ["goals", "docs"]
    assert found["active"] is True
    assert "created_at" in found
    assert "expires_at" in found
    assert "last_used_at" in found
    assert "revoked_at" in found


# ---------------------------------------------------------------------------
# Test 3: Revoke — soft revoke, idempotent re-delete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_soft_revoke_and_idempotent(async_client, company_a):
    """DELETE sets revoked_at; GET shows active=False; re-DELETE still ok."""
    # Mint
    mint_resp = await async_client.post(
        "/v1/mcp-access-tokens",
        json={
            "label": "To Revoke",
            "helper_id": company_a["helper_id"],
            "scopes": [],
        },
        headers=_auth(company_a["token"]),
    )
    assert mint_resp.status_code == 200, mint_resp.text
    token_id = mint_resp.json()["id"]

    # DELETE
    del_resp = await async_client.delete(
        f"/v1/mcp-access-tokens/{token_id}",
        headers=_auth(company_a["token"]),
    )
    assert del_resp.status_code in (200, 204), del_resp.text

    # GET list → active=False, revoked_at set
    list_resp = await async_client.get(
        "/v1/mcp-access-tokens",
        headers=_auth(company_a["token"]),
    )
    items = list_resp.json()
    found = next((t for t in items if t["id"] == token_id), None)
    assert found is not None
    assert found["active"] is False
    assert found["revoked_at"] is not None

    # Idempotent re-DELETE
    del_resp2 = await async_client.delete(
        f"/v1/mcp-access-tokens/{token_id}",
        headers=_auth(company_a["token"]),
    )
    assert del_resp2.status_code in (200, 204), del_resp2.text


# ---------------------------------------------------------------------------
# Test 4: Cross-company helper → 404 on mint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mint_cross_company_helper_404(async_client, company_a, company_b):
    """Minting with a helper from company B under company A's auth → 404."""
    # Company A tries to use Company B's helper_id
    resp = await async_client.post(
        "/v1/mcp-access-tokens",
        json={
            "label": "Should Fail",
            "helper_id": company_b["helper_id"],
            "scopes": [],
        },
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 404, (
        f"Expected 404 for cross-company helper, got {resp.status_code}: {resp.text}"
    )


# ---------------------------------------------------------------------------
# Test 5: Company-scoped list — B cannot see A's tokens
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_company_scoped(async_client, company_a, company_b):
    """Company B's GET /v1/mcp-access-tokens must not include company A's tokens."""
    # Mint under company A
    mint_resp = await async_client.post(
        "/v1/mcp-access-tokens",
        json={"label": "A-only Token", "helper_id": company_a["helper_id"], "scopes": []},
        headers=_auth(company_a["token"]),
    )
    assert mint_resp.status_code == 200, mint_resp.text
    a_token_id = mint_resp.json()["id"]

    # List under company B
    list_resp = await async_client.get(
        "/v1/mcp-access-tokens",
        headers=_auth(company_b["token"]),
    )
    assert list_resp.status_code == 200, list_resp.text
    b_ids = {t["id"] for t in list_resp.json()}

    assert a_token_id not in b_ids, (
        "Company B must NOT see company A's token"
    )


# ---------------------------------------------------------------------------
# Test 6: Company-scoped delete — B cannot delete A's token (→ 404)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_cross_company_404(async_client, company_a, company_b):
    """Company B DELETE of company A's token id → 404."""
    # Mint under company A
    mint_resp = await async_client.post(
        "/v1/mcp-access-tokens",
        json={"label": "A Token for B to fail", "helper_id": company_a["helper_id"], "scopes": []},
        headers=_auth(company_a["token"]),
    )
    assert mint_resp.status_code == 200, mint_resp.text
    a_token_id = mint_resp.json()["id"]

    # Company B tries to delete company A's token
    del_resp = await async_client.delete(
        f"/v1/mcp-access-tokens/{a_token_id}",
        headers=_auth(company_b["token"]),
    )
    assert del_resp.status_code == 404, (
        f"Expected 404 for cross-company delete, got {del_resp.status_code}: {del_resp.text}"
    )


# ---------------------------------------------------------------------------
# Test 7: Role guard — non-owner mint → 403; owner → ok
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_role_guard_mint(async_client):
    """A 'member' role cannot mint; an 'owner' can."""
    # Sign up owner
    owner_token, company_id = await _sign_up(async_client, name="RoleGuard Owner")
    helper_id = _make_helper_db(company_id)

    # Sign up a second user and add as member
    member_token, member_company_id = await _sign_up(async_client, name="RoleGuard Member")
    # Seed Member row directly with role='member'
    me_resp = await async_client.get("/v1/me", headers=_auth(member_token))
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

    # Member tries to mint → 403
    member_resp = await async_client.post(
        "/v1/mcp-access-tokens",
        json={"label": "Forbidden", "helper_id": helper_id, "scopes": []},
        headers={
            "Authorization": f"Bearer {member_token}",
            "X-Company-Id": company_id,
        },
    )
    assert member_resp.status_code == 403, (
        f"Expected 403 for member role mint, got {member_resp.status_code}: {member_resp.text}"
    )

    # Owner can mint → 200
    owner_resp = await async_client.post(
        "/v1/mcp-access-tokens",
        json={"label": "Allowed", "helper_id": helper_id, "scopes": []},
        headers=_auth(owner_token),
    )
    assert owner_resp.status_code == 200, (
        f"Expected 200 for owner mint, got {owner_resp.status_code}: {owner_resp.text}"
    )
