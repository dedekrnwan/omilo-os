"""Analytics endpoints.

Endpoints:
  GET /v1/analytics/overview          ?range=week&channel_id=  → {stats[], series[], buckets[]}
  GET /v1/analytics/helpers           ?range=week&channel_id=  → [{helperId, name, area, role, status,
                                                                  doing, jobs, success, tokens, spend,
                                                                  lastActive, budget, budgetReached}]
  GET /v1/analytics/spend-by-channel  ?range=week&channel_id=  → {buckets[], series[], total}
  GET /v1/analytics/tokens-by-helper  ?range=week&channel_id=  → {buckets[], series[], total}
  GET /v1/analytics/loops             ?range=week              → [{id, kind, name, ..., on}]
  GET /v1/analytics/reliability       ?range=week&channel_id=  → {stats[], causes[], causesTip}
  GET /v1/analytics/failures          ?range=week&channel_id=  → [{jobId, helperId, title, error, at, status, action}]
  GET /v1/activity ?kinds=&helper=&cursor=&limit=              → {items[], nextCursor, counts}
  POST /v1/jobs/{id}/retry                                     → {jobId, status, error}
      (lives here, not in a jobs module, so it doesn't collide with other
       sweep areas; move it if a jobs router lands.)

All values computed from real Job / Routine / Flow / Proposal
rows (company-scoped via RLS), never hardcoded.

range values: "day" (1d), "week" (7d, default), "month" (30d), "quarter" (91d).
Labels the UI used to send ("7 days", "30 days", "90 days") are accepted too.

AI usage is counted in tokens (Job.tokens_in + tokens_out) — the unit for budgets too.

Every stat carries the previous-period value (`prev`) so the UI can show a
delta vs the period before.
"""
from __future__ import annotations

import builtins
import re
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from omilo.models.agents import Helper
from omilo.models.execution import Job
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["analytics"])


# ── Range helpers ─────────────────────────────────────────────────────────────

_RANGE_DAYS = {"day": 1, "week": 7, "month": 30, "quarter": 91}
_RANGE_ALIASES = {
    "1 day": "day",
    "24h": "day",
    "7 days": "week",
    "7d": "week",
    "30 days": "month",
    "30d": "month",
    "90 days": "quarter",
    "90d": "quarter",
}
# (bucket count, bucket size in days) per range — keeps charts to ≤ 13 bars.
_BUCKETS = {"day": (1, 1), "week": (7, 1), "month": (10, 3), "quarter": (13, 7)}


def _norm_range(range_: str | None) -> str:
    r = (range_ or "week").strip().lower()
    r = _RANGE_ALIASES.get(r, r)
    return r if r in _RANGE_DAYS else "week"


def _range_start(range_: str) -> datetime:
    """Return a UTC datetime for the start of the given range."""
    now = datetime.now(tz=timezone.utc)
    return now - timedelta(days=_RANGE_DAYS[_norm_range(range_)])


def _window(range_: str) -> tuple[datetime, datetime, datetime]:
    """(prev_start, start, now) — the current window and the one before it."""
    now = datetime.now(tz=timezone.utc)
    days = _RANGE_DAYS[_norm_range(range_)]
    start = now - timedelta(days=days)
    return start - timedelta(days=days), start, now


def _buckets(range_: str) -> list[tuple[datetime, datetime]]:
    """Contiguous [start, end) buckets ending today (UTC day boundaries)."""
    n, size = _BUCKETS[_norm_range(range_)]
    today = datetime.now(tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    end = today + timedelta(days=1)
    out = []
    for i in builtins.range(n):
        b_end = end - timedelta(days=size * (n - 1 - i))
        out.append((b_end - timedelta(days=size), b_end))
    return out


def _bucket_meta(buckets: list[tuple[datetime, datetime]]) -> list[dict[str, str]]:
    return [
        {"start": s.date().isoformat(), "end": (e - timedelta(days=1)).date().isoformat()}
        for s, e in buckets
    ]


def _bucket_index(buckets: list[tuple[datetime, datetime]], at: datetime | None) -> int | None:
    if at is None:
        return None
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    for i, (s, e) in enumerate(buckets):
        if s <= at < e:
            return i
    return None


# ── Channel scoping ───────────────────────────────────────────────────────────


def _channel_scope(db: Session, channel_id: str | None):
    """Return (helper_ids, session_ids) belonging to a channel, or None when unscoped.

    A job belongs to a channel when its helper serves that channel
    (helper.channel_ids) or its chat session lives in the channel.
    """
    if not channel_id:
        return None
    from omilo.models.chat import ChatSession

    helper_ids = [
        h.id for h in db.query(Helper).all() if channel_id in (h.channel_ids or [])
    ]
    session_ids = [
        sid for (sid,) in db.query(ChatSession.id).filter(ChatSession.channel_id == channel_id).all()
    ]
    return helper_ids, session_ids


def _job_filter(scope):
    if scope is None:
        return None
    helper_ids, session_ids = scope
    conds = []
    if helper_ids:
        conds.append(Job.helper_id.in_(helper_ids))
    if session_ids:
        conds.append(Job.session_id.in_(session_ids))
    if not conds:
        return Job.id.is_(None)  # matches nothing
    return or_(*conds)


def _jobs(db: Session, scope, since: datetime, until: datetime | None = None):
    q = db.query(Job).filter(Job.created_at >= since)
    if until is not None:
        q = q.filter(Job.created_at < until)
    f = _job_filter(scope)
    if f is not None:
        q = q.filter(f)
    return q.all()


def _stat(label: str, value: int | float, prev: int | float, note: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"label": label, "value": value, "prev": prev}
    if note is not None:
        out["note"] = note
    return out


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("/analytics/overview", status_code=200)
def analytics_overview(
    range: str = Query(default="week", description="day | week | month | quarter"),
    channel_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return {stats, series, buckets} computed exactly from Job rows for the company.

    stats (each with `prev` = same stat for the previous period):
      - "Jobs done"    → count(status='done')
      - "Success rate" → round(100 * done / total) if total > 0 else 0
      - "Tokens"       → sum(tokens_in + tokens_out)
      - "Tokens per job" → average tokens per job

    series:
      - "Jobs per day" → total jobs per day over the range (legacy, daily)
      - "Done" / "Failed" → per bucket (see `buckets`) for the stacked jobs chart
    """
    range_key = _norm_range(range)
    prev_start, start, _now = _window(range_key)
    scope = _channel_scope(db, channel_id)

    all_jobs = _jobs(db, scope, start)
    prev_jobs = _jobs(db, scope, prev_start, start)

    def summary(jobs):
        total = len(jobs)
        done = sum(1 for j in jobs if j.status == "done")
        failed = sum(1 for j in jobs if j.status == "failed")
        tokens = sum((j.tokens_in or 0) + (j.tokens_out or 0) for j in jobs)
        success = round(100 * done / total) if total > 0 else 0
        return total, done, failed, tokens, success

    total, done_count, failed_count, tokens, success_rate = summary(all_jobs)
    _pt, p_done, _pf, p_tokens, p_success = summary(prev_jobs)

    stats = [
        _stat("Jobs done", done_count, p_done),
        _stat("Success rate", success_rate, p_success, "%"),
        _stat("Tokens", tokens, p_tokens),
        _stat("Tokens per job", round(tokens / total) if total else 0,
              round(p_tokens / _pt) if _pt else 0, "tokens"),
    ]
    stats[1]["failed"] = failed_count
    stats[2]["perJob"] = round(tokens / total) if total else 0

    # Legacy daily series (kept for existing consumers)
    days = _RANGE_DAYS[range_key]
    now_utc = datetime.now(tz=timezone.utc)
    date_counts: dict[str, int] = {}
    for j in all_jobs:
        if j.created_at:
            d = j.created_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
            date_counts[d] = date_counts.get(d, 0) + 1
    series_values = []
    series_labels = []
    for offset in builtins.range(days):
        day = (now_utc - timedelta(days=days - 1 - offset)).strftime("%Y-%m-%d")
        series_labels.append(day)
        series_values.append(date_counts.get(day, 0))

    buckets = _buckets(range_key)
    labels = [s.date().isoformat() for s, _ in buckets]
    done_b = [0] * len(buckets)
    failed_b = [0] * len(buckets)
    for j in _jobs(db, scope, buckets[0][0]):
        i = _bucket_index(buckets, j.created_at)
        if i is None:
            continue
        if j.status == "done":
            done_b[i] += 1
        elif j.status == "failed":
            failed_b[i] += 1

    series = [
        {"label": "Jobs per day", "values": series_values, "labels": series_labels},
        {"label": "Done", "values": done_b, "labels": labels},
        {"label": "Failed", "values": failed_b, "labels": labels},
    ]
    return {"stats": stats, "series": series, "buckets": _bucket_meta(buckets)}


def _helper_status(h: Helper, current: dict[str, Any] | None, reached: bool) -> str:
    if h.status == "paused" or reached:
        return "paused"
    if current is not None:
        return "needs" if current["status"] == "waiting" else "working"
    return "idle"


@router.get("/analytics/helpers", status_code=200)
def analytics_helpers(
    range: str = Query(default="week", description="day | week | month | quarter"),
    channel_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Return per-helper stats for the active company over the range.

    [{helperId, name, area, role, status, doing, jobs, success, tokens, spend,
      lastActive, budget: {spent, limit} | null, budgetReached}]
    Retired helpers are excluded. tokens, spend and budget are AI tokens (spend = tokens, kept
    for older clients).
    """
    from omilo.api.helpers import (
        tokens_by_helper,
        current_job_by_helper,
        last_active_by_helper,
        month_start,
        next_routine_by_helper,
    )

    start = _range_start(range)
    scope = _channel_scope(db, channel_id)

    q = db.query(Helper).filter(Helper.status != "retired")
    if scope is not None:
        q = q.filter(Helper.id.in_(scope[0] or ["-"]))
    helpers = q.order_by(Helper.created_at.asc()).all()

    jq = db.query(
        Job.helper_id,
        func.count(Job.id).label("total"),
        func.sum(case((Job.status == "done", 1), else_=0)).label("done"),
        func.sum(Job.tokens_in + Job.tokens_out).label("tokens"),
    ).filter(Job.created_at >= start)
    jf = _job_filter(scope)
    if jf is not None:
        jq = jq.filter(jf)
    agg: dict[str, dict[str, int]] = {}
    for row in jq.group_by(Job.helper_id).all():
        agg[row.helper_id] = {
            "total": row.total or 0,
            "done": int(row.done or 0),
            "tokens": int(row.tokens or 0),
        }

    mtd = tokens_by_helper(db, month_start())
    current = current_job_by_helper(db)
    nxt = next_routine_by_helper(db)
    last = last_active_by_helper(db)

    result = []
    for h in helpers:
        a = agg.get(h.id, {"total": 0, "done": 0, "tokens": 0})
        total = a["total"]
        done = a["done"]
        success = round(100 * done / total) if total > 0 else 0
        limit = h.budget_tokens_month
        spent_mtd = mtd.get(h.id, 0)
        reached = limit is not None and spent_mtd >= limit and not (h.budget_allow_jobs or 0)
        cur = current.get(h.id)
        if cur is not None:
            doing = cur["brief"] if cur["status"] != "waiting" else f"Waiting on you · {cur['brief']}"
        elif h.id in nxt:
            doing = f"Next: {nxt[h.id]['name']}"
        elif h.status == "paused":
            doing = "Paused"
        else:
            doing = ""
        result.append(
            {
                "helperId": h.id,
                "name": h.name,
                "area": h.area,
                "role": h.title or h.role,
                "isChief": h.is_chief,
                "status": _helper_status(h, cur, reached),
                "doing": doing,
                "nextAt": nxt.get(h.id, {}).get("nextAt"),
                "jobs": total,
                "success": success,
                "tokens": a["tokens"],
                "spend": a["tokens"],
                "lastActive": last.get(h.id),
                "budget": {"spent": spent_mtd, "limit": limit} if limit is not None else None,
                "budgetReached": reached,
            }
        )
    return result


def _area_of_channel(accent: str | None) -> str:
    return {"dev": "dev", "marketing": "marketing", "sales": "sales"}.get(accent or "", "brand")


@router.get("/analytics/spend-by-channel", status_code=200)
def analytics_spend_by_channel(
    range: str = Query(default="week"),
    channel_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """AI tokens per channel per bucket (stacked). A job is attributed to its
    chat-session channel, else the helper's first channel, else 'General'."""
    from omilo.models.chat import ChatSession
    from omilo.models.workspace import Channel

    range_key = _norm_range(range)
    buckets = _buckets(range_key)
    scope = _channel_scope(db, channel_id)
    rows = _jobs(db, scope, buckets[0][0])

    channels = {c.id: c for c in db.query(Channel).all()}
    sess_ids = {j.session_id for j in rows if j.session_id}
    sess_chan = (
        dict(db.query(ChatSession.id, ChatSession.channel_id).filter(ChatSession.id.in_(sess_ids)).all())
        if sess_ids
        else {}
    )
    helper_chan = {
        h.id: (h.channel_ids or [None])[0] for h in db.query(Helper).all()
    }

    per: dict[str, list[int]] = {}
    total = 0
    for r in rows:
        i = _bucket_index(buckets, r.created_at)
        if i is None:
            continue
        used = int(r.tokens_in or 0) + int(r.tokens_out or 0)
        if not used:
            continue
        cid = sess_chan.get(r.session_id) or helper_chan.get(r.helper_id) or "general"
        if cid not in channels:
            cid = "general"
        per.setdefault(cid, [0] * len(buckets))[i] += used
        total += used

    series = []
    for cid, values in sorted(per.items(), key=lambda kv: -sum(kv[1])):
        ch = channels.get(cid)
        series.append(
            {
                "key": cid,
                "label": ch.name if ch else "General",
                "area": _area_of_channel(getattr(ch, "accent", None)) if ch else "brand",
                "values": values,
            }
        )
    return {"buckets": _bucket_meta(buckets), "series": series, "total": total}


@router.get("/analytics/tokens-by-helper", status_code=200)
def analytics_tokens_by_helper(
    range: str = Query(default="week"),
    channel_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Tokens (in + out) per helper per bucket (stacked)."""
    range_key = _norm_range(range)
    buckets = _buckets(range_key)
    scope = _channel_scope(db, channel_id)
    helpers = {h.id: h for h in db.query(Helper).all()}

    per: dict[str, list[int]] = {}
    total = 0
    for j in _jobs(db, scope, buckets[0][0]):
        i = _bucket_index(buckets, j.created_at)
        if i is None:
            continue
        t = (j.tokens_in or 0) + (j.tokens_out or 0)
        per.setdefault(j.helper_id, [0] * len(buckets))[i] += t
        total += t

    series = [
        {
            "key": hid,
            "label": helpers[hid].name if hid in helpers else hid,
            "area": helpers[hid].area if hid in helpers else "ops",
            "values": values,
        }
        for hid, values in sorted(per.items(), key=lambda kv: -sum(kv[1]))
    ]
    return {"buckets": _bucket_meta(buckets), "series": series, "total": total}


# ── Loops (routines + scheduled flows) ────────────────────────────────────────

_DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _routine_schedule(r) -> str:
    at = r.at or ""
    if r.freq == "daily":
        return f"Daily · {at}"
    if r.freq == "weekdays":
        return f"Weekdays · {at}"
    if r.freq == "weekly":
        days = [_DOW[d] for d in (r.days or []) if isinstance(d, int) and 0 <= d < 7] or ["Mon"]
        return f"{', '.join(days)} · {at}"
    if r.freq == "monthly":
        return f"Monthly · {at}"
    return f"{r.freq} · {at}" if at else str(r.freq)


def _flow_schedule(trigger: dict) -> str:
    spec = (trigger or {}).get("spec") or {}
    cron = spec.get("cron")
    if not cron:
        return "Scheduled"
    parts = cron.split()
    if len(parts) == 5 and parts[2] == "*" and parts[3] == "*":
        m, h, _, _, dow = parts
        if m.isdigit() and h.isdigit():
            at = f"{int(h):02d}:{int(m):02d}"
            if dow == "*":
                return f"Daily · {at}"
            if dow == "1-5":
                return f"Weekdays · {at}"
            return f"Weekly · {at}"
        if m.isdigit() and h.startswith("*/"):
            return f"Every {h[2:]}h"
        if m.startswith("*/"):
            return f"Every {m[2:]} min"
    return cron


@router.get("/analytics/loops", status_code=200)
def analytics_loops(
    range: str = Query(default="week"),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Recurring work: Routines + schedule-triggered Flows, with runs / last result / avg cost."""
    from omilo.models.flows import Flow, FlowRun
    from omilo.models.routines import Routine, RoutineRun

    start = _range_start(range)
    helpers = {h.id: h for h in db.query(Helper).all()}
    out: list[dict[str, Any]] = []

    for r in db.query(Routine).order_by(Routine.created_at.asc()).all():
        h = helpers.get(r.helper_id)
        if h is not None and h.status == "retired":
            continue
        runs = (
            db.query(RoutineRun)
            .filter(RoutineRun.routine_id == r.id)
            .order_by(RoutineRun.created_at.desc())
            .all()
        )
        recent = [x for x in runs if x.created_at and x.created_at >= start and not x.skipped]
        last_result = None
        if runs:
            last = runs[0]
            job = db.get(Job, last.job_id) if last.job_id else None
            last_result = job.status if job is not None else (last.outcome or None)
        costs = [x.tokens or 0 for x in recent]
        out.append(
            {
                "id": r.id,
                "kind": "routine",
                "name": r.name,
                "helperId": r.helper_id,
                "helperName": h.name if h else None,
                "area": h.area if h else "ops",
                "schedule": _routine_schedule(r),
                "nextAt": r.next_at.isoformat() if r.next_at and not r.paused else None,
                "lastResult": last_result,
                "runs": len(recent),
                "avgTokens": round(sum(costs) / len(costs)) if costs else 0,
                "on": bool(r.enabled and not r.paused),
            }
        )

    for f in db.query(Flow).order_by(Flow.created_at.asc()).all():
        if (f.trigger or {}).get("kind") != "schedule":
            continue
        runs = (
            db.query(FlowRun).filter(FlowRun.flow_id == f.id).order_by(FlowRun.created_at.desc()).all()
        )
        recent = [x for x in runs if x.created_at and x.created_at >= start]
        costs = [x.tokens or 0 for x in recent]
        areas = f.areas or []
        out.append(
            {
                "id": f.id,
                "kind": "flow",
                "name": f.title,
                "helperId": None,
                "helperName": "Flow",
                "area": areas[0] if areas and isinstance(areas[0], str) else "ops",
                "schedule": _flow_schedule(f.trigger),
                "nextAt": None,
                "lastResult": runs[0].status if runs else None,
                "runs": len(recent),
                "avgTokens": round(sum(costs) / len(costs)) if costs else 0,
                "on": bool(f.enabled),
            }
        )
    return out


# ── Reliability ───────────────────────────────────────────────────────────────

_CAUSES = [
    ("Expired or missing connection", re.compile(r"token|expired|auth|not connected|unauthori[sz]ed|credential|401|403|connect", re.I)),
    ("Rate limits", re.compile(r"rate.?limit|429|too many requests|quota", re.I)),
    ("Timeouts", re.compile(r"time.?out|timed out|deadline", re.I)),
    ("Budget reached", re.compile(r"budget|token limit|credit|paused_offline|insufficient", re.I)),
    ("Bad input from a step", re.compile(r"invalid|validation|bad input|parse|missing field|not found", re.I)),
]
_CAUSE_TIPS = {
    "Expired or missing connection": "Most failures come from expired or missing connections. Reconnect them in Connectors.",
    "Rate limits": "Most failures are rate limits. Spread loops out or lower messages per hour.",
    "Timeouts": "Most failures are timeouts. Retry them, or give the step a smaller job.",
    "Budget reached": "Most failures come from AI token budgets. Raise the budget in AI engine or on the helper.",
    "Bad input from a step": "Most failures come from bad input between steps. Check the step before the failing one.",
    "Other errors": "Failures don't share one cause. Open each run to see what happened.",
}


def _cause(error: str | None) -> str:
    e = error or ""
    for label, rx in _CAUSES:
        if rx.search(e):
            return label
    return "Other errors"


def _failure_action(cause: str, status: str) -> str:
    if status == "recovered":
        return "view"
    if cause == "Expired or missing connection":
        return "connect"
    if cause == "Budget reached":
        return "budget"
    return "retry"


def _failed_jobs(db: Session, scope, since: datetime):
    q = db.query(Job).filter(
        Job.created_at >= since,
        or_(
            Job.status.in_(("failed", "blocked", "paused_offline")),
            (Job.status == "done") & (Job.error.isnot(None)),
            (Job.status == "done") & (Job.attempts > 1),
        ),
    )
    f = _job_filter(scope)
    if f is not None:
        q = q.filter(f)
    return q.order_by(Job.created_at.desc()).all()


def _failure_status(j: Job) -> str:
    if j.status == "done":
        return "recovered"
    if j.status in ("blocked", "paused_offline"):
        return "needs_you"
    return "failed"


@router.get("/analytics/failures", status_code=200)
def analytics_failures(
    range: str = Query(default="week"),
    channel_id: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Recent failed / blocked / recovered jobs with cause + suggested action."""
    helpers = {h.id: h for h in db.query(Helper).all()}
    out = []
    for j in _failed_jobs(db, _channel_scope(db, channel_id), _range_start(range))[:limit]:
        h = helpers.get(j.helper_id)
        st = _failure_status(j)
        cause = _cause(j.error)
        out.append(
            {
                "jobId": j.id,
                "helperId": j.helper_id,
                "helperName": h.name if h else None,
                "area": h.area if h else "ops",
                "title": (j.brief or "").strip().splitlines()[0][:120] if j.brief else "Job",
                "error": j.error or "",
                "cause": cause,
                "attempts": j.attempts or 0,
                "at": (j.ended_at or j.created_at).isoformat() if (j.ended_at or j.created_at) else None,
                "status": st,
                "action": _failure_action(cause, st),
                "sessionId": j.session_id,
            }
        )
    return out


@router.get("/analytics/reliability", status_code=200)
def analytics_reliability(
    range: str = Query(default="week"),
    channel_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """{stats: [success rate, failed jobs, retried & recovered, median duration],
    causes: [{label, count}] over the last 30 days, causesTip}."""
    range_key = _norm_range(range)
    prev_start, start, _now = _window(range_key)
    scope = _channel_scope(db, channel_id)

    def summary(jobs):
        total = len(jobs)
        done = sum(1 for j in jobs if j.status == "done")
        failed = sum(1 for j in jobs if j.status in ("failed", "blocked", "paused_offline"))
        recovered = sum(1 for j in jobs if j.status == "done" and (j.attempts or 0) > 1)
        durations = [
            (j.ended_at - j.started_at).total_seconds()
            for j in jobs
            if j.started_at and j.ended_at and j.ended_at >= j.started_at
        ]
        return total, done, failed, recovered, durations

    total, done, failed, recovered, durs = summary(_jobs(db, scope, start))
    p_total, p_done, p_failed, p_recovered, p_durs = summary(_jobs(db, scope, prev_start, start))
    success = round(100 * done / total) if total else 0
    p_success = round(100 * p_done / p_total) if p_total else 0
    median = round(statistics.median(durs)) if durs else 0
    p95 = round(sorted(durs)[max(0, int(len(durs) * 0.95) - 1)]) if durs else 0

    stats = [
        _stat("Success rate", success, p_success, "%"),
        _stat("Failed jobs", failed, p_failed),
        _stat("Retried and recovered", recovered, p_recovered),
        _stat("Median duration", median, round(statistics.median(p_durs)) if p_durs else 0, "s"),
    ]
    stats[2]["of"] = failed + recovered
    stats[3]["p95"] = p95

    causes: dict[str, int] = {}
    for j in _failed_jobs(db, scope, datetime.now(tz=timezone.utc) - timedelta(days=30)):
        if j.status == "done" and not j.error:
            continue
        c = _cause(j.error)
        causes[c] = causes.get(c, 0) + 1
    ranked = sorted(causes.items(), key=lambda kv: -kv[1])
    return {
        "stats": stats,
        "causes": [{"label": k, "count": v} for k, v in ranked],
        "causesTip": _CAUSE_TIPS[ranked[0][0]] if ranked else "",
    }


@router.post("/jobs/{job_id}/retry", status_code=200)
def retry_job(
    job_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Re-run a failed / blocked job in place (attempts + 1).

    The budget / balance gate runs first; if it still refuses, 409 with the
    reason so the UI can point at the fix (raise budget, top up, resume).
    """
    from omilo.billing.balance import check_can_start_job
    from omilo.loop.runner import run_job
    from omilo.models.tenancy import Company

    job = db.query(Job).filter(Job.id == job_id).first()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status not in ("failed", "blocked", "paused_offline"):
        raise HTTPException(status_code=409, detail=f"Only failed jobs can be retried (status: {job.status}).")
    helper = db.get(Helper, job.helper_id)
    company = db.get(Company, job.company_id)
    if helper is None or company is None:
        raise HTTPException(status_code=409, detail="The helper for this job no longer exists.")
    allowed, reason = check_can_start_job(
        db, company, helper, engine_type=(helper.engine or {}).get("type", "fake")
    )
    if not allowed:
        raise HTTPException(status_code=409, detail=reason or "blocked")
    job.status = "queued"
    job.error = None
    job.ended_at = None
    db.flush()
    run_job(db, job)
    return {"jobId": job.id, "status": job.status, "error": job.error, "attempts": job.attempts}


# ── Activity feed ─────────────────────────────────────────────────────────────

ACTIVITY_KINDS = ("done", "needs_you", "failed", "started")


@router.get("/activity", status_code=200)
def activity_feed(
    kinds: Optional[str] = Query(default=None, description="comma list of done,needs_you,failed,started"),
    helper: Optional[str] = Query(default=None, description="comma list of helper ids"),
    cursor: Optional[str] = Query(default=None, description="ISO timestamp — items strictly older"),
    limit: int = Query(default=30, ge=1, le=100),
    channel_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Merged feed of job events (started / done / failed) and pending proposals (needs you).

    counts: per-kind totals over the last 7 days (unaffected by the filters).
    """
    from omilo.models.approvals import Proposal

    want = {k for k in (kinds.split(",") if kinds else ACTIVITY_KINDS) if k in ACTIVITY_KINDS}
    helper_ids = {h for h in helper.split(",") if h} if helper else None
    before: datetime | None = None
    if cursor:
        try:
            before = datetime.fromisoformat(cursor)
        except ValueError:
            raise HTTPException(status_code=422, detail="Bad cursor.")
    scope = _channel_scope(db, channel_id)
    helpers = {h.id: h for h in db.query(Helper).all()}
    week = datetime.now(tz=timezone.utc) - timedelta(days=7)

    def job_kind(j: Job) -> str:
        if j.status == "done":
            return "done"
        if j.status in ("failed", "blocked", "paused_offline"):
            return "failed"
        if j.status == "waiting":
            return "needs_you"
        return "started"

    jq = db.query(Job)
    f = _job_filter(scope)
    if f is not None:
        jq = jq.filter(f)
    if helper_ids is not None:
        jq = jq.filter(Job.helper_id.in_(helper_ids))
    if before is not None:
        jq = jq.filter(Job.created_at < before)
    jobs = jq.order_by(Job.created_at.desc()).limit(limit * 3).all()

    items: list[dict[str, Any]] = []
    for j in jobs:
        k = job_kind(j)
        if k == "needs_you":
            continue  # represented by its proposal row below
        if k not in want:
            continue
        h = helpers.get(j.helper_id)
        title = (j.brief or "").strip().splitlines()[0][:120] if j.brief else "a job"
        what = {
            "done": f"finished {title}",
            "failed": f"couldn't finish {title}",
            "started": f"started {title}",
        }[k]
        meta_bits = [j.origin]
        if k == "failed" and j.error:
            meta_bits.append(j.error[:120])
        tokens = (j.tokens_in or 0) + (j.tokens_out or 0)
        if tokens:
            meta_bits.append(f"{tokens:,} tokens")
        items.append(
            {
                "id": f"job:{j.id}",
                "at": j.created_at.isoformat(),
                "kind": k,
                "helperId": j.helper_id,
                "who": h.name if h else "Helper",
                "area": h.area if h else "ops",
                "what": what,
                "meta": " · ".join(meta_bits),
                "jobId": j.id,
            }
        )

    if "needs_you" in want:
        pq = db.query(Proposal).filter(Proposal.status == "pending")
        if helper_ids is not None:
            pq = pq.filter(Proposal.helper_id.in_(helper_ids))
        if scope is not None:
            pq = pq.filter(Proposal.helper_id.in_(scope[0] or ["-"]))
        if before is not None:
            pq = pq.filter(Proposal.created_at < before)
        for p in pq.order_by(Proposal.created_at.desc()).limit(limit).all():
            h = helpers.get(p.helper_id)
            items.append(
                {
                    "id": f"proposal:{p.id}",
                    "at": p.created_at.isoformat(),
                    "kind": "needs_you",
                    "helperId": p.helper_id,
                    "who": h.name if h else "Helper",
                    "area": h.area if h else "ops",
                    "what": f"asked you to approve {p.title}",
                    "meta": f"{p.type} · {p.risk} risk",
                    "proposalId": p.id,
                    "jobId": p.job_id,
                }
            )

    items.sort(key=lambda x: x["at"], reverse=True)
    page = items[:limit]
    next_cursor = page[-1]["at"] if len(items) > limit and page else None

    # 7-day counts per kind (unfiltered by kind/helper/cursor)
    cq = db.query(Job.status, func.count(Job.id)).filter(Job.created_at >= week)
    if f is not None:
        cq = cq.filter(f)
    by_status = dict(cq.group_by(Job.status).all())
    counts = {
        "done": int(by_status.get("done", 0)),
        "failed": int(sum(by_status.get(s, 0) for s in ("failed", "blocked", "paused_offline"))),
        "started": int(sum(by_status.values())),
        "needs_you": int(
            db.query(func.count(Proposal.id)).filter(Proposal.status == "pending").scalar() or 0
        ),
    }
    return {"items": page, "nextCursor": next_cursor, "counts": counts}
