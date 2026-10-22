"""Task 4: Staff-lifecycle MCP tools.

Tests call `call_tool(db, agent, name, args)` directly (no HTTP round-trip).
Follows the pattern in test_creation.py / test_orchestration.py.

Decision helpers:
  out_decision(out) → gate["decision"] mapped to MCP status
      done/needs_approval/refused
  out_id(out) → staff id from created staff in the gate result
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

PREFIX = "mcp-staff-t4-"


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
    """Put back permissive after a test that set strict."""
    _set_auto()


def _call(agent_id: str, tool_name: str, **args):
    """Run call_tool synchronously; returns (status, data). May raise DomainError."""
    async def _inner():
        with session_scope() as db:
            agent = db.get(Staff, agent_id)
            return await mcp.call_tool(db, agent, tool_name, args)

    return asyncio.run(_inner())


def out_decision(out) -> str:
    """Return the MCP status string from the call_tool result tuple."""
    return out[0]  # first element of the (status, dict) tuple


def out_data(out) -> dict:
    return out[1]


def out_new_staff_id(out) -> str:
    """Extract the new staff id from a done create_staff result."""
    return out_data(out)["result"]["id"]


# ---------------------------------------------------------------------------
# Fixtures: persistent agent (created once per session, kept for all tests)
# ---------------------------------------------------------------------------

_AGENT_ID: str | None = None
_WEAK_AGENT_ID: str | None = None
_OTHER_ID: str | None = None


def _ensure_agents():
    global _AGENT_ID, _WEAK_AGENT_ID, _OTHER_ID
    if _AGENT_ID is None:
        # Normal agent: default permissions (staff.* ASK → permissive allows inline)
        _AGENT_ID = _make_staff()
        # Weak agent: staff.create explicitly OFF
        _WEAK_AGENT_ID = _make_staff(
            permissions={"actions": {"staff.create": policy.OFF, "staff.*": policy.OFF}}
        )
        # Another helper to use as grant/update target
        _OTHER_ID = _make_staff()


@pytest.fixture(autouse=True)
def setup_agents(owner):
    """Ensure agents exist (uses `owner` to trigger server start) and default to auto mode."""
    _ensure_agents()
    _set_auto()
    yield
    _set_auto()  # restore after each test


# ---------------------------------------------------------------------------
# list_team
# ---------------------------------------------------------------------------

def test_list_team_returns_roster(owner):
    """list_team is always read-only (knowledge.read → AUTO); returns staff list in gate result."""
    out = _call(_AGENT_ID, "list_team")
    assert out_decision(out) == "allowed"
    gate = out_data(out)
    # gate dict: {"decision": "done", "result": [...], "level": ...}
    assert "result" in gate
    assert isinstance(gate["result"], list)
    assert len(gate["result"]) > 0
    first = gate["result"][0]
    assert "id" in first and "name" in first and "role" in first and "status" in first


# ---------------------------------------------------------------------------
# create_staff — Auto mode
# ---------------------------------------------------------------------------

def test_create_staff_auto_executes_and_creates_helper(owner):
    """In Auto (permissive), create_staff runs inline; the new Staff row is created."""
    new_id = PREFIX + "new-" + uuid.uuid4().hex[:8]
    out = _call(
        _AGENT_ID,
        "create_staff",
        id=new_id,
        name="Developer Bot",
        role=new_id,
        job="Write code",
    )
    assert out_decision(out) == "allowed", out_data(out)
    with session_scope() as db:
        created = db.get(Staff, new_id)
    assert created is not None, f"Staff {new_id} was not created"


# ---------------------------------------------------------------------------
# create_staff — Strict mode (needs_approval)
# ---------------------------------------------------------------------------

def test_create_staff_strict_files_proposal_and_does_not_create(owner):
    """In Strict, create_staff files a proposal and does NOT create the staff row."""
    _set_strict()
    new_id = PREFIX + "strict-" + uuid.uuid4().hex[:8]
    try:
        out = _call(
            _AGENT_ID,
            "create_staff",
            id=new_id,
            name="Strict Bot",
            role=new_id,
            job="Draft emails",
        )
        assert out_decision(out) == "proposal", out_data(out)
        with session_scope() as db:
            not_created = db.get(Staff, new_id)
        assert not_created is None, f"Staff {new_id} should NOT have been created in strict mode"
    finally:
        _restore_auto()


# ---------------------------------------------------------------------------
# create_staff — invalid slug → DomainError
# ---------------------------------------------------------------------------

def test_create_staff_invalid_slug_raises_domain_error(owner):
    """A role/id with spaces or bad chars raises DomainError, not a generic crash."""
    with pytest.raises(S.DomainError):
        _call(
            _AGENT_ID,
            "create_staff",
            id="Bad Slug!",  # spaces and bang are invalid
            name="X",
            role="bad slug",
            job="",
        )


# ---------------------------------------------------------------------------
# update_staff
# ---------------------------------------------------------------------------

def test_update_staff_auto_inline(owner):
    """update_staff in auto mode applies the change inline."""
    out = _call(
        _AGENT_ID,
        "update_staff",
        staff_id=_OTHER_ID,
        name="Updated Name",
    )
    assert out_decision(out) == "allowed", out_data(out)
    with session_scope() as db:
        updated = db.get(Staff, _OTHER_ID)
    assert updated.name == "Updated Name"


# ---------------------------------------------------------------------------
# retire_staff
# ---------------------------------------------------------------------------

def test_retire_staff_auto_inline(owner):
    """retire_staff in auto mode retires the helper inline."""
    retiree_id = _make_staff()
    out = _call(
        _AGENT_ID,
        "retire_staff",
        staff_id=retiree_id,
    )
    assert out_decision(out) == "allowed", out_data(out)
    with session_scope() as db:
        st = db.get(Staff, retiree_id)
    assert st.status == "retired"


# ---------------------------------------------------------------------------
# grant_staff_access — Auto inline
# ---------------------------------------------------------------------------

def _make_folder() -> str:
    """Create a Folder and return its id."""
    with session_scope() as db:
        f = Folder(path="/tmp/mcp-test-" + uuid.uuid4().hex[:6], label="Test Folder",
                   access="read", commands=False, default_on=False)
        db.add(f)
        db.commit()
        return f.id


def test_grant_access_auto_inline(owner):
    """grant_staff_access in Auto mode sets the access and returns the view inline."""
    fld_id = _make_folder()
    out = _call(
        _AGENT_ID,
        "grant_staff_access",
        staff_id=_OTHER_ID,
        folders={fld_id: {"access": "read", "commands": False}},
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert "result" in data


# ---------------------------------------------------------------------------
# grant_staff_access — Strict → proposal
# ---------------------------------------------------------------------------

def test_grant_access_strict_files_proposal(owner):
    """grant_staff_access in Strict mode files a proposal, does not apply the change inline."""
    fld_id = _make_folder()
    _set_strict()
    try:
        out = _call(
            _AGENT_ID,
            "grant_staff_access",
            staff_id=_OTHER_ID,
            folders={fld_id: {"access": "write", "commands": True}},
        )
        assert out_decision(out) == "proposal", out_data(out)
    finally:
        _restore_auto()


# ---------------------------------------------------------------------------
# grant_staff_access — unknown folder → DomainError
# ---------------------------------------------------------------------------

def test_grant_access_unknown_folder_raises_domain_error(owner):
    """Passing an unknown folder id raises DomainError (not a crash)."""
    with pytest.raises(S.DomainError):
        _call(
            _AGENT_ID,
            "grant_staff_access",
            staff_id=_OTHER_ID,
            folders={"fld_nope_does_not_exist": {"access": "read"}},
        )


# ---------------------------------------------------------------------------
# Denied without permission (OFF) → refused
# ---------------------------------------------------------------------------

def test_tool_denied_without_permission(owner):
    """An agent with staff.create=OFF is refused, not errored."""
    new_id = PREFIX + "denied-" + uuid.uuid4().hex[:8]
    out = _call(
        _WEAK_AGENT_ID,
        "create_staff",
        id=new_id,
        name="Should Not Exist",
        role=new_id,
        job="",
    )
    assert out_decision(out) == "refused", out_data(out)
    with session_scope() as db:
        assert db.get(Staff, new_id) is None


# ---------------------------------------------------------------------------
# manage_shift — create in Auto mode
# ---------------------------------------------------------------------------

def test_manage_shift_create_auto_inline(owner):
    """manage_shift(op=create) in Auto mode creates a Shift inline."""
    target_id = _make_staff()
    out = _call(
        _AGENT_ID,
        "manage_shift",
        staff_id=target_id,
        op="create",
        name="Daily standup",
        cron="0 9 * * *",
        brief="Run the daily check",
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert "result" in data
    assert data["result"].get("id") or data["result"].get("shift_id") or data["result"].get("staff_id") == target_id


# ---------------------------------------------------------------------------
# Security fix 1: update_staff must NOT forward permissions
# ---------------------------------------------------------------------------

def test_update_staff_ignores_permissions_arg(owner):
    """update_staff via call_tool with a permissions arg must NOT change the target's permissions.

    An agent passing permissions={} or any overriding dict must be silently ignored;
    the target's permissions remain exactly as they were before the call.
    """
    # Create a target with an explicit permission set we can check later.
    target_id = _make_staff(
        permissions={"actions": {"staff.create": "off"}}
    )
    # Read the original permissions.
    with session_scope() as db:
        original = dict(db.get(Staff, target_id).permissions or {})

    # Call update_staff with a permissions arg that would escalate privileges.
    out = _call(
        _AGENT_ID,
        "update_staff",
        staff_id=target_id,
        name="Legit Name Change",
        permissions={"actions": {"staff.create": "auto", "deploy": "auto"}},
    )
    assert out_decision(out) == "allowed", out_data(out)

    # The target's permissions must be unchanged.
    with session_scope() as db:
        after = dict(db.get(Staff, target_id).permissions or {})
    assert after == original, (
        f"permissions were changed by update_staff via MCP: before={original!r}, after={after!r}"
    )


# ---------------------------------------------------------------------------
# Security fix 2: retire_staff on the chief must return a clean error, not 500
# ---------------------------------------------------------------------------

def test_retire_chief_raises_domain_error(owner):
    """Retiring the Chief of Staff via call_tool must raise DomainError (clean refusal),
    NOT an unhandled ValueError that would escape as a 500.
    """
    chief_id = _make_staff(is_chief=True)
    with pytest.raises(S.DomainError):
        _call(_AGENT_ID, "retire_staff", staff_id=chief_id)
