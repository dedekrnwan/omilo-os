"""TDD: Task 5 P3 — Skills (CRUD + skill_publish Proposal + MCP tools).

Setup: two isolated companies, each with a Chief helper.

Tests:
1. POST /v1/skills {helper_id,name,body_md} → status=draft, version=1.
2. GET /v1/skills → lists the skill (id, name, status, version, helperId, usageCount).
3. GET /v1/skills/{id} → full skill (including bodyMd).
4. GET /v1/skills/{id} cross-tenant → 404.
5. POST /v1/skills/{id}/publish → skill_publish Proposal (pending, risk=medium) +
   decision InboxItem (needs_you=True); skill stays draft.
6. Publish cross-tenant → 404.
7. Publish indexes skill body: recall("<unique_term>") returns kind="skill" chunk.
8. MCP skill_save (no skill_id) → creates draft Skill (created_by="agent").
9. MCP skill_save (with skill_id) → updates name/body_md, bumps version.
10. MCP skills_list → returns company's skills.
11. MCP skill_publish → Proposal (proposed) + ToolCall logged.
12. MCP skill_read → returns name + body_md.
13. MCP skill_read unknown id → error dict (not 500).
"""
from __future__ import annotations

import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from omilo.db import SessionLocal, set_company
from omilo.main import create_app
from omilo.models.agents import Helper
from omilo.models.approvals import Proposal
from omilo.models.base import prefixed_id
from omilo.models.inbox import InboxItem
from omilo.models.skills import Skill
from omilo.models.tenancy import Company, Member, User
from omilo.models.toolcall import ToolCall

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


class _SuperuserSession:
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


def _superuser_session():
    return _SuperuserSession()


class _TenantSession:
    def __init__(self, company_id: str):
        self._company_id = company_id

    def __enter__(self):
        self._sess = SessionLocal()
        self._txn = self._sess.begin()
        self._sess.execute(text("SET LOCAL ROLE omilo_app"))
        set_company(self._sess, self._company_id)
        return self._sess

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self._txn.rollback()
        else:
            self._txn.commit()
        self._sess.close()


def _tenant_session(company_id: str):
    return _TenantSession(company_id)


# ---------------------------------------------------------------------------
# Data factories
# ---------------------------------------------------------------------------


def _make_company(db) -> Company:
    cmp = Company(
        id=prefixed_id("cmp"),
        name=f"SkillsCo-{uuid.uuid4().hex[:6]}",
        color="#334455",
        autonomy_default="ask",
    )
    db.add(cmp)
    db.flush()
    return cmp


def _make_user_member(db, *, company_id: str) -> tuple[User, Member]:
    user = User(
        id=prefixed_id("usr"),
        email=f"skl_{uuid.uuid4().hex[:8]}@test.example",
        name="Skill User",
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


def _make_helper(db, *, company_id: str, is_chief: bool = True) -> Helper:
    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name="Chief" if is_chief else "Worker",
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


# ---------------------------------------------------------------------------
# Async helpers
# ---------------------------------------------------------------------------


async def _sign_up_in(client) -> tuple[str, str]:
    """Sign up + /me; return (access_token, company_id)."""
    email = f"skl_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Skill User", "password": "testP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    company_id = me.json()["company"]["id"]
    return token, company_id


async def _get_token_for_company(client, company_id: str) -> str:
    """Sign up fresh user, add Member for company_id, return token."""
    email = f"skl_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Skill Member", "password": "testP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200, me_resp.text
    user_id = me_resp.json()["user"]["id"]
    with _superuser_session() as su:
        member = Member(
            id=prefixed_id("mem"),
            company_id=company_id,
            user_id=user_id,
            role="owner",
        )
        su.add(member)
    return token


async def _mint_token(client, helper_id: str, auth_token: str) -> str:
    resp = await client.post(
        f"/v1/helpers/{helper_id}/mcp-token",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _rpc_payload(method: str, params: dict) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": method, "arguments": params},
    }


# ---------------------------------------------------------------------------
# Fixtures: two isolated tenants
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def tenant_a():
    """Company A + a Chief helper."""
    with _superuser_session() as su:
        cmp = _make_company(su)
        company_id = cmp.id
    with _tenant_session(company_id) as db:
        helper = _make_helper(db, company_id=company_id, is_chief=True)
        helper_id = helper.id
    return company_id, helper_id


@pytest.fixture(scope="module")
def tenant_b():
    """Company B + a Chief helper."""
    with _superuser_session() as su:
        cmp = _make_company(su)
        company_id = cmp.id
    with _tenant_session(company_id) as db:
        helper = _make_helper(db, company_id=company_id, is_chief=True)
        helper_id = helper.id
    return company_id, helper_id


@pytest_asyncio.fixture
async def async_client():
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client


# ---------------------------------------------------------------------------
# Task 1: REST Skill CRUD
# ---------------------------------------------------------------------------


class TestSkillCRUD:
    @pytest.mark.asyncio
    async def test_create_skill_returns_draft(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        resp = await async_client.post(
            "/v1/skills",
            json={"helper_id": helper_id, "name": "My Skill", "body_md": "## Steps\n- do X"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "draft"
        assert body["version"] == 1
        assert body["name"] == "My Skill"
        assert body["helperId"] == helper_id
        assert body["id"].startswith("skl_")

    @pytest.mark.asyncio
    async def test_list_skills(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        # Create a skill to list
        await async_client.post(
            "/v1/skills",
            json={"helper_id": helper_id, "name": "Listed Skill", "body_md": "list body"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        resp = await async_client.get(
            "/v1/skills",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        skills = resp.json()
        assert isinstance(skills, list)
        assert any(s["name"] == "Listed Skill" for s in skills)

    @pytest.mark.asyncio
    async def test_get_skill_by_id(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        cr = await async_client.post(
            "/v1/skills",
            json={"helper_id": helper_id, "name": "Fetch Me", "body_md": "fetch body"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        skill_id = cr.json()["id"]
        resp = await async_client.get(
            f"/v1/skills/{skill_id}",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == skill_id
        assert resp.json()["bodyMd"] == "fetch body"

    @pytest.mark.asyncio
    async def test_get_skill_other_tenant_404(self, async_client, tenant_a, tenant_b):
        company_a, helper_a = tenant_a
        company_b, _ = tenant_b
        token_a = await _get_token_for_company(async_client, company_a)
        token_b = await _get_token_for_company(async_client, company_b)
        cr = await async_client.post(
            "/v1/skills",
            json={"helper_id": helper_a, "name": "Secret Skill", "body_md": "secret"},
            headers={"Authorization": f"Bearer {token_a}", "X-Company-Id": company_a},
        )
        skill_id = cr.json()["id"]
        resp = await async_client.get(
            f"/v1/skills/{skill_id}",
            headers={"Authorization": f"Bearer {token_b}", "X-Company-Id": company_b},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Task 2: skill_publish endpoint
# ---------------------------------------------------------------------------


class TestSkillPublish:
    @pytest.mark.asyncio
    async def test_publish_creates_proposal_and_inbox_item(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        cr = await async_client.post(
            "/v1/skills",
            json={"helper_id": helper_id, "name": "Pub Skill", "body_md": "## Publish Me\n- step"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        skill_id = cr.json()["id"]
        resp = await async_client.post(
            f"/v1/skills/{skill_id}/publish",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        proposal = resp.json()
        assert proposal["type"] == "skill_publish"
        assert proposal["status"] == "pending"
        assert proposal["risk"] == "medium"
        assert "Pub Skill" in proposal["title"]

        # Skill stays draft
        skill_resp = await async_client.get(
            f"/v1/skills/{skill_id}",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert skill_resp.json()["status"] == "draft"

        # InboxItem with kind=decision exists
        with _tenant_session(company_id) as db:
            p = db.query(Proposal).filter_by(id=proposal["id"]).first()
            assert p is not None
            inb = db.query(InboxItem).filter_by(kind="decision", status="pending").filter(
                InboxItem.title == proposal["title"]
            ).first()
            assert inb is not None
            assert inb.needs_you is True

    @pytest.mark.asyncio
    async def test_publish_skill_body_kb_indexed(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        unique_term = f"xyzplumbus{uuid.uuid4().hex[:6]}"
        cr = await async_client.post(
            "/v1/skills",
            json={
                "helper_id": helper_id,
                "name": "KB Skill",
                "body_md": f"## How to {unique_term}\n- do it well",
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        skill_id = cr.json()["id"]
        await async_client.post(
            f"/v1/skills/{skill_id}/publish",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        with _tenant_session(company_id) as db:
            from omilo.kb.retrieve import recall
            results = recall(db, unique_term)
        assert len(results) > 0
        kinds = [r.get("kind") for r in results]
        assert "skill" in kinds

    @pytest.mark.asyncio
    async def test_publish_cross_tenant_404(self, async_client, tenant_a, tenant_b):
        company_a, helper_a = tenant_a
        company_b, _ = tenant_b
        token_a = await _get_token_for_company(async_client, company_a)
        token_b = await _get_token_for_company(async_client, company_b)
        cr = await async_client.post(
            "/v1/skills",
            json={"helper_id": helper_a, "name": "A Skill", "body_md": "a body"},
            headers={"Authorization": f"Bearer {token_a}", "X-Company-Id": company_a},
        )
        skill_id = cr.json()["id"]
        resp = await async_client.post(
            f"/v1/skills/{skill_id}/publish",
            headers={"Authorization": f"Bearer {token_b}", "X-Company-Id": company_b},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Task 3: MCP skill tools
# ---------------------------------------------------------------------------


def _make_helper_db(company_id: str, *, is_chief: bool = True) -> str:
    with _superuser_session() as db:
        helper = Helper(
            id=prefixed_id("hlp"),
            company_id=company_id,
            name="Chief" if is_chief else "Worker",
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
        return helper.id


class TestMcpSkillTools:
    @pytest.mark.asyncio
    async def test_skill_save_creates_draft(self, async_client):
        auth_token, company_id = await _sign_up_in(async_client)
        helper_id = _make_helper_db(company_id, is_chief=True)
        mcp_token = await _mint_token(async_client, helper_id, auth_token)
        resp = await async_client.post(
            "/v1/mcp",
            json=_rpc_payload("skill_save", {"name": "MCP Skill", "body_md": "mcp body"}),
            headers={"Authorization": f"Bearer {mcp_token}"},
        )
        assert resp.status_code == 200, resp.text
        result = resp.json()["result"]
        assert "skill_id" in result, resp.json()
        # Verify in DB
        with _tenant_session(company_id) as db:
            skill = db.get(Skill, result["skill_id"])
            assert skill is not None
            assert skill.status == "draft"
            assert skill.created_by == "agent"
            assert skill.version == 1

    @pytest.mark.asyncio
    async def test_skill_save_update_existing(self, async_client):
        auth_token, company_id = await _sign_up_in(async_client)
        helper_id = _make_helper_db(company_id, is_chief=True)
        mcp_token = await _mint_token(async_client, helper_id, auth_token)
        # Create
        r1 = await async_client.post(
            "/v1/mcp",
            json=_rpc_payload("skill_save", {"name": "Old Name", "body_md": "old body"}),
            headers={"Authorization": f"Bearer {mcp_token}"},
        )
        skill_id = r1.json()["result"]["skill_id"]
        # Update
        r2 = await async_client.post(
            "/v1/mcp",
            json=_rpc_payload(
                "skill_save",
                {"name": "New Name", "body_md": "new body", "skill_id": skill_id},
            ),
            headers={"Authorization": f"Bearer {mcp_token}"},
        )
        assert r2.json()["result"]["skill_id"] == skill_id
        with _tenant_session(company_id) as db:
            skill = db.get(Skill, skill_id)
            assert skill.name == "New Name"
            assert skill.body_md == "new body"
            assert skill.version == 2

    @pytest.mark.asyncio
    async def test_skills_list_via_mcp(self, async_client):
        auth_token, company_id = await _sign_up_in(async_client)
        helper_id = _make_helper_db(company_id, is_chief=True)
        mcp_token = await _mint_token(async_client, helper_id, auth_token)
        await async_client.post(
            "/v1/mcp",
            json=_rpc_payload("skill_save", {"name": "Listed MCP Skill", "body_md": "b"}),
            headers={"Authorization": f"Bearer {mcp_token}"},
        )
        resp = await async_client.post(
            "/v1/mcp",
            json=_rpc_payload("skills_list", {}),
            headers={"Authorization": f"Bearer {mcp_token}"},
        )
        assert resp.status_code == 200, resp.text
        skills = resp.json()["result"]
        assert isinstance(skills, list)
        assert any(s["name"] == "Listed MCP Skill" for s in skills)

    @pytest.mark.asyncio
    async def test_skill_publish_via_mcp_creates_proposal_and_toolcall(self, async_client):
        auth_token, company_id = await _sign_up_in(async_client)
        helper_id = _make_helper_db(company_id, is_chief=True)
        mcp_token = await _mint_token(async_client, helper_id, auth_token)
        r1 = await async_client.post(
            "/v1/mcp",
            json=_rpc_payload("skill_save", {"name": "Pub MCP Skill", "body_md": "publish me"}),
            headers={"Authorization": f"Bearer {mcp_token}"},
        )
        skill_id = r1.json()["result"]["skill_id"]
        resp = await async_client.post(
            "/v1/mcp",
            json=_rpc_payload("skill_publish", {"skill_id": skill_id}),
            headers={"Authorization": f"Bearer {mcp_token}"},
        )
        assert resp.status_code == 200, resp.text
        result = resp.json()["result"]
        assert result.get("status") == "proposed" or "proposal_id" in result, result
        # ToolCall logged
        with _tenant_session(company_id) as db:
            tc = db.query(ToolCall).filter_by(tool="skill_publish").first()
            assert tc is not None

    @pytest.mark.asyncio
    async def test_skill_read_via_mcp(self, async_client):
        auth_token, company_id = await _sign_up_in(async_client)
        helper_id = _make_helper_db(company_id, is_chief=True)
        mcp_token = await _mint_token(async_client, helper_id, auth_token)
        r1 = await async_client.post(
            "/v1/mcp",
            json=_rpc_payload("skill_save", {"name": "Readable Skill", "body_md": "read this"}),
            headers={"Authorization": f"Bearer {mcp_token}"},
        )
        skill_id = r1.json()["result"]["skill_id"]
        resp = await async_client.post(
            "/v1/mcp",
            json=_rpc_payload("skill_read", {"skill_id": skill_id}),
            headers={"Authorization": f"Bearer {mcp_token}"},
        )
        assert resp.status_code == 200, resp.text
        result = resp.json()["result"]
        assert result["body_md"] == "read this"
        assert result["name"] == "Readable Skill"

    @pytest.mark.asyncio
    async def test_skill_read_unknown_returns_error(self, async_client):
        auth_token, company_id = await _sign_up_in(async_client)
        helper_id = _make_helper_db(company_id, is_chief=True)
        mcp_token = await _mint_token(async_client, helper_id, auth_token)
        resp = await async_client.post(
            "/v1/mcp",
            json=_rpc_payload("skill_read", {"skill_id": "skl_doesnotexist"}),
            headers={"Authorization": f"Bearer {mcp_token}"},
        )
        assert resp.status_code == 200  # MCP returns result, not HTTP error
        result = resp.json()["result"]
        assert result.get("status") == "error" or "not found" in str(result).lower()

    @pytest.mark.asyncio
    async def test_skill_save_cross_helper_cannot_overwrite(self, async_client):
        """Helper B in the same company must NOT be able to overwrite Helper A's skill."""
        # Set up: one company, two helpers
        auth_token_a, company_id = await _sign_up_in(async_client)
        helper_a_id = _make_helper_db(company_id, is_chief=True)
        mcp_token_a = await _mint_token(async_client, helper_a_id, auth_token_a)

        # Helper B uses a separate auth token but shares the same company.
        # Must pass X-Company-Id so get_context resolves to the shared company.
        auth_token_b = await _get_token_for_company(async_client, company_id)
        helper_b_id = _make_helper_db(company_id, is_chief=False)
        resp_b_token = await async_client.post(
            f"/v1/helpers/{helper_b_id}/mcp-token",
            headers={
                "Authorization": f"Bearer {auth_token_b}",
                "X-Company-Id": company_id,
            },
        )
        assert resp_b_token.status_code == 200, resp_b_token.text
        mcp_token_b = resp_b_token.json()["token"]

        # Helper A creates a skill
        r1 = await async_client.post(
            "/v1/mcp",
            json=_rpc_payload("skill_save", {"name": "A's Skill", "body_md": "original body"}),
            headers={"Authorization": f"Bearer {mcp_token_a}"},
        )
        assert r1.status_code == 200, r1.text
        skill_a_id = r1.json()["result"]["skill_id"]

        # Helper B attempts to overwrite Helper A's skill via skill_save with skill_id
        r2 = await async_client.post(
            "/v1/mcp",
            json=_rpc_payload(
                "skill_save",
                {"skill_id": skill_a_id, "name": "hacked", "body_md": "x"},
            ),
            headers={"Authorization": f"Bearer {mcp_token_b}"},
        )
        assert r2.status_code == 200, r2.text
        result = r2.json()["result"]
        # Must return an error (not a skill_id)
        assert result.get("status") == "error", (
            f"Expected error status, got: {result}"
        )

        # Verify A's skill is unchanged in the DB
        with _tenant_session(company_id) as db:
            skill = db.get(Skill, skill_a_id)
            assert skill is not None
            assert skill.name == "A's Skill", f"Name was overwritten to: {skill.name!r}"
            assert skill.body_md == "original body", f"Body was overwritten to: {skill.body_md!r}"
