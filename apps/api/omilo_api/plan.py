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


def start_planning(db: Session, goal_id: str) -> None:
    """Enqueue exactly one planner Task for *goal_id*.

    - No-op if the goal is not active (done / dropped / missing).
    - No-op if a plan-origin task already exists for this goal (open or done).
    - No-op if there is no Chief of Staff.

    The created task instructs the CoS to read the goal's target and create one
    role-assigned sub-task per spec needed to achieve it via ``create_task``.
    """
    from sqlalchemy import select

    from .services import chief, create_task

    g = db.get(Goal, goal_id)
    if g is None or g.status != "active":
        return

    cos = chief(db)
    if cos is None:
        return

    # Idempotency guard: don't create a second plan task if one already exists.
    existing = db.scalar(
        select(Task).join(TaskGoal, TaskGoal.task_id == Task.id).where(
            TaskGoal.goal_id == goal_id,
            Task.origin == "plan",
        )
    )
    if existing is not None:
        return

    brief = (
        f"PLANNER RUN — Goal: {g.title}\n\n"
        f"Target: {g.target or '(no target set)'}\n\n"
        "Read the goal target above and decompose it into the minimum set of "
        "role-assigned sub-tasks needed to achieve it. For each spec, call "
        "`create_task(role=<role>, brief=<detailed spec>, goal_id=<goal_id>)`. "
        "Assign each task to the staff best suited by role. "
        "Do NOT execute the tasks yourself — your job is to plan and delegate."
    )
    create_task(
        db,
        staff_id=cos.id,
        origin="plan",
        brief=brief,
        created_by="system",
        goal_id=goal_id,
    )


def goals_for_prompt(db: Session) -> list[dict]:
    return [{"id": g.id, "title": g.title, "target": g.target, "due": g.due}
            for g in db.scalars(select(Goal).where(Goal.status == "active").order_by(Goal.position, Goal.created_at))]


def seed_from_onboarding(db: Session) -> None:
    """Once, the first time the plan is opened: turn the goals picked in onboarding into goals. After that the goals
    are yours: deleting them all leaves the plan empty (it used to bring them back)."""
    from . import onboarding as OB
    from .services import get_setting, set_setting

    if get_setting(db, "plan_seeded", False):
        return
    set_setting(db, "plan_seeded", True)
    if db.scalar(select(Goal.id).limit(1)):
        db.commit()
        return

    a = (get_setting(db, "onboarding_draft", None) or {}).get("answers") or {}
    opts = OB.options().get("goals", {})
    notes = a.get("goal_notes") or {}
    for i, k in enumerate(a.get("goals") or []):
        o = opts.get(k)
        title = o.get("label") if isinstance(o, dict) else (o or k)
        db.add(Goal(title=str(title)[:300], target=str(notes.get(k) or "")[:2000], due=str(a.get("focus_until") or "")[:32], position=i))
    db.commit()


def _fmt_num(n) -> str:
    """Render a KPI number without a trailing .0 (95.0 -> '95', 2.5 -> '2.5')."""
    try:
        f = float(n)
    except (TypeError, ValueError):
        return str(n)
    return str(int(f)) if f == int(f) else str(f)


def _node(t: Task, names: dict, reps: dict, props: dict, kids: dict) -> dict:
    first = (t.brief or "").strip().splitlines()[0] if (t.brief or "").strip() else t.origin
    return {"id": t.id, "title": first[:160], "staff_id": t.staff_id, "staff": names.get(t.staff_id, t.staff_id), "status": t.status,
            "origin": t.origin, "created_at": (t.created_at if t.created_at.tzinfo else t.created_at.replace(tzinfo=dt.UTC)).isoformat(),
            "headline": reps.get(t.id, ""), "proposals": props.get(t.id, []),
            "children": [_node(c, names, reps, props, kids) for c in kids.get(t.id, [])]}


def tree(db: Session, days: int = 30) -> dict:
    seed_from_onboarding(db)
    from .services import seed_relations
    seed_relations(db)
    since = now() - dt.timedelta(days=days)
    tasks = list(db.scalars(select(Task).where(Task.created_at >= since).order_by(Task.created_at)))
    ids = {t.id for t in tasks}
    names = {s.id: s.name for s in db.scalars(select(Staff))}
    reps = {r.task_id: r.headline for r in db.scalars(select(Report).where(Report.task_id.in_(ids)))} if ids else {}
    props: dict[str, list] = {}
    rows = list(db.scalars(select(Proposal).where(Proposal.task_id.in_(ids)).order_by(Proposal.created_at))) if ids else []
    rows.sort(key=lambda p: p.status not in ("approved", "executing", "done", "executed"))  # approved work first
    for p in rows:
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

    from .kpis import board as kpi_board

    kp = kpi_board(db, history=8)
    week_ago = now() - dt.timedelta(days=7)
    out, used = [], set()
    for g in goals:
        nodes = [_node(t, names, reps, props, kids) for t in roots if link.get(t.id) == g.id]
        used |= {n["id"] for n in nodes}
        gkpis = [{k: r[k] for k in ("name", "label", "unit", "value", "target", "progress", "direction")} for r in kp if r["goal_id"] == g.id]

        # Primary KPI → percent of target + a human metric label
        percent: int | None = None
        metric_label: str | None = None
        if gkpis:
            primary = gkpis[0]
            target = primary.get("target")
            value = primary.get("value")
            if target and value is not None:
                try:
                    percent = round(float(value) / float(target) * 100)
                    metric_label = f"this week · target {_fmt_num(target)}{primary.get('unit') or ''}"
                except (TypeError, ValueError, ZeroDivisionError):
                    percent = None
                    metric_label = None

        # Distinct staff + "done this week" count across this goal's flattened work nodes
        def _walk(ns: list[dict], team: dict[str, str], acc: dict) -> None:
            for n in ns:
                sid = n.get("staff_id")
                if sid and sid not in team:
                    team[sid] = names.get(sid, sid)
                st = (n.get("status") or "").lower()
                if st in ("done", "completed"):
                    created = n.get("created_at")
                    if created:
                        try:
                            when_dt = dt.datetime.fromisoformat(created)
                            if when_dt >= week_ago:
                                acc["done"] += 1
                        except ValueError:
                            pass
                _walk(n.get("children") or [], team, acc)

        team_map: dict[str, str] = {}
        week_acc = {"done": 0}
        _walk(nodes, team_map, week_acc)
        team = [{"id": sid, "name": nm} for sid, nm in list(team_map.items())[:5]]

        out.append({"id": g.id, "title": g.title, "target": g.target, "due": g.due, "status": g.status, "position": g.position,
                    "jobs": [{"id": sh.id, "name": sh.name, "staff_id": sh.staff_id, "staff": names.get(sh.staff_id, sh.staff_id), "cron": sh.cron}
                             for sh in shifts if shift_goal.get(sh.id) == g.id],
                    "work": list(reversed(nodes)), "progress": count(nodes, {"total": 0, "proposals": 0, "approved": 0}),
                    "percent": percent, "metric_label": metric_label, "done_this_week": week_acc["done"], "team": team,
                    "kpis": gkpis})
    rest = [_node(t, names, reps, props, kids) for t in roots if t.id not in used]
    return {"days": days, "goals": out, "unlinked": list(reversed(rest)),
            "shifts": [{"id": sh.id, "name": sh.name, "staff": names.get(sh.staff_id, sh.staff_id), "goal_id": shift_goal.get(sh.id), "cron": sh.cron} for sh in shifts]}


def lineage(db: Session, task_ids: list[str]) -> dict[str, dict]:
    """For each job: the goal it serves and the jobs above it (nearest last), so every card can show where it comes from."""
    ids = [t for t in dict.fromkeys(task_ids) if t]
    if not ids:
        return {}
    names = {s.id: s.name for s in db.scalars(select(Staff))}
    cache: dict[str, Task | None] = {}

    def get(tid: str | None) -> Task | None:
        if not tid:
            return None
        if tid not in cache:
            cache[tid] = db.get(Task, tid)
        return cache[tid]

    def parent_of(t: Task) -> Task | None:
        if t.parent_task_id:
            return get(t.parent_task_id)
        if t.proposal_id and (p := db.get(Proposal, t.proposal_id)) and p.task_id and p.task_id != t.id:
            return get(p.task_id)
        return None

    goals = {g.id: g for g in db.scalars(select(Goal))}
    out = {}
    for tid in ids:
        t = get(tid)
        if not t:
            continue
        chain, cur, seen = [], t, {t.id}
        while (par := parent_of(cur)) and par.id not in seen and len(chain) < 6:
            chain.append({"id": par.id, "title": ((par.brief or "").strip().splitlines() or [par.origin])[0][:120],
                          "staff_id": par.staff_id, "staff": names.get(par.staff_id, par.staff_id), "status": par.status})
            seen.add(par.id)
            cur = par
        tg = db.get(TaskGoal, t.id) or (db.get(TaskGoal, chain[-1]["id"]) if chain else None)
        g = goals.get(tg.goal_id) if tg else None
        out[tid] = {"goal": {"id": g.id, "title": g.title} if g else None, "parents": list(reversed(chain))}
    return out
