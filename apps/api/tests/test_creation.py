"""Task D1 — Open create_task beyond the Chief of Staff.
Task D2 — create_goal / update_goal MCP tools.

Scope rule (D1):
  A staff may create_task (delegate) to a target if ANY:
    (a) the caller is_chief; OR
    (b) a StaffRelation(kind="delegates_to", from_staff=caller, to_staff=target) exists; OR
    (c) (default-not-strict) the caller's autonomy_policy mode is "permissive" AND the caller
        holds the staff.delegate permission at >= DO_AND_TELL.
  If NONE of the above → DomainError(..., 403).

Tests:
  D1-1. CoS still delegates freely (is_chief path unchanged).
  D1-2. Non-CoS WITH a delegates_to edge to the target succeeds.
  D1-3. Non-CoS WITHOUT an edge AND WITHOUT the permission is refused (403).
  D1-4. Non-CoS WITH the staff.delegate permission (>= DO_AND_TELL) and permissive mode succeeds.
  D1-5. Self-delegation is still blocked regardless of edge.
  D1-6. Depth cap (2 levels) is still enforced.
  D1-7. Strict mode + permission present is refused (permission alone not enough in strict mode).

D2 tests:
  D2-1. create_goal creates an active goal with created_by=staff:<id>, enqueues one plan task, sets agent_goal_notice flag.
  D2-2. Created goal appears in worklog.live_state (planner task queued) and goals_for_prompt.
  D2-3. update_goal(status="done") closes the goal.
  D2-4. update_goal with an invalid status raises DomainError.
  D2-5. create_goal is permissioned: a staff without goal.create permission is refused (403).

All rows are self-contained: each test seeds its own Staff rows.
"""
import asyncio
import uuid

import pytest
from conftest import cleanup_main_company_non_terminal_tasks

from omilo_api import mcp_server as mcp
from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.models import Goal, Setting, Staff, StaffRelation, Task


@pytest.fixture(scope="module", autouse=True)
def _cleanup_creation_tasks():
    """At module teardown, purge non-terminal Task rows (and open threads/inbox items)
    created by this module in the shared MAIN company so the background worker's
    dispatch slots stay free for later test modules (e.g. test_harness).
    Covers all staff id prefixes used by this module's helpers."""
    yield
    for prefix in ("test-", "d2cos-", "d2st-", "d2noperm-"):
        cleanup_main_company_non_terminal_tasks(prefix)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_staff(
    *,
    is_chief: bool = False,
    permissions: dict | None = None,
    autonomy: str = "standard",
    status: str = "active",
) -> str:
    sid = "test-" + uuid.uuid4().hex[:10]
    with session_scope() as db:
        db.add(Staff(
            id=sid,
            name=f"Staff {sid}",
            role="tester-" + uuid.uuid4().hex[:4],
            is_chief=is_chief,
            permissions=permissions or {},
            autonomy=autonomy,
            status=status,
            engine={"type": "fake"},
        ))
        db.commit()
    return sid


def _add_delegates_to_edge(from_id: str, to_id: str) -> None:
    with session_scope() as db:
        existing = db.get(StaffRelation, (from_id, to_id, "delegates_to"))
        if not existing:
            db.add(StaffRelation(from_staff=from_id, to_staff=to_id, kind="delegates_to"))
        db.commit()


def _call(caller_id: str, **args) -> dict:
    """Invoke create_task as caller; returns result_data (or raises DomainError)."""
    async def _inner():
        with session_scope() as db:
            caller = db.get(Staff, caller_id)
            _, data = await mcp.call_tool(db, caller, "create_task", args)
            return data
    return asyncio.run(_inner())


# ---------------------------------------------------------------------------
# D1-1: CoS path unchanged
# ---------------------------------------------------------------------------

def test_cos_delegates_freely(owner):
    """CoS (is_chief=True) can still delegate to any staff without an edge."""
    cos_id = _make_staff(is_chief=True)
    target_id = _make_staff()

    result = _call(cos_id, staff_id=target_id, brief="cos delegates freely")
    assert "task_id" in result

    with session_scope() as db:
        t = db.get(Task, result["task_id"])
        assert t is not None
        assert t.staff_id == target_id


# ---------------------------------------------------------------------------
# D1-2: Non-CoS WITH delegates_to edge succeeds
# ---------------------------------------------------------------------------

def test_non_cos_with_edge_can_delegate(owner):
    """A non-CoS staff WITH a delegates_to edge to the target can create_task."""
    caller_id = _make_staff()
    target_id = _make_staff()
    _add_delegates_to_edge(caller_id, target_id)

    result = _call(caller_id, staff_id=target_id, brief="delegated via edge")
    assert "task_id" in result

    with session_scope() as db:
        t = db.get(Task, result["task_id"])
        assert t is not None
        assert t.staff_id == target_id


# ---------------------------------------------------------------------------
# D1-3: Non-CoS WITHOUT edge AND WITHOUT permission is refused
# ---------------------------------------------------------------------------

def test_non_cos_without_edge_or_permission_refused(owner):
    """A non-CoS staff with no delegates_to edge and no staff.delegate permission is refused 403."""
    caller_id = _make_staff()  # no edge, no permission (staff.delegate defaults to OFF)
    target_id = _make_staff()

    with pytest.raises(S.DomainError) as exc_info:
        _call(caller_id, staff_id=target_id, brief="should be refused")

    assert exc_info.value.code == 403


# ---------------------------------------------------------------------------
# D1-4: Non-CoS WITH staff.delegate permission (>=DO_AND_TELL) in permissive mode succeeds
# ---------------------------------------------------------------------------

def test_non_cos_with_permission_and_permissive_mode_succeeds(owner):
    """A non-CoS staff with staff.delegate >= DO_AND_TELL in permissive mode (standard autonomy) can delegate."""
    # autonomy="standard" → permissive mode; give staff.delegate = DO_AND_TELL (2)
    caller_id = _make_staff(
        permissions={"actions": {"staff.delegate": 2}},  # DO_AND_TELL
        autonomy="standard",
    )
    target_id = _make_staff()

    result = _call(caller_id, staff_id=target_id, brief="delegated via permission")
    assert "task_id" in result

    with session_scope() as db:
        t = db.get(Task, result["task_id"])
        assert t is not None
        assert t.staff_id == target_id


# ---------------------------------------------------------------------------
# D1-5: Self-delegation still blocked (even with edge)
# ---------------------------------------------------------------------------

def test_self_delegation_blocked_even_with_edge(owner):
    """Self-delegation raises DomainError even when a delegates_to self-edge exists."""
    caller_id = _make_staff()
    # Explicitly add a self-edge (shouldn't happen in practice, but guard must hold)
    with session_scope() as db:
        db.add(StaffRelation(from_staff=caller_id, to_staff=caller_id, kind="delegates_to"))
        db.commit()

    with pytest.raises(S.DomainError) as exc_info:
        _call(caller_id, staff_id=caller_id, brief="self-delegation attempt")

    assert "else" in str(exc_info.value).lower() or exc_info.value.code == 400


# ---------------------------------------------------------------------------
# D1-6: Depth cap still enforced
# ---------------------------------------------------------------------------

def test_depth_cap_enforced(owner):
    """Delegation depth cap (2 levels) is still enforced even when the caller has a delegates_to edge.

    Chain: cos → a (depth 0 parent), a → b (depth 1 parent chain), b → c (depth 2 → cap fires).
    The depth algorithm walks parent_task_id links counting delegation hops; cap fires at >= 2.
    """
    cos_id = _make_staff(is_chief=True)
    a_id = _make_staff()
    b_id = _make_staff()
    c_id = _make_staff()
    # Give a→b and b→c edges so both pass the scope check
    _add_delegates_to_edge(a_id, b_id)
    _add_delegates_to_edge(b_id, c_id)

    async def _build_chain():
        # Level 0: cos → a (no parent)
        with session_scope() as db:
            cos = db.get(Staff, cos_id)
            _, d0 = await mcp.call_tool(db, cos, "create_task", {"staff_id": a_id, "brief": "level 0"})
        task_a = d0["task_id"]

        # Level 1: a → b (parent = task_a) — depth traversal gives 1, passes
        with session_scope() as db:
            a = db.get(Staff, a_id)
            _, d1 = await mcp.call_tool(db, a, "create_task", {
                "staff_id": b_id, "brief": "level 1", "parent_task_id": task_a,
            })
        task_b = d1["task_id"]

        # Level 2: b → c (parent = task_b) — depth traversal gives 2, cap fires
        raised = False
        try:
            with session_scope() as db:
                b = db.get(Staff, b_id)
                await mcp.call_tool(db, b, "create_task", {
                    "staff_id": c_id,
                    "brief": "level 2 — should be blocked",
                    "parent_task_id": task_b,
                })
        except S.DomainError as exc:
            raised = True
            assert "level" in str(exc).lower() or exc.code in (400, 403)
        assert raised, "expected DomainError for depth cap but none was raised"

    asyncio.run(_build_chain())


# ---------------------------------------------------------------------------
# D1-7: Strict mode (guided autonomy) refuses even with permission
# ---------------------------------------------------------------------------

def test_strict_mode_permission_alone_insufficient(owner):
    """In strict mode (autonomy=guided), the permission path (c) is closed — edge still works."""
    # autonomy="guided" → strict mode; give the permission, but no edge
    caller_id = _make_staff(
        permissions={"actions": {"staff.delegate": 2}},  # DO_AND_TELL
        autonomy="guided",  # → strict mode
    )
    target_id = _make_staff()

    with pytest.raises(S.DomainError) as exc_info:
        _call(caller_id, staff_id=target_id, brief="strict mode should refuse permission path")

    assert exc_info.value.code == 403


# ---------------------------------------------------------------------------
# D2 helpers
# ---------------------------------------------------------------------------

def _make_cos_staff(permissions: dict | None = None) -> str:
    """CoS with is_chief=True (can create goals without extra permissions)."""
    sid = "d2cos-" + uuid.uuid4().hex[:10]
    with session_scope() as db:
        db.add(Staff(
            id=sid,
            name=f"CoS {sid}",
            role="chief-of-staff",
            is_chief=True,
            permissions=permissions or {},
            autonomy="standard",
            status="active",
            engine={"type": "fake"},
        ))
        db.commit()
    return sid


def _make_planning_staff(permissions: dict | None = None) -> str:
    """A non-CoS planning staff with staff.delegate >= DO_AND_TELL (permissive mode)."""
    sid = "d2st-" + uuid.uuid4().hex[:10]
    with session_scope() as db:
        db.add(Staff(
            id=sid,
            name=f"Planner {sid}",
            role="planning-" + uuid.uuid4().hex[:4],
            is_chief=False,
            permissions=permissions or {"actions": {"staff.delegate": 2}},
            autonomy="standard",
            status="active",
            engine={"type": "fake"},
        ))
        db.commit()
    return sid


async def _call_create_goal(caller_id: str, **args) -> dict:
    async def _inner():
        with session_scope() as db:
            caller = db.get(Staff, caller_id)
            _, data = await mcp.call_tool(db, caller, "create_goal", args)
            return data
    return await _inner()


async def _call_update_goal(caller_id: str, **args) -> dict:
    async def _inner():
        with session_scope() as db:
            caller = db.get(Staff, caller_id)
            _, data = await mcp.call_tool(db, caller, "update_goal", args)
            return data
    return await _inner()


# ---------------------------------------------------------------------------
# D2-1: create_goal creates active goal, enqueues one plan task, sets notice flag
# ---------------------------------------------------------------------------

def test_d2_create_goal_active_with_plan_task_and_notice(owner):
    """create_goal creates a Goal(status=active, created_by=staff:<id>), enqueues exactly one
    origin=plan task (via start_planning), and sets Setting(agent_goal_notice='pending')."""
    from sqlalchemy import select

    from omilo_api.models import AuditEvent, TaskGoal

    cos_id = _make_cos_staff()

    result = asyncio.run(
        _call_create_goal(cos_id, title="Launch product v2", target="10 signups in first week", due="2026-12-31")
    )
    assert "goal_id" in result
    goal_id = result["goal_id"]

    with session_scope() as db:
        g = db.get(Goal, goal_id)
        assert g is not None
        assert g.status == "active"
        assert g.created_by == f"staff:{cos_id}"
        assert g.title == "Launch product v2"

        # Exactly one plan task linked to the goal
        plan_tasks = db.scalars(
            select(Task).join(TaskGoal, TaskGoal.task_id == Task.id).where(
                TaskGoal.goal_id == goal_id,
                Task.origin == "plan",
            )
        ).all()
        assert len(plan_tasks) == 1, "start_planning must have enqueued exactly one plan task"

        # Agent-goal notice flag must be pending
        notice = db.get(Setting, "agent_goal_notice")
        assert notice is not None
        assert notice.value == "pending"

        # Audit trail
        audit_row = db.scalar(
            select(AuditEvent).where(
                AuditEvent.action == "goal.create",
                AuditEvent.ref == goal_id,
            )
        )
        assert audit_row is not None, "audit row for goal.create must exist"


# ---------------------------------------------------------------------------
# D2-2: Created goal appears in worklog.live_state and goals_for_prompt
# ---------------------------------------------------------------------------

def test_d2_goal_appears_in_live_state_and_prompt(owner):
    """The planner task for the created goal shows up in worklog.live_state and
    the goal itself appears in plan.goals_for_prompt."""
    from omilo_api import worklog
    from omilo_api.plan import goals_for_prompt

    cos_id = _make_cos_staff()

    result = asyncio.run(
        _call_create_goal(cos_id, title="D2 prompt goal " + uuid.uuid4().hex[:6], target="hit 5 signups")
    )
    goal_id = result["goal_id"]

    with session_scope() as db:
        # live_state should contain the queued planner task for this goal
        state = worklog.live_state(db)
        goal_task_items = [i for i in state["items"] if i.get("goal_id") == goal_id]
        assert len(goal_task_items) >= 1, "at least one live-state item must reference the new goal"

        # goals_for_prompt must list the goal (it is active)
        prompts = goals_for_prompt(db)
        ids = [g["id"] for g in prompts]
        assert goal_id in ids, "active goal must appear in goals_for_prompt"


# ---------------------------------------------------------------------------
# D2-3: update_goal(status="done") closes the goal
# ---------------------------------------------------------------------------

def test_d2_update_goal_sets_done(owner):
    """update_goal with status='done' sets the goal to done."""
    from sqlalchemy import select

    from omilo_api.models import AuditEvent

    cos_id = _make_cos_staff()

    res = asyncio.run(
        _call_create_goal(cos_id, title="Goal to close " + uuid.uuid4().hex[:6], target="some target")
    )
    goal_id = res["goal_id"]

    update_res = asyncio.run(
        _call_update_goal(cos_id, goal_id=goal_id, status="done")
    )
    assert update_res.get("ok") is True

    with session_scope() as db:
        g = db.get(Goal, goal_id)
        assert g.status == "done"

        audit_row = db.scalar(
            select(AuditEvent).where(
                AuditEvent.action == "goal.update",
                AuditEvent.ref == goal_id,
            )
        )
        assert audit_row is not None, "audit row for goal.update must exist"


# ---------------------------------------------------------------------------
# D2-4: update_goal with an invalid status raises DomainError
# ---------------------------------------------------------------------------

def test_d2_update_goal_invalid_status_raises(owner):
    """update_goal with an unrecognised status raises DomainError."""
    cos_id = _make_cos_staff()

    res = asyncio.run(
        _call_create_goal(cos_id, title="Goal invalid status " + uuid.uuid4().hex[:6], target="t")
    )
    goal_id = res["goal_id"]

    with pytest.raises(S.DomainError):
        asyncio.run(
            _call_update_goal(cos_id, goal_id=goal_id, status="flying")
        )


# ---------------------------------------------------------------------------
# D2-5: create_goal is permissioned — staff without goal.create is refused
# ---------------------------------------------------------------------------

def test_d2_create_goal_permission_gate(owner):
    """A staff member without goal.create permission (OFF by default) is refused 403."""
    sid = "d2noperm-" + uuid.uuid4().hex[:10]
    with session_scope() as db:
        db.add(Staff(
            id=sid,
            name=f"NoPerm {sid}",
            role="generic-" + uuid.uuid4().hex[:4],
            is_chief=False,
            permissions={},  # no goal.create permission
            autonomy="standard",
            status="active",
            engine={"type": "fake"},
        ))
        db.commit()

    with pytest.raises(S.DomainError) as exc_info:
        asyncio.run(
            _call_create_goal(sid, title="Unauthorised goal", target="shouldn't create")
        )

    assert exc_info.value.code == 403
