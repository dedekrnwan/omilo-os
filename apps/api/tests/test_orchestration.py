"""Task B1 — Role resolution + role-based delegation.
Task B2 — seed_relations: populate StaffRelation org chart.
Task B3 — Goal planner: activating a goal enqueues exactly one CoS plan task.

Tests:
  1. staff_by_role resolves a role to its first active staff (by id order).
  2. staff_by_role returns None for an unknown role.
  3. create_task MCP tool (role=...) routes to the resolved staff.
  4. create_task MCP tool (unresolved role) raises a clear DomainError.

  B2:
  5. seed_relations creates delegates_to + reviews edges from CoS to each active non-chief.
  6. seed_relations is idempotent: calling it twice adds no duplicates.
  7. seed_relations no-ops when there is no CoS.
  8. seed_relations skips retired staff.

  B3:
  9.  Activating a goal creates exactly one origin="plan" CoS task linked to the goal.
  10. Calling start_planning twice does not create a second plan task (idempotency).
  11. A create_task(goal_id=<g>) child links to goal g via TaskGoal.
  12. start_planning on a done goal is a no-op (no plan task created).
  13. start_planning when there is no CoS is a no-op (no crash, no task).

All rows are self-contained: each test creates its own Staff with a
distinct role so there is no cross-test bleed.
"""
import uuid

import pytest
from sqlalchemy import func, select

from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.models import Goal, Staff, StaffRelation, Task, TaskGoal


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


# ---------------------------------------------------------------------------
# Task B2 — seed_relations
# ---------------------------------------------------------------------------
# Each test uses its own isolated company (unique cid) so there is exactly
# one CoS per test and DB-state from other tests never bleeds in.

from omilo_api import company as C  # noqa: E402


def _isolated_cid() -> str:
    """Return a fresh, unique company-id for one test's isolated schema."""
    return "b2test-" + uuid.uuid4().hex[:10]


def _make_b2_team(cid: str) -> tuple[str, list[str]]:
    """Create a CoS + 2 active helpers in *cid*; return (cos_id, [helper_ids])."""
    prefix = uuid.uuid4().hex[:8]
    cos_id = "b2-cos-" + prefix
    h1_id = "b2-h1-" + prefix
    h2_id = "b2-h2-" + prefix
    with C.use(cid), session_scope(cid) as db:
        db.add(Staff(id=cos_id, name="CoS " + prefix, role="chief-of-staff",
                     is_chief=True, status="active", engine={"type": "fake"}))
        db.add(Staff(id=h1_id, name="Helper1 " + prefix, role="marketing",
                     is_chief=False, status="active", engine={"type": "fake"}))
        db.add(Staff(id=h2_id, name="Helper2 " + prefix, role="sales",
                     is_chief=False, status="active", engine={"type": "fake"}))
        db.commit()
    return cos_id, [h1_id, h2_id]


def _count_relations(cid: str, cos_id: str, to_id: str, kind: str) -> int:
    with C.use(cid), session_scope(cid) as db:
        return db.scalar(
            select(func.count()).select_from(StaffRelation).where(
                StaffRelation.from_staff == cos_id,
                StaffRelation.to_staff == to_id,
                StaffRelation.kind == kind,
            )
        ) or 0


def test_seed_relations_creates_edges():
    """seed_relations creates a delegates_to and a reviews edge from the CoS to each active non-chief."""
    cid = _isolated_cid()
    cos_id, helpers = _make_b2_team(cid)

    with C.use(cid), session_scope(cid) as db:
        S.seed_relations(db)

    for hid in helpers:
        assert _count_relations(cid, cos_id, hid, "delegates_to") == 1, \
            f"expected 1 delegates_to edge to {hid}"
        assert _count_relations(cid, cos_id, hid, "reviews") == 1, \
            f"expected 1 reviews edge to {hid}"


def test_seed_relations_idempotent():
    """Calling seed_relations twice must not create duplicate edges."""
    cid = _isolated_cid()
    cos_id, helpers = _make_b2_team(cid)

    with C.use(cid), session_scope(cid) as db:
        S.seed_relations(db)
    with C.use(cid), session_scope(cid) as db:
        S.seed_relations(db)

    for hid in helpers:
        assert _count_relations(cid, cos_id, hid, "delegates_to") == 1, \
            f"expected exactly 1 delegates_to edge to {hid} after two calls"
        assert _count_relations(cid, cos_id, hid, "reviews") == 1, \
            f"expected exactly 1 reviews edge to {hid} after two calls"


def test_seed_relations_no_cos_noop():
    """seed_relations is a no-op when there is no Chief of Staff."""
    cid = _isolated_cid()
    prefix = uuid.uuid4().hex[:8]
    h_id = "b2-nocoshelper-" + prefix
    with C.use(cid), session_scope(cid) as db:
        db.add(Staff(id=h_id, name="Loner " + prefix, role="ops",
                     is_chief=False, status="active", engine={"type": "fake"}))
        db.commit()

    with C.use(cid), session_scope(cid) as db:
        # Must not raise; no CoS means nothing seeded
        S.seed_relations(db)

    # No StaffRelation rows pointing to or from h_id should exist
    with C.use(cid), session_scope(cid) as db:
        count = db.scalar(
            select(func.count()).select_from(StaffRelation).where(
                StaffRelation.to_staff == h_id,
            )
        ) or 0
    assert count == 0


def test_seed_relations_skips_retired_staff():
    """seed_relations does not create edges to retired staff."""
    cid = _isolated_cid()
    prefix = uuid.uuid4().hex[:8]
    cos_id = "b2-cos-ret-" + prefix
    active_id = "b2-active-" + prefix
    retired_id = "b2-retired-" + prefix
    with C.use(cid), session_scope(cid) as db:
        db.add(Staff(id=cos_id, name="CoS " + prefix, role="chief-of-staff",
                     is_chief=True, status="active", engine={"type": "fake"}))
        db.add(Staff(id=active_id, name="Active " + prefix, role="ops",
                     is_chief=False, status="active", engine={"type": "fake"}))
        db.add(Staff(id=retired_id, name="Retired " + prefix, role="former",
                     is_chief=False, status="retired", engine={"type": "fake"}))
        db.commit()

    with C.use(cid), session_scope(cid) as db:
        S.seed_relations(db)

    # Active helper gets edges; retired one does not
    assert _count_relations(cid, cos_id, active_id, "delegates_to") == 1
    assert _count_relations(cid, cos_id, active_id, "reviews") == 1
    assert _count_relations(cid, cos_id, retired_id, "delegates_to") == 0
    assert _count_relations(cid, cos_id, retired_id, "reviews") == 0


# ---------------------------------------------------------------------------
# Task B3 — Goal planner: start_planning
# ---------------------------------------------------------------------------
# Each test uses its own isolated company (unique cid) so there is exactly
# one CoS per test and DB-state from other tests never bleeds in.


def _isolated_b3_cid() -> str:
    """Return a fresh, unique company-id for one B3 test's isolated schema."""
    return "b3test-" + uuid.uuid4().hex[:10]


def _make_b3_cos(cid: str) -> str:
    """Create a CoS staff in the given cid schema; return its id."""
    prefix = uuid.uuid4().hex[:8]
    cos_id = "b3-cos-" + prefix
    with C.use(cid), session_scope(cid) as db:
        db.add(Staff(id=cos_id, name="CoS " + prefix, role="chief-of-staff",
                     is_chief=True, status="active", engine={"type": "fake"}))
        db.commit()
    return cos_id


def _make_b3_goal(cid: str, status: str = "active") -> str:
    """Create a Goal in the given cid schema; return its id."""
    with C.use(cid), session_scope(cid) as db:
        g = Goal(title="Test goal " + uuid.uuid4().hex[:6],
                 target="Achieve the test objective", status=status)
        db.add(g)
        db.commit()
        return g.id


def _count_plan_tasks(cid: str, goal_id: str) -> int:
    """Count plan-origin TaskGoal-linked tasks for the given goal."""
    from sqlalchemy import func, select
    with C.use(cid), session_scope(cid) as db:
        return db.scalar(
            select(func.count()).select_from(Task).join(
                TaskGoal, TaskGoal.task_id == Task.id
            ).where(
                TaskGoal.goal_id == goal_id,
                Task.origin == "plan",
            )
        ) or 0


def test_start_planning_creates_one_plan_task():
    """Activating a goal enqueues exactly one origin='plan' CoS task linked to the goal."""
    from omilo_api import plan as P

    cid = _isolated_b3_cid()
    cos_id = _make_b3_cos(cid)
    goal_id = _make_b3_goal(cid, status="active")

    with C.use(cid), session_scope(cid) as db:
        P.start_planning(db, goal_id)

    count = _count_plan_tasks(cid, goal_id)
    assert count == 1, f"expected 1 plan task, got {count}"

    # The task is assigned to the CoS
    with C.use(cid), session_scope(cid) as db:
        tg = db.scalar(
            select(TaskGoal).where(TaskGoal.goal_id == goal_id)
        )
        assert tg is not None
        task = db.get(Task, tg.task_id)
        assert task is not None
        assert task.origin == "plan"
        assert task.staff_id == cos_id


def test_start_planning_idempotent_no_double_plan():
    """Calling start_planning twice for the same active goal must not create a second plan task."""
    from omilo_api import plan as P

    cid = _isolated_b3_cid()
    _make_b3_cos(cid)
    goal_id = _make_b3_goal(cid, status="active")

    with C.use(cid), session_scope(cid) as db:
        P.start_planning(db, goal_id)

    with C.use(cid), session_scope(cid) as db:
        P.start_planning(db, goal_id)

    count = _count_plan_tasks(cid, goal_id)
    assert count == 1, f"expected exactly 1 plan task after two calls, got {count}"


def test_child_task_links_to_goal_via_task_goal():
    """create_task(goal_id=<g>) links the task to the goal via TaskGoal (simulates the agent)."""
    cid = _isolated_b3_cid()
    cos_id = _make_b3_cos(cid)
    goal_id = _make_b3_goal(cid, status="active")

    with C.use(cid), session_scope(cid) as db:
        t = S.create_task(
            db,
            staff_id=cos_id,
            origin="delegation",
            brief="Simulate child task created by the planner agent",
            created_by="system",
            goal_id=goal_id,
        )
        task_id = t.id

    with C.use(cid), session_scope(cid) as db:
        tg = db.get(TaskGoal, task_id)
        assert tg is not None, "TaskGoal row missing"
        assert tg.goal_id == goal_id


def test_start_planning_done_goal_noop():
    """start_planning on a done goal must not create any plan task."""
    from omilo_api import plan as P

    cid = _isolated_b3_cid()
    _make_b3_cos(cid)
    goal_id = _make_b3_goal(cid, status="done")

    with C.use(cid), session_scope(cid) as db:
        P.start_planning(db, goal_id)

    count = _count_plan_tasks(cid, goal_id)
    assert count == 0, f"expected 0 plan tasks for a done goal, got {count}"


def test_start_planning_no_cos_noop():
    """start_planning when there is no CoS must not raise and must not create any task."""
    from omilo_api import plan as P

    cid = _isolated_b3_cid()
    # Intentionally no CoS created
    goal_id = _make_b3_goal(cid, status="active")

    with C.use(cid), session_scope(cid) as db:
        P.start_planning(db, goal_id)  # must not raise

    count = _count_plan_tasks(cid, goal_id)
    assert count == 0, f"expected 0 plan tasks when no CoS, got {count}"
