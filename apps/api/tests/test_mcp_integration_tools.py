"""Task 6: Integration MCP tools — manage_connector, manage_skill, manage_workflow,
cancel_workflow_run, manage_knowledge_file.

Tests call `call_tool(db, agent, name, args)` directly (no HTTP round-trip).
Follows the pattern established in test_mcp_ops_tools.py (Task 5).

Decision helpers:
  out_decision(out) → MCP status string (allowed / proposal / refused)
  out_data(out)     → gate dict payload
"""
import asyncio
import uuid

import pytest

from omilo_api import mcp_server as mcp
from omilo_api import policy
from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.models import Staff, Workflow, WorkflowRun

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PREFIX = "mcp-int-t6-"


def _uid() -> str:
    return PREFIX + uuid.uuid4().hex[:10]


def _make_staff(
    *,
    is_chief: bool = False,
    permissions: dict | None = None,
) -> str:
    sid = _uid()
    with session_scope() as db:
        db.add(
            Staff(
                id=sid,
                name=f"Test {sid}",
                role=_uid(),
                is_chief=is_chief,
                permissions=permissions or {},
                status="active",
                engine={"type": "fake"},
            )
        )
        db.commit()
    return sid


def _set_auto():
    with session_scope() as db:
        S.set_setting(db, "autonomy_mode", "permissive")
        S.set_setting(db, "strict_mode", False)


def _set_strict():
    with session_scope() as db:
        S.set_setting(db, "autonomy_mode", "strict")
        S.set_setting(db, "strict_mode", True)


def _restore_auto():
    _set_auto()


def _call(agent_id: str, tool_name: str, **args):
    """Run call_tool synchronously; returns (status, data). May raise DomainError."""
    async def _inner():
        with session_scope() as db:
            agent = db.get(Staff, agent_id)
            return await mcp.call_tool(db, agent, tool_name, args)

    return asyncio.get_event_loop().run_until_complete(_inner())


def out_decision(out) -> str:
    return out[0]


def out_data(out) -> dict:
    return out[1]


# ---------------------------------------------------------------------------
# Module-level agent singletons
# ---------------------------------------------------------------------------

_CONNECTOR_AGENT_ID: str | None = None      # connector.install=AUTO
_CONNECTOR_ASK_AGENT_ID: str | None = None  # connector.install=ASK (strict → proposal)
_SKILL_AGENT_ID: str | None = None          # skill.change=AUTO
_SKILL_ASK_AGENT_ID: str | None = None      # skill.change=ASK (strict → proposal)
_WORKFLOW_AGENT_ID: str | None = None       # workflow.change=DO_AND_TELL (inline in auto)
_WORKFLOW_ASK_AGENT_ID: str | None = None   # workflow.change=ASK (strict → proposal)
_KNOWLEDGE_AGENT_ID: str | None = None      # knowledge.write=AUTO
_KNOWLEDGE_ASK_AGENT_ID: str | None = None  # knowledge.write=ASK (strict → proposal)


def _ensure_agents():
    global _CONNECTOR_AGENT_ID, _CONNECTOR_ASK_AGENT_ID
    global _SKILL_AGENT_ID, _SKILL_ASK_AGENT_ID
    global _WORKFLOW_AGENT_ID, _WORKFLOW_ASK_AGENT_ID
    global _KNOWLEDGE_AGENT_ID, _KNOWLEDGE_ASK_AGENT_ID
    if _CONNECTOR_AGENT_ID is None:
        _CONNECTOR_AGENT_ID = _make_staff(
            permissions={"actions": {"connector.install": policy.AUTO}}
        )
        _CONNECTOR_ASK_AGENT_ID = _make_staff(
            permissions={"actions": {"connector.install": policy.ASK}}
        )
        _SKILL_AGENT_ID = _make_staff(
            permissions={"actions": {"skill.change": policy.AUTO}}
        )
        _SKILL_ASK_AGENT_ID = _make_staff(
            permissions={"actions": {"skill.change": policy.ASK}}
        )
        # workflow.change defaults to DO_AND_TELL — runs inline in permissive
        _WORKFLOW_AGENT_ID = _make_staff(
            permissions={"actions": {"workflow.change": policy.DO_AND_TELL}}
        )
        _WORKFLOW_ASK_AGENT_ID = _make_staff(
            permissions={"actions": {"workflow.change": policy.ASK}}
        )
        _KNOWLEDGE_AGENT_ID = _make_staff(
            permissions={"actions": {"knowledge.write": policy.AUTO}}
        )
        _KNOWLEDGE_ASK_AGENT_ID = _make_staff(
            permissions={"actions": {"knowledge.write": policy.ASK}}
        )


@pytest.fixture(autouse=True)
def setup_agents(owner):
    """Ensure agents exist and default to auto mode."""
    _ensure_agents()
    _set_auto()
    yield
    _set_auto()


# ---------------------------------------------------------------------------
# GUARD: no credential/harness tools must exist in TOOLS
# ---------------------------------------------------------------------------

def test_no_credential_or_harness_tools_exist():
    """No tool for AI keys, harness accounts, MCP token rotation, or founder auth must exist."""
    names = {t["name"] for t in mcp.TOOLS}
    forbidden = {
        "add_ai_key",
        "set_ai_key",
        "add_harness_account",
        "rotate_mcp_token",
        "manage_harness",
        "set_harness_account",
        "manage_ai_key",
        "manage_founder_auth",
        "company_delete",
    }
    found = names & forbidden
    assert not found, f"Forbidden credential tools found in TOOLS: {found}"


def test_integration_tools_exist():
    """All five integration tools must be registered in TOOLS."""
    names = {t["name"] for t in mcp.TOOLS}
    required = {"manage_connector", "manage_skill", "manage_workflow", "cancel_workflow_run", "manage_knowledge_file"}
    missing = required - names
    assert not missing, f"Missing integration tools: {missing}"


# ---------------------------------------------------------------------------
# manage_connector — Auto → done (install/configure/remove)
# ---------------------------------------------------------------------------

def test_manage_connector_install_auto(owner, tmp_path):
    """manage_connector(op=install) in Auto mode adds a connector inline."""
    cid = "t6-test-" + uuid.uuid4().hex[:6]
    out = _call(
        _CONNECTOR_AGENT_ID,
        "manage_connector",
        op="install",
        id=cid,
        label="Test HTTP Connector",
        kind="http",
        url="http://example.com/mcp",
        approval="ask",
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done"
    result = data["result"]
    assert result.get("id") == cid or result.get("ok")

    # cleanup
    with session_scope() as db:
        from omilo_api.models import Connector
        c = db.get(Connector, cid)
        if c:
            db.delete(c)
            db.commit()


def test_manage_connector_remove_auto(owner):
    """manage_connector(op=remove) in Auto mode deletes the connector inline."""
    from omilo_api.models import Connector

    cid = "t6-del-" + uuid.uuid4().hex[:6]
    with session_scope() as db:
        db.add(Connector(id=cid, label="To Delete", kind="http", url="http://x.com", approval="ask", default_on=False, enabled=True))
        db.commit()

    out = _call(
        _CONNECTOR_AGENT_ID,
        "manage_connector",
        op="remove",
        id=cid,
    )
    assert out_decision(out) == "allowed", out_data(out)

    with session_scope() as db:
        assert db.get(Connector, cid) is None


def test_manage_connector_strict_files_proposal(owner):
    """manage_connector with ASK-level permission in Strict mode files a proposal, not executed."""
    _set_strict()
    try:
        out = _call(
            _CONNECTOR_ASK_AGENT_ID,
            "manage_connector",
            op="install",
            id="t6-strict-" + uuid.uuid4().hex[:6],
            label="Strict HTTP",
            kind="http",
            url="http://strict-example.com/mcp",
            approval="ask",
        )
        assert out_decision(out) == "proposal", out_data(out)
    finally:
        _restore_auto()


# ---------------------------------------------------------------------------
# manage_skill — Auto → done (delete)
# ---------------------------------------------------------------------------

def test_manage_skill_delete_auto(owner):
    """manage_skill(op=delete) in Auto mode removes the skill inline."""
    from omilo_api import capabilities as C

    slug = "t6-skill-" + uuid.uuid4().hex[:6]
    # Create a skill to delete
    C.save_skill(slug, "Test Skill T6", "A test skill", "## Steps\n1. Do it")

    out = _call(
        _SKILL_AGENT_ID,
        "manage_skill",
        op="delete",
        slug=slug,
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done"
    assert C.get_skill(slug) is None


def test_manage_skill_delete_nonexistent_raises(owner):
    """manage_skill(op=delete) for an unknown slug raises DomainError."""
    with pytest.raises(S.DomainError):
        _call(
            _SKILL_AGENT_ID,
            "manage_skill",
            op="delete",
            slug="nonexistent-skill-xyz",
        )


def test_manage_skill_strict_files_proposal(owner):
    """manage_skill(op=delete) with ASK-level permission in Strict mode files a proposal."""
    from omilo_api import capabilities as C

    slug = "t6-strict-skill-" + uuid.uuid4().hex[:6]
    C.save_skill(slug, "Strict Skill", "Test", "## Body\nContent")

    _set_strict()
    try:
        out = _call(
            _SKILL_ASK_AGENT_ID,
            "manage_skill",
            op="delete",
            slug=slug,
        )
        assert out_decision(out) == "proposal", out_data(out)
    finally:
        _restore_auto()
        # cleanup the skill
        C.delete_skill(slug)


# ---------------------------------------------------------------------------
# manage_workflow — Auto → done (create/update/delete/activate/pause)
# ---------------------------------------------------------------------------

_MINIMAL_GRAPH = {
    "nodes": [{"id": "t1", "type": "trigger.manual", "label": "Start", "config": {}, "x": 0, "y": 0}],
    "edges": [],
}


def test_manage_workflow_create_auto(owner):
    """manage_workflow(op=create) in Auto mode creates a workflow inline."""
    out = _call(
        _WORKFLOW_AGENT_ID,
        "manage_workflow",
        op="create",
        name="T6 Test Workflow",
        description="Created by MCP test",
        graph=_MINIMAL_GRAPH,
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done"
    result = data["result"]
    wid = result.get("workflow_id") or result.get("id")
    assert wid

    # cleanup
    with session_scope() as db:
        wf = db.get(Workflow, wid)
        if wf:
            db.delete(wf)
            db.commit()


def test_manage_workflow_update_auto(owner):
    """manage_workflow(op=update) in Auto mode updates an existing workflow."""
    with session_scope() as db:
        wf = Workflow(name="Old WF Name", description="Old", graph=_MINIMAL_GRAPH, status="draft", created_by="test")
        db.add(wf)
        db.commit()
        wid = wf.id

    out = _call(
        _WORKFLOW_AGENT_ID,
        "manage_workflow",
        op="update",
        workflow_id=wid,
        name="Updated WF Name",
    )
    assert out_decision(out) == "allowed", out_data(out)

    with session_scope() as db:
        wf2 = db.get(Workflow, wid)
    assert wf2.name == "Updated WF Name"

    # cleanup
    with session_scope() as db:
        wf = db.get(Workflow, wid)
        if wf:
            db.delete(wf)
            db.commit()


def test_manage_workflow_delete_auto(owner):
    """manage_workflow(op=delete) in Auto mode removes the workflow."""
    with session_scope() as db:
        wf = Workflow(name="To Delete WF", description="", graph=_MINIMAL_GRAPH, status="draft", created_by="test")
        db.add(wf)
        db.commit()
        wid = wf.id

    out = _call(
        _WORKFLOW_AGENT_ID,
        "manage_workflow",
        op="delete",
        workflow_id=wid,
    )
    assert out_decision(out) == "allowed", out_data(out)

    with session_scope() as db:
        assert db.get(Workflow, wid) is None


def test_manage_workflow_activate_auto(owner):
    """manage_workflow(op=activate) in Auto mode activates a draft workflow."""
    with session_scope() as db:
        wf = Workflow(name="To Activate WF", description="", graph=_MINIMAL_GRAPH, status="draft", created_by="test")
        db.add(wf)
        db.commit()
        wid = wf.id

    out = _call(
        _WORKFLOW_AGENT_ID,
        "manage_workflow",
        op="activate",
        workflow_id=wid,
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done"
    with session_scope() as db:
        wf2 = db.get(Workflow, wid)
        assert wf2.status == "active"
        assert wf2.updated_at is not None

    # cleanup
    with session_scope() as db:
        wf = db.get(Workflow, wid)
        if wf:
            db.delete(wf)
            db.commit()


def test_manage_workflow_pause_auto(owner):
    """manage_workflow(op=pause) in Auto mode pauses an active workflow."""
    with session_scope() as db:
        wf = Workflow(name="To Pause WF", description="", graph=_MINIMAL_GRAPH, status="active", created_by="test")
        db.add(wf)
        db.commit()
        wid = wf.id

    out = _call(
        _WORKFLOW_AGENT_ID,
        "manage_workflow",
        op="pause",
        workflow_id=wid,
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done"
    with session_scope() as db:
        wf2 = db.get(Workflow, wid)
        assert wf2.status == "paused"
        assert wf2.updated_at is not None

    # cleanup
    with session_scope() as db:
        wf = db.get(Workflow, wid)
        if wf:
            db.delete(wf)
            db.commit()


def test_manage_workflow_strict_files_proposal(owner):
    """manage_workflow with ASK-level permission in Strict mode files a proposal."""
    _set_strict()
    try:
        out = _call(
            _WORKFLOW_ASK_AGENT_ID,
            "manage_workflow",
            op="create",
            name="Strict WF",
            description="Should not be created",
            graph=_MINIMAL_GRAPH,
        )
        assert out_decision(out) == "proposal", out_data(out)
    finally:
        _restore_auto()


# ---------------------------------------------------------------------------
# cancel_workflow_run — Auto → done
# ---------------------------------------------------------------------------

def test_cancel_workflow_run_auto(owner):
    """cancel_workflow_run in Auto mode cancels the run inline."""

    with session_scope() as db:
        wf = Workflow(name="Cancelable WF", description="", graph=_MINIMAL_GRAPH, status="active", created_by="test")
        db.add(wf)
        db.flush()
        r = WorkflowRun(
            workflow_id=wf.id,
            status="queued",
            started_by="test",
            trigger="manual",
            input={},
        )
        db.add(r)
        db.commit()
        rid = r.id
        wid = wf.id

    out = _call(
        _WORKFLOW_AGENT_ID,
        "cancel_workflow_run",
        run_id=rid,
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done"

    with session_scope() as db:
        r2 = db.get(WorkflowRun, rid)
    assert r2.status == "cancelled"

    # cleanup
    with session_scope() as db:
        wf = db.get(Workflow, wid)
        if wf:
            db.delete(wf)
            db.commit()


def test_cancel_workflow_run_already_done_raises(owner):
    """cancel_workflow_run on an already-done run raises DomainError."""
    from omilo_api.models import now

    with session_scope() as db:
        wf = Workflow(name="Done WF", description="", graph=_MINIMAL_GRAPH, status="active", created_by="test")
        db.add(wf)
        db.flush()
        r = WorkflowRun(
            workflow_id=wf.id,
            status="done",
            started_by="test",
            trigger="manual",
            input={},
            ended_at=now(),
        )
        db.add(r)
        db.commit()
        rid = r.id
        wid = wf.id

    with pytest.raises(S.DomainError):
        _call(
            _WORKFLOW_AGENT_ID,
            "cancel_workflow_run",
            run_id=rid,
        )

    # cleanup
    with session_scope() as db:
        wf = db.get(Workflow, wid)
        if wf:
            db.delete(wf)
            db.commit()


def test_cancel_workflow_run_strict_files_proposal(owner):
    """cancel_workflow_run with ASK-level workflow.change in Strict mode files a proposal."""

    with session_scope() as db:
        wf = Workflow(name="Strict Cancel WF", description="", graph=_MINIMAL_GRAPH, status="active", created_by="test")
        db.add(wf)
        db.flush()
        r = WorkflowRun(
            workflow_id=wf.id,
            status="queued",
            started_by="test",
            trigger="manual",
            input={},
        )
        db.add(r)
        db.commit()
        rid = r.id
        wid = wf.id

    _set_strict()
    try:
        out = _call(
            _WORKFLOW_ASK_AGENT_ID,
            "cancel_workflow_run",
            run_id=rid,
        )
        assert out_decision(out) == "proposal", out_data(out)
    finally:
        _restore_auto()
        # cleanup
        with session_scope() as db:
            wf = db.get(Workflow, wid)
            r = db.get(WorkflowRun, rid)
            if r:
                db.delete(r)
            if wf:
                db.delete(wf)
            db.commit()


# ---------------------------------------------------------------------------
# manage_knowledge_file — Auto → done (upload/write)
# ---------------------------------------------------------------------------

def test_manage_knowledge_file_write_auto(owner):
    """manage_knowledge_file(op=write) in Auto mode writes the file inline."""
    fname = "t6-test-knowledge.md"
    content = "# T6 Test\n\nThis is a test knowledge file."

    out = _call(
        _KNOWLEDGE_AGENT_ID,
        "manage_knowledge_file",
        op="write",
        name=fname,
        content=content,
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done"
    result = data["result"]
    assert result.get("name") == fname

    # Verify the file was actually written
    with session_scope():
        read_back = S.read_knowledge(fname)
    assert read_back == content

    # cleanup
    from omilo_api.config import get_settings
    p = get_settings().knowledge_dir / fname
    if p.exists():
        p.unlink()


def test_manage_knowledge_file_invalid_name_raises(owner):
    """manage_knowledge_file with invalid name raises DomainError."""
    with pytest.raises(S.DomainError):
        _call(
            _KNOWLEDGE_AGENT_ID,
            "manage_knowledge_file",
            op="write",
            name="INVALID NAME WITH SPACES.md",
            content="some content",
        )


def test_manage_knowledge_file_strict_files_proposal(owner):
    """manage_knowledge_file with ASK-level knowledge.write in Strict mode files a proposal."""
    _set_strict()
    try:
        out = _call(
            _KNOWLEDGE_ASK_AGENT_ID,
            "manage_knowledge_file",
            op="write",
            name="t6-strict-knowledge.md",
            content="# Strict Mode Test",
        )
        assert out_decision(out) == "proposal", out_data(out)
    finally:
        _restore_auto()


# ---------------------------------------------------------------------------
# REST regression: existing REST endpoint tests still pass
# ---------------------------------------------------------------------------

def test_rest_connectors_list_still_works(owner):
    """GET /connectors still works after Task 6 changes."""
    r = owner.get("/api/connectors")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_rest_skills_list_still_works(owner):
    """GET /skills still works after Task 6 changes."""
    r = owner.get("/api/skills")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_rest_workflows_list_still_works(owner):
    """GET /workflows still works after Task 6 changes."""
    r = owner.get("/api/workflows")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_rest_knowledge_list_still_works(owner):
    """GET /knowledge still works after Task 6 changes."""
    r = owner.get("/api/knowledge")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_rest_skill_delete_still_works(owner):
    """DELETE /skills/{slug} still works after Task 6 changes."""
    from omilo_api import capabilities as C

    slug = "t6-rest-skill-" + uuid.uuid4().hex[:6]
    C.save_skill(slug, "REST Test Skill", "Testing REST", "## Body\nContent")

    r = owner.delete(f"/api/skills/{slug}")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert C.get_skill(slug) is None


def test_rest_knowledge_write_still_works(owner):
    """PUT /knowledge/{name} still works after Task 6 changes."""
    fname = "t6-rest-knowledge.md"
    r = owner.put(f"/api/knowledge/{fname}", json={"content": "# REST Test"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == fname

    # cleanup
    from omilo_api.config import get_settings
    p = get_settings().knowledge_dir / fname
    if p.exists():
        p.unlink()
