"""Task 13: Calendar MCP tools — manage_calendar + list_upcoming.

Tests call `call_tool(db, agent, name, args)` directly (no HTTP round-trip).
Follows the pattern established in test_mcp_ops_tools.py (Task 5).

Decision helpers:
  out_decision(out) → MCP status string (allowed / proposal / refused)
  out_data(out)     → gate dict payload
"""
import asyncio
import datetime as dt
import uuid

import pytest
from sqlalchemy import func, select as sa_select

from omilo_api import mcp_server as mcp
from omilo_api import policy
from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.models import Proposal, Shift, Staff, Task

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PREFIX = "mcp-cal-t13-"


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


def _make_shift(staff_id: str) -> str:
    """Create a Shift for the given staff and return its id."""
    with session_scope() as db:
        sh = Shift(
            staff_id=staff_id,
            name="daily-report",
            cron="0 9 * * 1-5",
            brief="Write the daily report.",
        )
        # compute next_at using services helper
        sh.next_at = S.next_run("0 9 * * 1-5", db=db)
        db.add(sh)
        db.commit()
        return sh.id


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
# Module-level singletons (created once, reused across tests)
# ---------------------------------------------------------------------------

_CAL_AGENT_ID: str | None = None    # calendar.manage=AUTO → inline in permissive
_CAL_ASK_AGENT_ID: str | None = None  # calendar.manage=ASK → proposal in strict
_STAFF_ID: str | None = None         # the staff whose shifts we manage
_SHIFT_ID: str | None = None         # a reusable shift


def _ensure_fixtures():
    global _CAL_AGENT_ID, _CAL_ASK_AGENT_ID, _STAFF_ID, _SHIFT_ID
    if _CAL_AGENT_ID is None:
        # Caller with AUTO permission: runs inline in permissive mode
        _CAL_AGENT_ID = _make_staff(
            permissions={"actions": {"calendar.manage": policy.AUTO}}
        )
        # Caller with ASK permission: files proposal in strict mode
        _CAL_ASK_AGENT_ID = _make_staff(
            permissions={"actions": {"calendar.manage": policy.ASK}}
        )
        # A staff member whose shift we'll operate on
        _STAFF_ID = _make_staff()
        _SHIFT_ID = _make_shift(_STAFF_ID)


@pytest.fixture(autouse=True)
def setup_fixtures(owner):
    """Ensure fixtures exist and default to auto mode."""
    _ensure_fixtures()
    _set_auto()
    yield
    _set_auto()


# ---------------------------------------------------------------------------
# manage_calendar — run_now in Auto → done (task created)
# ---------------------------------------------------------------------------

def test_manage_calendar_run_now_auto_creates_task(owner):
    """manage_calendar(op=run_now) in Auto mode creates a Task for the shift inline."""
    out = _call(
        _CAL_AGENT_ID,
        "manage_calendar",
        op="run_now",
        shift_id=_SHIFT_ID,
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done", data
    result = data["result"]
    assert result.get("op") == "run_now"
    task_id = result.get("task_id")
    assert task_id, f"expected task_id in result: {result}"

    # Verify the Task row was actually created
    with session_scope() as db:
        t = db.get(Task, task_id)
    assert t is not None, f"Task '{task_id}' not found in DB"
    assert t.shift_id == _SHIFT_ID
    assert t.origin == "shift"


# ---------------------------------------------------------------------------
# manage_calendar — skip in Auto → done (ShiftSkip created)
# ---------------------------------------------------------------------------

def test_manage_calendar_skip_auto_creates_skip(owner):
    """manage_calendar(op=skip) in Auto mode creates a ShiftSkip inline."""
    # Find the next occurrence of the shift cron to get a valid future datetime
    with session_scope() as db:
        sh = db.get(Shift, _SHIFT_ID)
        # next_run returns the next UTC datetime after now
        next_at = S.next_run(sh.cron, db=db)

    at_str = next_at.isoformat()
    out = _call(
        _CAL_AGENT_ID,
        "manage_calendar",
        op="skip",
        shift_id=_SHIFT_ID,
        at=at_str,
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done", data
    result = data["result"]
    assert result.get("op") == "skip"
    assert result.get("ok") is True
    assert result.get("shift_id") == _SHIFT_ID

    # Unskip to leave DB clean for other tests
    _call(
        _CAL_AGENT_ID,
        "manage_calendar",
        op="unskip",
        shift_id=_SHIFT_ID,
        at=at_str,
    )


# ---------------------------------------------------------------------------
# manage_calendar — Strict → needs_approval (not executed)
# ---------------------------------------------------------------------------

def test_manage_calendar_strict_files_proposal(owner):
    """manage_calendar in Strict mode (ASK-level permission) files a proposal, not executed."""
    # Use a fresh staff + shift so we don't share state with the run_now test above
    fresh_staff_id = _make_staff()
    fresh_shift_id = _make_shift(fresh_staff_id)

    _set_strict()
    try:
        out = _call(
            _CAL_ASK_AGENT_ID,
            "manage_calendar",
            op="run_now",
            shift_id=fresh_shift_id,
        )
        assert out_decision(out) == "proposal", out_data(out)
        data = out_data(out)
        assert data.get("decision") == "needs_approval", data

        # Confirm no Task was created for the shift (strict → no execution)
        with session_scope() as db:
            from sqlalchemy import select
            tasks = list(db.scalars(
                select(Task).where(
                    Task.shift_id == fresh_shift_id,
                    Task.status.in_(["queued", "running"]),
                )
            ))
        assert tasks == [], f"Expected no task in strict mode but got: {tasks}"
    finally:
        _restore_auto()


# ---------------------------------------------------------------------------
# manage_calendar — unknown shift_id → DomainError (PRE-GATE, both modes)
# ---------------------------------------------------------------------------

def test_manage_calendar_unknown_shift_raises_domain_error_auto(owner):
    """Unknown shift_id raises DomainError in Auto mode (pre-gate, no proposal filed)."""
    with pytest.raises(S.DomainError) as exc_info:
        _call(
            _CAL_AGENT_ID,
            "manage_calendar",
            op="run_now",
            shift_id="shift-does-not-exist-xyz",
        )
    assert exc_info.value.code == 404


def _count_proposals(agent_id: str) -> int:
    """Return the number of Proposal rows for the given agent."""
    with session_scope() as db:
        return db.scalar(sa_select(func.count()).select_from(Proposal).where(Proposal.staff_id == agent_id))


def test_manage_calendar_unknown_shift_raises_domain_error_strict(owner):
    """Unknown shift_id raises DomainError even in Strict mode (no proposal filed)."""
    _set_strict()
    try:
        before_count = _count_proposals(_CAL_ASK_AGENT_ID)

        with pytest.raises(S.DomainError) as exc_info:
            _call(
                _CAL_ASK_AGENT_ID,
                "manage_calendar",
                op="run_now",
                shift_id="shift-does-not-exist-strict",
            )
        assert exc_info.value.code == 404

        after_count = _count_proposals(_CAL_ASK_AGENT_ID)
        assert after_count == before_count, (
            f"A proposal was filed for a non-existent shift in Strict mode "
            f"(before={before_count}, after={after_count})"
        )
    finally:
        _restore_auto()


# ---------------------------------------------------------------------------
# list_upcoming — returns events (read-only, always AUTO via knowledge.read)
# ---------------------------------------------------------------------------

def test_list_upcoming_returns_items(owner):
    """list_upcoming returns a dict with 'items' and 'timezone' keys."""
    out = _call(
        _CAL_AGENT_ID,
        "list_upcoming",
        limit=10,
    )
    assert out_decision(out) == "allowed", out_data(out)
    data = out_data(out)
    assert data.get("decision") == "done", data
    result = data["result"]
    assert "items" in result, f"Expected 'items' in result: {result}"
    assert "timezone" in result, f"Expected 'timezone' in result: {result}"
    assert isinstance(result["items"], list), f"items should be a list: {result}"


def test_list_upcoming_strict_still_allowed(owner):
    """list_upcoming uses knowledge.read (AUTO) so it succeeds even in Strict mode."""
    _set_strict()
    try:
        out = _call(
            _CAL_AGENT_ID,
            "list_upcoming",
            limit=5,
        )
        # knowledge.read is AUTO — always inline
        assert out_decision(out) == "allowed", out_data(out)
        data = out_data(out)
        assert data.get("decision") == "done", data
    finally:
        _restore_auto()


def test_list_upcoming_with_staff_filter(owner):
    """list_upcoming with staff_id filter returns only that helper's events."""
    out = _call(
        _CAL_AGENT_ID,
        "list_upcoming",
        staff_id=_STAFF_ID,
        limit=5,
    )
    assert out_decision(out) == "allowed", out_data(out)
    result = out_data(out)["result"]
    # All returned items should belong to _STAFF_ID
    for item in result.get("items", []):
        if item.get("staff_id") is not None:
            assert item["staff_id"] == _STAFF_ID, f"Got event for wrong staff: {item}"
