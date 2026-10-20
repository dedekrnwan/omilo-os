"""Tests for board.build() — Inbox board columns.

Self-contained: each test creates its own rows (Staff + Task/Thread) and isolates
them by unique staff IDs, so they don't interact with session-scoped fixtures.

Run with:
    cd apps/api && pytest tests/test_board.py -v
"""
import datetime as dt

import pytest

from omilo_api import board
from omilo_api.db import session_scope
from omilo_api.models import Staff, Task, Thread


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _staff(suffix: str) -> Staff:
    return Staff(
        id=f"bd_staff_{suffix}",
        name=f"BoardStaff {suffix}",
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


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_board_running_includes_chat(owner):
    """A Thread with awaiting_reply=True (no Task) → board RUNNING has a chat-kind card."""
    with session_scope() as db:
        sa = _staff("chat_only")
        db.add(sa)
        db.flush()

        thread = _thread(sa.id, awaiting=True, title="Replying to customer")
        db.add(thread)
        db.commit()

    with session_scope() as db:
        b = board.build(db)

    assert any(c.get("kind") == "chat" for c in b["running"]), (
        "Expected a chat-kind card in RUNNING but none found. "
        "Board RUNNING only shows Tasks, missing in-flight chat work."
    )


def test_board_running_chat_card_shape(owner):
    """Chat cards in RUNNING have the expected fields."""
    with session_scope() as db:
        sb = _staff("chat_shape")
        db.add(sb)
        db.flush()

        thread = _thread(sb.id, awaiting=True, title="Discussing strategy")
        db.add(thread)
        db.commit()
        thread_id = thread.id

    with session_scope() as db:
        b = board.build(db)

    chat_cards = [c for c in b["running"] if c.get("kind") == "chat" and c.get("id") == thread_id]
    assert chat_cards, "Expected a chat card for the created thread"
    card = chat_cards[0]
    assert card["kind"] == "chat"
    assert card["id"] == thread_id
    assert "title" in card
    assert "summary" in card
    assert "staff" in card


def test_board_running_task_cards_unchanged(owner):
    """Existing running task cards still appear and have the expected structure."""
    with session_scope() as db:
        sc = _staff("task_unchanged")
        db.add(sc)
        db.flush()

        task = _task(sc.id, "running")
        db.add(task)
        db.commit()
        task_id = task.id

    with session_scope() as db:
        b = board.build(db)

    task_cards = [c for c in b["running"] if c.get("id") == task_id]
    assert task_cards, "Running task should appear in RUNNING"
    card = task_cards[0]
    # Task cards don't have kind="chat"; they have status field
    assert card.get("kind") != "chat"
    assert "status" in card
    assert card["status"] == "running"


def test_board_running_chat_stable_order(owner):
    """Multiple awaiting-reply threads appear in a stable order (by since then id)."""
    with session_scope() as db:
        sd = _staff("chat_order")
        db.add(sd)
        db.flush()

        base = dt.datetime.now(dt.UTC)
        t1 = _thread(sd.id, awaiting=True, title="First",
                     updated_at=base - dt.timedelta(seconds=10))
        t2 = _thread(sd.id, awaiting=True, title="Second",
                     updated_at=base - dt.timedelta(seconds=5))
        t3 = _thread(sd.id, awaiting=True, title="Third",
                     updated_at=base)
        db.add_all([t1, t2, t3])
        db.commit()
        ids = [t1.id, t2.id, t3.id]

    with session_scope() as db:
        b = board.build(db)

    our_cards = [c for c in b["running"] if c.get("kind") == "chat" and c.get("id") in ids]
    assert len(our_cards) == 3
    # Verify stable order: earlier since comes first
    sinces = [c.get("since") for c in our_cards]
    assert sinces == sorted(sinces), "Chat cards should be in ascending since order"


def test_board_idle_thread_not_in_running(owner):
    """A thread with awaiting_reply=False does NOT appear in RUNNING."""
    with session_scope() as db:
        se = _staff("idle_thread")
        db.add(se)
        db.flush()

        thread = _thread(se.id, awaiting=False, title="Done chatting")
        db.add(thread)
        db.commit()
        thread_id = thread.id

    with session_scope() as db:
        b = board.build(db)

    assert not any(c.get("id") == thread_id for c in b["running"]), (
        "Idle thread (awaiting_reply=False) should not appear in RUNNING"
    )
