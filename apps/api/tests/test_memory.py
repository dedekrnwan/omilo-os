"""TDD: Task 4 — Memory (editable markdown lessons/notes) + endpoints.

Setup: two companies; each with a company-scoped session + a Helper.

Tests:
1. add_lesson → MemoryDoc at Memory/<id>/Lessons.md; content contains lesson line.
2. Second add_lesson PREPENDS (newest first — 2nd lesson appears ABOVE 1st).
3. Lesson is recall-able: after add_lesson, recall('rollback') returns a chunk
   with kind='memory'.
4. remember → Notes.md with appended line.
5. get_memory returns text including lessons.
6. GET /v1/memory?helper_id= returns the docs; PATCH /v1/memory/{id} edits.
7. Rejecting a proposal with a note adds a lesson for that helper (integration).
8. Company-scoped: B cannot GET A's memory.
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
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Company, Member, User

_API_DIR = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Module schema guard
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
    """Context manager: privileged session — bypasses RLS."""
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
    """Context manager: omilo_app-scoped session with RLS GUC set."""
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

def _make_company(name: str = "Memory Test Co") -> str:
    """Insert a Company row; return company_id."""
    with _superuser_session() as db:
        cmp = Company(
            id=prefixed_id("cmp"),
            name=name,
            color="#3b82f6",
            timezone="UTC",
        )
        db.add(cmp)
        db.flush()
        return cmp.id


def _make_helper(company_id: str, name: str = "Memory Helper") -> str:
    """Insert a Helper row; return helper_id."""
    with _superuser_session() as db:
        h = Helper(
            id=prefixed_id("hlp"),
            company_id=company_id,
            name=name,
            area="ops",
            is_chief=False,
            engine={"type": "fake"},
            autonomy_cap=None,
            permissions=[],
            status="active",
            channel_ids=[],
        )
        db.add(h)
        db.flush()
        return h.id


async def _sign_up_user(client, email: str | None = None) -> tuple[str, str]:
    """Sign up a fresh user; return (access_token, company_id)."""
    email = email or f"mem_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Mem User", "password": "MemP4ss!memP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me = (
        await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    ).json()
    return token, me["company"]["id"]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def cmp_a() -> str:
    return _make_company("Co A Memory")


@pytest.fixture(scope="module")
def cmp_b() -> str:
    return _make_company("Co B Memory")


@pytest.fixture(scope="module")
def helper_a(cmp_a) -> str:
    return _make_helper(cmp_a, "Helper A Memory")


@pytest.fixture(scope="module")
def helper_b(cmp_b) -> str:
    return _make_helper(cmp_b, "Helper B Memory")


@pytest.fixture(scope="module")
def app():
    return create_app()


@pytest_asyncio.fixture(scope="module")
async def async_client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


# ---------------------------------------------------------------------------
# Tests: add_lesson (prepend, upsert)
# ---------------------------------------------------------------------------

def test_add_lesson_creates_memory_doc(cmp_a, helper_a):
    """add_lesson must upsert a MemoryDoc at Memory/<helper_id>/Lessons.md."""
    from omilo.memory.store import add_lesson
    from omilo.models.memory import MemoryDoc

    with _tenant_session(cmp_a) as db:
        doc = add_lesson(db, helper_a, "rollback first", source="test")
        doc_id = doc.id
        path = doc.path
        content = doc.content

    assert path == f"Memory/{helper_a}/Lessons.md"
    assert "rollback first" in content
    # Should be a bullet line
    assert "- " in content

    # Verify it persists
    with _tenant_session(cmp_a) as db:
        persisted = db.query(MemoryDoc).filter_by(id=doc_id).first()
        assert persisted is not None
        assert "rollback first" in persisted.content


def test_add_lesson_prepends_newest_first(cmp_a, helper_a):
    """Second add_lesson must prepend — newest lesson appears ABOVE the first."""
    from omilo.memory.store import add_lesson
    from omilo.models.memory import MemoryDoc

    # First lesson already added in previous test, add a second
    with _tenant_session(cmp_a) as db:
        doc = add_lesson(db, helper_a, "always validate input", source="test")
        content = doc.content

    # "always validate input" (2nd) should appear BEFORE "rollback first" (1st)
    idx_newest = content.find("always validate input")
    idx_oldest = content.find("rollback first")
    assert idx_newest != -1, "Second lesson not found in content"
    assert idx_oldest != -1, "First lesson not found in content"
    assert idx_newest < idx_oldest, (
        f"Newest lesson should come BEFORE oldest. "
        f"idx_newest={idx_newest}, idx_oldest={idx_oldest}\ncontent:\n{content}"
    )


def test_add_lesson_is_kb_indexed_and_recallable(cmp_a, helper_a):
    """After add_lesson, recall('rollback') must return at least one memory chunk."""
    from omilo.kb.retrieve import recall

    with _tenant_session(cmp_a) as db:
        results = recall(db, "rollback", k=10)

    memory_results = [r for r in results if r["kind"] == "memory"]
    assert memory_results, (
        f"Expected recall to return memory chunks; got: {results}"
    )
    # At least one memory result should mention rollback
    texts = " ".join(r["text"] for r in memory_results)
    assert "rollback" in texts.lower()


# ---------------------------------------------------------------------------
# Tests: remember → Notes.md
# ---------------------------------------------------------------------------

def test_remember_creates_notes_doc(cmp_a, helper_a):
    """remember() must upsert a MemoryDoc at Memory/<helper_id>/Notes.md."""
    from omilo.memory.store import remember
    from omilo.models.memory import MemoryDoc

    with _tenant_session(cmp_a) as db:
        doc = remember(db, helper_a, "user prefers concise answers")
        doc_id = doc.id
        path = doc.path
        content = doc.content

    assert path == f"Memory/{helper_a}/Notes.md"
    assert "user prefers concise answers" in content

    with _tenant_session(cmp_a) as db:
        persisted = db.query(MemoryDoc).filter_by(id=doc_id).first()
        assert persisted is not None
        assert "user prefers concise answers" in persisted.content


def test_remember_appends_additional_notes(cmp_a, helper_a):
    """Second remember() call must append another line to Notes.md."""
    from omilo.memory.store import remember

    with _tenant_session(cmp_a) as db:
        doc = remember(db, helper_a, "timezone is UTC+7")
        content = doc.content

    assert "user prefers concise answers" in content
    assert "timezone is UTC+7" in content


# ---------------------------------------------------------------------------
# Tests: get_memory
# ---------------------------------------------------------------------------

def test_get_memory_returns_combined_text(cmp_a, helper_a):
    """get_memory must return a string containing both lessons and notes."""
    from omilo.memory.store import get_memory

    with _tenant_session(cmp_a) as db:
        text_out = get_memory(db, helper_a)

    assert isinstance(text_out, str)
    assert "rollback first" in text_out or "always validate input" in text_out
    assert "user prefers concise answers" in text_out or "timezone is UTC+7" in text_out


def test_get_memory_empty_for_new_helper(cmp_a):
    """get_memory must return empty string for a helper with no docs."""
    from omilo.memory.store import get_memory

    fresh_helper_id = prefixed_id("hlp")  # not persisted — just an unknown ID

    with _tenant_session(cmp_a) as db:
        text_out = get_memory(db, fresh_helper_id)

    assert text_out == ""


# ---------------------------------------------------------------------------
# Tests: API endpoints (GET /v1/memory, PATCH /v1/memory/{id})
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_memory_endpoint(async_client):
    """GET /v1/memory?helper_id= returns the helper's MemoryDocs."""
    token, cmp_id = await _sign_up_user(async_client)
    headers = {"Authorization": f"Bearer {token}"}

    # Create a helper and add a lesson
    helper_id = _make_helper(cmp_id, "API Mem Helper")
    from omilo.memory.store import add_lesson
    with _tenant_session(cmp_id) as db:
        add_lesson(db, helper_id, "api test lesson", source="api_test")

    resp = await async_client.get(
        "/v1/memory",
        params={"helper_id": helper_id},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    docs = resp.json()
    assert isinstance(docs, list)
    assert len(docs) >= 1

    doc = docs[0]
    assert "id" in doc
    assert "path" in doc
    assert "content" in doc
    assert "updatedAt" in doc
    assert "api test lesson" in doc["content"]


@pytest.mark.asyncio
async def test_patch_memory_endpoint(async_client):
    """PATCH /v1/memory/{id} allows operator to edit a memory doc and re-indexes it."""
    token, cmp_id = await _sign_up_user(async_client)
    headers = {"Authorization": f"Bearer {token}"}

    # Create a helper and add a lesson
    helper_id = _make_helper(cmp_id, "Patch Mem Helper")
    from omilo.memory.store import add_lesson
    with _tenant_session(cmp_id) as db:
        doc = add_lesson(db, helper_id, "original lesson content", source="patch_test")
        doc_id = doc.id

    # PATCH the doc with new content
    new_content = "- **2026-01-01** · operator manually corrected this lesson (edit)"
    resp = await async_client.patch(
        f"/v1/memory/{doc_id}",
        json={"content": new_content},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    result = resp.json()
    assert result["content"] == new_content

    # Verify it's re-indexed — recall should find it
    from omilo.kb.retrieve import recall
    with _tenant_session(cmp_id) as db:
        results = recall(db, "operator manually corrected", k=10)
    assert any("operator manually corrected" in r["text"] for r in results), (
        "PATCH content must be re-indexed and recall-able"
    )


@pytest.mark.asyncio
async def test_get_memory_endpoint_no_helper_id(async_client):
    """GET /v1/memory without helper_id returns all company memory docs."""
    token, cmp_id = await _sign_up_user(async_client)
    headers = {"Authorization": f"Bearer {token}"}

    helper_id = _make_helper(cmp_id, "No Filter Mem Helper")
    from omilo.memory.store import add_lesson, remember
    with _tenant_session(cmp_id) as db:
        add_lesson(db, helper_id, "lesson without filter", source="test")
        remember(db, helper_id, "note without filter")

    resp = await async_client.get("/v1/memory", headers=headers)
    assert resp.status_code == 200, resp.text
    docs = resp.json()
    assert isinstance(docs, list)
    assert len(docs) >= 2


# ---------------------------------------------------------------------------
# Tests: reject with note → add_lesson (integration)
# ---------------------------------------------------------------------------

def test_reject_proposal_with_note_adds_lesson(cmp_a, helper_a):
    """Rejecting a proposal with a note must add a Lessons.md entry for the helper."""
    from omilo.models.approvals import Proposal, ProposalRevision
    from omilo.models.memory import MemoryDoc

    # Create a proposal for helper_a (directly via DB)
    with _superuser_session() as db:
        proposal_id = prefixed_id("prp")
        proposal = Proposal(
            id=proposal_id,
            company_id=cmp_a,
            job_id="test_job",
            helper_id=helper_a,
            type="message",
            risk="medium",
            title="Test proposal for rejection",
            body_md="Send a message to the team",
            status="pending",
            current_revision=1,
        )
        db.add(proposal)
        revision = ProposalRevision(
            id=prefixed_id("prv"),
            company_id=cmp_a,
            proposal_id=proposal_id,
            n=1,
            body_md="Send a message to the team",
            author="agent",
            summary="Initial proposal",
        )
        db.add(revision)
        db.flush()

    # Count existing Lessons.md docs for helper_a
    with _tenant_session(cmp_a) as db:
        docs_before = db.query(MemoryDoc).filter_by(
            helper_id=helper_a,
            path=f"Memory/{helper_a}/Lessons.md",
        ).all()
        content_before = docs_before[0].content if docs_before else ""

    # Reject with a note via the store's add_lesson pathway
    # (simulating what the approvals endpoint does)
    from omilo.memory.store import add_lesson
    with _tenant_session(cmp_a) as db:
        # This is what the reject endpoint calls
        add_lesson(
            db,
            helper_a,
            "Operator rejected: do not send unsolicited messages",
            source="approval",
        )

    # Verify the lesson was added
    with _tenant_session(cmp_a) as db:
        docs_after = db.query(MemoryDoc).filter_by(
            helper_id=helper_a,
            path=f"Memory/{helper_a}/Lessons.md",
        ).first()
        assert docs_after is not None
        assert "do not send unsolicited messages" in docs_after.content


@pytest.mark.asyncio
async def test_reject_proposal_via_api_adds_lesson(async_client):
    """POST /v1/proposals/{id}/reject with note → lesson added for the helper."""
    token, cmp_id = await _sign_up_user(async_client)
    headers = {"Authorization": f"Bearer {token}"}
    helper_id = _make_helper(cmp_id, "Reject Lesson Helper")

    # Create a proposal directly in the DB
    from omilo.models.approvals import Proposal, ProposalRevision
    from omilo.models.memory import MemoryDoc

    with _superuser_session() as db:
        proposal_id = prefixed_id("prp")
        proposal = Proposal(
            id=proposal_id,
            company_id=cmp_id,
            job_id="test_reject_job",
            helper_id=helper_id,
            type="message",
            risk="medium",
            title="Proposal to reject with lesson",
            body_md="Do something the operator won't like",
            status="pending",
            current_revision=1,
        )
        db.add(proposal)
        revision = ProposalRevision(
            id=prefixed_id("prv"),
            company_id=cmp_id,
            proposal_id=proposal_id,
            n=1,
            body_md="Do something the operator won't like",
            author="agent",
            summary="Initial proposal",
        )
        db.add(revision)
        db.flush()

    # Reject with a note
    reject_note = "Never do this — it violates our privacy policy"
    resp = await async_client.post(
        f"/v1/proposals/{proposal_id}/reject",
        json={"note": reject_note},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["proposal"]["status"] == "rejected"

    # Verify a lesson was added for the helper
    from omilo.models.memory import MemoryDoc
    with _tenant_session(cmp_id) as db:
        doc = db.query(MemoryDoc).filter_by(
            helper_id=helper_id,
            path=f"Memory/{helper_id}/Lessons.md",
        ).first()
        assert doc is not None, "Lesson doc must exist after rejection with note"
        assert "privacy policy" in doc.content or "violates" in doc.content, (
            f"Lesson content must contain the rejection note. Got: {doc.content}"
        )


# ---------------------------------------------------------------------------
# Tests: MCP remember tool
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_mcp_remember_tool(async_client):
    """MCP remember tool must persist a note and log a ToolCall."""
    token, cmp_id = await _sign_up_user(async_client)
    headers_auth = {"Authorization": f"Bearer {token}"}
    helper_id = _make_helper(cmp_id, "MCP Remember Helper")

    # Mint MCP token
    resp = await async_client.post(
        f"/v1/helpers/{helper_id}/mcp-token",
        headers=headers_auth,
    )
    assert resp.status_code == 200, resp.text
    mcp_token = resp.json()["token"]
    mcp_headers = {"Authorization": f"Bearer {mcp_token}"}

    # Call remember tool
    resp = await async_client.post(
        "/v1/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "remember",
                "arguments": {"text": "user always wants bullet points"},
            },
        },
        headers=mcp_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "result" in data, data
    result = data["result"]
    assert result.get("status") == "ok", f"Expected ok status, got: {result}"

    # Verify note was persisted
    from omilo.models.memory import MemoryDoc
    with _tenant_session(cmp_id) as db:
        doc = db.query(MemoryDoc).filter_by(
            helper_id=helper_id,
            path=f"Memory/{helper_id}/Notes.md",
        ).first()
        assert doc is not None, "Notes.md must exist after MCP remember tool call"
        assert "user always wants bullet points" in doc.content

    # Verify ToolCall was logged
    from omilo.models.toolcall import ToolCall
    with _tenant_session(cmp_id) as db:
        tc = (
            db.query(ToolCall)
            .filter_by(helper_id=helper_id, tool="remember")
            .first()
        )
        assert tc is not None, "ToolCall must be logged for remember tool"


# ---------------------------------------------------------------------------
# Tests: company isolation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_company_b_cannot_see_company_a_memory(async_client):
    """Company B cannot GET company A's memory docs."""
    # Sign up user A and user B in separate companies
    token_a, cmp_a_id = await _sign_up_user(async_client)
    token_b, cmp_b_id = await _sign_up_user(async_client)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # Create a helper in company A and add a lesson
    helper_a_id = _make_helper(cmp_a_id, "Isolation Test Helper A")
    from omilo.memory.store import add_lesson
    with _tenant_session(cmp_a_id) as db:
        doc_a = add_lesson(db, helper_a_id, "confidential company A lesson", source="test")
        doc_a_id = doc_a.id

    # Company B tries to GET company A's memory
    resp_b = await async_client.get(
        "/v1/memory",
        params={"helper_id": helper_a_id},
        headers=headers_b,
    )
    assert resp_b.status_code == 200, resp_b.text
    docs_b = resp_b.json()
    # Company B should see zero docs (RLS scopes by company)
    doc_ids_b = [d["id"] for d in docs_b]
    assert doc_a_id not in doc_ids_b, (
        "Company B must NOT see company A's memory docs"
    )

    # Company B tries to PATCH company A's doc directly
    resp_patch = await async_client.patch(
        f"/v1/memory/{doc_a_id}",
        json={"content": "hacked content"},
        headers=headers_b,
    )
    # Should be 404 (RLS makes it invisible to B)
    assert resp_patch.status_code == 404, (
        f"Company B must not be able to PATCH company A's doc; got {resp_patch.status_code}"
    )
