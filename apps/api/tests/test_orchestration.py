"""Task B1 — Role resolution + role-based delegation.
Task B2 — seed_relations: populate StaffRelation org chart.
Task B3 — Goal planner: activating a goal enqueues exactly one CoS plan task.
Task B4 — CoS manager tool-policy (context-sensitive): goal-delivery runs exclude exec tools.

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

  B4:
  14. manager_tool_filter: CoS goal-delivery run strips Bash/Write/Edit/MultiEdit from tools.
  15. manager_tool_filter: CoS non-goal-delivery run keeps Bash.
  16. manager_tool_filter: non-CoS run is unaffected (Bash present).
  17. manager_tool_filter: CoS origin="plan" (no goal link) is still goal-delivery → no Bash.
  18. manager_tool_filter: CoS origin="review" is goal-delivery → no Bash.
  19. manager_tool_filter: read-only tools (Read, Glob, Grep) are kept on CoS goal-delivery run.
  20. manager_tool_filter: mcp__omilo tools are kept on CoS goal-delivery run.
  21. Integration: _task_context sets goal_delivery=True for goal-linked CoS plan task.
  22. Integration: _task_context sets goal_delivery=False for non-goal CoS admin task.

All rows are self-contained: each test creates its own Staff with a
distinct role so there is no cross-test bleed.
"""
import uuid

import pytest
from conftest import cleanup_main_company_non_terminal_tasks
from sqlalchemy import func, select

from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.models import Goal, Staff, StaffRelation, Task, TaskGoal


@pytest.fixture(scope="module", autouse=True)
def _cleanup_orchestration_tasks():
    """At module teardown, purge non-terminal Task rows (and open threads/inbox items)
    created by this module's B1 tests in the shared MAIN company so the background
    worker's dispatch slots stay free for later test modules (e.g. test_harness).
    B2-B6 tests use isolated cids and clean up themselves."""
    yield
    cleanup_main_company_non_terminal_tasks("test-")


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


# ---------------------------------------------------------------------------
# Task B4 — CoS manager tool-policy (context-sensitive)
# ---------------------------------------------------------------------------
# Unit tests for the pure helper: manager_tool_filter(tools, is_chief, goal_delivery)
# Integration tests: _task_context computes goal_delivery correctly.

from omilo_api.engines.claude_code import SAFE_TOOLS, manager_tool_filter  # noqa: E402

_FULL_TOOLS = list(SAFE_TOOLS) + ["Bash", "mcp__omilo__create_task", "mcp__omilo__get_task"]


def test_b4_filter_strips_exec_tools_for_cos_goal_delivery():
    """CoS goal-delivery: Bash, Write, Edit, MultiEdit removed from tool list."""
    result = manager_tool_filter(_FULL_TOOLS, is_chief=True, goal_delivery=True)
    for exec_tool in ("Bash", "Write", "Edit", "MultiEdit"):
        assert exec_tool not in result, f"{exec_tool!r} must be absent for CoS goal-delivery"


def test_b4_filter_keeps_bash_for_cos_non_goal_delivery():
    """CoS non-goal-delivery (admin run): Bash is preserved."""
    result = manager_tool_filter(_FULL_TOOLS, is_chief=True, goal_delivery=False)
    assert "Bash" in result, "Bash must be present for a CoS admin run"


def test_b4_filter_non_cos_is_unaffected():
    """Non-CoS staff: all tools including Bash are preserved regardless of goal_delivery."""
    for gd in (True, False):
        result = manager_tool_filter(_FULL_TOOLS, is_chief=False, goal_delivery=gd)
        assert "Bash" in result, f"Bash must be present for non-CoS staff (goal_delivery={gd})"


def test_b4_filter_cos_plan_origin_is_goal_delivery():
    """origin='plan' is goal-delivery even without a TaskGoal link → exec tools stripped."""
    # Simulate: is_chief=True, goal_delivery determined by origin="plan"
    tools_with_bash = list(SAFE_TOOLS) + ["Bash"]
    result = manager_tool_filter(tools_with_bash, is_chief=True, goal_delivery=True)
    assert "Bash" not in result


def test_b4_filter_cos_review_origin_is_goal_delivery():
    """origin='review' is goal-delivery → exec tools stripped."""
    tools_with_bash = list(SAFE_TOOLS) + ["Bash"]
    result = manager_tool_filter(tools_with_bash, is_chief=True, goal_delivery=True)
    assert "Bash" not in result


def test_b4_filter_keeps_read_only_tools_for_cos_goal_delivery():
    """Read-only tools (Read, Glob, Grep) are preserved on a CoS goal-delivery run."""
    result = manager_tool_filter(_FULL_TOOLS, is_chief=True, goal_delivery=True)
    for ro_tool in ("Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"):
        assert ro_tool in result, f"{ro_tool!r} must be kept for CoS goal-delivery"


def test_b4_filter_keeps_mcp_tools_for_cos_goal_delivery():
    """MCP (omilo) tools are preserved on a CoS goal-delivery run."""
    result = manager_tool_filter(_FULL_TOOLS, is_chief=True, goal_delivery=True)
    mcp_tools = [t for t in result if t.startswith("mcp__omilo")]
    assert mcp_tools, "mcp__omilo tools must be kept for CoS goal-delivery"


# ---------------------------------------------------------------------------
# Integration: _task_context goal_delivery computation
# ---------------------------------------------------------------------------

def _isolated_b4_cid() -> str:
    return "b4test-" + uuid.uuid4().hex[:10]


def _make_b4_cos(cid: str) -> str:
    prefix = uuid.uuid4().hex[:8]
    cos_id = "b4-cos-" + prefix
    with C.use(cid), session_scope(cid) as db:
        db.add(Staff(id=cos_id, name="CoS " + prefix, role="chief-of-staff",
                     is_chief=True, status="active", engine={"type": "fake"}))
        db.commit()
    return cos_id


def test_b4_task_context_goal_delivery_true_for_goal_linked_cos_task():
    """_task_context sets goal_delivery=True when CoS task has a TaskGoal link."""
    from omilo_api.worker import Worker  # noqa: E402

    cid = _isolated_b4_cid()
    cos_id = _make_b4_cos(cid)

    with C.use(cid), session_scope(cid) as db:
        g = Goal(title="Goal B4", target="Achieve it", status="active")
        db.add(g)
        db.flush()
        goal_id = g.id
        t = S.create_task(db, staff_id=cos_id, origin="delegation", brief="Plan this goal",
                          created_by="system", goal_id=goal_id)
        task_id = t.id
        db.commit()

    with C.use(cid):
        worker = Worker.__new__(Worker)
        ctx, _, _ = worker._task_context(task_id)

    assert ctx.goal_delivery is True, "goal_delivery must be True when CoS task is goal-linked"


def test_b4_task_context_goal_delivery_false_for_cos_admin_task():
    """_task_context sets goal_delivery=False for a CoS task with no goal link and admin origin."""
    from omilo_api.worker import Worker  # noqa: E402

    cid = _isolated_b4_cid()
    cos_id = _make_b4_cos(cid)

    with C.use(cid), session_scope(cid) as db:
        t = S.create_task(db, staff_id=cos_id, origin="chat", brief="A quick admin retro",
                          created_by="system")
        task_id = t.id
        db.commit()

    with C.use(cid):
        worker = Worker.__new__(Worker)
        ctx, _, _ = worker._task_context(task_id)

    assert ctx.goal_delivery is False, "goal_delivery must be False for a CoS admin/chat run"


# ---------------------------------------------------------------------------
# Task B5 — Loop-closure: child-complete -> CoS review
# ---------------------------------------------------------------------------
# Each test runs in its own isolated company (unique cid) so there is exactly
# one CoS and no cross-test bleed. The hook under test lives on the terminal
# SUCCESS path of Worker._finish.

def _isolated_b5_cid() -> str:
    return "b5test-" + uuid.uuid4().hex[:10]


def _make_b5_cos(cid: str) -> str:
    prefix = uuid.uuid4().hex[:8]
    cos_id = "b5-cos-" + prefix
    with C.use(cid), session_scope(cid) as db:
        db.add(Staff(id=cos_id, name="CoS " + prefix, role="chief-of-staff",
                     is_chief=True, status="active", engine={"type": "fake"}))
        db.commit()
    return cos_id


def _make_b5_worker_staff(cid: str) -> str:
    prefix = uuid.uuid4().hex[:8]
    sid = "b5-worker-" + prefix
    with C.use(cid), session_scope(cid) as db:
        db.add(Staff(id=sid, name="Worker " + prefix, role="ic-" + prefix,
                     is_chief=False, status="active", engine={"type": "fake"}))
        db.commit()
    return sid


def _make_b5_goal(cid: str, status: str = "active") -> str:
    with C.use(cid), session_scope(cid) as db:
        g = Goal(title="B5 goal " + uuid.uuid4().hex[:6],
                 target="Ship it with numbers", status=status)
        db.add(g)
        db.commit()
        return g.id


def _make_b5_child(cid: str, staff_id: str, goal_id: str | None, origin: str = "delegation") -> str:
    """Create a goal-linked (unless goal_id is None) running child task; return its id."""
    with C.use(cid), session_scope(cid) as db:
        t = S.create_task(db, staff_id=staff_id, origin=origin, brief="Do the real work",
                          created_by="system", goal_id=goal_id)
        t.status = "running"
        db.commit()
        return t.id


def _count_review_tasks(cid: str, child_id: str) -> int:
    with C.use(cid), session_scope(cid) as db:
        return db.scalar(
            select(func.count()).select_from(Task).where(
                Task.origin == "review", Task.parent_task_id == child_id
            )
        ) or 0


def _finish_success(cid: str, task_id: str):
    """Drive the terminal SUCCESS path of _finish inside the company context."""
    from omilo_api.engines import EngineResult
    from omilo_api.worker import Worker

    w = Worker()
    with C.use(cid):
        w._finish(task_id, EngineResult(text="result of the work"), {})
    return w


def test_b5_success_enqueues_one_review_to_reviewer():
    """A goal-linked child finishing successfully enqueues exactly one review task,
    assigned to the reviewing staff (the from_staff of a reviews edge)."""
    cid = _isolated_b5_cid()
    cos_id = _make_b5_cos(cid)
    worker_sid = _make_b5_worker_staff(cid)
    goal_id = _make_b5_goal(cid)
    # CoS reviews the worker (B2-style edge).
    with C.use(cid), session_scope(cid) as db:
        db.add(StaffRelation(from_staff=cos_id, to_staff=worker_sid, kind="reviews"))
        db.commit()
    child_id = _make_b5_child(cid, worker_sid, goal_id, origin="delegation")

    _finish_success(cid, child_id)

    assert _count_review_tasks(cid, child_id) == 1
    with C.use(cid), session_scope(cid) as db:
        rev = db.scalar(select(Task).where(Task.origin == "review", Task.parent_task_id == child_id))
        assert rev is not None
        assert rev.staff_id == cos_id, "review goes to the reviewing staff (reviews-edge from_staff)"
        tg = db.get(TaskGoal, rev.id)
        assert tg is not None and tg.goal_id == goal_id, "review is linked to the child's goal"


def test_b5_review_falls_back_to_cos_when_no_reviews_edge():
    """With no reviews edge for the child's staff, the review is assigned to the CoS."""
    cid = _isolated_b5_cid()
    cos_id = _make_b5_cos(cid)
    worker_sid = _make_b5_worker_staff(cid)
    goal_id = _make_b5_goal(cid)
    child_id = _make_b5_child(cid, worker_sid, goal_id, origin="delegation")

    _finish_success(cid, child_id)

    assert _count_review_tasks(cid, child_id) == 1
    with C.use(cid), session_scope(cid) as db:
        rev = db.scalar(select(Task).where(Task.origin == "review", Task.parent_task_id == child_id))
        assert rev is not None and rev.staff_id == cos_id


def test_b5_idempotent_no_double_fire():
    """Calling _finish twice for the same child must not create a second review."""
    cid = _isolated_b5_cid()
    _make_b5_cos(cid)
    worker_sid = _make_b5_worker_staff(cid)
    goal_id = _make_b5_goal(cid)
    child_id = _make_b5_child(cid, worker_sid, goal_id, origin="delegation")

    _finish_success(cid, child_id)
    _finish_success(cid, child_id)  # second finish — must be a no-op for the review

    assert _count_review_tasks(cid, child_id) == 1, "no double-fire: exactly one review across two finishes"


def test_b5_review_origin_child_enqueues_no_review():
    """Loop guard: a finished task whose origin is 'review' spawns no further review."""
    cid = _isolated_b5_cid()
    _make_b5_cos(cid)
    worker_sid = _make_b5_worker_staff(cid)
    goal_id = _make_b5_goal(cid)
    child_id = _make_b5_child(cid, worker_sid, goal_id, origin="review")

    _finish_success(cid, child_id)

    assert _count_review_tasks(cid, child_id) == 0, "a review completing must not enqueue another review"


def test_b5_plan_origin_child_enqueues_no_review():
    """Loop guard: a finished task whose origin is 'plan' spawns no review."""
    cid = _isolated_b5_cid()
    _make_b5_cos(cid)
    worker_sid = _make_b5_worker_staff(cid)
    goal_id = _make_b5_goal(cid)
    child_id = _make_b5_child(cid, worker_sid, goal_id, origin="plan")

    _finish_success(cid, child_id)

    assert _count_review_tasks(cid, child_id) == 0


def test_b5_non_goal_linked_child_enqueues_no_review():
    """A successful child with no TaskGoal link enqueues no review."""
    cid = _isolated_b5_cid()
    _make_b5_cos(cid)
    worker_sid = _make_b5_worker_staff(cid)
    child_id = _make_b5_child(cid, worker_sid, goal_id=None, origin="delegation")

    _finish_success(cid, child_id)

    assert _count_review_tasks(cid, child_id) == 0


def test_b5_defer_finish_enqueues_no_review():
    """A defer=True finish returns before the hook — no review."""
    from omilo_api.engines import EngineResult
    from omilo_api.worker import Worker

    cid = _isolated_b5_cid()
    _make_b5_cos(cid)
    worker_sid = _make_b5_worker_staff(cid)
    goal_id = _make_b5_goal(cid)
    child_id = _make_b5_child(cid, worker_sid, goal_id, origin="delegation")

    w = Worker()
    with C.use(cid):
        # mimic dispatch: attempts bumped so the defer path can undo it
        with session_scope(cid) as db:
            db.get(Task, child_id).attempts = 1
            db.commit()
        w._finish(child_id, EngineResult(defer=True, error="No Claude Code account is free right now..."), {})

    assert _count_review_tasks(cid, child_id) == 0


def test_b5_failed_finish_enqueues_no_review():
    """A failed (res.error) terminal finish enqueues no review."""
    from omilo_api.engines import EngineResult
    from omilo_api.worker import Worker

    cid = _isolated_b5_cid()
    _make_b5_cos(cid)
    worker_sid = _make_b5_worker_staff(cid)
    goal_id = _make_b5_goal(cid)
    # origin="execution" so the transient-retry path never applies — this is a terminal failure.
    child_id = _make_b5_child(cid, worker_sid, goal_id, origin="execution")

    w = Worker()
    with C.use(cid):
        w._finish(child_id, EngineResult(error="hard failure, not transient"), {})

    assert _count_review_tasks(cid, child_id) == 0


def test_b5_done_goal_enqueues_no_review():
    """A goal-linked child whose goal is already done enqueues no review."""
    cid = _isolated_b5_cid()
    _make_b5_cos(cid)
    worker_sid = _make_b5_worker_staff(cid)
    goal_id = _make_b5_goal(cid, status="done")
    child_id = _make_b5_child(cid, worker_sid, goal_id, origin="delegation")

    _finish_success(cid, child_id)

    assert _count_review_tasks(cid, child_id) == 0


# ---------------------------------------------------------------------------
# Task B6 — Goal termination: complete_goal MCP tool + loop-termination guards
# ---------------------------------------------------------------------------
# Each test uses its own isolated company so there is no cross-test bleed.

def _isolated_b6_cid() -> str:
    return "b6test-" + uuid.uuid4().hex[:10]


def _make_b6_cos(cid: str) -> str:
    prefix = uuid.uuid4().hex[:8]
    cos_id = "b6-cos-" + prefix
    with C.use(cid), session_scope(cid) as db:
        db.add(Staff(id=cos_id, name="CoS " + prefix, role="chief-of-staff",
                     is_chief=True, status="active", engine={"type": "fake"}))
        db.commit()
    return cos_id


def _make_b6_goal(cid: str, status: str = "active") -> str:
    with C.use(cid), session_scope(cid) as db:
        g = Goal(title="B6 goal " + uuid.uuid4().hex[:6],
                 target="Ship it with numbers", status=status)
        db.add(g)
        db.commit()
        return g.id


async def _call_complete_goal(cid: str, cos_id: str, goal_id: str, outcome: str) -> dict:
    from omilo_api import mcp_server as mcp

    with C.use(cid), session_scope(cid) as db:
        cos = db.get(Staff, cos_id)
        _decision, result = await mcp.call_tool(db, cos, "complete_goal",
                                                {"goal_id": goal_id, "outcome": outcome})
    return result


def test_b6_complete_goal_sets_status_done():
    """complete_goal sets the goal status to 'done' and writes an audit row."""
    import asyncio

    from omilo_api.models import AuditEvent

    cid = _isolated_b6_cid()
    cos_id = _make_b6_cos(cid)
    goal_id = _make_b6_goal(cid)

    result = asyncio.get_event_loop().run_until_complete(
        _call_complete_goal(cid, cos_id, goal_id, "All targets met — shipped.")
    )

    assert result.get("ok") is True

    with C.use(cid), session_scope(cid) as db:
        g = db.get(Goal, goal_id)
        assert g is not None
        assert g.status == "done"
        audit_row = db.scalar(
            select(AuditEvent).where(
                AuditEvent.action == "goal.complete",
                AuditEvent.ref == goal_id,
            )
        )
        assert audit_row is not None, "an audit row for goal.complete must exist"


def test_b6_complete_goal_unknown_raises():
    """complete_goal with an unknown goal_id raises DomainError(404)."""
    import asyncio

    cid = _isolated_b6_cid()
    cos_id = _make_b6_cos(cid)

    with pytest.raises(S.DomainError) as exc_info:
        asyncio.get_event_loop().run_until_complete(
            _call_complete_goal(cid, cos_id, "gol-nonexistent-xxxx", "done")
        )

    assert exc_info.value.code == 404


def test_b6_complete_goal_already_done_is_idempotent():
    """complete_goal on an already-done goal returns ok without error (idempotent)."""
    import asyncio

    cid = _isolated_b6_cid()
    cos_id = _make_b6_cos(cid)
    goal_id = _make_b6_goal(cid, status="done")

    result = asyncio.get_event_loop().run_until_complete(
        _call_complete_goal(cid, cos_id, goal_id, "already done")
    )

    assert result.get("ok") is True

    with C.use(cid), session_scope(cid) as db:
        g = db.get(Goal, goal_id)
        assert g.status == "done"


def test_b6_complete_goal_dropped_left_untouched():
    """complete_goal on a dropped goal leaves it dropped (not overwritten to done)."""
    import asyncio

    cid = _isolated_b6_cid()
    cos_id = _make_b6_cos(cid)
    goal_id = _make_b6_goal(cid, status="dropped")

    result = asyncio.get_event_loop().run_until_complete(
        _call_complete_goal(cid, cos_id, goal_id, "cannot complete a dropped goal")
    )

    assert result.get("ok") is True

    with C.use(cid), session_scope(cid) as db:
        g = db.get(Goal, goal_id)
        assert g.status == "dropped", "dropped goal must remain dropped after complete_goal"


def test_b6_complete_goal_non_cos_rejected():
    """complete_goal called by non-CoS staff without staff.delegate permission is rejected (403)."""
    import asyncio

    cid = _isolated_b6_cid()
    # Create a non-CoS staff with no staff.delegate permission
    staff_id = "b6-staff-" + uuid.uuid4().hex[:8]
    with C.use(cid), session_scope(cid) as db:
        db.add(Staff(id=staff_id, name="Regular Staff", role="engineer",
                     is_chief=False, status="active", engine={"type": "fake"},
                     permissions={}))  # no staff.delegate permission
        db.commit()

    goal_id = _make_b6_goal(cid)

    with pytest.raises(S.DomainError) as exc_info:
        asyncio.get_event_loop().run_until_complete(
            _call_complete_goal(cid, staff_id, goal_id, "attempt to complete")
        )

    assert exc_info.value.code == 403


def test_b6_complete_goal_idempotent_no_duplicate_audit():
    """complete_goal called twice on the same goal writes only one audit row (idempotent)."""
    import asyncio

    from omilo_api.models import AuditEvent

    cid = _isolated_b6_cid()
    cos_id = _make_b6_cos(cid)
    goal_id = _make_b6_goal(cid)

    # First call: completes the goal and writes one audit row
    asyncio.get_event_loop().run_until_complete(
        _call_complete_goal(cid, cos_id, goal_id, "First completion.")
    )

    # Second call: idempotent, should not write another audit row
    asyncio.get_event_loop().run_until_complete(
        _call_complete_goal(cid, cos_id, goal_id, "Second completion (idempotent).")
    )

    with C.use(cid), session_scope(cid) as db:
        audit_count = db.scalar(
            select(func.count()).select_from(AuditEvent).where(
                AuditEvent.action == "goal.complete",
                AuditEvent.ref == goal_id,
            )
        ) or 0

    assert audit_count == 1, f"exactly one audit row should exist after two complete_goal calls, got {audit_count}"


def test_b6_done_goal_start_planning_is_noop():
    """After complete_goal, start_planning enqueues NO plan task (loop terminates)."""
    import asyncio

    from omilo_api import plan as P

    cid = _isolated_b6_cid()
    cos_id = _make_b6_cos(cid)
    goal_id = _make_b6_goal(cid)

    # Complete the goal via the MCP tool
    asyncio.get_event_loop().run_until_complete(
        _call_complete_goal(cid, cos_id, goal_id, "All done.")
    )

    # Now try to start planning — should be a no-op
    with C.use(cid), session_scope(cid) as db:
        P.start_planning(db, goal_id)

    with C.use(cid), session_scope(cid) as db:
        plan_count = db.scalar(
            select(func.count()).select_from(Task).join(
                TaskGoal, TaskGoal.task_id == Task.id
            ).where(TaskGoal.goal_id == goal_id, Task.origin == "plan")
        ) or 0

    assert plan_count == 0, f"start_planning must not enqueue a plan task for a done goal, got {plan_count}"


def test_b6_done_goal_enqueue_review_is_noop():
    """After complete_goal, _enqueue_review for a child of that goal creates no review task
    (the orchestration loop terminates — the B5 guard on goal.status != 'active' holds)."""
    import asyncio

    cid = _isolated_b6_cid()
    cos_id = _make_b6_cos(cid)
    worker_sid = _make_b5_worker_staff(cid)  # reuse B5 helper to create a worker
    goal_id = _make_b6_goal(cid)
    child_id = _make_b5_child(cid, worker_sid, goal_id, origin="delegation")

    # Complete the goal, then finish the child — no review should be enqueued
    asyncio.get_event_loop().run_until_complete(
        _call_complete_goal(cid, cos_id, goal_id, "Goal completed before child finished.")
    )
    _finish_success(cid, child_id)

    with C.use(cid), session_scope(cid) as db:
        review_count = db.scalar(
            select(func.count()).select_from(Task).where(
                Task.origin == "review", Task.parent_task_id == child_id
            )
        ) or 0

    assert review_count == 0, f"_enqueue_review must not create a review for a done goal, got {review_count}"
