"""The live office: one authoritative picture of what every helper is doing, and the verified events behind it.

Both views on the Monitor page (Simple and Office) read the same `state()`; the Office animates the `OfficeEvent`
rows. Events are written by a flush hook from the real records (jobs, tool calls, approvals, questions, chats), so
nothing is invented: when nothing happens, nothing moves, and the view shows how fresh its last event is.
"""
from __future__ import annotations

import datetime as dt
import logging
import re
import time

from sqlalchemy import event, func, inspect, select
from sqlalchemy.orm import Session

from .models import InboxItem, OfficeEvent, Proposal, RunEvent, Staff, Task, Thread, new_id, now

log = logging.getLogger("saga.office")
FAILED_FOR = dt.timedelta(hours=24)  # a failed last job keeps a helper "failed" this long, unless it works again
KEEP = dt.timedelta(days=14)

# ------------------------------------------------------------------ departments (office zones)
DEPARTMENTS = [
    ("leadership", "Leadership", r"chief|ceo|founder|lead"),
    ("marketing", "Marketing", r"market|brand|social|content|seo|growth|community|design|creative"),
    ("sales", "Sales", r"sales|account exec|deal|partner|business dev|bd\b"),
    ("support", "Support", r"support|customer|success|help ?desk"),
    ("engineering", "Engineering & Ops", r"ops|operation|devops|infra|sre|platform|dev|engineer|code|frontend|backend|qa|test|security|product"),
    ("finance", "Finance", r"financ|account|bookkeep|tax|invest|cfo|legal"),
]
STUDIO = ("studio", "Studio")


def department(st: Staff) -> str:
    if st.is_chief:
        return "leadership"
    k = f"{st.id} {st.role or ''} {st.name or ''}".lower()
    for key, _, rx in DEPARTMENTS:
        if re.search(rx, k):
            return key
    return STUDIO[0]


def departments() -> list[dict]:
    return [{"id": k, "name": n} for k, n, _ in DEPARTMENTS] + [{"id": STUDIO[0], "name": STUDIO[1]}]


def _iso(d: dt.datetime | None) -> str | None:
    return (d if d.tzinfo else d.replace(tzinfo=dt.UTC)).isoformat() if d else None


def _short(s: str | None, n: int = 160) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


# ------------------------------------------------------------------ the event log, written from real changes
def _changed(o, attr: str):
    h = inspect(o).attrs[attr].history
    if not h.added:
        return None
    new, old = h.added[0], (h.deleted[0] if h.deleted else None)
    return None if new == old else (old, new)


def _tool_label(name: str) -> str:
    n = name.replace("saga-os · ", "")
    n = re.sub(r"^mcp__[^_]+(?:-[^_]+)*__", "", n)
    return n[:48]


@event.listens_for(Session, "before_flush")
def _office_events(session: Session, flush_context, instances) -> None:  # noqa: ARG001
    try:
        _collect(session)
    except Exception:  # noqa: BLE001 - the office view must never break real work
        log.exception("office event hook failed")


def _collect(session: Session) -> None:
    out: list[OfficeEvent] = []
    add = lambda staff, kind, task=None, **data: out.append(OfficeEvent(staff_id=staff or "", kind=kind, task_id=task, data=data))  # noqa: E731
    for o in list(session.new):
        if isinstance(o, Task):
            if o.id is None:
                o.id = new_id("tsk")
            frm = (o.created_by or "")[6:] if (o.created_by or "").startswith("staff:") else ""
            if not frm and o.parent_task_id:
                with session.no_autoflush:
                    p = session.get(Task, o.parent_task_id)
                frm = p.staff_id if p and p.staff_id != o.staff_id else ""
            add(o.staff_id, "job.queued", o.id, brief=_short(o.brief), origin=o.origin or "", parent_task_id=o.parent_task_id, from_staff=frm or None)
            if frm and frm != o.staff_id:
                add(frm, "handoff", o.id, to_staff=o.staff_id, brief=_short(o.brief), parent_task_id=o.parent_task_id)
        elif isinstance(o, Proposal):
            if o.id is None:
                o.id = new_id("prp")
            add(o.staff_id, "approval.requested", o.task_id, proposal_id=o.id, title=_short(o.title), risk=o.risk or "medium")
        elif isinstance(o, InboxItem) and o.kind == "question" and o.staff_id:
            if o.id is None:
                o.id = new_id("inb")
            add(o.staff_id, "question.asked", o.task_id, item_id=o.id, title=_short(o.title))
        elif isinstance(o, RunEvent) and o.staff_id:
            d = o.data or {}
            if o.kind == "tool":
                running = d.get("state") == "running"
                ok = d.get("ok", True) is not False and not d.get("error")
                add(o.staff_id, "tool", o.task_id, name=_tool_label(str(d.get("name") or "tool")), phase="start" if running else "end",
                    ok=ok, decision=d.get("decision"), thread_id=o.thread_id)
            elif o.kind == "status" and d.get("state") in ("retrying", "switching"):
                add(o.staff_id, "engine", o.task_id, state=d.get("state"), reason=_short(d.get("reason") or d.get("error") or "", 120))
            elif o.kind == "browser":
                add(o.staff_id, "tool", o.task_id, name="browser", phase="end", ok=True, url=_short(str(d.get("url") or ""), 200))
    for o in list(session.dirty):
        if isinstance(o, Task):
            ch = _changed(o, "status")
            if ch:
                kind = {"running": "job.started", "done": "job.done", "failed": "job.failed", "cancelled": "job.cancelled", "queued": "job.queued"}.get(ch[1])
                if kind:
                    add(o.staff_id, kind, o.id, brief=_short(o.brief), error=_short(o.error, 300) if ch[1] == "failed" else None,
                        origin=o.origin or "", parent_task_id=o.parent_task_id)
        elif isinstance(o, Proposal):
            ch = _changed(o, "status")
            if ch and ch[1] in ("approved", "rejected", "changes_requested"):
                add(o.staff_id, "approval.decided", o.task_id, proposal_id=o.id, title=_short(o.title), decision=ch[1])
        elif isinstance(o, InboxItem) and o.kind == "question" and o.staff_id:
            ch = _changed(o, "status")
            if ch and ch[1] == "done":
                add(o.staff_id, "question.answered", o.task_id, item_id=o.id, title=_short(o.title))
        elif isinstance(o, Thread):
            ch = _changed(o, "awaiting_reply")
            if ch:
                add(o.staff_id, "chat.started" if ch[1] else "chat.replied", None, thread_id=o.id, title=_short(o.title, 80))
        elif isinstance(o, Staff):
            ch = _changed(o, "status")
            if ch:
                add(o.id, "agent.paused" if ch[1] != "active" else "agent.resumed", None)
    for e in out:
        session.add(e)


def serialize(e: OfficeEvent) -> dict:
    return {"id": e.id, "at": _iso(e.at), "staff_id": e.staff_id, "kind": e.kind, "task_id": e.task_id,
            "data": {k: v for k, v in (e.data or {}).items() if v is not None}}


def events(db: Session, after: int = 0, limit: int = 200) -> list[dict]:
    rows = db.scalars(select(OfficeEvent).where(OfficeEvent.id > after).order_by(OfficeEvent.id).limit(min(limit, 1000)))
    return [serialize(e) for e in rows]


def cursor(db: Session) -> int:
    return db.scalar(select(func.max(OfficeEvent.id))) or 0


_pruned: dict[str, float] = {}


def _prune(db: Session) -> None:
    from . import company as C

    cid = C.current()
    if time.monotonic() - _pruned.get(cid, -1e9) < 3600:
        return
    _pruned[cid] = time.monotonic()
    old = list(db.scalars(select(OfficeEvent).where(OfficeEvent.at < now() - KEEP).limit(5000)))
    for e in old:
        db.delete(e)
    if old:
        db.commit()


# ------------------------------------------------------------------ the authoritative state
def state(db: Session) -> dict:
    """What every helper is doing right now, worked out from the records (not from the event stream), so a view that
    missed events still shows the truth. Status: working, blocked (waiting on you), failed (last job failed),
    queued, idle, or paused."""
    from . import services as S

    _prune(db)
    t_now = now()
    staff = list(db.scalars(select(Staff).order_by(Staff.is_chief.desc(), Staff.created_at)))
    running: dict[str, Task] = {}
    for t in db.scalars(select(Task).where(Task.status == "running").order_by(Task.started_at)):
        running[t.staff_id] = t
    queued: dict[str, int] = dict(db.execute(select(Task.staff_id, func.count()).where(Task.status == "queued").group_by(Task.staff_id)).all())  # type: ignore[arg-type]
    chats: dict[str, Thread] = {th.staff_id: th for th in db.scalars(select(Thread).where(Thread.awaiting_reply.is_(True)))}
    waiting: dict[str, list[InboxItem]] = {}
    for i in db.scalars(select(InboxItem).where(InboxItem.status == "open", InboxItem.kind.in_(["proposal", "question"])).order_by(InboxItem.created_at)):
        if i.staff_id:
            waiting.setdefault(i.staff_id, []).append(i)
    last_end: dict[str, Task] = {}
    for t in db.scalars(select(Task).where(Task.ended_at.is_not(None), Task.ended_at >= t_now - FAILED_FOR).order_by(Task.ended_at.desc())):
        last_end.setdefault(t.staff_id, t)
    last_ev: dict[str, dt.datetime] = dict(db.execute(select(OfficeEvent.staff_id, func.max(OfficeEvent.at)).group_by(OfficeEvent.staff_id)).all())  # type: ignore[arg-type]
    run_ids = [t.id for t in running.values()]
    last_tool: dict[str, dict] = {}
    if run_ids:
        for e in db.scalars(select(OfficeEvent).where(OfficeEvent.kind == "tool", OfficeEvent.task_id.in_(run_ids)).order_by(OfficeEvent.id.desc()).limit(200)):
            last_tool.setdefault(e.task_id or "", {"name": (e.data or {}).get("name"), "phase": (e.data or {}).get("phase"), "at": _iso(e.at)})
    # collaboration: running/queued jobs whose parent job (another helper's) is still open
    active = list(db.scalars(select(Task).where(Task.status.in_(["running", "queued"]), Task.parent_task_id.is_not(None))))
    parents = {t.id: t for t in db.scalars(select(Task).where(Task.id.in_([a.parent_task_id for a in active]))) } if active else {}
    collab: dict[str, list[dict]] = {}
    for a in active:
        p = parents.get(a.parent_task_id or "")
        if p and p.staff_id != a.staff_id and p.status in ("running", "queued", "done"):
            collab.setdefault(a.staff_id, []).append({"staff_id": p.staff_id, "task_id": a.id, "brief": _short(a.brief, 90), "relation": "working_for", "live": a.status == "running"})
            collab.setdefault(p.staff_id, []).append({"staff_id": a.staff_id, "task_id": a.id, "brief": _short(a.brief, 90), "relation": "handed_to", "live": a.status == "running"})
    hs = S.helper_states(db)
    company_paused = S.is_paused(db)

    agents = []
    for st in staff:
        run, chat, w = running.get(st.id), chats.get(st.id), waiting.get(st.id, [])
        le = last_end.get(st.id)
        failed = le if (le and le.status == "failed") else None
        if st.status != "active" or company_paused:
            status, since = "paused", st.updated_at
        elif run or chat:
            status, since = "working", (run.started_at if run else chat.updated_at)
        elif w:
            status, since = "blocked", w[0].created_at
        elif failed:
            status, since = "failed", failed.ended_at
        elif queued.get(st.id):
            status, since = "queued", None
        else:
            status, since = "idle", le.ended_at if le else None
        cur = None
        if run:
            cur = {"kind": "job", "task_id": run.id, "brief": _short(run.brief, 220), "origin": run.origin, "started_at": _iso(run.started_at),
                   "tool": last_tool.get(run.id)}
        elif chat:
            cur = {"kind": "chat", "thread_id": chat.id, "brief": _short(chat.title or "Replying to you", 220), "started_at": _iso(chat.updated_at), "tool": None}
        times = [x for x in (last_ev.get(st.id), run.started_at if run else None, le.ended_at if le else None) if x]
        agents.append({
            "id": st.id, "name": st.name, "role": st.role, "is_chief": st.is_chief, "department": department(st),
            "status": status, "since": _iso(since), "current": cur, "queued": queued.get(st.id, 0),
            "waiting": [{"id": i.id, "kind": i.kind, "title": _short(i.title, 120), "task_id": i.task_id, "at": _iso(i.created_at)} for i in w[:5]],
            "waiting_count": len(w),
            "last_failure": {"task_id": failed.id, "brief": _short(failed.brief, 160), "error": _short(failed.error, 300), "at": _iso(failed.ended_at)} if failed else None,
            "collaborators": collab.get(st.id, [])[:6],
            "last_activity": _iso(max((x if x.tzinfo else x.replace(tzinfo=dt.UTC)) for x in times)) if times else None,
            "next_job": (hs.get(st.id) or {}).get("next_job"),
        })
    return {"server_time": _iso(t_now), "cursor": cursor(db), "last_event_at": _iso(db.scalar(select(func.max(OfficeEvent.at)))), "paused": company_paused, "departments": departments(), "agents": agents}


def agent_detail(db: Session, staff_id: str) -> dict | None:
    """Everything the inspector shows for one helper: recent jobs, the live log of its current (or last) job,
    the tools it used this week, its last output and its recent events."""
    st = db.get(Staff, staff_id)
    if not st:
        return None
    me = next((a for a in state(db)["agents"] if a["id"] == staff_id), None)
    jobs = list(db.scalars(select(Task).where(Task.staff_id == staff_id).order_by(Task.created_at.desc()).limit(12)))
    focus = next((t for t in jobs if t.status == "running"), None) or next((t for t in jobs if t.ended_at), None)
    log_rows = []
    if focus:
        for e in db.scalars(select(RunEvent).where(RunEvent.task_id == focus.id, RunEvent.kind.in_(["status", "tool", "text", "browser"]))
                            .order_by(RunEvent.id.desc()).limit(60)):
            d = e.data or {}
            if e.kind == "tool":
                line = _tool_label(str(d.get("name") or "tool")) + ("" if d.get("state") != "running" else " …")
                ok = d.get("ok", True) is not False and not d.get("error")
            elif e.kind == "status":
                line, ok = str(d.get("state") or "") + (f": {_short(d.get('error') or d.get('reason') or '', 160)}" if d.get("error") or d.get("reason") else ""), d.get("state") != "failed"
            elif e.kind == "browser":
                line, ok = f"browser {_short(str(d.get('url') or ''), 120)}", True
            else:
                line, ok = _short(str(d.get("text") or ""), 240), True
            if line.strip():
                log_rows.append({"id": e.id, "at": _iso(e.at), "kind": e.kind, "text": line, "ok": ok})
        log_rows.reverse()
    week = now() - dt.timedelta(days=7)
    tools: dict[str, int] = {}
    for e in db.scalars(select(OfficeEvent).where(OfficeEvent.staff_id == staff_id, OfficeEvent.kind == "tool", OfficeEvent.at >= week).limit(3000)):
        if (e.data or {}).get("phase") != "start":
            n = (e.data or {}).get("name") or "tool"
            tools[n] = tools.get(n, 0) + 1
    last_done = db.scalar(select(Task).where(Task.staff_id == staff_id, Task.status == "done", Task.result_text != "").order_by(Task.ended_at.desc()).limit(1))
    evs = [serialize(e) for e in db.scalars(select(OfficeEvent).where(OfficeEvent.staff_id == staff_id).order_by(OfficeEvent.id.desc()).limit(30))]
    return {
        "agent": me,
        "jobs": [{"id": t.id, "brief": _short(t.brief, 200), "status": t.status, "origin": t.origin, "created_at": _iso(t.created_at), "started_at": _iso(t.started_at),
                  "ended_at": _iso(t.ended_at), "error": _short(t.error, 300), "tokens": t.tokens, "cost_usd": round(t.cost_usd or 0, 4)} for t in jobs],
        "log": {"task_id": focus.id, "brief": _short(focus.brief, 200), "status": focus.status, "lines": log_rows} if focus else None,
        "tools": sorted(({"name": k, "calls": v} for k, v in tools.items()), key=lambda x: -x["calls"])[:12],
        "output": {"task_id": last_done.id, "brief": _short(last_done.brief, 160), "at": _iso(last_done.ended_at), "text": (last_done.result_text or "")[:4000]} if last_done else None,
        "events": evs,
    }
