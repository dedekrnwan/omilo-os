"""Team board — per-helper work cards for the "By helper" UI view.

Exposes:
  card_progress(db, task)  ->  {"done": int, "total": int}
  board(db, days=14)       ->  {"paused": bool, "server_time": str, "helpers": [Helper]}

Helper shape:
  {"id", "name", "role", "is_chief", "status", "cards": [Card]}

Card shape:
  {"id", "title", "staff_id", "status", "needs_proposal", "awaiting_reply",
   "progress", "goal", "cost_usd", "updated_at"}

Card status derivation precedence (highest to lowest):
  needs_you  (open proposal OR task-scoped thread awaiting_reply)
  running
  waiting    (queued maps to waiting)
  done / failed
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    Checkpoint,
    Goal,
    Proposal,
    Staff,
    Task,
    TaskGoal,
    Thread,
    now,
)


def _iso(d: dt.datetime | None) -> str | None:
    if d is None:
        return None
    if not d.tzinfo:
        d = d.replace(tzinfo=dt.UTC)
    return d.isoformat()


def _title(brief: str) -> str:
    """First line of the task brief, clipped to 70 chars."""
    first = (brief or "").strip().splitlines()[0] if (brief or "").strip() else "Job"
    first = " ".join(first.replace("**", "").replace("#", "").replace("`", "").split())
    return first if len(first) <= 70 else first[:69] + "…"


# --------------------------------------------------------------------------- card_progress

def card_progress(db: Session, task: Task) -> dict:
    """Count Checkpoint.plan steps whose status=='done' vs total.

    Returns {"done": 0, "total": 0} when there is no checkpoint or the plan is empty.
    """
    ckp = db.scalar(
        select(Checkpoint)
        .where(Checkpoint.task_id == task.id)
        .order_by(Checkpoint.at.desc())
        .limit(1)
    )
    if not ckp or not ckp.plan:
        return {"done": 0, "total": 0}

    plan = ckp.plan
    steps: list[dict] = []
    if isinstance(plan, list):
        for step in plan:
            if isinstance(step, dict):
                steps.append(step)
    elif isinstance(plan, dict):
        for k, v in plan.items():
            steps.append({"label": k, "status": str(v)})

    total = len(steps)
    done = sum(1 for s in steps if s.get("status") == "done")
    return {"done": done, "total": total}


# --------------------------------------------------------------------------- board

def board(db: Session, days: int = 14) -> dict:
    """Return the full team board: one entry per active helper, each with their live cards."""
    from . import office as O

    state = O.state(db)
    paused: bool = state["paused"]
    server_time: str = state["server_time"]

    cutoff = now() - dt.timedelta(days=days)

    # ---------------------------------------------------------------- collect qualifying tasks

    # Tasks from the last `days` with live statuses
    live_tasks = list(db.scalars(
        select(Task)
        .where(
            Task.status.in_(["running", "queued", "waiting"]),
            Task.created_at >= cutoff,
        )
    ))

    # Tasks with an open Proposal (status in pending/changes_requested)
    open_proposal_task_ids: set[str] = set(
        db.scalars(
            select(Proposal.task_id)
            .where(
                Proposal.status.in_(["pending", "changes_requested"]),
                Proposal.task_id.is_not(None),
            )
        )
    )

    # Tasks whose task-scoped thread is awaiting_reply
    awaiting_thread_task_ids: set[str] = set(
        db.scalars(
            select(Thread.ref_id)
            .where(
                Thread.scope == "task",
                Thread.awaiting_reply.is_(True),
                Thread.ref_id.is_not(None),
            )
        )
    )

    # Collect all qualifying task IDs
    all_task_ids: set[str] = {t.id for t in live_tasks} | open_proposal_task_ids | awaiting_thread_task_ids

    # Load tasks we don't yet have (open proposal / awaiting thread tasks not in live window)
    extra_ids = (open_proposal_task_ids | awaiting_thread_task_ids) - {t.id for t in live_tasks}
    extra_tasks: list[Task] = []
    if extra_ids:
        extra_tasks = list(db.scalars(select(Task).where(Task.id.in_(extra_ids))))

    all_tasks: dict[str, Task] = {t.id: t for t in live_tasks + extra_tasks}

    # ---------------------------------------------------------------- goal lookup

    task_goals: dict[str, tuple[str, str]] = {}  # task_id -> (goal_id, goal_title)
    if all_task_ids:
        rows = db.execute(
            select(TaskGoal.task_id, Goal.id, Goal.title)
            .join(Goal, Goal.id == TaskGoal.goal_id)
            .where(TaskGoal.task_id.in_(all_task_ids))
        ).all()
        for task_id, goal_id, goal_title in rows:
            task_goals[task_id] = (goal_id, goal_title)

    # ---------------------------------------------------------------- collaborators lookup (child tasks per parent task)
    # Batch query: for each task in all_task_ids, find child tasks (handoffs) and their staff.
    # collaborators[parent_task_id] = list of {id, name} for child-task staff EXCLUDING parent's own staff.
    child_task_rows: list[tuple[str, str]] = []  # (parent_task_id, child_staff_id)
    if all_task_ids:
        child_task_rows = list(db.execute(
            select(Task.parent_task_id, Task.staff_id)
            .where(Task.parent_task_id.in_(all_task_ids))
            .distinct()
        ).all())

    # Build staff name map for collaborator lookup
    staff_name_map: dict[str, str] = {s.id: s.name for s in db.scalars(select(Staff))}

    # Build parent_task_id -> list of child staff_id (deduplicated, excluding parent's own staff)
    _child_staff_by_parent: dict[str, list[str]] = {}
    for parent_tid, child_sid in child_task_rows:
        if parent_tid:
            _child_staff_by_parent.setdefault(parent_tid, []).append(child_sid)

    def _collaborators(task: Task) -> list[dict]:
        """Return up to 3 distinct child-task staff members (excluding the task's own staff)."""
        child_sids = _child_staff_by_parent.get(task.id, [])
        seen: set[str] = set()
        result: list[dict] = []
        for sid in child_sids:
            if sid != task.staff_id and sid not in seen:
                seen.add(sid)
                result.append({"id": sid, "name": staff_name_map.get(sid, sid)})
                if len(result) >= 3:
                    break
        return result

    # ---------------------------------------------------------------- build agent activity map from office state
    # agent["current"] = {"kind": "job"|"chat", "brief": str, ...} | None
    agent_activity: dict[str, str | None] = {}
    for agent in state["agents"]:
        cur = agent.get("current")
        if cur and cur.get("brief"):
            agent_activity[agent["id"]] = cur["brief"][:80]
        else:
            agent_activity[agent["id"]] = None

    # ---------------------------------------------------------------- build per-helper card lists

    # Index tasks by staff_id
    tasks_by_staff: dict[str, list[Task]] = {}
    for t in all_tasks.values():
        tasks_by_staff.setdefault(t.staff_id, []).append(t)

    helpers: list[dict] = []
    for agent in state["agents"]:
        staff_tasks = tasks_by_staff.get(agent["id"], [])

        # Sort newest first (by created_at desc)
        staff_tasks.sort(key=lambda t: t.created_at or dt.datetime.min.replace(tzinfo=dt.UTC), reverse=True)

        cards: list[dict] = []
        for task in staff_tasks:
            needs_proposal = task.id in open_proposal_task_ids
            awaiting_reply = task.id in awaiting_thread_task_ids

            # Status derivation: needs_you > running > waiting > done/failed
            if needs_proposal or awaiting_reply:
                card_status = "needs_you"
            elif task.status == "running":
                card_status = "running"
            elif task.status in ("queued", "waiting"):
                card_status = "waiting"
            else:
                card_status = task.status  # done | failed | cancelled

            g = task_goals.get(task.id)
            goal = {"id": g[0], "title": g[1]} if g else None

            # updated_at: prefer ended_at > started_at > created_at
            updated_raw = task.ended_at or task.started_at or task.created_at

            cards.append({
                "id": task.id,
                "title": _title(task.brief),
                "staff_id": task.staff_id,
                "status": card_status,
                "needs_proposal": needs_proposal,
                "awaiting_reply": awaiting_reply,
                "progress": card_progress(db, task),
                "goal": goal,
                "cost_usd": round(task.cost_usd or 0.0, 4),
                "updated_at": _iso(updated_raw),
                "collaborators": _collaborators(task),
            })

        helpers.append({
            "id": agent["id"],
            "name": agent["name"],
            "role": agent["role"],
            "is_chief": agent["is_chief"],
            "status": agent["status"],
            "activity": agent_activity.get(agent["id"]),
            "cards": cards,
        })

    return {
        "paused": paused,
        "server_time": server_time,
        "helpers": helpers,
    }
