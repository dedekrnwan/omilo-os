"""Task 5: Ops MCP tools — manage_goal, set_kpi_def, manage_folder, update_system_setting.

Tests call `call_tool(db, agent, name, args)` directly (no HTTP round-trip).
Follows the pattern established in test_mcp_staff_tools.py (Task 4).

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
from omilo_api.models import Folder, Staff

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PREFIX = "mcp-ops-t5-"


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
    return out[0]  # first element of the (status, dict) tuple


def out_data(out) -> dict:
    return out[1]


def _make_folder(tmp_path_str: str | None = None) -> str:
    """Create a Folder row and return its id."""
    import os
    import tempfile

    p = tmp_path_str or tempfile.mkdtemp(prefix="mcp-ops-t5-")
    with session_scope() as db:
        f = Folder(path=p, label="Test Folder", access="read", commands=False, default_on=False)
        db.add(f)
        db.commit()
        return f.id


# ---------------------------------------------------------------------------
# Module-level agent singletons
# ---------------------------------------------------------------------------

_GOAL_AGENT_ID: str | None = None        # has goal.create=AUTO (runs inline)
_GOAL_ASK_AGENT_ID: str | None = None   # has goal.create=ASK (files proposal in strict)
_KPI_AGENT_ID: str | None = None         # has kpi.write=AUTO (runs inline)
_KPI_ASK_AGENT_ID: str | None = None    # has kpi.write=ASK (files proposal in strict)
_FOLDER_AGENT_ID: str | None = None      # folder.grant=ASK → inline in permissive
_SETTING_AGENT_ID: str | None = None     # staff.change=ASK → inline in permissive
_WEAK_AGENT_ID: str | None = None        # all off


def _ensure_agents():
    global _GOAL_AGENT_ID, _GOAL_ASK_AGENT_ID, _KPI_AGENT_ID, _KPI_ASK_AGENT_ID
    global _FOLDER_AGENT_ID, _SETTING_AGENT_ID, _WEAK_AGENT_ID
    if _GOAL_AGENT_ID is None:
        # Goal agent: goal.create=AUTO so gated_execute runs inline in permissive
        _GOAL_AGENT_ID = _make_staff(
            permissions={"actions": {"goal.create": policy.AUTO}}
        )
        # Goal ASK agent: goal.create=ASK → proposal in strict (not auto in strict)
        _GOAL_ASK_AGENT_ID = _make_staff(
            permissions={"actions": {"goal.create": policy.ASK}}
        )
        # KPI agent: kpi.write=AUTO
        _KPI_AGENT_ID = _make_staff(
            permissions={"actions": {"kpi.write": policy.AUTO}}
        )
        # KPI ASK agent: kpi.write=ASK → proposal in strict
        _KPI_ASK_AGENT_ID = _make_staff(
            permissions={"actions": {"kpi.write": policy.ASK}}
        )
        # Folder agent: folder.grant defaults to ASK → inline in permissive mode
        _FOLDER_AGENT_ID = _make_staff()
        # Setting agent: staff.change defaults to ASK → inline in permissive mode
        _SETTING_AGENT_ID = _make_staff()
        # Weak agent: everything OFF
        _WEAK_AGENT_ID = _make_staff(
            permissions={"actions": {"goal.create": policy.OFF, "kpi.write": policy.OFF,
                                     "folder.grant": policy.OFF, "staff.change": policy.OFF}}
        )


@pytest.fixture(autouse=True)
def setup_agents(owner):
    """Ensure agents exist and default to auto mode."""
    _ensure_agents()
    _set_auto()
    yield
    _set_auto()


# ---------------------------------------------------------------------------
# manage_goal — Auto → done (executes)
# ---------------------------------------------------------------------------

def test_manage_goal_auto_create_executes(owner):
    """manage_goal(op=create) in Auto mode creates a Goal inline."""
    out = _call(
        _GOAL_AGENT_ID,
        "manage_goal",
        op="create",
        title="Grow revenue 20%",
        target="20% MRR increase by Dec 2026",
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done"
    assert "result" in data
    assert data["result"].get("goal_id") or data["result"].get("id")


def test_manage_goal_auto_update_executes(owner):
    """manage_goal(op=update) in Auto mode applies the change inline."""
    from omilo_api.models import Goal

    # Create a goal first directly so we have an id
    with session_scope() as db:
        g = Goal(title="Old Title", target="Old Target", status="active", created_by="test")
        db.add(g)
        db.commit()
        gid = g.id

    out = _call(
        _GOAL_AGENT_ID,
        "manage_goal",
        op="update",
        goal_id=gid,
        title="New Title",
        status="dropped",
    )
    assert out_decision(out) == "allowed", out_data(out)

    with session_scope() as db:
        g2 = db.get(Goal, gid)
    assert g2.title == "New Title"
    assert g2.status == "dropped"


def test_manage_goal_auto_delete_executes(owner):
    """manage_goal(op=delete) in Auto mode removes the Goal row."""
    from omilo_api.models import Goal

    with session_scope() as db:
        g = Goal(title="To Delete", target="Delete me", status="active", created_by="test")
        db.add(g)
        db.commit()
        gid = g.id

    out = _call(
        _GOAL_AGENT_ID,
        "manage_goal",
        op="delete",
        goal_id=gid,
    )
    assert out_decision(out) == "allowed", out_data(out)

    with session_scope() as db:
        g2 = db.get(Goal, gid)
    assert g2 is None


# ---------------------------------------------------------------------------
# manage_goal — Strict → proposal (not executed)
# ---------------------------------------------------------------------------

def test_manage_goal_strict_files_proposal(owner):
    """manage_goal with ASK-level permission in Strict mode files a proposal, not executed."""
    _set_strict()
    try:
        out = _call(
            _GOAL_ASK_AGENT_ID,
            "manage_goal",
            op="create",
            title="Strict Goal",
            target="Should not appear",
        )
        assert out_decision(out) == "proposal", out_data(out)
    finally:
        _restore_auto()


# ---------------------------------------------------------------------------
# set_kpi_def — Auto → done (executes)
# ---------------------------------------------------------------------------

def test_set_kpi_def_auto_executes(owner):
    """set_kpi_def in Auto mode defines the KPI inline."""
    out = _call(
        _KPI_AGENT_ID,
        "set_kpi_def",
        name="Monthly Revenue",
        label="MRR",
        unit="USD",
        direction="up",
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done"
    assert "result" in data
    assert data["result"].get("name")


def test_set_kpi_def_auto_undefine_executes(owner):
    """set_kpi_def with op=undefine removes the KPI definition."""
    from omilo_api.models import KpiDef
    from omilo_api.kpis import key as kpi_key

    kname = kpi_key("Test Metric Delete")
    with session_scope() as db:
        if not db.get(KpiDef, kname):
            db.add(KpiDef(name=kname))
            db.commit()

    out = _call(
        _KPI_AGENT_ID,
        "set_kpi_def",
        name=kname,
        op="undefine",
    )
    assert out_decision(out) == "allowed", out_data(out)

    with session_scope() as db:
        assert db.get(KpiDef, kname) is None


# ---------------------------------------------------------------------------
# set_kpi_def — Strict → proposal
# ---------------------------------------------------------------------------

def test_set_kpi_def_strict_files_proposal(owner):
    """set_kpi_def with ASK-level permission in Strict mode files a proposal, not executed."""
    _set_strict()
    try:
        out = _call(
            _KPI_ASK_AGENT_ID,
            "set_kpi_def",
            name="Strict KPI",
            label="Should not appear",
        )
        assert out_decision(out) == "proposal", out_data(out)
    finally:
        _restore_auto()


# ---------------------------------------------------------------------------
# manage_folder — Auto → done (executes)
# ---------------------------------------------------------------------------

def test_manage_folder_auto_add_executes(owner, tmp_path):
    """manage_folder(op=add) in Auto mode adds a company folder inline."""
    p = str(tmp_path)
    out = _call(
        _FOLDER_AGENT_ID,
        "manage_folder",
        op="add",
        path=p,
        label="Test Folder Add",
        access="read",
        commands=False,
        default_on=False,
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done"
    result = data["result"]
    assert result.get("id") or result.get("path") == p


def test_manage_folder_auto_delete_executes(owner):
    """manage_folder(op=delete) in Auto mode removes the folder row."""
    import tempfile

    p = tempfile.mkdtemp(prefix="mcp-t5-del-")
    fid = _make_folder(p)

    out = _call(
        _FOLDER_AGENT_ID,
        "manage_folder",
        op="delete",
        folder_id=fid,
    )
    assert out_decision(out) == "allowed", out_data(out)

    with session_scope() as db:
        assert db.get(Folder, fid) is None


# ---------------------------------------------------------------------------
# manage_folder — Strict → proposal
# ---------------------------------------------------------------------------

def test_manage_folder_strict_files_proposal(owner, tmp_path):
    """manage_folder in Strict mode files a proposal, does not add the folder."""
    _set_strict()
    try:
        out = _call(
            _FOLDER_AGENT_ID,
            "manage_folder",
            op="add",
            path=str(tmp_path),
            access="read",
        )
        assert out_decision(out) == "proposal", out_data(out)
    finally:
        _restore_auto()


# ---------------------------------------------------------------------------
# update_system_setting — allowed keys (max_concurrent_tasks, timezone)
# ---------------------------------------------------------------------------

def test_update_system_setting_max_concurrent_tasks_auto(owner):
    """update_system_setting with max_concurrent_tasks applies inline in Auto mode."""
    out = _call(
        _SETTING_AGENT_ID,
        "update_system_setting",
        key="max_concurrent_tasks",
        value=5,
    )
    assert out_decision(out) == "allowed", out_data(out)
    with session_scope() as db:
        assert S.get_setting(db, "max_concurrent_tasks") == 5


def test_update_system_setting_timezone_auto(owner):
    """update_system_setting with timezone applies inline in Auto mode."""
    out = _call(
        _SETTING_AGENT_ID,
        "update_system_setting",
        key="timezone",
        value="Asia/Jakarta",
    )
    assert out_decision(out) == "allowed", out_data(out)
    with session_scope() as db:
        assert S.get_setting(db, "timezone") == "Asia/Jakarta"


# ---------------------------------------------------------------------------
# update_system_setting — Strict → proposal
# ---------------------------------------------------------------------------

def test_update_system_setting_strict_files_proposal(owner):
    """update_system_setting in Strict mode files a proposal, does not apply."""
    _set_strict()
    try:
        out = _call(
            _SETTING_AGENT_ID,
            "update_system_setting",
            key="max_concurrent_tasks",
            value=99,
        )
        assert out_decision(out) == "proposal", out_data(out)
    finally:
        _restore_auto()


# ---------------------------------------------------------------------------
# REVIEW FOCUS: self-escalation guard — update_system_setting must REJECT
# autonomy/paused/strict_mode/autonomy_mode/self_tuning/budget keys
# ---------------------------------------------------------------------------

def test_update_system_setting_rejects_autonomy_key(owner):
    """update_system_setting with autonomy key must raise DomainError."""
    with pytest.raises(S.DomainError):
        _call(
            _SETTING_AGENT_ID,
            "update_system_setting",
            key="autonomy",
            value="auto",
        )


def test_update_system_setting_rejects_paused_key(owner):
    """update_system_setting with paused=True must raise DomainError."""
    with pytest.raises(S.DomainError):
        _call(
            _SETTING_AGENT_ID,
            "update_system_setting",
            key="paused",
            value=True,
        )


def test_update_system_setting_rejects_strict_mode_key(owner):
    """update_system_setting must reject strict_mode."""
    with pytest.raises(S.DomainError):
        _call(
            _SETTING_AGENT_ID,
            "update_system_setting",
            key="strict_mode",
            value=False,
        )


def test_update_system_setting_rejects_autonomy_mode_key(owner):
    """update_system_setting must reject autonomy_mode."""
    with pytest.raises(S.DomainError):
        _call(
            _SETTING_AGENT_ID,
            "update_system_setting",
            key="autonomy_mode",
            value="permissive",
        )


def test_update_system_setting_rejects_self_tuning_key(owner):
    """update_system_setting must reject self_tuning."""
    with pytest.raises(S.DomainError):
        _call(
            _SETTING_AGENT_ID,
            "update_system_setting",
            key="self_tuning",
            value=True,
        )


def test_update_system_setting_rejects_budget_key(owner):
    """update_system_setting must reject budget-related keys."""
    with pytest.raises(S.DomainError):
        _call(
            _SETTING_AGENT_ID,
            "update_system_setting",
            key="autonomy_budget_stop_usd",
            value=10,
        )


def test_update_system_setting_rejects_unknown_key(owner):
    """update_system_setting must reject any key not in the whitelist."""
    with pytest.raises(S.DomainError):
        _call(
            _SETTING_AGENT_ID,
            "update_system_setting",
            key="some_random_setting",
            value="evil",
        )
