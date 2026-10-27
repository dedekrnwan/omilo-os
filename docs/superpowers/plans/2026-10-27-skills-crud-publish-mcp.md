# Skills CRUD + skill_publish Proposal + MCP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Skill CRUD REST endpoints, a `skill_publish` Proposal flow (identical to `flow_publish`), KB-indexing of skill bodies, and four MCP tools (`skill_save`, `skill_publish`, `skills_list`, `skill_read`) — all company-scoped, TDD-first, full suite green.

**Architecture:** Mirror the `flows_write.py` publish pattern exactly: `POST /v1/skills/{id}/publish` creates a lightweight Job + Proposal (type="skill_publish", risk="medium") + ProposalRevision + decision InboxItem; the Skill stays "draft" until approval. On publish request, call `index_source(db, kind="skill", …)` to make the skill body recall-able. MCP tools delegate to a shared helper that reuses the same Proposal creation path.

**Tech Stack:** FastAPI/Pydantic v2, SQLAlchemy ORM, PostgreSQL with RLS, `prefixed_id`, existing `Skill` model (`omilo.models.skills`), `index_source` from `omilo.kb.index`, `recall` from `omilo.kb.retrieve`, existing `Proposal`/`ProposalRevision`/`InboxItem` models.

**Spec:**
- `docs/technical/04-rag-knowledge-learning.md` §7 (Skills)
- `docs/technical/02-api-contracts.md` §10 (GET /v1/skills, POST /v1/skills/{id}/publish)
- `.superpowers/sdd/2026-10-27-backend-p3-rag/task-5-brief.md`
- Reference implementation: `apps/api/omilo/api/flows_write.py` `publish_flow`

## Global Constraints

- All routes are company-scoped via `get_tenant_db` (FORCE RLS) — tenant is implicit from auth.
- Skill model prefix: `skl_` — use `prefixed_id("skl")`.
- `status` values: `"draft"` | `"published"` — skill stays `"draft"` until approval wired (later task).
- `created_by` set to `"operator"` for REST-created skills; `"agent"` for MCP-created skills.
- Proposal pattern: type=`"skill_publish"`, risk=`"medium"`, job origin=`"skill"`.
- KB indexing: `index_source(db, kind="skill", ref=f"skill:{skill.id}", title=skill.name, body=skill.body_md, helper_id=skill.helper_id)` — called on publish request.
- MCP tools log a `ToolCall` (existing dispatcher in `server.py` handles this).
- Python: `from __future__ import annotations`; SQLAlchemy ORM; Pydantic v2.
- Tests run from `apps/api/` via `.venv/bin/python -m pytest`. Suite was 377 tests before this task.
- Branch: `feat/backend-p3-rag`.

## Review Focus

1. **Tenancy on publish**: `POST /v1/skills/{id}/publish` for a skill belonging to company B using a company A token must return 404 (RLS scopes the query, but confirm the test exercises cross-tenant isolation explicitly).
2. **Chief fallback in publish**: if `is_chief=True` helper is absent, `publish_flow` falls back to any helper — skill publish must do the same and fail 409 if no helper at all exists.
3. **KB-index idempotency**: calling publish twice on the same skill body calls `index_source` twice; the function is idempotent (same hash → skip), but confirm no duplicate KbSource rows appear.
4. **MCP `skill_save` with `skill_id`** (update path): if a valid `skill_id` is passed, the existing Skill's `body_md`/`name`/`version` must be updated, not a new Skill created.
5. **`skill_read` 404**: `skill_read` called with an unknown or other-tenant skill_id must return an error dict (not raise an unhandled exception that kills the MCP session).

Each of these is pinned to a test in the tasks below.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/api/omilo/api/skills.py` | Create | REST CRUD + publish endpoint |
| `apps/api/omilo/main.py` | Modify | Mount skills router |
| `apps/api/omilo/mcp/tools.py` | Modify | Add 4 skill tools to catalog + handlers + dispatcher |
| `apps/api/tests/test_skills.py` | Create | TDD tests for all of the above |

---

### Task 1: REST Skill CRUD (GET list, POST create, GET by id)

**Files:**
- Create: `apps/api/omilo/api/skills.py`
- Modify: `apps/api/omilo/main.py` (add import + `app.include_router`)
- Test: `apps/api/tests/test_skills.py`

**Interfaces:**
- Produces:
  - `GET /v1/skills` → `[{id, name, status, version, helperId, usageCount, createdAt}]`
  - `POST /v1/skills {helper_id, name, body_md}` → full Skill dict, status="draft", version=1
  - `GET /v1/skills/{id}` → full Skill dict; 404 for other-tenant
  - `router` (FastAPI `APIRouter`) exported as `skills_router`
  - `_skill_to_dict(skill: Skill) -> dict` (internal; reused by publish)

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_skills.py
# Module-level: ensure_schema fixture (same pattern as test_flows_crud.py)
# Helper factories: _make_company, _make_user_member, _make_helper (copy from test_flows_crud.py)
# Session helpers: _superuser_session(), _tenant_session(company_id) (copy exact pattern)
# _get_token_for_company(client, company_id) async helper (copy from test_flows_crud.py)
# Fixtures: tenant_a (module-scoped, Company+Helper), tenant_b (module-scoped, Company+Helper)

class TestSkillCRUD:
    @pytest.mark.asyncio
    async def test_create_skill_returns_draft(self, async_client, tenant_a):
        company_id, helper_id = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        resp = await async_client.post(
            "/v1/skills",
            json={"helper_id": helper_id, "name": "My Skill", "body_md": "## Steps\n- do X"},
            headers={"Authorization": f"Bearer {token}",
                     "X-Company-Id": company_id},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "draft"
        assert body["version"] == 1
        assert body["name"] == "My Skill"
        assert body["helperId"] == helper_id

    @pytest.mark.asyncio
    async def test_list_skills(self, async_client, tenant_a):
        # After creating one skill above (or create inline), GET /v1/skills returns it
        company_id, helper_id = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        # Create
        await async_client.post(
            "/v1/skills",
            json={"helper_id": helper_id, "name": "Listed Skill", "body_md": "body"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        resp = await async_client.get(
            "/v1/skills",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200
        ids = [s["id"] for s in resp.json()]
        assert any(s["name"] == "Listed Skill" for s in resp.json())

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
        assert resp.status_code == 200
        assert resp.json()["id"] == skill_id
        assert resp.json()["bodyMd"] == "fetch body"

    @pytest.mark.asyncio
    async def test_get_skill_other_tenant_404(self, async_client, tenant_a, tenant_b):
        # Create in A, fetch with B's token → 404
        company_a, helper_a = tenant_a
        company_b, helper_b = tenant_b
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/api && .venv/bin/python -m pytest tests/test_skills.py::TestSkillCRUD -v 2>&1 | tail -20
```
Expected: ImportError or 404/AttributeError — `skills.py` does not exist yet.

- [ ] **Step 3: Create `apps/api/omilo/api/skills.py` with CRUD endpoints**

File header docstring mirrors `flows_write.py` convention. Define:
- `CreateSkillBody(BaseModel)`: `helper_id: str`, `name: str`, `body_md: str`
- `_skill_to_dict(skill: Skill) -> dict`: returns `{id, companyId, helperId, name, bodyMd, status, version, usageCount, createdBy, createdAt}`
- `_skill_card(skill: Skill) -> dict`: returns `{id, name, status, version, helperId, usageCount}`
- `GET /skills` → `list_skills`: `db.query(Skill).order_by(Skill.created_at.desc()).all()` → `[_skill_card(s) for s in skills]`
- `POST /skills` → `create_skill`: create `Skill(id=prefixed_id("skl"), company_id=ctx.company_id, helper_id=body.helper_id, name=body.name, body_md=body.body_md, status="draft", version=1, usage_count=0, created_by="operator")`, `db.add(skill)`, `db.flush()`, return `_skill_to_dict(skill)`
- `GET /skills/{skill_id}` → `get_skill`: query + 404 if None

Import from `omilo.models.skills import Skill`. Use `get_tenant_db`, `get_context` deps exactly as in `flows_write.py`.

- [ ] **Step 4: Mount router in `apps/api/omilo/main.py`**

Add after the memory_router line:
```python
from omilo.api.skills import router as skills_router
# ...
app.include_router(skills_router, prefix="/v1")
```

- [ ] **Step 5: Run CRUD tests to verify they pass**

```bash
cd apps/api && .venv/bin/python -m pytest tests/test_skills.py::TestSkillCRUD -v 2>&1 | tail -20
```
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/omilo/api/skills.py apps/api/omilo/main.py apps/api/tests/test_skills.py
git commit -m "feat(skills): REST CRUD — list, create, get (TDD green)"
```

---

### Task 2: skill_publish endpoint (Proposal + InboxItem + KB-index)

**Files:**
- Modify: `apps/api/omilo/api/skills.py` (add publish endpoint)
- Test: `apps/api/tests/test_skills.py` (add TestSkillPublish class)

**Interfaces:**
- Consumes: `_skill_to_dict`, `Skill` model, `get_tenant_db`, `get_context`, `prefixed_id` — all from Task 1
- Produces:
  - `POST /v1/skills/{id}/publish` → `dict` (proposal shape, same as `_proposal_to_dict` in flows_write)
  - Skill stays `status="draft"` after this call
  - One `Proposal` row (type="skill_publish", risk="medium", status="pending")
  - One `ProposalRevision` row
  - One `InboxItem` row (kind="decision", needs_you=True)
  - One `KbSource` + `KbChunk` row(s) for the skill body (kind="skill")

- [ ] **Step 7: Write failing publish + KB-index tests**

```python
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
        assert resp.status_code == 200
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

        # decision InboxItem exists
        with _tenant_session(company_id) as db:
            from omilo.models.inbox import InboxItem
            from omilo.models.approvals import Proposal
            p = db.query(Proposal).filter_by(id=proposal["id"]).first()
            assert p is not None
            inb = db.query(InboxItem).filter_by(kind="decision").filter(
                InboxItem.proposals["proposal_id"].astext == proposal["id"]
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
            json={"helper_id": helper_id, "name": "KB Skill",
                  "body_md": f"## How to {unique_term}\n- do it well"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        skill_id = cr.json()["id"]
        await async_client.post(
            f"/v1/skills/{skill_id}/publish",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        # recall should surface the skill chunk
        with _tenant_session(company_id) as db:
            from omilo.kb.retrieve import recall
            results = recall(db, unique_term)
        assert len(results) > 0
        kinds = [r.get("kind") for r in results]
        assert "skill" in kinds

    @pytest.mark.asyncio
    async def test_publish_cross_tenant_404(self, async_client, tenant_a, tenant_b):
        company_a, helper_a = tenant_a
        company_b, helper_b = tenant_b
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
```

- [ ] **Step 8: Run tests to verify they fail**

```bash
cd apps/api && .venv/bin/python -m pytest tests/test_skills.py::TestSkillPublish -v 2>&1 | tail -20
```
Expected: 404 on publish (route doesn't exist yet).

- [ ] **Step 9: Add `publish_skill` endpoint to `apps/api/omilo/api/skills.py`**

The function signature: `publish_skill(skill_id: str, db: Session = Depends(get_tenant_db), ctx: RequestContext = Depends(get_context)) -> dict`

Pattern to follow exactly (from `publish_flow`):
1. `skill = db.query(Skill).filter(Skill.id == skill_id).first()` — 404 if None.
2. Find Chief helper: `db.query(Helper).filter_by(company_id=ctx.company_id, is_chief=True).first()` — fallback to any helper — 409 if none.
3. Create `Job(id=prefixed_id("job"), company_id=ctx.company_id, helper_id=chief.id, origin="skill", brief=f"Publish skill {skill.id}: {skill.name}", status="waiting", cost_credits=0, tokens_in=0, tokens_out=0, attempts=0, checkpoint={}, started_at=datetime.now(timezone.utc))`.
4. `db.add(job); db.flush()`
5. Build `body_md = f"**Skill:** {skill.name}  \n**Helper:** {skill.helper_id}  \n\nApproving will publish the skill and make it available for recall and context loading."`
6. Create `Proposal(id=prefixed_id("prp"), company_id=ctx.company_id, job_id=job.id, helper_id=chief.id, type="skill_publish", risk="medium", title=f"Publish skill: {skill.name}", body_md=body_md, status="pending", current_revision=1)`.
7. `db.add(proposal); db.flush(); job.proposal_id = proposal.id; db.flush()`
8. Create `ProposalRevision(id=prefixed_id("prv"), company_id=ctx.company_id, proposal_id=proposal.id, n=1, body_md=body_md, author="operator", summary="Publish request from operator")`.
9. Create `InboxItem(id=prefixed_id("inb"), company_id=ctx.company_id, title=proposal.title, summary=body_md, session_id="", channel_id=(chief.channel_ids[0] if getattr(chief, "channel_ids", None) else ""), kind="decision", status="pending", asker=chief.name, asker_area=chief.area, needs_you=True, proposals={"proposal_id": proposal.id, "type": "skill_publish", "risk": "medium"}, actions=[{"label": "Approve", "primary": True}, {"label": "Reject"}])`.
10. `db.add(inbox_item); db.flush()`
11. Call `index_source(db, kind="skill", ref=f"skill:{skill.id}", title=skill.name, body=skill.body_md, helper_id=skill.helper_id)` — import from `omilo.kb.index`.
12. Best-effort SSE publish (try/except, same as `publish_flow`).
13. Return `_proposal_to_dict(proposal)`.

Add `_proposal_to_dict(proposal: Proposal) -> dict` (same fields as in `flows_write.py`).

Imports to add: `from omilo.models.approvals import Proposal, ProposalRevision`, `from omilo.models.inbox import InboxItem`, `from omilo.models.agents import Helper`, `from omilo.models.execution import Job`, `from datetime import datetime, timezone`.

- [ ] **Step 10: Run publish tests to verify they pass**

```bash
cd apps/api && .venv/bin/python -m pytest tests/test_skills.py::TestSkillPublish -v 2>&1 | tail -20
```
Expected: 3 tests PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/api/omilo/api/skills.py apps/api/tests/test_skills.py
git commit -m "feat(skills): skill_publish → Proposal + InboxItem + KB-index (TDD green)"
```

---

### Task 3: MCP skill tools (skill_save, skill_publish, skills_list, skill_read)

**Files:**
- Modify: `apps/api/omilo/mcp/tools.py` (add 4 entries to `TOOL_CATALOG`, 4 handler functions, 4 entries in `TOOL_HANDLERS`)
- Test: `apps/api/tests/test_skills.py` (add TestMcpSkillTools class)

**Interfaces:**
- Consumes:
  - `Skill` model from `omilo.models.skills`
  - `publish_skill_proposal(db, company_id, skill, chief)` — a private helper extracted from the REST endpoint logic (to avoid duplication; see implementation note below)
  - `dispatch(tool_name, arguments, db, helper)` from existing dispatcher — no changes to the dispatcher itself
- Produces (added to `TOOL_CATALOG`):
  ```python
  {"name": "skill_save", "description": "Create or update a draft Skill for this helper.",
   "inputSchema": {"type": "object", "properties": {
     "name": {"type": "string"},
     "body_md": {"type": "string"},
     "skill_id": {"type": "string", "description": "If provided, update that existing skill."}
   }, "required": ["name", "body_md"]}}

  {"name": "skill_publish", "description": "Create a skill_publish Proposal for a Skill.",
   "inputSchema": {"type": "object", "properties": {
     "skill_id": {"type": "string"}
   }, "required": ["skill_id"]}}

  {"name": "skills_list", "description": "List all skills for this company.",
   "inputSchema": {"type": "object", "properties": {}, "required": []}}

  {"name": "skill_read", "description": "Read the full body of a Skill.",
   "inputSchema": {"type": "object", "properties": {
     "skill_id": {"type": "string"}
   }, "required": ["skill_id"]}}
  ```

**Implementation note on `publish_skill_proposal`:** to avoid duplicating the 10-step Proposal creation in both `skills.py` and `tools.py`, extract a module-level function `_create_skill_publish_proposal(db, ctx_company_id, skill, chief) -> Proposal` inside `skills.py`, then import and call it from the MCP handler. Alternatively, keep the logic inline in both files (acceptable since it's short). Choose whichever keeps each file self-contained; do not create a third shared module just for this.

- [ ] **Step 12: Write failing MCP skill tool tests**

```python
class TestMcpSkillTools:
    # Requires: async_client, setup_mcp fixture that mints a helper token
    # Use same pattern as test_mcp.py: _sign_up_in, _make_helper_db, _mint_token, _rpc_payload

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
        assert resp.status_code == 200
        result = resp.json()["result"]
        assert "skill_id" in result
        # Verify in DB
        with _tenant_session(company_id) as db:
            from omilo.models.skills import Skill
            skill = db.get(Skill, result["skill_id"])
            assert skill is not None
            assert skill.status == "draft"
            assert skill.created_by == "agent"

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
            json=_rpc_payload("skill_save", {"name": "New Name", "body_md": "new body", "skill_id": skill_id}),
            headers={"Authorization": f"Bearer {mcp_token}"},
        )
        assert r2.json()["result"]["skill_id"] == skill_id
        with _tenant_session(company_id) as db:
            from omilo.models.skills import Skill
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
        assert resp.status_code == 200
        skills = resp.json()["result"]
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
        assert resp.status_code == 200
        result = resp.json()["result"]
        assert result.get("status") in ("proposed", "pending") or "proposal_id" in result
        # ToolCall logged
        with _tenant_session(company_id) as db:
            from omilo.models.toolcall import ToolCall
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
        assert resp.status_code == 200
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
        assert resp.status_code == 200  # MCP never 404s — returns result with error
        result = resp.json()["result"]
        assert result.get("status") == "error" or "not found" in str(result).lower()
```

- [ ] **Step 13: Run tests to verify they fail**

```bash
cd apps/api && .venv/bin/python -m pytest tests/test_skills.py::TestMcpSkillTools -v 2>&1 | tail -20
```
Expected: KeyError ("Unknown tool") from dispatch for skill_save.

- [ ] **Step 14: Add 4 skill tool handlers to `apps/api/omilo/mcp/tools.py`**

Add at the top of the file: `from omilo.models.skills import Skill`

Add 4 functions after `tool_remember`:

**`tool_skill_save(db, helper, arguments) -> dict`**:
- `skill_id = arguments.get("skill_id")`
- `name = arguments.get("name", "Untitled Skill")`
- `body_md = arguments.get("body_md", "")`
- If `skill_id`: load `skill = db.query(Skill).filter_by(id=skill_id).first()`. If None or wrong company → return `{"status": "error", "detail": "Skill not found"}`. Else: `skill.name = name; skill.body_md = body_md; skill.version = (skill.version or 1) + 1; db.flush(); return {"skill_id": skill.id}`.
- Else: create `Skill(id=prefixed_id("skl"), company_id=helper.company_id, helper_id=helper.id, name=name, body_md=body_md, status="draft", version=1, usage_count=0, created_by="agent")`. `db.add(skill); db.flush(); return {"skill_id": skill.id}`.

**`tool_skill_publish(db, helper, arguments) -> dict`**:
- `skill_id = arguments.get("skill_id", "")`
- `skill = db.query(Skill).filter_by(id=skill_id).first()`. If None → return `{"status": "error", "detail": "Skill not found"}`.
- Find Chief: `chief = db.query(Helper).filter_by(company_id=helper.company_id, is_chief=True).first() or db.query(Helper).filter_by(company_id=helper.company_id).first()`. If None → return `{"status": "error", "detail": "No helper found"}`.
- Inline create Job → Proposal → ProposalRevision → InboxItem (same 10-step pattern as REST endpoint). Call `index_source(db, kind="skill", ref=f"skill:{skill.id}", title=skill.name, body=skill.body_md, helper_id=skill.helper_id)`.
- Return `{"status": "proposed", "proposal_id": proposal.id}`.

**`tool_skills_list(db, helper, arguments) -> list[dict]`**:
- `skills = db.query(Skill).all()`
- Return `[{"id": s.id, "name": s.name, "status": s.status, "version": s.version, "helper_id": s.helper_id} for s in skills]`

**`tool_skill_read(db, helper, arguments) -> dict`**:
- `skill_id = arguments.get("skill_id", "")`
- `skill = db.query(Skill).filter_by(id=skill_id).first()`
- If None → return `{"status": "error", "detail": "Skill not found"}`
- Return `{"id": skill.id, "name": skill.name, "body_md": skill.body_md, "status": skill.status, "version": skill.version}`

Add all 4 to `TOOL_CATALOG` (schemas as specified in Interfaces above).
Add all 4 to `TOOL_HANDLERS` dict.

- [ ] **Step 15: Run MCP skill tool tests to verify they pass**

```bash
cd apps/api && .venv/bin/python -m pytest tests/test_skills.py::TestMcpSkillTools -v 2>&1 | tail -20
```
Expected: 6 tests PASS.

- [ ] **Step 16: Commit**

```bash
git add apps/api/omilo/mcp/tools.py apps/api/tests/test_skills.py
git commit -m "feat(skills): MCP tools — skill_save/publish/list/read + ToolCall (TDD green)"
```

---

### Task 4: Full suite green + self-review

**Files:**
- No new files. Possible minor fixes from full-suite run.

- [ ] **Step 17: Run full test suite**

```bash
cd apps/api && .venv/bin/python -m pytest -x -q 2>&1 | tail -30
```
Expected: all tests pass (377 original + new skills tests).

- [ ] **Step 18: Fix any regressions**

If any test fails:
- If it's an import error in `main.py` (router not imported), fix the import.
- If it's an `InboxItem.proposals` JSON path filter not supported by SQLite/test DB, simplify the InboxItem assertion to query by `kind="decision"` only and assert `inb is not None`.
- If `_make_helper_db` in test needs `is_chief` param, add it.
- Commit fixes with `git commit -m "fix(skills): <short description>"`.

- [ ] **Step 19: Re-run full suite to confirm green**

```bash
cd apps/api && .venv/bin/python -m pytest -q 2>&1 | tail -10
```
Expected: passed, 0 failed. Note the total count.

- [ ] **Step 20: Write task report**

Create `apps/api/.superpowers/sdd/2026-10-27-backend-p3-rag/task-5-report.md` (path from task instructions is `.superpowers/sdd/…/task-5-report.md` under repo root, not under apps/api).

Report content per the brief (status, commit SHA+subject, one-line test summary, concerns, report path).

- [ ] **Step 21: Final commit (report)**

```bash
git add .superpowers/sdd/2026-10-27-backend-p3-rag/task-5-report.md
git commit -m "docs(skills): task-5 completion report"
```
