"""The Inbox board: what needs the owner, what is running, what just finished, as compact cards.

Each card carries a short summary, how long it has been going (or took), how many sources the helper read and
how many tools it used, the engine, and a few recent steps (checkpoints and notable run events)."""
from __future__ import annotations

import datetime as dt
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import serialize as X
from .models import Checkpoint, InboxItem, Proposal, Report, RunEvent, Staff, Task, now

SEARCH_TOOLS = ("websearch", "webfetch", "web_search", "web_fetch", "browser", "search", "fetch", "navigate", "read", "grep", "glob")


def _aware(d):
    return d.replace(tzinfo=d.tzinfo or dt.UTC) if d else None


def _clip(s: str, n: int = 160) -> str:
    s = " ".join((s or "").replace("**", "").replace("#", "").replace("`", "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _title(brief: str) -> str:
    first = (brief or "").strip().splitlines()[0] if (brief or "").strip() else "Job"
    return _clip(first, 70)


def _task_facts(db: Session, task_ids: list[str]) -> dict[str, dict]:
    """Counts, engine and recent steps per task, from run events and checkpoints."""
    facts: dict[str, dict] = defaultdict(lambda: {"searches": 0, "tools": 0, "engine": "", "steps": [], "last_text": ""})
    if not task_ids:
        return facts
    for e in db.scalars(select(RunEvent).where(RunEvent.task_id.in_(task_ids)).order_by(RunEvent.id)):
        f, d = facts[e.task_id], e.data or {}
        if e.kind == "tool":
            if d.get("state") == "running":
                continue  # count each call once, when it finishes
            name = str(d.get("name") or "").lower()
            f["tools"] += 1
            if any(k in name for k in SEARCH_TOOLS):
                f["searches"] += 1
            if not d.get("ok", True):
                f["steps"].append({"at": X.iso(e.at), "text": f"{d.get('name')} failed"})
        elif e.kind == "sources":
            f["searches"] += max(0, len(d.get("items") or []) - 1)  # several results from one search count as more reading
        elif e.kind == "status":
            st = d.get("state")
            if st == "started":
                f["engine"] = d.get("engine") or f["engine"]
            elif st == "switching":
                f["steps"].append({"at": X.iso(e.at), "text": f"Switched account ({d.get('reason') or 'limit'})"})
            elif st == "failed" and d.get("error"):
                f["steps"].append({"at": X.iso(e.at), "text": _clip(f"Stopped: {d['error']}", 90)})
            elif st == "harness" and d.get("account"):
                f["engine"] = f["engine"] or "Claude Code pool"
        elif e.kind in ("text", "draft") and d.get("text"):
            f["last_text"] = d["text"]
    for c in db.scalars(select(Checkpoint).where(Checkpoint.task_id.in_(task_ids)).order_by(Checkpoint.at)):
        if c.done:
            facts[c.task_id]["steps"].append({"at": X.iso(c.at), "text": _clip(c.done, 90)})
        facts[c.task_id]["next"] = c.next
    for f in facts.values():
        f["steps"].sort(key=lambda s: s["at"] or "")
        f["steps"] = f["steps"][-4:]
    return facts


def build(db: Session, done_hours: int = 48) -> dict:
    staff = {s.id: s for s in db.scalars(select(Staff))}
    t_now = now()

    open_items = list(db.scalars(select(InboxItem).where(InboxItem.status == "open")))
    order = {"critical": 0, "decision": 1, "fyi": 2}
    open_items.sort(key=lambda i: (order.get(i.level, 3), not i.blocking, -(_aware(i.created_at).timestamp())))
    running = list(db.scalars(select(Task).where(Task.status.in_(["running", "queued"])).order_by(Task.created_at.desc()).limit(50)))
    done = list(db.scalars(select(Task).where(Task.status.in_(["done", "failed", "cancelled"]), Task.ended_at >= t_now - dt.timedelta(hours=done_hours))
                           .order_by(Task.ended_at.desc()).limit(30)))
    tids = [i.task_id for i in open_items if i.task_id] + [t.id for t in running + done]
    facts = _task_facts(db, list(dict.fromkeys(tids)))
    reports = {r.task_id: r for r in db.scalars(select(Report).where(Report.task_id.in_([t.id for t in done])))} if done else {}

    def who(sid):
        s = staff.get(sid or "")
        return {"id": sid, "name": s.name if s else (sid or "Saga OS"), "role": s.role if s else "", "is_chief": bool(s and s.is_chief)}

    needs = []
    for i in open_items:
        f = facts.get(i.task_id) if i.task_id else None
        card = {"id": i.id, "kind": i.kind, "title": _clip(i.title, 70), "summary": _clip(i.body or i.title),
                "staff": who(i.staff_id), "since": X.iso(i.created_at), "level": i.level, "blocking": i.blocking, "task_id": i.task_id,
                "searches": f["searches"] if f else 0, "tools": f["tools"] if f else 0, "engine": f["engine"] if f else "",
                "steps": f["steps"] if f else [], "item": X.inbox(i)}
        if i.kind == "proposal" and (p := db.get(Proposal, i.ref_id)):
            card["item"]["proposal"] = X.proposal(p)
            card["summary"] = _clip(X.proposal(p).get("body_md") or i.title)
        needs.append(card)

    run_cards = []
    for t in running:
        f = facts.get(t.id) or {"searches": 0, "tools": 0, "engine": "", "steps": [], "last_text": ""}
        lines = [x for x in (t.brief or "").strip().splitlines() if x.strip()]
        summary = " ".join(lines[1:]) if len(lines) > 1 else (f.get("last_text") or t.brief)
        steps = list(f["steps"])
        if f.get("next"):
            steps = steps[-3:] + [{"at": None, "text": f"Now: {_clip(f['next'], 80)}"}]
        run_cards.append({"id": t.id, "title": _title(t.brief), "summary": _clip(summary), "staff": who(t.staff_id), "status": t.status,
                          "started_at": X.iso(t.started_at), "created_at": X.iso(t.created_at), "searches": f["searches"], "tools": f["tools"],
                          "engine": f["engine"], "steps": steps, "origin": t.origin})

    done_cards = []
    for t in done:
        f = facts.get(t.id) or {"searches": 0, "tools": 0, "engine": "", "steps": [], "last_text": ""}
        r = reports.get(t.id)
        took = (_aware(t.ended_at) - _aware(t.started_at)).total_seconds() if t.started_at and t.ended_at else None
        summary = (r.headline + (" · " + _clip(r.body_md, 120) if r.body_md else "")) if r else (t.error if t.status == "failed" else t.result_text) or t.brief
        done_cards.append({"id": t.id, "title": _title(t.brief), "summary": _clip(summary), "staff": who(t.staff_id), "status": t.status,
                           "ended_at": X.iso(t.ended_at), "seconds": round(took) if took is not None else None,
                           "searches": f["searches"], "tools": f["tools"], "engine": f["engine"], "steps": f["steps"]})

    from .plan import lineage

    lin = lineage(db, tids)
    for c in needs:  # an approval or question belongs to its job: show the job itself as the last step up
        tid = c.get("task_id")
        if tid and tid in lin:
            t = db.get(Task, tid)
            me = {"id": tid, "title": _title(t.brief) if t else tid, "staff_id": t.staff_id if t else "", "staff": who(t.staff_id)["name"] if t else "",
                  "status": t.status if t else ""}
            c["lineage"] = {**lin[tid], "parents": lin[tid]["parents"] + [me]}
    for c in run_cards + done_cards:
        c["lineage"] = lin.get(c["id"])
    return {"needs": needs, "running": run_cards, "done": done_cards, "now": X.iso(t_now)}
