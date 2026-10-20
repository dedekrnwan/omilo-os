"""C3: Stop/escalate gate — pure decision function, no side effects.
C4: Budget stop condition — autonomy-level stop that fires BELOW the hard 100% cap.

Callers (action boundary, proposal boundary) check ``should_escalate`` BEFORE
dispatching any action to an external service, spending money, or running an
irreversible operation.  The caller is responsible for filing the owner-inbox
alert (via ``services.alert``) when this returns ``True``.

Precedence (first match wins):
  1. Explicit pause/stop  → ("stopped", ...)
  2. Owner note present   → ("note", ...)
  3. Critical / high-risk → ("critical", ...)
  4. Tier in escalate_tiers → (tier, ...)
  5. Spend over budget    → ("budget", ...)
  6. Strict mode          → ("strict", ...)
  7. Otherwise            → (False, "")
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy.orm import Session

from .services import autonomy_policy, is_paused
from .graph.risk import classify_risk

# ---------------------------------------------------------------------------
# C4 constant: fraction of budget_usd_month used as the autonomy stop when no
# explicit autonomy_budget_stop_usd is configured.
# ---------------------------------------------------------------------------
DEFAULT_BUDGET_STOP_FRACTION: float = 0.8


def effective_budget_stop(db: Session, staff) -> float | None:
    """Resolve the effective autonomy budget stop for a helper.

    Resolution order:
      1. Explicit ``autonomy_budget_stop_usd`` policy (company or inherited) — returned as-is.
      2. ``staff.budget_usd_month * DEFAULT_BUDGET_STOP_FRACTION`` when the helper has a
         positive monthly budget.
      3. ``None`` — no stop configured.

    Parameters
    ----------
    db:
        Open SQLAlchemy session.
    staff:
        The Staff instance (must not be None — this is per-helper).
    """
    policy = autonomy_policy(db, staff)
    if policy["budget_stop_usd"] is not None:
        return policy["budget_stop_usd"]
    month_budget = float(getattr(staff, "budget_usd_month", 0) or 0)
    if month_budget > 0:
        return month_budget * DEFAULT_BUDGET_STOP_FRACTION
    return None


def check_autonomy_budget_stop(db: Session, staff) -> bool:
    """Check whether the helper's month-to-date spend has crossed its autonomy stop.

    When the threshold is crossed:
      - The helper is paused (``staff.status = "paused"``).
      - An owner inbox alert is filed.
      - The action is idempotent: guarded by a per-month Setting flag so the
        alert fires exactly once per month (mirrors budgets.check pattern).

    Returns ``True`` if the stop was triggered this call, ``False`` otherwise.
    This does NOT double-fire if ``budgets.check`` already paused the helper at 100%.
    """
    from . import budgets as _budgets
    from .services import alert
    from .models import Setting

    stop = effective_budget_stop(db, staff)
    if stop is None:
        return False

    # Get month-to-date spend
    usage = _budgets.month_usage(db, staff.id).get(staff.id, {"cost_usd": 0.0})
    spend = usage["cost_usd"]
    if spend < stop:
        return False

    # Guard: fire at most once per month (key mirrors the budgets.check pattern)
    month = _budgets.month_start(db).strftime("%Y-%m")
    flag_key = f"autonomy_budget_flag:{staff.id}:{month}"
    flag = db.get(Setting, flag_key)
    if flag:
        return False  # already alerted this month

    # Mark before side-effects (idempotency)
    db.add(Setting(key=flag_key, value=1))

    # Pause the helper (only if still active — don't fight a hard-cap pause)
    if staff.status == "active":
        staff.status = "paused"

    # File owner alert
    alert(
        db,
        title=f"{staff.name} hit its autonomy budget stop",
        body=(
            f"{staff.name} has spent ${spend:.2f} this month, reaching its autonomy "
            f"budget stop of ${stop:.2f}. It is paused so it stops accumulating spend. "
            f"Raise its autonomy budget or resume it to continue."
        ),
        staff_id=staff.id,
        task_id=None,
        level="decision",
        commit=False,
    )
    db.commit()
    return True


def should_escalate(
    db: Session,
    staff,  # Staff | None — forwarded to autonomy_policy for per-helper resolution
    action: dict,
) -> tuple[bool, str]:
    """Return ``(True, reason)`` when the autonomous team must stop for the owner.

    Parameters
    ----------
    db:
        Open SQLAlchemy session (read-only inside this function).
    staff:
        The Staff instance acting, or ``None`` for company-level policy.
    action:
        Dict describing the pending action.  Recognised keys (all optional):
          - ``tier``     str | None  — action tier / type string
          - ``task_id``  str | None  — Task PK to load founder_note from
          - ``goal_id``  str | None  — reserved for future Goal-level notes
          - ``spend_usd`` float | None — money this action would spend
          - ``note``     str | None  — owner note passed inline by the caller
    """
    # ------------------------------------------------------------------ (c) pause
    if is_paused(db):
        return True, "stopped"

    # ------------------------------------------------------------------ (a) owner note
    # Inline note passed by caller.
    if action.get("note"):
        return True, "note"

    # Note stored on the Task row (founder_note field).
    task_id = action.get("task_id")
    if task_id:
        from .models import Task  # local import to avoid circular at module level
        task = db.get(Task, task_id)
        if task is not None and task.founder_note:
            return True, "note"

    # ------------------------------------------------------------------ resolve policy
    policy = autonomy_policy(db, staff)
    mode: str = policy["mode"]
    escalate_tiers: list[str] = policy["escalate_tiers"]

    # Resolve effective budget stop (C4: falls back to fraction of budget_usd_month)
    if staff is not None:
        budget_stop_usd = effective_budget_stop(db, staff)
    else:
        budget_stop_usd = policy["budget_stop_usd"]

    # ------------------------------------------------------------------ (b) critical tier
    tier = action.get("tier")
    if tier == "critical":
        return True, "critical"

    # classify_risk uses the tier string as the action_type; "high" ≈ critical.
    if tier:
        risk_level = classify_risk(action_type=tier, summary="", worker_label=None)
        if risk_level == "high":
            return True, "critical"

    # ------------------------------------------------------------------ (e) escalate_tiers
    if tier and tier in escalate_tiers:
        return True, tier

    # ------------------------------------------------------------------ (d) budget
    spend = action.get("spend_usd")
    if spend is not None and budget_stop_usd is not None and spend >= budget_stop_usd:
        return True, "budget"

    # ------------------------------------------------------------------ (f) strict
    if mode == "strict":
        return True, "strict"

    # ------------------------------------------------------------------ clear
    return False, ""
