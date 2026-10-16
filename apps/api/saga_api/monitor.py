"""The Monitor page: one read of how the company of helpers is doing over a time range.

Everything is computed from what Saga OS already records: run usage events (tokens, cost, time per run, any engine),
tasks, proposals and inbox items, MCP tool calls, the Claude Code pool and notices."""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import services as S
from .models import InboxItem, Notice, Proposal, RunEvent, Staff, Task, ToolCall, now

RANGES = {"24h": (dt.timedelta(hours=24), "hour", 24), "7d": (dt.timedelta(days=7), "day", 7), "30d": (dt.timedelta(days=30), "day", 30)}


def _aware(d: dt.datetime | None) -> dt.datetime | None:
    return d.replace(tzinfo=d.tzinfo or dt.UTC) if d else None


def _buckets(rng: str, tz: ZoneInfo) -> tuple[list[dt.datetime], dt.timedelta]:
    span, unit, n = RANGES[rng]
    local = now().astimezone(tz)
    if unit == "hour":
        end = local.replace(minute=0, second=0, microsecond=0) + dt.timedelta(hours=1)
        step = dt.timedelta(hours=1)
    else:
        end = local.replace(hour=0, minute=0, second=0, microsecond=0) + dt.timedelta(days=1)
        step = dt.timedelta(days=1)
    return [end - step * (n - i) for i in range(n)], step


def _index(starts: list[dt.datetime], step: dt.timedelta, at: dt.datetime | None) -> int | None:
    if at is None:
        return None
    i = int((_aware(at) - starts[0]) // step)
    return i if 0 <= i < len(starts) else None


def build(db: Session, rng: str = "7d") -> dict:
    from . import harness as H
    from .notify import serialize as notice_json
    from .serialize import iso

    rng = rng if rng in RANGES else "7d"
    tz = S._tz(db)
    starts, step = _buckets(rng, tz)
    t0, t_end = starts[0], starts[-1] + step
    span = t_end - t0
    p0 = t0 - span  # the previous period of the same length, for deltas

    staff = list(db.scalars(select(Staff).order_by(Staff.is_chief.desc(), Staff.created_at, Staff.name)))
    awake = S.awake_staff(db)

    # ---- tokens, cost and run time, from usage events (every engine reports one per run)
    usage = list(db.scalars(select(RunEvent).where(RunEvent.kind == "usage", RunEvent.at >= p0)))
    tok = defaultdict(lambda: [0] * len(starts))
    per_staff = defaultdict(lambda: {"tokens": 0, "cost": 0.0, "runs": 0, "seconds": 0.0})
    cur = {"tokens": 0, "cost": 0.0, "runs": 0, "seconds": 0.0}
    prev = {"tokens": 0, "cost": 0.0, "runs": 0}
    for e in usage:
        d = e.data or {}
        tokens, cost = int(d.get("tokens") or 0), float(d.get("cost_usd") or 0)
        at = _aware(e.at)
        if at >= t0:
            i = _index(starts, step, at)
            if i is not None:
                tok[e.staff_id][i] += tokens
            cur["tokens"] += tokens
            cur["cost"] += cost
            cur["runs"] += 1
            cur["seconds"] += float(d.get("seconds") or 0)
            ps = per_staff[e.staff_id]
            ps["tokens"] += tokens
            ps["cost"] += cost
            ps["runs"] += 1
            ps["seconds"] += float(d.get("seconds") or 0)
        else:
            prev["tokens"] += tokens
            prev["cost"] += cost
            prev["runs"] += 1

    # ---- jobs
    ended = list(db.scalars(select(Task).where(Task.ended_at >= p0, Task.status.in_(["done", "failed"]))))
    jobs = {"done": [0] * len(starts), "failed": [0] * len(starts)}
    jcur = {"done": 0, "failed": 0}
    jprev = {"done": 0, "failed": 0}
    jstaff = defaultdict(lambda: {"done": 0, "failed": 0})
    for t in ended:
        at = _aware(t.ended_at)
        if at >= t0:
            i = _index(starts, step, at)
            if i is not None:
                jobs[t.status][i] += 1
            jcur[t.status] += 1
            jstaff[t.staff_id][t.status] += 1
        else:
            jprev[t.status] += 1
    running = {t.staff_id: t for t in db.scalars(select(Task).where(Task.status == "running"))}
    queued = db.scalar(select(func.count()).select_from(Task).where(Task.status == "queued")) or 0

    # ---- waiting on the owner
    open_items = list(db.scalars(select(InboxItem).where(InboxItem.status == "open")))
    decided = list(db.scalars(select(Proposal).where(Proposal.decided_at >= t0)))
    waits = [(_aware(p.decided_at) - _aware(p.created_at)).total_seconds() / 60 for p in decided if p.decided_at and p.created_at]
    oldest = min((_aware(i.created_at) for i in open_items), default=None)

    # ---- last activity per helper
    last_seen = dict(db.execute(select(RunEvent.staff_id, func.max(RunEvent.at)).group_by(RunEvent.staff_id)).all())

    helpers = []
    for st in staff:
        t = running.get(st.id)
        state = "paused" if st.status != "active" else "working" if t else "awake" if st.id in awake else "sleeping"
        ps, js = per_staff.get(st.id, {}), jstaff.get(st.id, {})
        helpers.append({
            "id": st.id, "name": st.name, "role": st.role, "is_chief": st.is_chief, "state": state,
            "engine": (st.engine or {}).get("type", "fake"),
            "current": {"task_id": t.id, "brief": t.brief[:140], "started_at": iso(t.started_at)} if t else None,
            "tokens": ps.get("tokens", 0), "cost_usd": round(ps.get("cost", 0.0), 4), "runs": ps.get("runs", 0),
            "jobs_done": js.get("done", 0), "jobs_failed": js.get("failed", 0),
            "last_active": iso(last_seen.get(st.id)),
        })

    # ---- tools (Saga's MCP tools, every engine)
    tool_rows = db.execute(select(ToolCall.tool, ToolCall.decision, func.count(), func.avg(ToolCall.duration_ms))
                           .where(ToolCall.at >= t0).group_by(ToolCall.tool, ToolCall.decision)).all()
    tools = defaultdict(lambda: {"calls": 0, "errors": 0, "blocked": 0, "ms_total": 0.0})
    for name, decision, n, avg in tool_rows:
        x = tools[name]
        x["calls"] += n
        x["ms_total"] += (avg or 0) * n
        if decision == "error":
            x["errors"] += n
        elif decision == "refused":
            x["blocked"] += n
    top_tools = sorted(({"name": k, "calls": v["calls"], "errors": v["errors"], "blocked": v["blocked"],
                         "avg_ms": round(v["ms_total"] / v["calls"]) if v["calls"] else 0} for k, v in tools.items()),
                       key=lambda x: -x["calls"])[:8]

    # ---- pool
    pool = H.meter()
    from .models import HarnessUsage

    acc_tokens = dict(db.execute(select(HarnessUsage.account_id, func.sum(HarnessUsage.tokens)).where(HarnessUsage.at >= t0)
                                 .group_by(HarnessUsage.account_id)).all())
    for a in pool["accounts"]:
        a["tokens_range"] = int(acc_tokens.get(a["id"]) or 0)

    activity = [notice_json(n) for n in db.scalars(select(Notice).where(Notice.kind != "test").order_by(Notice.id.desc()).limit(12))]

    return {
        "range": rng, "timezone": tz.key, "unit": RANGES[rng][1],
        "buckets": [iso(b) for b in starts],
        "kpi": {
            "tokens": cur["tokens"], "tokens_prev": prev["tokens"], "cost_usd": round(cur["cost"], 4), "cost_prev": round(prev["cost"], 4),
            "runs": cur["runs"], "runs_prev": prev["runs"], "avg_run_seconds": round(cur["seconds"] / cur["runs"], 1) if cur["runs"] else None,
            "jobs_done": jcur["done"], "jobs_failed": jcur["failed"], "jobs_done_prev": jprev["done"], "jobs_failed_prev": jprev["failed"],
            "waiting": len(open_items), "waiting_critical": sum(1 for i in open_items if i.level == "critical" or i.blocking),
            "oldest_waiting": iso(oldest), "avg_decision_minutes": round(sum(waits) / len(waits)) if waits else None, "decided": len(waits),
            "working": sum(1 for h in helpers if h["state"] == "working"), "awake": sum(1 for h in helpers if h["state"] in ("working", "awake")),
            "helpers": len(helpers), "queued": queued, "paused": S.is_paused(db),
        },
        "tokens_by_helper": [{"staff_id": k, "values": v} for k, v in tok.items() if any(v)],
        "jobs": jobs,
        "helpers": helpers,
        "tools": top_tools,
        "pool": pool,
        "activity": activity,
        **insights(db, t0, staff),
    }


# ------------------------------------------------------------------ insights
FAILURE_CAUSES = [  # (key, label, what to do, pattern)
    ("limit", "Usage limit", "Add pool accounts or spread jobs over the day", r"usage limit|limit reached|rate limit|429|quota|overloaded|no claude code account is free"),
    ("signin", "Sign-in problem", "Re-add the token on the Harness page or check the API key", r"invalid api key|unauthori[sz]ed|authentication|401|403|please run /login|oauth|expired|revoked"),
    ("timeout", "Took too long", "Raise the helper's time limit or split the job", r"timed? ?out|timeout|deadline"),
    ("connection", "Could not connect", "Check the AI engine is running and reachable", r"connecterror|connection|unreachable|refused|dns|network"),
    ("interrupted", "Interrupted", "Saga OS restarted during the job", r"interrupted|requeued|cancelled"),
    ("budget", "Budget", "Raise the helper's monthly budget", r"budget"),
]


def _pct(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    xs = sorted(xs)
    k = (len(xs) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def insights(db: Session, t0: dt.datetime, staff: list[Staff]) -> dict:
    import re

    from . import budgets
    from .models import HarnessAccount, HarnessLimitHit, HarnessUsage
    from .serialize import iso

    names = {s.id: s.name for s in staff}
    tasks = list(db.scalars(select(Task).where(Task.ended_at >= t0, Task.status.in_(["done", "failed"]))))

    # run timing: per helper and per engine (jobs that started and ended)
    by_staff, by_engine = defaultdict(list), defaultdict(lambda: {"secs": [], "failed": 0, "jobs": 0})
    slowest: dict[str, Task] = {}
    for t in tasks:
        eng = by_engine[t.engine_type or "fake"]
        eng["jobs"] += 1
        eng["failed"] += t.status == "failed"
        if t.started_at and t.ended_at:
            secs = (_aware(t.ended_at) - _aware(t.started_at)).total_seconds()
            by_staff[t.staff_id].append(secs)
            eng["secs"].append(secs)
            if t.staff_id not in slowest or secs > (_aware(slowest[t.staff_id].ended_at) - _aware(slowest[t.staff_id].started_at)).total_seconds():
                slowest[t.staff_id] = t
    timing_staff = sorted(({"staff_id": k, "name": names.get(k, k), "jobs": len(v), "median_s": round(_pct(v, .5) or 0), "p90_s": round(_pct(v, .9) or 0),
                            "slowest": {"task_id": slowest[k].id, "brief": slowest[k].brief.splitlines()[0][:80],
                                        "seconds": round((_aware(slowest[k].ended_at) - _aware(slowest[k].started_at)).total_seconds())} if k in slowest else None}
                           for k, v in by_staff.items()), key=lambda x: -x["median_s"])
    labels = {"claude-code": "Claude Code pool", "hermes": "Hermes (removed)", "claude": "Claude (direct)", "fake": "Practice mode"}
    timing_engine = sorted(({"engine": labels.get(k, k), "jobs": v["jobs"], "failed": v["failed"],
                             "fail_rate": round(v["failed"] * 100 / v["jobs"]) if v["jobs"] else 0,
                             "median_s": round(_pct(v["secs"], .5) or 0), "p90_s": round(_pct(v["secs"], .9) or 0)}
                            for k, v in by_engine.items()), key=lambda x: -x["jobs"])

    # failure causes
    groups: dict[str, dict] = {}
    for t in (t for t in tasks if t.status == "failed"):
        err = t.error or ""
        key, label, fix = "other", "Other", "Open the job to see what happened"
        for k, lab, f, pat in FAILURE_CAUSES:
            if re.search(pat, err, re.I):
                key, label, fix = k, lab, f
                break
        g = groups.setdefault(key, {"key": key, "label": label, "fix": fix, "count": 0, "example": "", "jobs": []})
        g["count"] += 1
        g["example"] = g["example"] or err[:200]
        if len(g["jobs"]) < 5:
            g["jobs"].append({"task_id": t.id, "brief": t.brief.splitlines()[0][:70] if t.brief else t.id, "staff": names.get(t.staff_id, t.staff_id), "at": iso(t.ended_at)})
    failures = sorted(groups.values(), key=lambda g: -g["count"])

    # value per helper: proposals and what they cost
    props = list(db.scalars(select(Proposal).where(Proposal.created_at >= t0)))
    usage = defaultdict(float)
    for e in db.scalars(select(RunEvent).where(RunEvent.kind == "usage", RunEvent.at >= t0)):
        usage[e.staff_id] += float((e.data or {}).get("cost_usd") or 0)
    value = []
    for s in staff:
        mine = [p for p in props if p.staff_id == s.id]
        approved = sum(p.status in ("approved", "executing", "done") for p in mine)
        rejected = sum(p.status == "rejected" for p in mine)
        changes = sum(p.status == "changes_requested" for p in mine)
        pending = sum(p.status == "pending" for p in mine)
        decided = approved + rejected + changes
        cost = usage.get(s.id, 0.0)
        if not mine and not cost:
            continue
        value.append({"staff_id": s.id, "name": s.name, "proposals": len(mine), "approved": approved, "rejected": rejected, "changes": changes,
                      "pending": pending, "approval_rate": round(approved * 100 / decided) if decided else None, "cost_usd": round(cost, 4),
                      "cost_per_approved": round(cost / approved, 4) if approved else None})
    value.sort(key=lambda v: (-(v["approved"]), v["cost_per_approved"] or 1e9))

    # pool history: tokens per account per hour over the last 24 hours, and when limits hit
    hour0 = S.now().replace(minute=0, second=0, microsecond=0) - dt.timedelta(hours=23)
    accounts = list(db.scalars(select(HarnessAccount).order_by(HarnessAccount.created_at)))
    grid = {a.id: [0] * 24 for a in accounts}
    for u in db.scalars(select(HarnessUsage).where(HarnessUsage.at >= hour0)):
        i = int((_aware(u.at) - hour0).total_seconds() // 3600)
        if u.account_id in grid and 0 <= i < 24:
            grid[u.account_id][i] += u.tokens
    hits = defaultdict(list)
    for h in db.scalars(select(HarnessLimitHit).where(HarnessLimitHit.at >= hour0)):
        i = int((_aware(h.at) - hour0).total_seconds() // 3600)
        if 0 <= i < 24:
            hits[h.account_id].append({"hour": i, "at": iso(h.at), "resets_at": iso(h.resets_at)})
    pool_history = {"hours": [iso(hour0 + dt.timedelta(hours=i)) for i in range(24)],
                    "accounts": [{"id": a.id, "label": a.label, "tokens": grid[a.id], "hits": hits.get(a.id, [])} for a in accounts]}
    total_hits_7d = db.scalar(select(func.count()).select_from(HarnessLimitHit).where(HarnessLimitHit.at >= S.now() - dt.timedelta(days=7))) or 0

    # budgets (this month)
    used = budgets.month_usage(db)
    budget = {s.id: budgets.status(db, s, used.get(s.id, {"tokens": 0, "cost_usd": 0.0})) for s in staff}

    return {"timing": {"helpers": timing_staff, "engines": timing_engine}, "failures": failures, "value": value,
            "pool_history": {**pool_history, "hits_7d": total_hits_7d}, "budgets": budget}
