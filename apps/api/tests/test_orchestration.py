"""Task B1 — Role resolution + role-based delegation.

Tests:
  1. staff_by_role resolves a role to its first active staff (by id order).
  2. staff_by_role returns None for an unknown role.
  3. create_task MCP tool (role=...) routes to the resolved staff.
  4. create_task MCP tool (unresolved role) raises a clear DomainError.

All rows are self-contained: each test creates its own Staff with a
distinct role so there is no cross-test bleed.
"""
import uuid

import pytest
from sqlalchemy import func, select

from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.models import Staff, Task


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_staff(role: str, is_chief: bool = False, status: str = "active") -> str:
    """Insert a throwaway Staff row and return its id."""
    sid = "test-" + uuid.uuid4().hex[:8]
    with session_scope() as db:
        db.add(Staff(
            id=sid,
            name=f"Test Staff {sid}",
            role=role,
            is_chief=is_chief,
            status=status,
            engine={"type": "fake"},
        ))
        db.commit()
    return sid


def _make_cos() -> str:
    """Insert a Chief-of-Staff staff row and return its id."""
    return _make_staff(role="chief-of-staff", is_chief=True)


# ---------------------------------------------------------------------------
# Unit tests: staff_by_role
# ---------------------------------------------------------------------------

def test_staff_by_role_resolves_active_staff():
    """staff_by_role returns the first active staff whose role matches (case-insensitive)."""
    role_slug = "b1-marketing-" + uuid.uuid4().hex[:6]
    sid = _make_staff(role=role_slug)

    with session_scope() as db:
        found = S.staff_by_role(db, role_slug)
        assert found is not None
        assert found.id == sid


def test_staff_by_role_case_insensitive():
    """Role matching is case-insensitive: 'Marketing' == 'marketing'."""
    role_slug = "b1-Sales-" + uuid.uuid4().hex[:6]
    sid = _make_staff(role=role_slug.lower())

    with session_scope() as db:
        found = S.staff_by_role(db, role_slug.upper())
        assert found is not None
        assert found.id == sid


def test_staff_by_role_unknown_returns_none():
    """staff_by_role returns None when no staff holds the given role."""
    with session_scope() as db:
        found = S.staff_by_role(db, "totally-unknown-role-" + uuid.uuid4().hex)
        assert found is None


def test_staff_by_role_skips_retired_staff():
    """staff_by_role skips retired (non-active) staff."""
    role_slug = "b1-retired-" + uuid.uuid4().hex[:6]
    _make_staff(role=role_slug, status="retired")

    with session_scope() as db:
        found = S.staff_by_role(db, role_slug)
        assert found is None


def test_staff_by_role_many_holders_returns_first_by_id():
    """When multiple active staff share a role, the first by id (alphabetical) is returned."""
    role_slug = "b1-shared-" + uuid.uuid4().hex[:6]
    # Create two with deterministic ids so we know which comes first alphabetically
    prefix = uuid.uuid4().hex[:6]
    sid_a = "test-aaa-" + prefix
    sid_b = "test-zzz-" + prefix
    with session_scope() as db:
        db.add(Staff(id=sid_a, name="Staff A", role=role_slug, engine={"type": "fake"}))
        db.add(Staff(id=sid_b, name="Staff B", role=role_slug, engine={"type": "fake"}))
        db.commit()

    with session_scope() as db:
        found = S.staff_by_role(db, role_slug)
        assert found is not None
        assert found.id == sid_a  # alphabetically first


# ---------------------------------------------------------------------------
# Integration tests: create_task MCP tool with role=
# ---------------------------------------------------------------------------

async def _call_create_task(cos_id: str, **args) -> dict:
    """Call the MCP create_task handler directly (bypasses HTTP)."""
    from omilo_api import mcp_server as mcp

    with session_scope() as db:
        cos = db.get(Staff, cos_id)
        result_decision, result_data = await mcp.call_tool(db, cos, "create_task", args)
    return result_data


def test_create_task_by_role_routes_to_staff(owner):
    """create_task(role=...) resolves the role and creates a task for that staff."""
    import asyncio

    role_slug = "b1-mcp-role-" + uuid.uuid4().hex[:6]
    target_sid = _make_staff(role=role_slug)
    cos_id = _make_cos()

    result = asyncio.get_event_loop().run_until_complete(
        _call_create_task(cos_id, role=role_slug, brief="Plan a campaign")
    )
    assert "task_id" in result

    with session_scope() as db:
        t = db.get(Task, result["task_id"])
        assert t is not None
        assert t.staff_id == target_sid


def test_create_task_unresolved_role_raises_domain_error(owner):
    """create_task(role=<unknown>) raises a DomainError that names the unresolved role."""
    import asyncio

    cos_id = _make_cos()
    unknown_role = "nonexistent-role-" + uuid.uuid4().hex

    with pytest.raises(S.DomainError) as exc_info:
        asyncio.get_event_loop().run_until_complete(
            _call_create_task(cos_id, role=unknown_role, brief="Do something")
        )

    assert unknown_role in str(exc_info.value)


def test_create_task_neither_staff_id_nor_role_raises_domain_error(owner):
    """create_task without staff_id or role raises a DomainError."""
    import asyncio

    cos_id = _make_cos()

    with pytest.raises(S.DomainError):
        asyncio.get_event_loop().run_until_complete(
            _call_create_task(cos_id, brief="Do something")
        )


def test_create_task_staff_id_still_works(owner):
    """Existing staff_id path is unchanged after adding role support."""
    import asyncio

    target_sid = _make_staff(role="b1-direct-" + uuid.uuid4().hex[:6])
    cos_id = _make_cos()

    result = asyncio.get_event_loop().run_until_complete(
        _call_create_task(cos_id, staff_id=target_sid, brief="Direct delegation")
    )
    assert "task_id" in result

    with session_scope() as db:
        t = db.get(Task, result["task_id"])
        assert t is not None
        assert t.staff_id == target_sid
