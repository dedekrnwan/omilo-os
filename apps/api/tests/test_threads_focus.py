"""Thread grouping, focus aggregation, and add-helper endpoint tests.

Tests for:
 (a) Thread grouping: needs_you / active / earlier
 (b) GET /threads/{id}/focus: aggregates cost/tokens/steps/files from linked task
 (c) POST /threads/{id}/add-helper: adds participant, idempotent

Run with:
    cd apps/api && .venv/bin/pytest -q tests/test_threads_focus.py
"""
import datetime as dt

import pytest

from omilo_api import thread_extras
from omilo_api.db import session_scope
from omilo_api.models import Checkpoint, Goal, KbSource, Staff, Task, TaskGoal, Thread

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _staff(suffix: str) -> Staff:
    return Staff(
        id=f"tf_staff_{suffix}",
        name=f"TF Staff {suffix}",
        role="tester",
        is_chief=False,
        status="active",
    )


def _thread(staff_id: str, **kw) -> Thread:
    defaults = dict(
        scope="staff",
        title="Test thread",
        awaiting_reply=False,
        updated_at=dt.datetime.now(dt.UTC),
    )
    defaults.update(kw)
    return Thread(staff_id=staff_id, **defaults)


def _task(staff_id: str, **kw) -> Task:
    defaults = dict(
        origin="chat",
        brief="Build the feature",
        status="done",
        cost_usd=0.05,
        tokens=500,
    )
    defaults.update(kw)
    return Task(staff_id=staff_id, **defaults)


# ---------------------------------------------------------------------------
# (a) Thread grouping
# ---------------------------------------------------------------------------

def test_grouping_needs_you(owner):
    """A thread with awaiting_reply=True → group='needs_you'."""
    with session_scope() as db:
        s = _staff("g_needs_you")
        db.add(s)
        db.flush()
        th = _thread(
            s.id,
            awaiting_reply=True,
            title="Awaiting reply",
            updated_at=dt.datetime.now(dt.UTC),
        )
        db.add(th)
        db.commit()
        thread_id = th.id

    with session_scope() as db:
        th = db.get(Thread, thread_id)
        g = thread_extras.group(th)

    assert g == "needs_you"


def test_grouping_active(owner):
    """A non-awaiting thread updated within 4 hours → group='active'."""
    with session_scope() as db:
        s = _staff("g_active")
        db.add(s)
        db.flush()
        th = _thread(
            s.id,
            awaiting_reply=False,
            title="Active thread",
            updated_at=dt.datetime.now(dt.UTC) - dt.timedelta(hours=1),
        )
        db.add(th)
        db.commit()
        thread_id = th.id

    with session_scope() as db:
        th = db.get(Thread, thread_id)
        g = thread_extras.group(th)

    assert g == "active"


def test_grouping_earlier(owner):
    """A non-awaiting thread updated over 4 hours ago → group='earlier'."""
    with session_scope() as db:
        s = _staff("g_earlier")
        db.add(s)
        db.flush()
        th = _thread(
            s.id,
            awaiting_reply=False,
            title="Old thread",
            updated_at=dt.datetime.now(dt.UTC) - dt.timedelta(hours=8),
        )
        db.add(th)
        db.commit()
        thread_id = th.id

    with session_scope() as db:
        th = db.get(Thread, thread_id)
        g = thread_extras.group(th)

    assert g == "earlier"


def test_thread_list_has_derived_fields(owner):
    """GET /threads returns items with group, subtitle, participants, last_at."""
    with session_scope() as db:
        s = _staff("g_list")
        db.add(s)
        db.flush()
        th = _thread(
            s.id,
            awaiting_reply=True,
            title="List test thread",
            updated_at=dt.datetime.now(dt.UTC),
        )
        db.add(th)
        db.commit()

    threads = owner.get("/api/threads").json()
    assert isinstance(threads, list)
    # find our thread
    our = next((t for t in threads if t.get("title") == "List test thread"), None)
    assert our is not None, "thread not found in list"
    assert our["group"] == "needs_you"
    assert "subtitle" in our
    assert "participants" in our
    assert isinstance(our["participants"], list)
    assert "last_at" in our


# ---------------------------------------------------------------------------
# (b) Focus aggregation
# ---------------------------------------------------------------------------

def test_focus_with_linked_task(owner):
    """GET /threads/{id}/focus aggregates cost/tokens/steps/files from linked task."""
    with session_scope() as db:
        s = _staff("focus_task")
        db.add(s)
        db.flush()

        task = _task(
            s.id,
            status="done",
            cost_usd=0.12,
            tokens=1200,
            started_at=dt.datetime.now(dt.UTC) - dt.timedelta(minutes=8),
            ended_at=dt.datetime.now(dt.UTC),
        )
        db.add(task)
        db.flush()
        task_id = task.id

        # checkpoint with plan steps
        ckp = Checkpoint(
            task_id=task_id,
            plan=[{"label": "Research market", "status": "done"},
                  {"label": "Write draft", "status": "done"}],
            done="Research market",
            next="",
        )
        db.add(ckp)

        th = _thread(
            s.id,
            scope="task",
            ref_id=task_id,
            title="Focus thread",
        )
        db.add(th)
        db.flush()
        thread_id = th.id

        # KbSource for this thread
        kb = KbSource(
            kind="file",
            ref=thread_id,
            title="Campaign brief.pdf",
        )
        db.add(kb)

        # KbSource for the task
        kb2 = KbSource(
            kind="doc",
            ref=task_id,
            title="Research notes",
        )
        db.add(kb2)

        db.commit()

    resp = owner.get(f"/api/threads/{thread_id}/focus")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert "progress" in data
    assert "files" in data
    assert "cost" in data

    # cost fields
    assert data["cost"]["usd"] == pytest.approx(0.12, abs=0.001)
    assert data["cost"]["tokens"] == 1200
    assert data["cost"]["minutes"] >= 7  # ~8 min

    # files from both thread and task
    titles = [f["title"] for f in data["files"]]
    assert "Campaign brief.pdf" in titles
    assert "Research notes" in titles

    # progress from checkpoint plan
    labels = [p["label"] for p in data["progress"]]
    assert "Research market" in labels
    assert "Write draft" in labels


def test_focus_without_linked_task(owner):
    """GET /threads/{id}/focus on a non-task thread returns empty arrays + zeroed cost."""
    with session_scope() as db:
        s = _staff("focus_no_task")
        db.add(s)
        db.flush()
        th = _thread(s.id, scope="staff", title="Staff thread no task")
        db.add(th)
        db.commit()
        thread_id = th.id

    resp = owner.get(f"/api/threads/{thread_id}/focus")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["progress"] == []
    assert data["files"] == []
    assert data["cost"]["usd"] == 0.0
    assert data["cost"]["tokens"] == 0
    assert data["cost"]["minutes"] == 0


def test_focus_task_id_and_status_in_thread_list(owner):
    """Thread list items for scope='task' include task_id and task_status."""
    with session_scope() as db:
        s = _staff("focus_tl")
        db.add(s)
        db.flush()

        task = _task(s.id, status="done")
        db.add(task)
        db.flush()
        task_id = task.id

        th = _thread(
            s.id,
            scope="task",
            ref_id=task_id,
            title="Task thread for list",
        )
        db.add(th)
        db.commit()

    threads = owner.get("/api/threads").json()
    task_threads = [t for t in threads if t.get("scope") == "task" and t.get("ref_id") == task_id]
    assert task_threads, "task-scope thread not found in list"
    t = task_threads[0]
    assert t.get("task_id") == task_id
    assert t.get("task_status") == "done"


# ---------------------------------------------------------------------------
# (c) add-helper
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# (d) Thread goal enrichment
# ---------------------------------------------------------------------------

def test_task_thread_with_goal_returns_goal_in_get(owner):
    """GET /api/threads/{id} for a task-scoped thread whose task has a linked Goal
    returns goal: {id, title} in the response body."""
    with session_scope() as db:
        s = _staff("tg_goal")
        db.add(s)
        db.flush()

        task = _task(s.id, status="running", brief="Build the landing page")
        db.add(task)
        db.flush()

        g = Goal(title="Grow signups", target="500 signups by Q4", due="2026-12-31")
        db.add(g)
        db.flush()

        tg = TaskGoal(task_id=task.id, goal_id=g.id)
        db.add(tg)

        th = _thread(
            s.id,
            scope="task",
            ref_id=task.id,
            title="Landing page thread",
        )
        db.add(th)
        db.commit()

        thread_id = th.id
        goal_id = g.id
        goal_title = g.title

    resp = owner.get(f"/api/threads/{thread_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert "goal" in data, f"Expected 'goal' in thread response, got keys: {list(data.keys())}"
    assert data["goal"] is not None, "goal must not be null when a TaskGoal link exists"
    assert data["goal"]["id"] == goal_id
    assert data["goal"]["title"] == goal_title


def test_add_helper_adds_participant(owner):
    """POST /threads/{id}/add-helper with staff_id adds a system @mention turn."""
    # Use an existing staff member from the session-scoped team
    with session_scope() as db:
        th = _thread("chief-of-staff", scope="group", title="Helper test room")
        db.add(th)
        db.commit()
        thread_id = th.id

    resp = owner.post(f"/api/threads/{thread_id}/add-helper", json={"staff_id": "marketing"})
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # returned thread has a message about marketing
    all_texts = " ".join(m["text"] for m in data.get("messages", []))
    assert "marketing" in all_texts.lower() or "TF Staff" in all_texts or "@" in all_texts

    # participants includes marketing
    assert "marketing" in data.get("participants", [])


def test_add_helper_idempotent(owner):
    """POST /threads/{id}/add-helper with the same staff_id twice is idempotent."""
    with session_scope() as db:
        th = _thread("chief-of-staff", scope="group", title="Idempotent room")
        db.add(th)
        db.commit()
        thread_id = th.id

    # first call
    r1 = owner.post(f"/api/threads/{thread_id}/add-helper", json={"staff_id": "sales"})
    assert r1.status_code == 200, r1.text
    msgs_after_1 = r1.json().get("messages", [])

    # second call (idempotent)
    r2 = owner.post(f"/api/threads/{thread_id}/add-helper", json={"staff_id": "sales"})
    assert r2.status_code == 200, r2.text
    msgs_after_2 = r2.json().get("messages", [])

    # no extra system message was added on the second call
    assert len(msgs_after_2) == len(msgs_after_1), (
        "Second add-helper call should not add a duplicate message"
    )
