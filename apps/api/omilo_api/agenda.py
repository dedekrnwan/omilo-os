"""The calendar: what the helpers will do and did, on one timeline.

Events come from four places, none of them stored twice:
- shift occurrences, expanded from each regular job's cron in the company's time zone (future only: past runs are tasks)
- tasks: queued and running now, finished ones in the past (a task that came from a shift sits where that run was)
- scheduled workflows, expanded from their trigger's cron
- workflow runs that already happened

An occurrence can be skipped (ShiftSkip): the worker then lets that one run pass and the calendar shows it crossed out.
`upcoming()` is the right-hand list: everything after a moment, oldest first, a page at a time.
"""
from __future__ import annotations

import datetime as dt
from heapq import merge

from croniter import croniter
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from . import services as S
from .models import Shift, ShiftSkip, Staff, Task, Workflow, WorkflowRun, now

DEFAULT_MIN = 20  # how long a run takes when there is no history yet
MAX_PER_SOURCE = 400  # occurrences of one schedule in one range (a cron every minute must not flood a month view)


def iso(v: dt.datetime | None) -> str | None:
    """Always UTC with seconds, so times sort and compare as strings."""
    if v is None:
        return None
    v = v if v.tzinfo else v.replace(tzinfo=dt.UTC)
    return v.astimezone(dt.UTC).isoformat(timespec="seconds")


def _aware(d: dt.datetime | None) -> dt.datetime | None:
    return d if d is None or d.tzinfo else d.replace(tzinfo=dt.UTC)


def _occurrences(cron: str, start: dt.datetime, end: dt.datetime, tz, limit: int = MAX_PER_SOURCE):
    """Cron times in (start, end], as UTC, in the company's time zone."""
    if not croniter.is_valid(cron):
        return
    it = croniter(cron, start.astimezone(tz))
    for _ in range(limit):
        t = it.get_next(dt.datetime).astimezone(dt.UTC)
        if t > end:
            return
        yield t


def typical_minutes(db: Session, shift_ids: list[str], last: int = 10) -> dict[str, int]:
    """How long each regular job usually runs (average of its last finished runs), for the size of its block."""
    if not shift_ids:
        return {}
    secs = func.extract("epoch", Task.ended_at - Task.started_at)
    recent = (select(Task.shift_id.label("sid"), secs.label("secs"),
                     func.row_number().over(partition_by=Task.shift_id, order_by=Task.ended_at.desc()).label("n"))
              .where(Task.shift_id.in_(shift_ids), Task.status == "done", Task.started_at.is_not(None), Task.ended_at.is_not(None))
              .subquery())
    rows = db.execute(select(recent.c.sid, func.avg(recent.c.secs)).where(recent.c.n <= last).group_by(recent.c.sid)).all()
    return {sid: max(5, min(240, round(float(v or 0) / 60))) for sid, v in rows}


def _skips(db: Session, shift_ids: list[str], start: dt.datetime, end: dt.datetime) -> set[tuple[str, str]]:
    if not shift_ids:
        return set()
    q = select(ShiftSkip).where(ShiftSkip.shift_id.in_(shift_ids), ShiftSkip.at >= start, ShiftSkip.at <= end)
    return {(s.shift_id, iso(_aware(s.at))) for s in db.scalars(q)}


def _first_line(text: str, n: int = 90) -> str:
    line = next((x.strip() for x in (text or "").splitlines() if x.strip()), "")
    return line if len(line) <= n else line[: n - 1] + "…"


def _clip(text: str, n: int = 280) -> str:
    t = " ".join((text or "").split())
    return t if len(t) <= n else t[: n - 1] + "…"


_WHEN: dict[str, str] = {}


def _when(cron: str) -> str:
    """'30 7 * * *' → 'Every day at 07:30' (cached: the same few schedules repeat on every event)."""
    if cron not in _WHEN:
        from .onboarding import describe_cron

        p = cron.split()
        if len(p) == 5 and p[0].isdigit() and p[1].startswith("*/") and p[1][2:].isdigit() and p[2:] == ["*", "*", "*"]:
            _WHEN[cron] = f"Every {p[1][2:]} hours at :{int(p[0]):02d}"  # describe_cron calls these "custom"
        else:
            _WHEN[cron] = describe_cron(cron)
    return _WHEN[cron]


def _shift_event(sh: Shift, st: Staff | None, at: dt.datetime, minutes: int, skipped: bool) -> dict:
    return {"id": f"shift:{sh.id}:{iso(at)}", "kind": "shift", "ref_id": sh.id, "staff_id": sh.staff_id,
            "staff": st.name if st else sh.staff_id, "role": st.role if st else "", "title": sh.name.replace("-", " ").capitalize(),
            "detail": _first_line(sh.brief), "brief": _clip(sh.brief), "start": iso(at), "end": iso(at + dt.timedelta(minutes=minutes)),
            "status": "paused" if not sh.enabled else "skipped" if skipped else "scheduled", "recurring": True, "cron": sh.cron,
            "when": _when(sh.cron), "typical_min": minutes}


def _task_event(t: Task, st: Staff | None, shifts: dict[str, Shift], minutes: dict[str, int]) -> dict:
    start = _aware(t.started_at) or _aware(t.created_at)
    end = _aware(t.ended_at) or (now() if t.status == "running" else start + dt.timedelta(minutes=minutes.get(t.shift_id or "", DEFAULT_MIN)))
    sh = shifts.get(t.shift_id or "")
    title = sh.name.replace("-", " ").capitalize() if sh else _first_line(t.brief, 70) or t.origin
    ended, began = _aware(t.ended_at), _aware(t.started_at)
    outcome = _first_line(t.error, 160) if t.status == "failed" else _first_line(t.result_text, 160) if t.status == "done" else ""
    return {"id": f"task:{t.id}", "kind": "task", "ref_id": t.id, "staff_id": t.staff_id, "staff": st.name if st else t.staff_id,
            "role": st.role if st else "", "title": title, "detail": _first_line(t.brief), "brief": _clip(t.brief),
            "start": iso(start), "end": iso(max(end, start + dt.timedelta(minutes=5))),
            "status": t.status, "origin": t.origin, "shift_id": t.shift_id, "recurring": False,
            "when": _when(sh.cron) if sh else "", "outcome": outcome,
            "seconds": round((ended - began).total_seconds()) if ended and began else None,
            "cost_usd": round(t.cost_usd or 0, 4), "tokens": t.tokens or 0}


def _workflow_event(wf: Workflow, at: dt.datetime, cron: str) -> dict:
    return {"id": f"workflow:{wf.id}:{iso(at)}", "kind": "workflow", "ref_id": wf.id, "staff_id": None, "staff": "Workflow",
            "title": wf.name, "detail": _first_line(wf.description), "brief": _clip(wf.description), "start": iso(at),
            "end": iso(at + dt.timedelta(minutes=10)), "status": "scheduled", "recurring": True, "cron": cron, "when": _when(cron)}


def _run_event(r: WorkflowRun, wf: Workflow | None) -> dict:
    start = _aware(r.started_at) or _aware(r.created_at)
    end = _aware(r.ended_at) or (now() if r.status in ("running", "waiting") else start + dt.timedelta(minutes=10))
    return {"id": f"run:{r.id}", "kind": "workflow_run", "ref_id": r.id, "workflow_id": r.workflow_id, "staff_id": None, "staff": "Workflow",
            "title": wf.name if wf else "Workflow run", "detail": f"{r.trigger} run", "brief": _clip(wf.description) if wf else "",
            "start": iso(start), "end": iso(max(end, start + dt.timedelta(minutes=5))), "status": r.status, "recurring": False,
            "outcome": _first_line(r.error, 160) if r.status == "failed" else "", "ai_steps": r.ai_steps,
            "seconds": round((_aware(r.ended_at) - _aware(r.started_at)).total_seconds()) if r.ended_at and r.started_at else None}


def _schedules(db: Session) -> tuple[list[Shift], dict[str, Staff], list[tuple[Workflow, str]]]:
    from .workflows import trigger_of

    staff = {s.id: s for s in db.scalars(select(Staff))}
    shifts = [sh for sh in db.scalars(select(Shift)) if (st := staff.get(sh.staff_id)) and st.status == "active"]
    wfs = []
    for wf in db.scalars(select(Workflow).where(Workflow.status == "active")):
        t = trigger_of(wf)
        if t["type"] == "trigger.schedule":
            wfs.append((wf, str(t["config"].get("cron") or "0 9 * * 1-5")))
    return shifts, staff, wfs


def events(db: Session, start: dt.datetime, end: dt.datetime, staff_id: str | None = None, kinds: set[str] | None = None) -> list[dict]:
    """Everything between start and end, sorted by start."""
    start, end = _aware(start), _aware(end)
    t_now = now()
    tz = S._tz(db)
    shifts, staff, wfs = _schedules(db)
    by_id = {sh.id: sh for sh in shifts}
    minutes = typical_minutes(db, list(by_id))
    want = kinds or {"shift", "task", "workflow", "workflow_run"}
    out: list[dict] = []

    if "shift" in want:
        skips = _skips(db, list(by_id), start, end)
        for sh in shifts:
            if staff_id and sh.staff_id != staff_id:
                continue
            for at in _occurrences(sh.cron, max(start, t_now) - dt.timedelta(seconds=1), end, tz):
                out.append(_shift_event(sh, staff.get(sh.staff_id), at, minutes.get(sh.id, DEFAULT_MIN), (sh.id, iso(at)) in skips))

    if "task" in want:
        when = func.coalesce(Task.started_at, Task.created_at)
        until = func.coalesce(Task.ended_at, func.now())  # a job that crosses midnight shows on both days
        q = select(Task).where(or_(Task.status.in_(["queued", "running"]), (when < end) & (until > start))).order_by(when).limit(2000)
        if staff_id:
            q = q.where(Task.staff_id == staff_id)
        for t in db.scalars(q):
            ev = _task_event(t, staff.get(t.staff_id), by_id, minutes)
            if ev["start"] < iso(end) and ev["end"] > iso(start):
                out.append(ev)

    if not staff_id and "workflow" in want:
        for wf, cron in wfs:
            for at in _occurrences(cron, max(start, t_now) - dt.timedelta(seconds=1), end, tz):
                out.append(_workflow_event(wf, at, cron))

    if not staff_id and "workflow_run" in want:
        when = func.coalesce(WorkflowRun.started_at, WorkflowRun.created_at)
        until = func.coalesce(WorkflowRun.ended_at, func.now())
        runs = list(db.scalars(select(WorkflowRun).where(when < end, until > start).order_by(when).limit(1000)))
        names = {w.id: w for w in db.scalars(select(Workflow).where(Workflow.id.in_({r.workflow_id for r in runs})))} if runs else {}
        out += [_run_event(r, names.get(r.workflow_id)) for r in runs]

    out.sort(key=lambda e: (e["start"], e["id"]))
    return out


def _shift_stream(sh, st, after, horizon, tz, limit, minutes, skips):
    for at in _occurrences(sh.cron, after, horizon, tz, limit):
        yield _shift_event(sh, st, at, minutes, (sh.id, iso(at)) in skips)


def _workflow_stream(wf, cron, after, horizon, tz, limit):
    for at in _occurrences(cron, after, horizon, tz, limit):
        yield _workflow_event(wf, at, cron)


def upcoming(db: Session, after: dt.datetime | None = None, after_id: str = "", limit: int = 20,
             staff_id: str | None = None) -> dict:
    """The right-hand list: queued and running jobs first (they are "now"), then every scheduled run after `after`,
    oldest first. Pass the returned cursor back to get the next page."""
    t_now = now()
    first_page = after is None
    after = t_now if first_page else max(_aware(after), t_now)
    tz = S._tz(db)
    shifts, staff, wfs = _schedules(db)
    by_id = {sh.id: sh for sh in shifts}
    minutes = typical_minutes(db, list(by_id))
    horizon = after + dt.timedelta(days=366)
    skips = _skips(db, list(by_id), after - dt.timedelta(seconds=1), horizon)
    items: list[dict] = []

    if first_page:
        q = select(Task).where(Task.status.in_(["running", "queued"])).order_by(Task.status.desc(), Task.created_at)
        if staff_id:
            q = q.where(Task.staff_id == staff_id)
        for t in db.scalars(q.limit(50)):
            items.append({**_task_event(t, staff.get(t.staff_id), by_id, minutes), "now": True})

    # each schedule yields its own sorted stream; merge them and stop after `limit`
    # each stream starts a second early: runs at exactly the cursor's time that were not on the last page still come
    streams = []
    since = after - dt.timedelta(seconds=1)
    for sh in shifts:
        if not sh.enabled or (staff_id and sh.staff_id != staff_id):
            continue
        streams.append(_shift_stream(sh, staff.get(sh.staff_id), since, horizon, tz, limit + 2, minutes.get(sh.id, DEFAULT_MIN), skips))
    if not staff_id:
        for wf, cron in wfs:
            streams.append(_workflow_stream(wf, cron, since, horizon, tz, limit + 2))
    later: list[dict] = []
    cut = iso(after)
    for ev in merge(*streams, key=lambda e: (e["start"], e["id"])):
        if ev["start"] < cut or (not first_page and ev["start"] == cut and ev["id"] <= after_id):
            continue  # already passed, or already on the previous page
        later.append(ev)
        if len(later) > limit:
            break
    more = len(later) > limit
    later = later[:limit]
    items += later
    cursor = {"after": later[-1]["start"], "after_id": later[-1]["id"]} if more and later else None
    return {"items": items, "next": cursor, "timezone": S.timezone_name(db)}


# ------------------------------------------------------------------ quick actions
def skip(db: Session, sh: Shift, at: dt.datetime, actor: str) -> ShiftSkip:
    at = _aware(at).astimezone(dt.UTC)
    if at <= now():
        raise S.DomainError("that run is not in the future", 409)
    if not any(abs((t - at).total_seconds()) < 1 for t in _occurrences(sh.cron, at - dt.timedelta(seconds=1), at + dt.timedelta(seconds=1), S._tz(db), 2)):
        raise S.DomainError("the job does not run at that time", 400)
    existing = db.scalar(select(ShiftSkip).where(ShiftSkip.shift_id == sh.id, ShiftSkip.at == at))
    if existing:
        return existing
    s = ShiftSkip(shift_id=sh.id, at=at, by=actor)
    db.add(s)
    S.audit(db, actor, "shift.skip", sh.id, at=at.isoformat())
    db.commit()
    return s


def unskip(db: Session, sh: Shift, at: dt.datetime, actor: str) -> None:
    at = _aware(at).astimezone(dt.UTC)
    for s in db.scalars(select(ShiftSkip).where(ShiftSkip.shift_id == sh.id, ShiftSkip.at == at)):
        db.delete(s)
    S.audit(db, actor, "shift.unskip", sh.id, at=at.isoformat())
    db.commit()


def is_skipped(db: Session, sh: Shift, at: dt.datetime | None) -> bool:
    """Used by the worker when a shift comes due."""
    if at is None:
        return False
    at = _aware(at)
    return bool(db.scalar(select(func.count()).select_from(ShiftSkip).where(
        ShiftSkip.shift_id == sh.id, ShiftSkip.at >= at - dt.timedelta(seconds=1), ShiftSkip.at <= at + dt.timedelta(seconds=1))))


def run_now(db: Session, sh: Shift, actor: str) -> Task:
    """Run a regular job now, outside its schedule (the schedule itself stays as it is)."""
    st = db.get(Staff, sh.staff_id)
    if not st or st.status != "active":
        raise S.DomainError("that helper is not active", 409)
    busy = db.scalar(select(func.count()).select_from(Task).where(Task.shift_id == sh.id, Task.status.in_(["queued", "running"])))
    if busy:
        raise S.DomainError("this job is already queued or running", 409)
    t = Task(staff_id=st.id, origin="shift", brief=sh.brief or sh.name, created_by=actor, shift_id=sh.id)
    db.add(t)
    S.audit(db, actor, "shift.run_now", sh.id, staff=st.id)
    db.commit()
    return t
