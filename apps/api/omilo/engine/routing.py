"""AI-engine settings → model routing + budgets (sweep/control).

The control-panel "AI engine" page saves ``company.settings.aiEngine``:

  roles: {
    chief:  {model: "Opus 5.5",   budgetCredits: 20000},
    agents: {model: "Sonnet 5.5", budgetCredits: 5000},   # per helper / month
    quick:  {model: "Haiku 5.5",  budgetCredits: 1000},   # flow quick steps
  }
  monthlyBudgetCredits: 60000      # whole company, AI pauses when reached

``role_model`` picks the model a helper runs with (unless the helper pins its
own ``engine.model``); ``budget_block_reason`` is consulted by
``billing.balance.check_can_start_job`` before a job starts.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def ai_engine_settings(company: Any) -> dict[str, Any]:
    settings = getattr(company, "settings", None) or {}
    e = settings.get("aiEngine") if isinstance(settings, dict) else None
    return e if isinstance(e, dict) else {}


def helper_role(helper: Any) -> str:
    return "chief" if getattr(helper, "is_chief", False) else "agents"


def role_settings(company: Any, role: str) -> dict[str, Any]:
    roles = ai_engine_settings(company).get("roles")
    r = roles.get(role) if isinstance(roles, dict) else None
    return r if isinstance(r, dict) else {}


def role_model(company: Any, helper: Any) -> str | None:
    model = role_settings(company, helper_role(helper)).get("model")
    return model if isinstance(model, str) and model.strip() else None


def _positive_int(v: Any) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and v > 0:
        return int(v)
    return None


def _mtd(db: Any, company_id: str, helper_ids: list[str] | None = None) -> int:
    from sqlalchemy import func

    from omilo.models.billing import CreditLedger

    start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    q = db.query(func.coalesce(func.sum(CreditLedger.credits_charged), 0)).filter(
        CreditLedger.company_id == company_id,
        CreditLedger.at >= start,
    )
    if helper_ids is not None:
        q = q.filter(CreditLedger.helper_id.in_(helper_ids))
    return int(q.scalar() or 0)


def budget_block_reason(db: Any, company: Any, helper: Any) -> str | None:
    """Return a block reason when a company/role monthly AI budget is spent."""
    eng = ai_engine_settings(company)
    if not eng:
        return None
    company_id = getattr(company, "id", "")
    total = _positive_int(eng.get("monthlyBudgetCredits"))
    if total is not None and _mtd(db, company_id) >= total:
        return "monthly_budget_reached"
    role_budget = _positive_int(role_settings(company, helper_role(helper)).get("budgetCredits"))
    if role_budget is not None and _mtd(db, company_id, [helper.id]) >= role_budget:
        return "role_budget_reached"
    return None
