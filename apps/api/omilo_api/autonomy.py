"""C3: Stop/escalate gate — pure decision function, no side effects.

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

from sqlalchemy.orm import Session

from .services import autonomy_policy, is_paused
from .graph.risk import classify_risk


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
    budget_stop_usd = policy["budget_stop_usd"]
    escalate_tiers: list[str] = policy["escalate_tiers"]

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
