"""Thread-grouping, focus aggregation and participant derivation helpers.

All computations are derived at read time — no new DB columns.

Grouping cutoffs (documented here as the definitive record):
  - needs_you: thread.awaiting_reply is True
  - active:    awaiting_reply is False AND updated within the last 4 hours
  - earlier:   awaiting_reply is False AND updated more than 4 hours ago

4 hours was chosen because it spans a typical half-day work block; threads that
had activity "this morning" still feel live, while threads from yesterday
naturally fall into "earlier".

Participant derivation:
  participants = thread.pending (helpers yet to reply to the latest message)
                 ∪ distinct authors of agent-role messages in the thread

This is purely read-time and covers the "persistent membership" need:
- pending already tracks who is in the current conversational loop.
- Past agent-message authors record every helper that has *ever* spoken.
No nullable Thread.participants column is needed; derivation is sufficient.
(Ruling: a helper who is @mentioned once stays in the participants set for
the lifetime of the thread because their agent-message author record persists.
The only edge case—a helper who was pending but the message was cancelled before
they answered—is acceptable: they drop off pending but their older messages
still anchor them. This edge is not worth a DB column.)
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    Checkpoint,
    Goal,
    KbSource,
    KpiDef,
    KpiValue,
    Message,
    Proposal,
    Shift,
    ShiftGoal,
    Staff,
    Task,
    TaskGoal,
    Thread,
)

# Cutoff separating "active" from "earlier" (non-awaiting threads).
_ACTIVE_CUTOFF_HOURS = 4


# ---------------------------------------------------------------------------
# Goal derivation (scope=="goal")
# ---------------------------------------------------------------------------

def _fmt_num(n: float) -> str:
    """Render a float without a trailing .0 for whole numbers."""
    if n == int(n):
        return str(int(n))
    return f"{n:g}"


def _primary_kpi(db: Session, goal: Goal) -> KpiDef | None:
    """The goal's primary KPI: lowest position, then name."""
    return db.scalar(
        select(KpiDef)
        .where(KpiDef.goal_id == goal.id)
        .order_by(KpiDef.position, KpiDef.name)
        .limit(1)
    )


def _latest_kpi_value(db: Session, kpi: KpiDef) -> KpiValue | None:
    return db.scalar(
        select(KpiValue)
        .where(KpiValue.name == kpi.name)
        .order_by(KpiValue.at.desc())
        .limit(1)
    )


def _goal_progress(db: Session, goal: Goal) -> tuple[int | None, str | None]:
    """Return (percent 0..100 | None, target_label | None) from the primary KPI."""
    kpi = _primary_kpi(db, goal)
    if not kpi:
        return None, (goal.target or None)
    unit = kpi.unit or ""
    target_label = None
    if kpi.target is not None:
        target_label = f"{_fmt_num(kpi.target)}{unit}" if unit == "%" else (
            f"{_fmt_num(kpi.target)} {unit}".strip()
        )
    kv = _latest_kpi_value(db, kpi)
    if kv is None or kpi.target in (None, 0):
        return None, target_label
    pct = int(round((kv.value / kpi.target) * 100))
    pct = max(0, min(100, pct))
    return pct, target_label


def _goal_owner(db: Session, goal: Goal) -> str:
    kpi = _primary_kpi(db, goal)
    owner = (kpi.owner if kpi else "") or goal.created_by or ""
    if owner:
        st = db.get(Staff, owner)
        if st:
            return st.name
        if owner != "owner":
            return owner
    return "Chief of Staff"


def _goal_check_in(db: Session, goal: Goal) -> str | None:
    """Humanized cadence of the first enabled Shift tied to this goal, else None."""
    from .onboarding import describe_cron

    sg = db.scalar(select(ShiftGoal).where(ShiftGoal.goal_id == goal.id))
    if not sg:
        return None
    sh = db.get(Shift, sg.shift_id)
    if not sh or not sh.cron:
        return None
    return describe_cron(sh.cron)


def _active_goals(db: Session) -> list[Goal]:
    return list(
        db.scalars(
            select(Goal)
            .where(Goal.status == "active")
            .order_by(Goal.position, Goal.created_at)
        )
    )


def goal_view(db: Session, goal: Goal) -> dict:
    """Header meta for a goal thread (see enrich scope=='goal')."""
    percent, target_label = _goal_progress(db, goal)
    owner = _goal_owner(db, goal)
    check_in = _goal_check_in(db, goal)

    if percent is not None and target_label:
        status_label = f"Close · {percent}% of {target_label}"
    elif percent is not None:
        status_label = f"{percent}% done"
    elif target_label:
        status_label = f"Target {target_label}"
    else:
        status_label = "In progress"

    actives = _active_goals(db)
    ids = [g.id for g in actives]
    position = ids.index(goal.id) + 1 if goal.id in ids else 1
    total = len(actives) or 1
    next_goal = None
    if goal.id in ids:
        idx = ids.index(goal.id)
        if len(actives) > 1:
            nxt = actives[(idx + 1) % len(actives)]
            if nxt.id != goal.id:
                next_goal = {"id": nxt.id, "title": nxt.title}

    return {
        "id": goal.id,
        "title": goal.title,
        "percent": percent,
        "target_label": target_label,
        "status_label": status_label,
        "owner": owner,
        "check_in": check_in,
        "position": position,
        "total": total,
        "next_goal": next_goal,
    }


_WORK_STATUS_LABEL = {
    "running": "Running",
    "queued": "Queued",
    "waiting": "Queued",
    "done": "Done",
    "failed": "Stopped",
    "cancelled": "Stopped",
}


def _work_status_label(task: Task, prog: dict) -> str:
    st = task.status
    if st == "running":
        d, t = prog.get("done", 0), prog.get("total", 0)
        return f"Running · {d}/{t}" if t else "Running"
    if st in ("needs_you", "awaiting"):
        return "Suggested · waiting for you"
    if st in ("queued", "waiting"):
        return "Queued"
    return _WORK_STATUS_LABEL.get(st, st.title() if st else "Queued")


def goal_focus(db: Session, goal: Goal) -> dict:
    """Full Details-panel payload for a goal thread (see focus scope=='goal')."""
    from . import team_board

    percent, target_label = _goal_progress(db, goal)
    owner = _goal_owner(db, goal)
    check_in = _goal_check_in(db, goal)

    # Work items = Tasks linked via TaskGoal
    task_ids = list(db.scalars(select(TaskGoal.task_id).where(TaskGoal.goal_id == goal.id)))
    work: list[dict] = []
    done_this_week = 0
    week_ago = dt.datetime.now(dt.UTC) - dt.timedelta(days=7)
    for tid in task_ids:
        task = db.get(Task, tid)
        if not task:
            continue
        prog = team_board.card_progress(db, task)
        st = db.get(Staff, task.staff_id)
        staff_name = st.name if st else task.staff_id
        title = (task.brief or "Job").strip().splitlines()[0] if (task.brief or "").strip() else "Job"
        title = " ".join(title.replace("**", "").replace("#", "").replace("`", "").split())[:70]
        work.append({
            "id": task.id,
            "title": title,
            "staff": {"id": task.staff_id, "name": staff_name},
            "status_label": _work_status_label(task, prog),
            "progress": {"done": prog.get("done", 0), "total": prog.get("total", 0)},
        })
        if task.status == "done":
            ended = task.ended_at or task.created_at
            if ended is not None and ended.tzinfo is None:
                ended = ended.replace(tzinfo=dt.UTC)
            if ended is not None and ended >= week_ago:
                done_this_week += 1

    # Progress note: graceful fallback when no late-reply data exists.
    in_progress = sum(1 for w in work if w["status_label"].startswith("Running"))
    note = f"{in_progress} work item{'s' if in_progress != 1 else ''} in progress" if in_progress else None

    # measured: kpi label/unit, else goal.target
    kpi = _primary_kpi(db, goal)
    if kpi and (kpi.label or kpi.unit):
        measured = " ".join(x for x in [kpi.label, f"({kpi.unit})" if kpi.unit else ""] if x).strip()
    else:
        measured = goal.target or None

    # since: goal.created_at formatted
    created = goal.created_at
    if created is not None and created.tzinfo is None:
        created = created.replace(tzinfo=dt.UTC)
    since = created.strftime("%b %-d, %Y") if created else None

    return {
        "progress": {"percent": percent, "target_label": target_label, "note": note},
        "work": work,
        "done_this_week": done_this_week,
        "about": {
            "owner": owner,
            "measured": measured,
            "check_in": check_in,
            "since": since,
        },
    }


# ---------------------------------------------------------------------------
# Grouping
# ---------------------------------------------------------------------------

def group(th: Thread) -> str:
    """Return 'needs_you' | 'active' | 'earlier' for a thread."""
    if th.awaiting_reply:
        return "needs_you"
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(hours=_ACTIVE_CUTOFF_HOURS)
    updated = th.updated_at
    if updated is not None and updated.tzinfo is None:
        updated = updated.replace(tzinfo=dt.UTC)
    if updated is not None and updated >= cutoff:
        return "active"
    return "earlier"


# ---------------------------------------------------------------------------
# Participant derivation
# ---------------------------------------------------------------------------

def participants(db: Session, th: Thread) -> list[str]:
    """staff ids = thread.pending ∪ distinct agent/system-message authors.

    Both 'agent' (AI replies) and 'system' (join events written by add-helper)
    are counted so a helper added via POST /add-helper shows up immediately.
    'owner' role messages are excluded (the owner is not a helper participant).
    """
    pending = list(th.pending or [])
    authors = list(
        db.scalars(
            select(Message.author)
            .where(
                Message.thread_id == th.id,
                Message.role.in_(["agent", "system"]),
            )
            .distinct()
        )
    )
    seen: set[str] = set()
    result: list[str] = []
    for sid in pending + authors:
        if sid not in seen:
            seen.add(sid)
            result.append(sid)
    return result


# ---------------------------------------------------------------------------
# Subtitle
# ---------------------------------------------------------------------------

def subtitle(db: Session, th: Thread) -> str:
    """One-line subtitle: last message text truncated, or the thread title."""
    last_msg = db.scalar(
        select(Message)
        .where(Message.thread_id == th.id)
        .order_by(Message.at.desc())
        .limit(1)
    )
    if last_msg and last_msg.text:
        return last_msg.text[:120].replace("\n", " ")
    return th.title or ""


# ---------------------------------------------------------------------------
# Serialisation extras (added onto the base X.thread() dict)
# ---------------------------------------------------------------------------

def enrich(db: Session, th: Thread) -> dict:
    """Return the derived extra fields to merge into a serialised thread dict."""
    _updated = th.updated_at
    if _updated is not None and _updated.tzinfo is None:
        _updated = _updated.replace(tzinfo=dt.UTC)
    last_at = _updated.isoformat() if _updated else None

    extras: dict = {
        "group": group(th),
        "subtitle": subtitle(db, th),
        "participants": participants(db, th),
        "last_at": last_at,
    }

    if th.scope == "task" and th.ref_id:
        task = db.get(Task, th.ref_id)
        if task:
            extras["task_id"] = task.id
            extras["task_status"] = task.status
            # Add linked goal when a TaskGoal association exists for this task.
            tg = db.get(TaskGoal, task.id)
            if tg:
                goal = db.get(Goal, tg.goal_id)
                if goal:
                    extras["goal"] = {"id": goal.id, "title": goal.title}

    if th.scope == "goal" and th.ref_id:
        goal = db.get(Goal, th.ref_id)
        if goal:
            extras["goal_view"] = goal_view(db, goal)

    # Bug #3 + Bug #4: enrich proposal threads so the frontend can surface proposal context,
    # and mark a pending proposal thread as needs_you so the workspace rail matches the inbox count.
    if th.scope == "proposal" and th.ref_id:
        from .services import current_body
        proposal = db.get(Proposal, th.ref_id)
        if proposal:
            extras["proposal_id"] = proposal.id
            extras["proposal_title"] = proposal.title
            extras["proposal_status"] = proposal.status
            extras["proposal_risk"] = proposal.risk
            extras["proposal_body"] = current_body(proposal)
            # Bug #4: a pending proposal needs the founder — surface it as needs_you in the workspace rail.
            if proposal.status == "pending":
                extras["group"] = "needs_you"

    return extras


# ---------------------------------------------------------------------------
# Focus aggregation
# ---------------------------------------------------------------------------

def _iso_dur_minutes(started_at, ended_at) -> int:
    if not started_at or not ended_at:
        return 0
    s = started_at if started_at.tzinfo else started_at.replace(tzinfo=dt.UTC)
    e = ended_at if ended_at.tzinfo else ended_at.replace(tzinfo=dt.UTC)
    return max(0, int((e - s).total_seconds() / 60))


def focus(db: Session, th: Thread) -> dict:
    """Aggregate progress, files, and cost for the Focus panel.

    If the thread has scope='task' and ref_id pointing to a Task, all three
    sections are populated from that task.  Otherwise returns empty/zeroed.
    """
    empty = {"progress": [], "files": [], "cost": {"usd": 0.0, "tokens": 0, "minutes": 0}}

    if th.scope == "goal" and th.ref_id:
        goal = db.get(Goal, th.ref_id)
        if goal:
            return {**empty, "goal": goal_focus(db, goal)}
        return empty

    if th.scope != "task" or not th.ref_id:
        return empty

    task = db.get(Task, th.ref_id)
    if not task:
        return empty

    # --- progress: from the latest Checkpoint.plan ---
    progress: list[dict] = []
    ckp = db.scalar(
        select(Checkpoint)
        .where(Checkpoint.task_id == task.id)
        .order_by(Checkpoint.at.desc())
        .limit(1)
    )
    if ckp and ckp.plan:
        plan = ckp.plan
        if isinstance(plan, list):
            for step in plan:
                if isinstance(step, dict):
                    progress.append({
                        "label": step.get("label", str(step)),
                        "status": step.get("status", "done"),
                    })
        elif isinstance(plan, dict):
            for k, v in plan.items():
                progress.append({"label": k, "status": str(v)})

    # --- files: KbSource where ref ∈ {thread_id, task_id} ---
    refs = list({th.id, task.id})
    kb_rows = list(db.scalars(select(KbSource).where(KbSource.ref.in_(refs))))
    files = [
        {"title": k.title or k.ref, "kind": k.kind, "ref": k.ref, "url": k.url or ""}
        for k in kb_rows
    ]

    # --- cost: from task ---
    minutes = _iso_dur_minutes(task.started_at, task.ended_at)
    cost = {
        "usd": round(task.cost_usd or 0.0, 4),
        "tokens": task.tokens or 0,
        "minutes": minutes,
    }

    return {"progress": progress, "files": files, "cost": cost}
