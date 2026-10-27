"""TDD: Task 3 — KB ingestion + hybrid recall + MCP/loop wiring.

Setup: two companies; each with a company-scoped session.

Tests:
1. index_source indexes body into KbSource + KbChunk rows with tsv + embedding.
2. recall("passkeys") → A's chunk ranks top (FTS).
3. recall with vector-similar query also retrieves A (RRF fuses both legs).
4. recall("invoice") → B's chunk ranks top.
5. Tenant isolation: company B's chunks NEVER appear in company A's recall.
6. Empty KB / empty query → [].
7. POST /v1/knowledge/sources then GET /v1/knowledge?q=passkeys → returns A.
8. MCP recall tool returns real results (not []).
9. loop runner ctx.memory is a non-empty string assembled from recall.
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
    """Context manager: privileged (superuser) session — bypasses RLS."""
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

def _make_company(name: str = "KB Test Co") -> str:
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


def _make_helper(company_id: str) -> str:
    """Insert a Helper row; return helper_id."""
    with _superuser_session() as db:
        h = Helper(
            id=prefixed_id("hlp"),
            company_id=company_id,
            name="KB Helper",
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
    email = email or f"kb_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "KB User", "password": "KbP4ss!kbP4ss!"},
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
    return _make_company("Co A KB")


@pytest.fixture(scope="module")
def cmp_b() -> str:
    return _make_company("Co B KB")


@pytest.fixture(scope="module")
def helper_a(cmp_a) -> str:
    return _make_helper(cmp_a)


@pytest.fixture(scope="module")
def source_a(cmp_a):
    """Index source A (passkeys/webauthn) into company A, return KbSource."""
    from omilo.kb.index import index_source

    with _tenant_session(cmp_a) as db:
        src = index_source(
            db,
            kind="note",
            ref="kb-test-passkeys-a",
            title="Passkeys rollout guide",
            body=(
                "# Passkeys rollout\n\n"
                "We are rolling out passkeys webauthn authentication across all "
                "production services by Q4. Each team must implement FIDO2 "
                "passkeys support with WebAuthn before the deadline.\n\n"
                "## Action items\n\n"
                "- Register authenticator factory\n"
                "- Enable webauthn in auth service\n"
                "- Deploy to staging first\n"
            ),
        )
        src_id = src.id
    return src_id


@pytest.fixture(scope="module")
def source_b(cmp_a):
    """Index source B (invoice/finance) into company A, return KbSource."""
    from omilo.kb.index import index_source

    with _tenant_session(cmp_a) as db:
        src = index_source(
            db,
            kind="note",
            ref="kb-test-invoice-b",
            title="Invoice disbursement finance SOP",
            body=(
                "# Invoice disbursement\n\n"
                "The finance team handles invoice disbursement every Tuesday. "
                "All disbursement requests must go through the finance approval "
                "workflow. Vendor invoices are processed within 5 business days.\n\n"
                "## Process\n\n"
                "- Submit invoice to finance@company.com\n"
                "- Finance approves or returns within 2 days\n"
                "- Disbursement processed on next Tuesday\n"
            ),
        )
        src_id = src.id
    return src_id


@pytest.fixture(scope="module")
def source_b_cmp_b(cmp_b):
    """Index a source in company B; used for tenant-isolation assertion."""
    from omilo.kb.index import index_source

    with _tenant_session(cmp_b) as db:
        src = index_source(
            db,
            kind="note",
            ref="kb-test-cmp-b-secret",
            title="Company B secret",
            body=(
                "# Company B confidential passkeys finance invoice\n\n"
                "This document must never appear in company A's recall results. "
                "It contains passkeys webauthn invoice finance secrets for B only."
            ),
        )
        src_id = src.id
    return src_id


# ---------------------------------------------------------------------------
# Tests: ingestion
# ---------------------------------------------------------------------------

def test_index_source_creates_kb_source_and_chunks(cmp_a, source_a):
    """index_source must produce at least one KbChunk with embedding + tsv."""
    from omilo.models.knowledge import KbChunk, KbSource

    with _tenant_session(cmp_a) as db:
        src = db.get(KbSource, source_a)
        assert src is not None, "KbSource not found"
        assert src.content_hash, "content_hash must be set"

        chunks = db.query(KbChunk).filter_by(source_id=source_a).all()
        assert len(chunks) >= 1, "At least one chunk expected"

        for c in chunks:
            assert c.embedding is not None, "embedding must be set"
            assert len(c.embedding) == 256, "embedding dim must be 256"
            assert c.tsv is not None, "tsv must be set"
            assert c.embedding_model == "hash"
            assert c.indexed_at is not None
            assert c.embedded_at is not None


def test_index_source_idempotent_same_hash(cmp_a, source_a):
    """Re-indexing with identical body must skip re-chunk (same hash)."""
    from omilo.kb.index import index_source
    from omilo.models.knowledge import KbChunk

    # Get initial chunk count
    with _tenant_session(cmp_a) as db:
        n_before = db.query(KbChunk).filter_by(source_id=source_a).count()

    # Re-index with same body
    body = (
        "# Passkeys rollout\n\n"
        "We are rolling out passkeys webauthn authentication across all "
        "production services by Q4. Each team must implement FIDO2 "
        "passkeys support with WebAuthn before the deadline.\n\n"
        "## Action items\n\n"
        "- Register authenticator factory\n"
        "- Enable webauthn in auth service\n"
        "- Deploy to staging first\n"
    )
    with _tenant_session(cmp_a) as db:
        src2 = index_source(
            db,
            kind="note",
            ref="kb-test-passkeys-a",
            title="Passkeys rollout guide",
            body=body,
        )
        n_after = db.query(KbChunk).filter_by(source_id=src2.id).count()

    assert src2.id == source_a, "Same ref should return same KbSource"
    assert n_after == n_before, "Chunk count must not change on re-index with same hash"


# ---------------------------------------------------------------------------
# Tests: recall
# ---------------------------------------------------------------------------

def test_recall_passkeys_returns_source_a_top(cmp_a, source_a, source_b):
    """recall('passkeys') must rank source A's chunk above source B's."""
    from omilo.kb.retrieve import recall

    with _tenant_session(cmp_a) as db:
        results = recall(db, "passkeys webauthn", k=8)

    assert results, "recall must return results"
    top = results[0]
    assert top["source_id"] == source_a, (
        f"Top result source_id={top['source_id']!r}, expected {source_a!r}"
    )
    assert "passkey" in top["text"].lower() or "webauthn" in top["text"].lower(), (
        "Top chunk text must mention passkeys or webauthn"
    )


def test_recall_invoice_returns_source_b_top(cmp_a, source_a, source_b):
    """recall('invoice disbursement') must rank source B's chunk top."""
    from omilo.kb.retrieve import recall

    with _tenant_session(cmp_a) as db:
        results = recall(db, "invoice disbursement finance", k=8)

    assert results, "recall must return results"
    top = results[0]
    assert top["source_id"] == source_b, (
        f"Top result source_id={top['source_id']!r}, expected {source_b!r}"
    )


def test_recall_rrf_returns_structured_dicts(cmp_a, source_a, source_b):
    """Each recall result must have source_id, heading, text, kind, score."""
    from omilo.kb.retrieve import recall

    with _tenant_session(cmp_a) as db:
        results = recall(db, "passkeys", k=8)

    assert results
    for r in results:
        assert "source_id" in r
        assert "heading" in r
        assert "text" in r
        assert "kind" in r
        assert "score" in r
        assert isinstance(r["score"], float)
        assert r["score"] > 0


def test_recall_vector_leg_retrieves_source_a(cmp_a, source_a, source_b):
    """A query using words from source A body should still retrieve A (vector + FTS fused)."""
    from omilo.kb.retrieve import recall

    # These exact words appear in source A
    with _tenant_session(cmp_a) as db:
        results = recall(db, "FIDO2 authenticator staging webauthn rollout", k=8)

    assert results
    source_ids = [r["source_id"] for r in results]
    assert source_a in source_ids, (
        f"Source A not in results: {source_ids}"
    )


def test_recall_empty_query_returns_empty(cmp_a, source_a, source_b):
    """recall('') must return []."""
    from omilo.kb.retrieve import recall

    with _tenant_session(cmp_a) as db:
        results = recall(db, "", k=8)

    assert results == [], f"Expected [] for empty query, got {results}"


def test_recall_with_kind_filter(cmp_a, source_a, source_b):
    """recall with kinds=['note'] must still find results; kinds=['web'] must return []."""
    from omilo.kb.retrieve import recall

    with _tenant_session(cmp_a) as db:
        results_note = recall(db, "passkeys", kinds=["note"], k=8)
        results_web = recall(db, "passkeys", kinds=["web"], k=8)

    assert results_note, "kind=note should return results"
    assert results_web == [], "kind=web should return [] (no web sources)"


# ---------------------------------------------------------------------------
# Tests: tenant isolation
# ---------------------------------------------------------------------------

def test_tenant_isolation_company_a_never_sees_company_b(
    cmp_a, source_a, source_b, source_b_cmp_b
):
    """Company A's recall must NEVER return company B's chunks.

    source_b_cmp_b is indexed under company B with keywords that overlap with
    cmp_a's passkeys/finance sources. company A's RLS-scoped session must not
    return any chunk belonging to cmp_b.
    """
    from omilo.kb.retrieve import recall

    # Use a query that matches both A sources AND the B-secret source keywords
    with _tenant_session(cmp_a) as db:
        results = recall(db, "passkeys webauthn invoice finance", k=20)

    source_ids = [r["source_id"] for r in results]
    # source_b_cmp_b is the KbSource.id of the company-B source
    # The chunk's source_id must not appear in A's results
    assert source_b_cmp_b not in source_ids, (
        f"Company B's source {source_b_cmp_b!r} leaked into company A's recall! "
        f"All source_ids seen: {source_ids}"
    )


def test_tenant_isolation_company_b_has_its_own_chunk(cmp_b, source_b_cmp_b):
    """Company B sees its own chunk — isolation is two-way."""
    from omilo.kb.retrieve import recall

    with _tenant_session(cmp_b) as db:
        results = recall(db, "passkeys finance invoice", k=8)

    assert results, "company B must see its own KB"
    source_ids = [r["source_id"] for r in results]
    assert source_b_cmp_b in source_ids, (
        f"Company B cannot see its own source! source_ids={source_ids}"
    )


def test_tenant_isolation_company_b_does_not_see_company_a(
    cmp_b, source_a, source_b, source_b_cmp_b
):
    """Company B's recall must not see company A's sources."""
    from omilo.kb.retrieve import recall

    with _tenant_session(cmp_b) as db:
        results = recall(db, "passkeys webauthn invoice disbursement", k=20)

    source_ids = [r["source_id"] for r in results]
    for s_id in (source_a, source_b):
        assert s_id not in source_ids, (
            f"Company A's source {s_id!r} leaked into company B's recall!"
        )


# ---------------------------------------------------------------------------
# Tests: API endpoints
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def app():
    return create_app()


@pytest_asyncio.fixture(scope="module")
async def async_client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.mark.asyncio
async def test_post_knowledge_sources_and_get_recall(async_client):
    """POST /v1/knowledge/sources then GET /v1/knowledge?q=passkeys."""
    token, _cmp = await _sign_up_user(async_client)
    headers = {"Authorization": f"Bearer {token}"}

    # POST — index a source
    resp = await async_client.post(
        "/v1/knowledge/sources",
        json={
            "kind": "note",
            "ref": f"api-test-{uuid.uuid4().hex[:8]}",
            "title": "Passkeys API test",
            "body": (
                "Passkeys webauthn rollout for the API test. "
                "Enable FIDO2 passkeys on all endpoints."
            ),
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "source_id" in body
    assert "chunks" in body
    assert body["chunks"] >= 1

    source_id = body["source_id"]

    # GET — recall
    resp = await async_client.get(
        "/v1/knowledge", params={"q": "passkeys"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    results = resp.json()
    assert isinstance(results, list)
    assert results, "recall must return results"
    source_ids = [r["source_id"] for r in results]
    assert source_id in source_ids, (
        f"Indexed source {source_id!r} not in recall results: {source_ids}"
    )


# ---------------------------------------------------------------------------
# Tests: MCP recall tool
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_mcp_recall_tool_returns_real_results(async_client):
    """MCP recall tool must return real results, not []."""
    # Sign up, get a token and company
    token, cmp_id = await _sign_up_user(async_client)
    headers_auth = {"Authorization": f"Bearer {token}"}

    # Mint an MCP token for a helper in this company
    helper_id = _make_helper(cmp_id)

    resp = await async_client.post(
        f"/v1/helpers/{helper_id}/mcp-token",
        headers=headers_auth,
    )
    assert resp.status_code == 200, resp.text
    mcp_token = resp.json()["token"]
    mcp_headers = {"Authorization": f"Bearer {mcp_token}"}

    # Index a source in this company first
    from omilo.kb.index import index_source
    with _tenant_session(cmp_id) as db:
        index_source(
            db,
            kind="note",
            ref=f"mcp-test-{uuid.uuid4().hex[:8]}",
            title="MCP recall test",
            body=(
                "Passkeys webauthn MCP test document. "
                "FIDO2 authentication enables passwordless login."
            ),
        )

    # Call recall tool via MCP
    resp = await async_client.post(
        "/v1/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": "recall",
                "arguments": {"query": "passkeys webauthn"},
            },
        },
        headers=mcp_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "result" in data, data
    result = data["result"]
    assert isinstance(result, list), f"recall must return a list, got {result!r}"
    assert len(result) > 0, "MCP recall must return real results, not []"


# ---------------------------------------------------------------------------
# Tests: loop runner ctx.memory
# ---------------------------------------------------------------------------

def test_loop_runner_ctx_memory_assembled_from_recall(cmp_a, source_a, source_b, helper_a):
    """run_job must build ctx.memory from recall (non-empty string for relevant brief)."""
    from omilo.loop.runner import start_job

    with _tenant_session(cmp_a) as db:
        job = start_job(
            db,
            company_id=cmp_a,
            helper_id=helper_a,
            origin="routine",
            brief="What is our passkeys webauthn rollout plan?",
        )

    # The job ran; the engine is fake but ctx.memory should have been assembled
    # We verify by checking that ctx.memory was passed — indirectly, we just
    # verify the job completes without error and that recall is wired.
    assert job.status in ("done", "waiting", "failed"), (
        f"Job status unexpected: {job.status}"
    )
    # We trust the runner wiring is correct if it didn't raise and the job finished.
    # The deeper assertion is that memory= no longer hardcodes "" — unit-tested below.


def test_recall_wired_in_runner_memory_field(cmp_a, source_a, source_b, helper_a):
    """Directly assert that run_job wires ctx.memory from recall.

    We monkeypatch the engine to capture the TaskContext.memory value.
    """
    from omilo.engine import TaskContext, get_engine
    from omilo.engine.fake import FakeEngine

    captured: list[str] = []

    class _CapturingEngine(FakeEngine):
        def run(self, ctx: TaskContext):
            captured.append(ctx.memory)
            return super().run(ctx)

    import omilo.engine as _eng
    orig_get_engine = _eng.get_engine

    def _patched_get_engine(cfg):
        if cfg.get("type") == "fake":
            return _CapturingEngine()
        return orig_get_engine(cfg)

    import omilo.loop.runner as _runner
    orig_runner_get_engine = _runner.get_engine

    _runner.get_engine = _patched_get_engine
    try:
        with _tenant_session(cmp_a) as db:
            from omilo.loop.runner import start_job
            start_job(
                db,
                company_id=cmp_a,
                helper_id=helper_a,
                origin="routine",
                brief="What is our passkeys webauthn rollout plan?",
            )
    finally:
        _runner.get_engine = orig_runner_get_engine

    assert captured, "Engine was never called"
    memory_value = captured[0]
    # memory must be a string (even if empty on error — but with KB seeded it should be non-empty)
    assert isinstance(memory_value, str), f"ctx.memory must be str, got {type(memory_value)}"
    # With source_a indexed, we should have real memory content
    assert memory_value, (
        "ctx.memory must be non-empty when KB has relevant content for the brief"
    )
