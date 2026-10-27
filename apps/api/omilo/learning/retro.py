"""Retro / scorecard + Improvement creation (§8 self-improvement, P3 Task 7).

Public API
----------
    scorecard(db, *, days=30) -> list[dict]
        One row per helper active in the window.
        {helper_id, name, runs, success_rate, approval_rate, cost_credits}
        All values computed EXACTLY from Job/Proposal rows — never estimated.

    review(db, *, days=7) -> dict
        Compute scorecard, find the weakest helper (lowest success_rate below
        SUCCESS_THRESHOLD), create an Improvement record with status="active",
        by="chief", baseline={current scorecard metrics}.
        Returns {improvements: [...], scorecard: [...]}.
        If no helper is weak, returns {improvements: [], scorecard: [...]}.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from omilo.models.agents import Helper
from omilo.models.approvals import Proposal
from omilo.models.base import prefixed_id
from omilo.models.execution import Job
from omilo.models.improvement import Improvement

# A helper is "weak" when its success_rate is below this threshold.
SUCCESS_THRESHOLD = 0.6


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _window_start(days: int) -> datetime:
    return datetime.now(tz=timezone.utc) - timedelta(days=days)


def _job_aggregates(db: Session, since: datetime) -> dict[str, dict[str, Any]]:
    """Return per-helper job aggregates for all helpers visible in *db*.

    Returns {helper_id: {total, done, cost_credits}}.
    RLS scopes results to the active company automatically.
    """
    rows = (
        db.query(
            Job.helper_id,
            func.count(Job.id).label("total"),
            func.sum(case((Job.status == "done", 1), else_=0)).label("done"),
            func.sum(Job.cost_credits).label("cost_credits"),
        )
        .filter(Job.created_at >= since)
        .group_by(Job.helper_id)
        .all()
    )
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        result[row.helper_id] = {
            "total": row.total or 0,
            "done": int(row.done or 0),
            "cost_credits": int(row.cost_credits or 0),
        }
    return result


def _proposal_approval_rates(db: Session, since: datetime) -> dict[str, dict[str, int]]:
    """Return per-helper proposal counts {helper_id: {total, approved}}.

    Only proposals created on or after *since* are included, so the window
    matches the job-aggregation window used by the caller.
    RLS scopes to the active company.
    """
    rows = (
        db.query(
            Proposal.helper_id,
            func.count(Proposal.id).label("total"),
            func.sum(case((Proposal.status == "approved", 1), else_=0)).label("approved"),
        )
        .filter(Proposal.created_at >= since)
        .group_by(Proposal.helper_id)
        .all()
    )
    result: dict[str, dict[str, int]] = {}
    for row in rows:
        result[row.helper_id] = {
            "total": row.total or 0,
            "approved": int(row.approved or 0),
        }
    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def scorecard(db: Session, *, days: int = 30) -> list[dict[str, Any]]:
    """Return one scorecard row per helper active in the last *days*.

    Values are computed EXACTLY from Job/Proposal rows (company-scoped via RLS).

    Row shape::

        {
            "helper_id": str,
            "name": str,
            "runs": int,              # count of Jobs in window
            "success_rate": float,    # done / total  (0.0 when total == 0)
            "approval_rate": float,   # approved / raised (0.0 when none raised)
            "cost_credits": int,      # sum(cost_credits) over the window
        }
    """
    since = _window_start(days)

    # Aggregate jobs (RLS-scoped).
    # NOTE (P4 gap): "runs" counts Job rows only. RoutineRun and Report execution
    # records are not yet incorporated into the scorecard and will be added in P4.
    job_agg = _job_aggregates(db, since)

    # Aggregate proposals (RLS-scoped); uses the same *since* window as job metrics.
    prop_agg = _proposal_approval_rates(db, since)

    # Build name map from helpers visible in the company
    helpers = db.query(Helper).all()
    helper_names: dict[str, str] = {h.id: h.name for h in helpers}

    rows: list[dict[str, Any]] = []
    for helper_id, agg in job_agg.items():
        total = agg["total"]
        done = agg["done"]
        success_rate = done / total if total > 0 else 0.0

        prop = prop_agg.get(helper_id, {"total": 0, "approved": 0})
        prop_total = prop["total"]
        prop_approved = prop["approved"]
        approval_rate = prop_approved / prop_total if prop_total > 0 else 0.0

        rows.append(
            {
                "helper_id": helper_id,
                "name": helper_names.get(helper_id, ""),
                "runs": total,
                "success_rate": success_rate,
                "approval_rate": approval_rate,
                "cost_credits": agg["cost_credits"],
            }
        )

    return rows


def review(db: Session, *, days: int = 7) -> dict[str, Any]:
    """Compute scorecard, find weak helpers, create Improvement records.

    A helper is "weak" if its success_rate < SUCCESS_THRESHOLD (0.6).
    For the weakest helper (lowest success_rate), one Improvement is created::

        {
            by: "chief",
            kind: "shift_brief",
            ref: <helper_id>,
            helper_id: <helper_id>,
            before: {weak metrics},
            after: {},
            reason: "low success rate ...",
            baseline: <full scorecard snapshot>,
            status: "active",
        }

    Returns::

        {"improvements": [<serialised Improvement>], "scorecard": [...]}

    If no helper is weak, improvements is [].
    """
    sc = scorecard(db, days=days)

    # Find the weakest helper (below threshold, fewest successes wins tie)
    weak_candidates = [
        row for row in sc
        if row["runs"] > 0 and row["success_rate"] < SUCCESS_THRESHOLD
    ]

    improvements: list[dict[str, Any]] = []

    if weak_candidates:
        # Pick the one with the lowest success_rate (then highest runs to break ties)
        worst = min(weak_candidates, key=lambda r: (r["success_rate"], -r["runs"]))

        # Determine company_id from the DB context (first Job in company)
        # We can derive it from any helper visible via RLS.
        helper = db.query(Helper).filter_by(id=worst["helper_id"]).first()
        company_id = helper.company_id if helper else ""

        baseline: dict[str, Any] = {
            "scorecard": sc,
            "evaluated_helper_id": worst["helper_id"],
            "evaluated_at_utc": datetime.now(tz=timezone.utc).isoformat(),
        }

        reason = (
            f"low success rate {worst['success_rate']:.0%} "
            f"({int(worst['success_rate'] * worst['runs'])}/{worst['runs']} jobs done) "
            f"over the last {days} days"
        )

        imp = Improvement(
            id=prefixed_id("imp"),
            company_id=company_id,
            by="chief",
            helper_id=worst["helper_id"],
            kind="shift_brief",
            ref=worst["helper_id"],
            before={
                "helper_id": worst["helper_id"],
                "name": worst["name"],
                "runs": worst["runs"],
                "success_rate": worst["success_rate"],
                "approval_rate": worst["approval_rate"],
                "cost_credits": worst["cost_credits"],
            },
            after={},
            reason=reason,
            baseline=baseline,
            result=None,
            status="active",
            task_id=None,
            evaluated_at=None,
        )
        db.add(imp)
        db.flush()  # assign id; still within the caller's transaction

        improvements.append(_serialize_improvement(imp))

    return {"improvements": improvements, "scorecard": sc}


def _serialize_improvement(imp: Improvement) -> dict[str, Any]:
    return {
        "id": imp.id,
        "company_id": imp.company_id,
        "by": imp.by,
        "helper_id": imp.helper_id,
        "kind": imp.kind,
        "ref": imp.ref,
        "before": imp.before,
        "after": imp.after,
        "reason": imp.reason,
        "baseline": imp.baseline,
        "result": imp.result,
        "status": imp.status,
        "task_id": imp.task_id,
        "created_at": imp.created_at.isoformat() if imp.created_at else None,
        "evaluated_at": imp.evaluated_at.isoformat() if imp.evaluated_at else None,
    }
