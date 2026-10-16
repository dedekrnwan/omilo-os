"""The plan: your goals at the top, the work that serves each goal under it.

You set the goals. The Chief of Staff hands out work (create_task with a goal_id), helpers hand off sub-jobs, and
regular jobs can be linked to a goal. Every new job finds its goal by itself: the one it was given, else its
parent's, else its regular job's (a before_flush hook, so no call site has to remember it).
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from .models import Goal, Proposal, Report, Shift, ShiftGoal, Staff, Task, TaskGoal, now


@event.listens_for(Session, "before_flush")
def _link_goals(session: Session, flush_context, instances) -> None:  # noqa: ARG001
    for o in list(session.new):
        if not isinstance(o, Task):
            continue
        gid = getattr(o, "_goal_id", None)
        with session.no_autoflush:
            if not gid and o.parent_task_id and (tg := session.get(TaskGoal, o.parent_task_id)):
                gid = tg.goal_id
            if not gid and o.shift_id and (sg := session.get(ShiftGoal, o.shift_id)):
                gid = sg.goal_id
            if not gid and o.proposal_id and (p := session.get(Proposal, o.proposal_id)) and p.task_id and (tg := session.get(TaskGoal, p.task_id)):
                gid = tg.goal_id
        if gid:
            if o.id is None:
                from .models import new_id

                o.id = new_id("tsk")
            session.add(TaskGoal(task_id=o.id, goal_id=gid))


def goals_for_prompt(db: Session) -> list[dict]:
    return [{"id": g.id, "title": g.title, "target": g.target, "due": g.due}
            for g in db.scalars(select(Goal).where(Goal.status == "active").order_by(Goal.position, Goal.created_at))]


def seed_from_onboarding(db: Session) -> None:
    """The first time the plan is opened: turn the goals picked in onboarding into goals."""
    if db.scalar(select(Goal.id).limit(1)):
        return
    from . import onboarding as OB
    from .services import get_setting

    a = (get_setting(db, "onboarding_draft", None) or {}).get("answers") or {}
    opts = OB.options().get("goals", {})
    notes = a.get("goal_notes") or {}
    for i, k in enumerate(a.get("goals") or []):
        o = opts.get(k)
        title = o.get("label") if isinstance(o, dict) else (o or k)
        db.add(Goal(title=str(title)[:300], target=str(notes.get(k) or "")[:2000], due=str(a.get("focus_until") or "")[:32], position=i))
    db.commit()


def _node(t: Task, names: dict, reps: dict, props: dict, kids: dict) -> dict:
    first = (t.brief or "").strip().splitlines()[0] if (t.brief or "").strip() else t.origin
    return {"id": t.id, "title": first[:160], "staff_id": t.staff_id, "staff": names.get(t.staff_id, t.staff_id), "status": t.status,
            "origin": t.origin, "created_at": (t.created_at if t.created_at.tzinfo else t.created_at.replace(tzinfo=dt.UTC)).isoformat(),
            "headline": reps.get(t.id, ""), "proposals": props.get(t.id, []),
            "children": [_node(c, names, reps, props, kids) for c in kids.get(t.id, [])]}


def tree(db: Session, days: int = 30) -> dict:
    seed_from_onboarding(db)
    since = now() - dt.timedelta(days=days)
    tasks = list(db.scalars(select(Task).where(Task.created_at >= since).order_by(Task.created_at)))
    ids = {t.id for t in tasks}
    names = {s.id: s.name for s in db.scalars(select(Staff))}
    reps = {r.task_id: r.headline for r in db.scalars(select(Report).where(Report.task_id.in_(ids)))} if ids else {}
    props: dict[str, list] = {}
    for p in db.scalars(select(Proposal).where(Proposal.task_id.in_(ids))) if ids else []:
        props.setdefault(p.task_id, []).append({"id": p.id, "title": p.title[:120], "status": p.status})
    kids: dict[str, list[Task]] = {}
    roots: list[Task] = []
    for t in tasks:
        parent = t.parent_task_id
        if not parent and t.proposal_id and (p := db.get(Proposal, t.proposal_id)):
            parent = p.task_id  # an execution or revision belongs under the job that proposed it
        if parent and parent in ids:
            kids.setdefault(parent, []).append(t)
        else:
            roots.append(t)
    link = {tg.task_id: tg.goal_id for tg in db.scalars(select(TaskGoal).where(TaskGoal.task_id.in_(ids)))} if ids else {}
    shift_goal = {sg.shift_id: sg.goal_id for sg in db.scalars(select(ShiftGoal))}
    shifts = list(db.scalars(select(Shift)))
    goals = list(db.scalars(select(Goal).order_by(Goal.status != "active", Goal.position, Goal.created_at)))

    def count(nodes: list[dict], acc: dict) -> dict:
        for n in nodes:
            acc["total"] += 1
            acc[n["status"]] = acc.get(n["status"], 0) + 1
            acc["proposals"] += len(n["proposals"])
            acc["approved"] += sum(p["status"] in ("approved", "executing", "done") for p in n["proposals"])
            count(n["children"], acc)
        return acc

    out, used = [], set()
    for g in goals:
        nodes = [_node(t, names, reps, props, kids) for t in roots if link.get(t.id) == g.id]
        used |= {n["id"] for n in nodes}
        out.append({"id": g.id, "title": g.title, "target": g.target, "due": g.due, "status": g.status, "position": g.position,
                    "jobs": [{"id": sh.id, "name": sh.name, "staff_id": sh.staff_id, "staff": names.get(sh.staff_id, sh.staff_id), "cron": sh.cron}
                             for sh in shifts if shift_goal.get(sh.id) == g.id],
                    "work": list(reversed(nodes)), "progress": count(nodes, {"total": 0, "proposals": 0, "approved": 0})})
    rest = [_node(t, names, reps, props, kids) for t in roots if t.id not in used]
    return {"days": days, "goals": out, "unlinked": list(reversed(rest)),
            "shifts": [{"id": sh.id, "name": sh.name, "staff": names.get(sh.staff_id, sh.staff_id), "goal_id": shift_goal.get(sh.id)} for sh in shifts]}
