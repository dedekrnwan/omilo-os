"""Tests for GET /api/team/board — per-helper work cards.

Self-contained: each test seeds its own Staff/Task/Checkpoint/Proposal/Thread rows
using unique staff ID prefixes (tb_*) to avoid interfering with other test modules.

Run with:
    cd apps/api && uv run pytest tests/test_team_board.py -v
"""
from __future__ import annotations

import datetime as dt

import pytest
from conftest import cleanup_main_company_non_terminal_tasks

from omilo_api import team_board
from omilo_api.db import session_scope
from omilo_api.models import (
    Checkpoint,
    Goal,
    Proposal,
    Setting,
    Staff,
    Task,
    TaskGoal,
    Thread,
)

# ---------------------------------------------------------------------------
# Module-level cleanup: purge non-terminal tasks created by this module
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def _cleanup_team_board_tasks():
    yield
    cleanup_main_company_non_terminal_tasks("tb_staff_")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _staff(suffix: str, **kw) -> Staff:
    defaults = dict(
        name=f"TB Staff {suffix}",
        role="tester",
        is_chief=False,
        status="active",
    )
    defaults.update(kw)
    return Staff(id=f"tb_staff_{suffix}", **defaults)


def _task(staff_id: str, status: str = "running", **kw) -> Task:
    defaults = dict(
        origin="manual",
        brief="Build the feature\nDetailed description here",
        status=status,
        cost_usd=0.05,
        created_at=dt.datetime.now(dt.UTC),
    )
    if status == "running":
        defaults["started_at"] = dt.datetime.now(dt.UTC)
    defaults.update(kw)
    return Task(staff_id=staff_id, **defaults)


def _find_helper(helpers: list[dict], staff_id: str) -> dict | None:
    return next((h for h in helpers if h["id"] == staff_id), None)


def _find_card(helpers: list[dict], task_id: str) -> dict | None:
    for h in helpers:
        for c in h["cards"]:
            if c["id"] == task_id:
                return c
    return None


# ---------------------------------------------------------------------------
# Test 1: Cards are grouped under the correct helper with progress
# ---------------------------------------------------------------------------

def test_board_groups_cards_under_helper(owner):
    """A running Task with a Checkpoint plan [done, pending] appears under the correct
    helper with status='running' and progress={done:1, total:2}."""
    with session_scope() as db:
        s = _staff("grp")
        db.add(s)
        db.flush()

        t = _task(s.id, status="running")
        db.add(t)
        db.flush()

        ckp = Checkpoint(
            task_id=t.id,
            plan=[
                {"label": "Step 1", "status": "done"},
                {"label": "Step 2", "status": "pending"},
            ],
        )
        db.add(ckp)
        db.commit()
        staff_id = s.id
        task_id = t.id

    with session_scope() as db:
        b = team_board.board(db)

    h = _find_helper(b["helpers"], staff_id)
    assert h is not None, f"Helper {staff_id} not found in board response"

    c = next((x for x in h["cards"] if x["id"] == task_id), None)
    assert c is not None, f"Task {task_id} not found in helper cards"

    assert c["status"] == "running"
    assert c["progress"] == {"done": 1, "total": 2}
    assert c["needs_proposal"] is False
    assert c["awaiting_reply"] is False
    assert "title" in c and c["title"]
    assert "updated_at" in c


# ---------------------------------------------------------------------------
# Test 2: Idle helper is listed with empty cards
# ---------------------------------------------------------------------------

def test_idle_helper_listed_with_empty_cards(owner):
    """An idle helper (no tasks) still appears in helpers with cards=[]."""
    with session_scope() as db:
        s = _staff("idle")
        db.add(s)
        db.commit()
        staff_id = s.id

    with session_scope() as db:
        b = team_board.board(db)

    h = _find_helper(b["helpers"], staff_id)
    assert h is not None, f"Idle helper {staff_id} not found in board response"
    assert h["cards"] == []
    assert h["status"] == "idle"


# ---------------------------------------------------------------------------
# Test 3: Open proposal makes card status "needs_you"
# ---------------------------------------------------------------------------

def test_open_proposal_makes_card_needs_you(owner):
    """A Task with an open (pending) Proposal gets card status='needs_you' and needs_proposal=True."""
    with session_scope() as db:
        s = _staff("prp")
        db.add(s)
        db.flush()

        t = _task(s.id, status="running")
        db.add(t)
        db.flush()

        p = Proposal(
            task_id=t.id,
            staff_id=s.id,
            type="content.publish",
            risk="medium",
            title="Publish the post",
            status="pending",
        )
        db.add(p)
        db.commit()
        task_id = t.id

    with session_scope() as db:
        b = team_board.board(db)

    c = _find_card(b["helpers"], task_id)
    assert c is not None, f"Card for task {task_id} not found"
    assert c["status"] == "needs_you"
    assert c["needs_proposal"] is True


# ---------------------------------------------------------------------------
# Test 4: Paused company flag is propagated
# ---------------------------------------------------------------------------

def test_paused_company_flag(owner):
    """When the company is paused, board returns paused=True."""
    # Set company paused via the API endpoint
    r = owner.post("/api/settings", json={"key": "paused", "value": True})
    # If no settings endpoint, set directly via DB
    if r.status_code not in (200, 204):
        with session_scope() as db:
            s = db.get(Setting, "paused")
            if s is None:
                db.add(Setting(key="paused", value=True))
            else:
                s.value = True
            db.commit()
    try:
        r = owner.get("/api/team/board")
        assert r.status_code == 200
        assert r.json()["paused"] is True
    finally:
        # Clean up: unpause so we don't affect other tests
        with session_scope() as db:
            s = db.get(Setting, "paused")
            if s is not None:
                s.value = False
            db.commit()


# ---------------------------------------------------------------------------
# Test 5: Awaiting-reply thread makes card status "needs_you"
# ---------------------------------------------------------------------------

def test_awaiting_reply_thread_makes_card_needs_you(owner):
    """A Task whose task-scoped Thread has awaiting_reply=True gets card status='needs_you'."""
    with session_scope() as db:
        s = _staff("thr")
        db.add(s)
        db.flush()

        t = _task(s.id, status="running")
        db.add(t)
        db.flush()

        th = Thread(
            scope="task",
            ref_id=t.id,
            staff_id=s.id,
            title="Discuss task",
            awaiting_reply=True,
            updated_at=dt.datetime.now(dt.UTC),
        )
        db.add(th)
        db.commit()
        task_id = t.id

    with session_scope() as db:
        b = team_board.board(db)

    c = _find_card(b["helpers"], task_id)
    assert c is not None, f"Card for task {task_id} not found"
    assert c["status"] == "needs_you"
    assert c["awaiting_reply"] is True


# ---------------------------------------------------------------------------
# Test 6: Goal is attached to card when TaskGoal link exists
# ---------------------------------------------------------------------------

def test_card_goal_linked(owner):
    """A Task with a TaskGoal link shows the goal on its card."""
    with session_scope() as db:
        s = _staff("goal_lnk")
        db.add(s)
        db.flush()

        t = _task(s.id, status="running")
        db.add(t)
        db.flush()

        g = Goal(title="Grow MRR", target="$10k by Dec", due="2026-12-31")
        db.add(g)
        db.flush()

        tg = TaskGoal(task_id=t.id, goal_id=g.id)
        db.add(tg)
        db.commit()
        task_id = t.id
        goal_id = g.id

    with session_scope() as db:
        b = team_board.board(db)

    c = _find_card(b["helpers"], task_id)
    assert c is not None
    assert c["goal"] is not None
    assert c["goal"]["id"] == goal_id
    assert c["goal"]["title"] == "Grow MRR"


# ---------------------------------------------------------------------------
# Test 7: card_progress unit tests
# ---------------------------------------------------------------------------

def test_card_progress_no_checkpoint(owner):
    """card_progress returns {done:0, total:0} when there is no Checkpoint."""
    with session_scope() as db:
        s = _staff("cp_none")
        db.add(s)
        db.flush()
        t = _task(s.id, status="running")
        db.add(t)
        db.commit()
        task_id = t.id

    with session_scope() as db:
        t = db.get(Task, task_id)
        result = team_board.card_progress(db, t)
    assert result == {"done": 0, "total": 0}


def test_card_progress_with_steps(owner):
    """card_progress counts done steps correctly."""
    with session_scope() as db:
        s = _staff("cp_steps")
        db.add(s)
        db.flush()
        t = _task(s.id, status="running")
        db.add(t)
        db.flush()
        ckp = Checkpoint(
            task_id=t.id,
            plan=[
                {"label": "A", "status": "done"},
                {"label": "B", "status": "done"},
                {"label": "C", "status": "pending"},
            ],
        )
        db.add(ckp)
        db.commit()
        task_id = t.id

    with session_scope() as db:
        t = db.get(Task, task_id)
        result = team_board.card_progress(db, t)
    assert result == {"done": 2, "total": 3}


# ---------------------------------------------------------------------------
# Test 8: HTTP endpoint returns 200 with expected shape
# ---------------------------------------------------------------------------

def test_team_board_endpoint_shape(owner):
    """GET /api/team/board returns 200 with paused, server_time, helpers keys."""
    r = owner.get("/api/team/board")
    assert r.status_code == 200
    body = r.json()
    assert "paused" in body
    assert "server_time" in body
    assert "helpers" in body
    assert isinstance(body["helpers"], list)
    # Each helper has the required shape
    for h in body["helpers"]:
        assert "id" in h
        assert "name" in h
        assert "role" in h
        assert "is_chief" in h
        assert "status" in h
        assert "cards" in h
        for c in h["cards"]:
            assert "id" in c
            assert "title" in c
            assert "status" in c
            assert "needs_proposal" in c
            assert "awaiting_reply" in c
            assert "progress" in c
            assert "cost_usd" in c


# ---------------------------------------------------------------------------
# Test 9: helper.activity is set from office state current.brief (running task)
# ---------------------------------------------------------------------------

def test_helper_activity_from_running_task(owner):
    """A helper with a running task has activity == task.brief[:80] (from office state current.brief)."""
    brief_text = "Analyse sales funnel and prepare conversion report"

    with session_scope() as db:
        s = _staff("act_run")
        db.add(s)
        db.flush()

        t = _task(s.id, status="running", brief=brief_text)
        db.add(t)
        db.commit()
        staff_id = s.id

    with session_scope() as db:
        b = team_board.board(db)

    h = _find_helper(b["helpers"], staff_id)
    assert h is not None, f"Helper {staff_id} not found"
    # The activity field must be present on each helper
    assert "activity" in h
    # When the task is running, activity comes from office.state current.brief[:80]
    # office.state._short clips to 220, team_board clips to 80; brief is ≤80 so exact match
    assert h["activity"] == brief_text[:80], (
        f"Expected activity={brief_text[:80]!r}, got {h['activity']!r}"
    )


# ---------------------------------------------------------------------------
# Test 10: card.collaborators contains child-task staff (excluding owner)
# ---------------------------------------------------------------------------

def test_card_collaborators_from_child_tasks(owner):
    """A task with a child task owned by a different staff member has
    that staff member listed in card.collaborators; the parent's own staff is excluded."""
    with session_scope() as db:
        parent_staff = _staff("collab_par")
        child_staff = _staff("collab_chi")
        db.add(parent_staff)
        db.add(child_staff)
        db.flush()

        # Parent task (running)
        parent_task = _task(parent_staff.id, status="running", brief="Parent task work")
        db.add(parent_task)
        db.flush()

        # Child task owned by a different helper, referencing parent
        child_task = _task(
            child_staff.id,
            status="running",
            brief="Child task work",
            parent_task_id=parent_task.id,
        )
        db.add(child_task)
        db.commit()

        parent_staff_id = parent_staff.id
        child_staff_id = child_staff.id
        parent_task_id = parent_task.id

    with session_scope() as db:
        b = team_board.board(db)

    card = _find_card(b["helpers"], parent_task_id)
    assert card is not None, f"Card for parent task {parent_task_id} not found"
    assert "collaborators" in card, "Card must have a 'collaborators' field"

    collab_ids = [c["id"] for c in card["collaborators"]]
    # Child staff is a collaborator
    assert child_staff_id in collab_ids, (
        f"Expected {child_staff_id} in collaborators {collab_ids}"
    )
    # Parent's own staff is NOT a collaborator
    assert parent_staff_id not in collab_ids, (
        f"Parent staff {parent_staff_id} must not appear in collaborators"
    )
    # Each collaborator has id and name
    for c in card["collaborators"]:
        assert "id" in c and "name" in c
