"""Retro endpoints (P3 Task 7).

Endpoints:
  GET  /v1/retro/scorecard?days=30   → list of per-helper scorecard rows
  POST /v1/retro/run?days=7          → creates Improvements, returns them + scorecard

All values are company-scoped via RLS (get_tenant_db).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from omilo.learning.retro import review, scorecard
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["retro"])


@router.get("/retro/scorecard", status_code=200)
def retro_scorecard(
    days: int = Query(default=30, ge=1, description="Lookback window in days"),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Return per-helper scorecard computed from real Job/Proposal rows.

    Each row: {helper_id, name, runs, success_rate, approval_rate, tokens}.
    All values exact — not estimated.  Company-scoped via RLS.
    """
    return scorecard(db, days=days)


@router.post("/retro/run", status_code=200)
def retro_run(
    days: int = Query(default=7, ge=1, description="Lookback window in days"),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Evaluate performance, find weak spots, create Improvement records.

    Returns {improvements: [...], scorecard: [...]}.
    Improvement records are persisted and have status="active".
    If no helper is weak (success_rate >= 0.6), improvements is [].
    """
    return review(db, days=days)
