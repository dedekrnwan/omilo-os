"""Analytics endpoints.

Endpoints:
  GET /v1/analytics/overview  ?range=week   → {stats[], series[]}
  GET /v1/analytics/helpers   ?range=week   → [{helperId, jobs, success, tokens, spend}]

All values computed from real Job/CreditLedger rows (company-scoped via RLS), never hardcoded.

range values: "day" (1d), "week" (7d, default), "month" (30d).

spend field (Task 7 P4 extension):
  overview: sum(CreditLedger.credits_charged) where reason="job" in period
  helpers: per-helper sum(CreditLedger.credits_charged) where reason="job" in period
"""
from __future__ import annotations

import builtins
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Integer, case, func
from sqlalchemy.orm import Session

from omilo.models.agents import Helper
from omilo.models.billing import CreditLedger
from omilo.models.execution import Job
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["analytics"])


# ── Range helpers ─────────────────────────────────────────────────────────────


def _range_start(range_: str) -> datetime:
    """Return a UTC datetime for the start of the given range."""
    now = datetime.now(tz=timezone.utc)
    days = {"day": 1, "week": 7, "month": 30}.get(range_, 7)
    return now - timedelta(days=days)


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("/analytics/overview", status_code=200)
def analytics_overview(
    range: str = Query(default="week", description="day | week | month"),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return {stats, series} computed exactly from Job rows for the company.

    stats:
      - "Jobs done"    → count(status='done')
      - "Success rate" → round(100 * done / total) if total > 0 else 0
      - "Tokens"       → sum(tokens_in + tokens_out)
      - "Spend"        → sum(cost_credits)

    series:
      - "Jobs per day" → [{label: date, values: [count]}] over the range
    """
    range_key = range  # preserve Query param name; avoid shadowing built-in below
    start = _range_start(range_key)

    # All jobs in range (RLS already scopes to company)
    all_jobs = (
        db.query(Job)
        .filter(Job.created_at >= start)
        .all()
    )

    total = len(all_jobs)
    done_count = sum(1 for j in all_jobs if j.status == "done")
    tokens = sum(j.tokens_in + j.tokens_out for j in all_jobs)
    success_rate = round(100 * done_count / total) if total > 0 else 0

    # Spend: exact sum from CreditLedger (reason="job") in the period
    ledger_spend_row = (
        db.query(func.sum(CreditLedger.credits_charged))
        .filter(
            CreditLedger.reason == "job",
            CreditLedger.at >= start,
        )
        .scalar()
    )
    spend = int(ledger_spend_row or 0)

    stats = [
        {"label": "Jobs done", "value": done_count},
        {"label": "Success rate", "value": success_rate, "note": "%"},
        {"label": "Tokens", "value": tokens},
        {"label": "Spend", "value": spend, "note": "credits"},
    ]

    # Build jobs-per-day series
    days = {"day": 1, "week": 7, "month": 30}.get(range_key, 7)
    now_utc = datetime.now(tz=timezone.utc)

    # Count per calendar date (UTC)
    date_counts: dict[str, int] = {}
    for j in all_jobs:
        if j.created_at:
            d = j.created_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
            date_counts[d] = date_counts.get(d, 0) + 1

    # Generate labels for every day in range (ensures 0-fill)
    series_values = []
    series_labels = []
    for offset in builtins.range(days):
        day = (now_utc - timedelta(days=days - 1 - offset)).strftime("%Y-%m-%d")
        series_labels.append(day)
        series_values.append(date_counts.get(day, 0))

    series = [
        {"label": "Jobs per day", "values": series_values, "labels": series_labels}
    ]

    return {"stats": stats, "series": series}


@router.get("/analytics/helpers", status_code=200)
def analytics_helpers(
    range: str = Query(default="week", description="day | week | month"),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Return per-helper stats for the active company over the range.

    [{helperId, name, jobs, success, tokens, spend}]
    """
    start = _range_start(range)

    helpers = db.query(Helper).all()

    # Aggregate from jobs (RLS-scoped)
    job_rows = (
        db.query(
            Job.helper_id,
            func.count(Job.id).label("total"),
            func.sum(
                case((Job.status == "done", 1), else_=0)
            ).label("done"),
            func.sum(Job.tokens_in + Job.tokens_out).label("tokens"),
        )
        .filter(Job.created_at >= start)
        .group_by(Job.helper_id)
        .all()
    )

    agg: dict[str, dict[str, int]] = {}
    for row in job_rows:
        total = row.total or 0
        done = int(row.done or 0)
        agg[row.helper_id] = {
            "total": total,
            "done": done,
            "tokens": int(row.tokens or 0),
        }

    # Per-helper spend from CreditLedger (reason="job") in the period
    ledger_rows = (
        db.query(
            CreditLedger.helper_id,
            func.sum(CreditLedger.credits_charged).label("spend"),
        )
        .filter(
            CreditLedger.reason == "job",
            CreditLedger.at >= start,
            CreditLedger.helper_id.isnot(None),
        )
        .group_by(CreditLedger.helper_id)
        .all()
    )
    ledger_spend: dict[str, int] = {
        row.helper_id: int(row.spend or 0)
        for row in ledger_rows
    }

    result = []
    for h in helpers:
        a = agg.get(h.id, {"total": 0, "done": 0, "tokens": 0})
        total = a["total"]
        done = a["done"]
        success = round(100 * done / total) if total > 0 else 0
        result.append(
            {
                "helperId": h.id,
                "name": h.name,
                "jobs": total,
                "success": success,
                "tokens": a["tokens"],
                "spend": ledger_spend.get(h.id, 0),
            }
        )

    return result
