"""Goal thread feed: opening a goal's chat seeds a Chief summary, and a finished linked job adds a line.

Run with:
    cd apps/api && .venv/bin/pytest -q tests/test_goal_feed.py
"""
from omilo_api import services as S
from omilo_api import thread_extras as TE
from omilo_api.db import session_scope
from omilo_api.models import Goal, Message, Report, Staff, Task, TaskGoal, Thread
from omilo_api.worker import Worker


def _setup(key: str, task_status: str = "done") -> tuple[str, str]:
    """A Chief, a goal, and one job linked to that goal. Returns (goal_id, task_id)."""
    with session_scope() as db:
        ch = Staff(id=f"gf_chief_{key}", name="Chief", is_chief=True, status="active", engine={"type": "fake"})
        helper = Staff(id=f"gf_helper_{key}", name="Wira", role="marketing", status="active")
        db.add_all([ch, helper])
        g = Goal(id=f"gf_goal_{key}", title="Reach 100 customers", target="100 paying by Dec", due="2026-12-31")
        db.add(g)
        t = Task(id=f"gf_task_{key}", staff_id=helper.id, origin="chat", brief="Call 10 leads today", status=task_status)
        db.add(t)
        db.add(TaskGoal(task_id=t.id, goal_id=g.id))
        db.flush()
        return g.id, t.id


def test_goal_intro_names_goal_and_work():
    gid, _ = _setup("intro")
    with session_scope() as db:
        g = db.get(Goal, gid)
        text = TE.goal_intro(db, g)
    assert "Reach 100 customers" in text
    assert "Wira" in text and "Call 10 leads today" in text  # the linked job shows who's on it


def test_activity_line_formats_by_status():
    assert TE.goal_activity_line("Wira", "Call 10 leads", "done", "Booked 3 demos").startswith("✅ **Wira** finished")
    assert "Booked 3 demos" in TE.goal_activity_line("Wira", "Call 10 leads", "done", "Booked 3 demos")
    assert TE.goal_activity_line("Wira", "Call 10 leads", "failed").startswith("⚠️ **Wira** couldn't finish")


def test_opening_goal_thread_seeds_chief_intro(owner):
    gid, _ = _setup("open")
    th = owner.post("/api/threads", json={"scope": "goal", "ref_id": gid}).json()
    detail = owner.get(f"/api/threads/{th['id']}").json()
    assert detail["messages"], "goal thread should not be empty on first open"
    assert any("Reach 100 customers" in m["text"] for m in detail["messages"])
    # idempotent: opening again does not add a second intro
    owner.post("/api/threads", json={"scope": "goal", "ref_id": gid})
    again = owner.get(f"/api/threads/{th['id']}").json()
    assert len(again["messages"]) == len(detail["messages"])


def test_finished_job_posts_activity_line_to_goal_thread():
    gid, tid = _setup("finish")
    with session_scope() as db:
        t = db.get(Task, tid)
        db.add(Report(task_id=t.id, staff_id=t.staff_id, headline="Booked 3 demos", body_md="…"))
    # call the worker hook directly with the task + its report
    with session_scope() as db:
        from sqlalchemy import select
        t = db.get(Task, tid)
        rep = db.scalar(select(Report).where(Report.task_id == t.id))
        Worker.__new__(Worker)._post_goal_activity(db, t, rep)
        db.commit()
    with session_scope() as db:
        from sqlalchemy import select
        g = db.get(Goal, gid)
        ch = S.chief(db)
        gth = db.scalar(select(Thread).where(Thread.scope == "goal", Thread.ref_id == g.id))
        msgs = list(db.scalars(select(Message).where(Message.thread_id == gth.id).order_by(Message.at)))
    texts = [m.text for m in msgs]
    assert any(t.startswith("Here's the goal") for t in texts)          # intro seeded
    assert any("✅ **Wira** finished" in t and "Booked 3 demos" in t for t in texts)  # the activity line
