"""Tests for the unified live work-state read model (worklog.live_state).

These are self-contained: each test creates its own rows (Staff + Task/Thread/InboxItem)
and only isolates them by unique staff IDs, so they don't interact with the session-scoped
fixtures from other test modules.

Run with:
    cd apps/api && pytest tests/test_worklog.py -v
"""
import datetime as dt

import pytest

from conftest import cleanup_main_company_non_terminal_tasks
from omilo_api.db import session_scope
from omilo_api.models import InboxItem, Staff, Task, TaskGoal, Thread
from omilo_api.worklog import live_state


@pytest.fixture(scope="module", autouse=True)
def _cleanup_worklog_tasks():
    """At module teardown, purge non-terminal rows created by this module from the
    shared MAIN company so the background worker's dispatch slots stay free for
    later test modules (e.g. test_harness)."""
    yield
    cleanup_main_company_non_terminal_tasks("wl_staff_")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _staff(suffix: str) -> Staff:
    return Staff(
        id=f"wl_staff_{suffix}",
        name=f"Staff {suffix}",
        role="tester",
        is_chief=False,
        status="active",
    )


def _task(staff_id: str, status: str, **kw) -> Task:
    defaults = dict(
        origin="manual",
        brief="Do something important\nMore details here",
        status=status,
        created_at=dt.datetime.now(dt.UTC),
    )
    if status == "running":
        defaults["started_at"] = dt.datetime.now(dt.UTC)
    defaults.update(kw)
    return Task(staff_id=staff_id, **defaults)


def _thread(staff_id: str, awaiting: bool, **kw) -> Thread:
    defaults = dict(
        scope="staff",
        title="Chat with owner",
        awaiting_reply=awaiting,
        updated_at=dt.datetime.now(dt.UTC),
    )
    defaults.update(kw)
    return Thread(staff_id=staff_id, **defaults)


def _inbox(staff_id: str, kind: str, status: str = "open") -> InboxItem:
    return InboxItem(
        kind=kind,
        staff_id=staff_id,
        title=f"A {kind} from {staff_id}",
        status=status,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_live_state_unions_tasks_and_chats(owner):
    """A running task for staff A and an awaiting-reply thread for staff B both appear."""
    with session_scope() as db:
        sa = _staff("A_union")
        sb = _staff("B_union")
        db.add_all([sa, sb])
        db.flush()

        task_a = _task(sa.id, "running")
        thread_b = _thread(sb.id, awaiting=True)
        db.add_all([task_a, thread_b])
        db.commit()

    with session_scope() as db:
        s = live_state(db)

    kinds = {(i["kind"], i["staff_id"]) for i in s["items"]}
    assert ("task", sa.id) in kinds
    assert ("chat", sb.id) in kinds   # the desync bug: chat work IS live work


def test_live_state_excludes_finished(owner):
    """A done task and a thread with awaiting_reply=False neither appear."""
    with session_scope() as db:
        sc = _staff("C_done")
        db.add(sc)
        db.flush()

        done_task = _task(sc.id, "done")
        idle_thread = _thread(sc.id, awaiting=False)
        db.add_all([done_task, idle_thread])
        db.commit()

    with session_scope() as db:
        items = [i for i in live_state(db)["items"] if i["staff_id"] == sc.id]
    assert items == []


def test_live_state_includes_queued_and_waiting_tasks(owner):
    """Tasks with status 'queued' or 'waiting' also appear."""
    with session_scope() as db:
        sd = _staff("D_queued")
        se = _staff("E_waiting")
        db.add_all([sd, se])
        db.flush()

        queued_task = _task(sd.id, "queued")
        waiting_task = _task(se.id, "waiting")
        db.add_all([queued_task, waiting_task])
        db.commit()

    with session_scope() as db:
        items = live_state(db)["items"]

    staff_kinds = {(i["kind"], i["staff_id"], i["status"]) for i in items}
    assert ("task", sd.id, "queued") in staff_kinds
    assert ("task", se.id, "waiting") in staff_kinds


def test_live_state_includes_open_inbox_proposals_and_questions(owner):
    """Open InboxItems of kind 'proposal' and 'question' appear with correct kinds."""
    with session_scope() as db:
        sf = _staff("F_inbox")
        db.add(sf)
        db.flush()

        prop = _inbox(sf.id, "proposal")
        q = _inbox(sf.id, "question")
        alert = _inbox(sf.id, "alert")        # should NOT appear
        closed_prop = _inbox(sf.id, "proposal", status="done")  # should NOT appear
        db.add_all([prop, q, alert, closed_prop])
        db.commit()

    with session_scope() as db:
        items = [i for i in live_state(db)["items"] if i["staff_id"] == sf.id]

    item_kinds = {i["kind"] for i in items}
    assert "proposal" in item_kinds
    assert "question" in item_kinds
    assert "alert" not in item_kinds
    assert len(items) == 2  # alert and closed_prop excluded


def test_live_state_workitem_shape(owner):
    """WorkItem dicts have all required keys with correct types."""
    with session_scope() as db:
        sg = _staff("G_shape")
        db.add(sg)
        db.flush()

        task = _task(sg.id, "running")
        db.add(task)
        db.commit()

    with session_scope() as db:
        items = [i for i in live_state(db)["items"] if i["staff_id"] == sg.id]

    assert len(items) == 1
    item = items[0]
    required_keys = {"kind", "id", "staff_id", "status", "title", "goal_id", "since"}
    assert required_keys <= set(item.keys()), f"Missing keys: {required_keys - set(item.keys())}"
    assert item["kind"] == "task"
    assert item["status"] == "running"
    assert item["staff_id"] == sg.id
    assert isinstance(item["title"], str) and item["title"]
    assert item["goal_id"] is None   # no TaskGoal row
    # since should be an ISO string or None
    if item["since"] is not None:
        assert "T" in item["since"]


def test_live_state_task_goal_id(owner):
    """goal_id is populated when a TaskGoal row exists."""
    with session_scope() as db:
        sh = _staff("H_goal")
        db.add(sh)
        db.flush()

        task = _task(sh.id, "running")
        db.add(task)
        db.flush()

        goal_id = "gol_test123"
        tg = TaskGoal(task_id=task.id, goal_id=goal_id)
        db.add(tg)
        db.commit()

    with session_scope() as db:
        items = [i for i in live_state(db)["items"] if i["staff_id"] == sh.id]

    assert len(items) == 1
    assert items[0]["goal_id"] == goal_id


def test_live_state_chat_workitem_shape(owner):
    """Chat WorkItems have kind='chat', status='working', and title from thread title."""
    with session_scope() as db:
        si = _staff("I_chat")
        db.add(si)
        db.flush()

        thread = _thread(si.id, awaiting=True, title="Planning call")
        db.add(thread)
        db.commit()

    with session_scope() as db:
        items = [i for i in live_state(db)["items"] if i["staff_id"] == si.id]

    assert len(items) == 1
    item = items[0]
    assert item["kind"] == "chat"
    assert item["status"] == "working"
    assert item["title"] == "Planning call"
    assert item["goal_id"] is None
    assert item["id"]  # the thread id


def test_live_state_returns_dict_with_items_key(owner):
    """live_state always returns a dict with an 'items' key containing a list."""
    with session_scope() as db:
        result = live_state(db)
    assert isinstance(result, dict)
    assert "items" in result
    assert isinstance(result["items"], list)
