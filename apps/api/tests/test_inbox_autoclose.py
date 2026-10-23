"""Tests for automatic Inbox resolution when a task ends (services.finish_task).

When a Task reaches a terminal state (done/failed/cancelled), any approval or question
still open against it is moot — the work it gated already finished or stopped — so those
Inbox items must close automatically. The Inbox then reflects what genuinely still needs
the owner instead of lingering decisions on work that is already over.

Run with:
    cd apps/api && pytest tests/test_inbox_autoclose.py -v
"""
import datetime as dt

import pytest
from conftest import cleanup_main_company_non_terminal_tasks
from sqlalchemy import select

from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.models import InboxItem, Proposal, Staff, Task


@pytest.fixture(scope="module", autouse=True)
def _cleanup_autoclose_tasks():
    yield
    cleanup_main_company_non_terminal_tasks("ac_staff_")


def _mk_staff_task(db, suffix: str, status: str = "running") -> tuple[Staff, Task]:
    st = Staff(id=f"ac_staff_{suffix}", name=f"AC {suffix}", role="tester", is_chief=False, status="active")
    db.add(st)
    db.flush()
    t = Task(
        staff_id=st.id, origin="manual", brief="Reconcile the July payouts", status=status,
        created_at=dt.datetime.now(dt.UTC), started_at=dt.datetime.now(dt.UTC),
    )
    db.add(t)
    db.flush()
    return st, t


def test_finish_task_closes_open_proposal_and_question(owner):
    """A terminal task auto-closes its open proposal + question Inbox items, and the
    pending proposal row is resolved by the system (not left dangling)."""
    with session_scope() as db:
        st, t = _mk_staff_task(db, "close")
        p = S.create_proposal(
            db, st, task_id=t.id, title="Publish the weekly recap",
            type_="content.publish", risk="low", body="Draft is ready to post.", actor="owner",
        )
        q = S.ask_founder(db, st, t.id, "Which account should I reconcile first?", blocking=False)
        prop_item = db.scalar(select(InboxItem).where(InboxItem.kind == "proposal", InboxItem.ref_id == p.id))
        db.commit()
        prop_item_id, q_id, p_id, t_id = prop_item.id, q.id, p.id, t.id

    # Precondition: both items are open while the task is live.
    with session_scope() as db:
        assert db.get(InboxItem, prop_item_id).status == "open"
        assert db.get(InboxItem, q_id).status == "open"

    # The task is cancelled before the owner ever decided.
    with session_scope() as db:
        S.finish_task(db, db.get(Task, t_id), "cancelled")

    # Both Inbox items are now closed, and the proposal is resolved by the system.
    with session_scope() as db:
        assert db.get(InboxItem, prop_item_id).status == "done"
        assert db.get(InboxItem, q_id).status == "done"
        p = db.get(Proposal, p_id)
        assert p.status == "rejected"
        assert p.decided_by == "system"


def test_finish_task_leaves_unrelated_items_open(owner):
    """Finishing one task must not touch Inbox items tied to a different, still-running task."""
    with session_scope() as db:
        st, t1 = _mk_staff_task(db, "keepA")
        _, t2 = _mk_staff_task(db, "keepB")
        q_other = S.ask_founder(db, st, t2.id, "Unrelated question about the other task?", blocking=False)
        db.commit()
        q_other_id, t1_id = q_other.id, t1.id

    with session_scope() as db:
        S.finish_task(db, db.get(Task, t1_id), "done")

    with session_scope() as db:
        assert db.get(InboxItem, q_other_id).status == "open"
