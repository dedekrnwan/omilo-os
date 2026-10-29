"""Company safety settings → gate adjustments (sweep/control).

The control-panel "Safety & limits" page saves to ``company.settings.safety``:

  postPublicly        bool  — posting publicly always waits for a person
  messageCustomers    bool  — messaging customers always waits
  deployProd          bool  — production deploys always wait
  noDelete            bool  — agents can't delete data (deleting needs a person)
  autoApproveUnderIdr int   — spends below this go through without asking
  dailySpendCapIdr    int   — agents stop spending on their own once today's
                              auto-approved spend reaches this

``adjust_verdict`` runs AFTER ``engine.autonomy.decide``.  It only ever makes
the gate stricter, except the explicit "auto-approve spending under" rule,
which lets small spends through (never under Strict, never past the cap).
"No delete" defaults to ON until a company saves it off; the always-wait
toggles and money limits apply once saved.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


# Defaults for toggles that were never saved.  "No delete" holds even under
# YOLO (the page says so); the always-wait toggles only bite once saved, so
# YOLO keeps "posting, sending, deploying go" until someone turns them on.
TOGGLE_DEFAULTS = {"noDelete": True}

_PUBLIC = ("post", "social", "tweet", "instagram", "facebook", "tiktok", "linkedin", "website", "public", "publish")
_MESSAGE = ("message", "email", "whatsapp", "sms", "send", "reply", "dm")
_DEPLOY = ("deploy", "merge", "release", "rollout")
_DELETE = ("delete", "remove", "destroy", "drop", "purge")
_SPEND = ("spend", "purchase", "refund", "pay", "ad_budget", "ads", "order", "buy")

# Internal workflow proposals are governed by their own review flow.
_INTERNAL_PREFIXES = ("skill_", "flow_", "routine_", "goal_")


def categories(proposal_type: str) -> set[str]:
    """Classify an action type into safety categories."""
    t = (proposal_type or "").lower()
    if t.startswith(_INTERNAL_PREFIXES):
        return set()
    tokens = set(t.replace(".", "_").replace("-", "_").split("_")) | {t}

    def hit(words: tuple[str, ...]) -> bool:
        return any(w in tokens or t.startswith(w) or f"_{w}" in t or f".{w}" in t for w in words)

    out: set[str] = set()
    if hit(_PUBLIC):
        out.add("public")
    if hit(_MESSAGE):
        out.add("message")
    if hit(_DEPLOY):
        out.add("deploy")
    if hit(_DELETE):
        out.add("delete")
    if hit(_SPEND):
        out.add("spend")
    return out


def amount_idr(arguments: dict[str, Any] | None) -> int | None:
    if not arguments:
        return None
    for key in ("amount_idr", "amount", "cost_idr", "value"):
        v = arguments.get(key)
        if isinstance(v, (int, float)) and v >= 0:
            return int(v)
        if isinstance(v, str):
            digits = "".join(ch for ch in v if ch.isdigit())
            if digits:
                return int(digits)
    return None


def _int(v: Any) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)) and v > 0:
        return int(v)
    return None


def adjust_verdict(
    verdict: str,
    *,
    effective: str,
    proposal_type: str,
    safety: dict[str, Any] | None,
    arguments: dict[str, Any] | None = None,
    spend_today_idr: int = 0,
) -> tuple[str, str | None]:
    """Return (verdict, reason) after applying the company's safety settings."""
    if verdict == "refused":
        return verdict, None
    safety = {**TOGGLE_DEFAULTS, **(safety or {})}
    cats = categories(proposal_type)
    if not cats:
        return verdict, None

    if verdict == "allowed":
        if "public" in cats and safety.get("postPublicly") is True:
            return "needs_owner", "posting_publicly_waits"
        if "message" in cats and safety.get("messageCustomers") is True:
            return "needs_owner", "messaging_customers_waits"
        if "deploy" in cats and safety.get("deployProd") is True:
            return "needs_owner", "deploys_wait"
    if "delete" in cats and safety.get("noDelete") is True:
        return "needs_owner", "no_delete"

    if "spend" in cats:
        amount = amount_idr(arguments)
        cap = _int(safety.get("dailySpendCapIdr"))
        under = _int(safety.get("autoApproveUnderIdr"))
        over_cap = cap is not None and spend_today_idr + (amount or 0) > cap
        if verdict == "allowed" and over_cap:
            return "needs_owner", "daily_spend_cap"
        if (
            verdict == "needs_owner"
            and effective != "strict"
            and under is not None
            and amount is not None
            and amount < under
            and not over_cap
        ):
            return "allowed", "auto_approved_under_limit"
    return verdict, None


def company_safety(company: Any) -> dict[str, Any]:
    settings = getattr(company, "settings", None) or {}
    s = settings.get("safety") if isinstance(settings, dict) else None
    return s if isinstance(s, dict) else {}


def spend_today_idr(db: Any, company_id: str) -> int:
    """Sum of spends agents made on their own today (from the activity log)."""
    try:
        from omilo.models.control import AuditEvent

        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        rows = (
            db.query(AuditEvent.meta)
            .filter(
                AuditEvent.company_id == company_id,
                AuditEvent.type == "approvals",
                AuditEvent.action == "auto-approved spend",
                AuditEvent.at >= start,
            )
            .all()
        )
        return sum(int((m or {}).get("amount_idr") or 0) for (m,) in rows)
    except Exception:
        return 0


def record_auto_spend(company_id: str, helper: Any, proposal_type: str, amount: int | None) -> None:
    """Log an agent spend that went through without asking (feeds the daily cap)."""
    from omilo import audit

    audit.record(
        company_id,
        type="approvals",
        action="auto-approved spend",
        target=f"{proposal_type}" + (f" · Rp {amount:,}".replace(",", ".") if amount else ""),
        actor_type="agent",
        actor_id=getattr(helper, "id", None),
        actor_name=getattr(helper, "name", "Agent"),
        actor_area=getattr(helper, "area", None),
        meta={"amount_idr": amount or 0, "type": proposal_type},
    )


def gate(
    db: Any,
    company: Any,
    helper: Any,
    verdict: str,
    *,
    effective: str,
    proposal_type: str,
    arguments: dict[str, Any] | None = None,
) -> str:
    """Apply company safety to a decided verdict; log auto-approved spends."""
    safety = company_safety(company)
    company_id = getattr(company, "id", "")
    today = spend_today_idr(db, company_id) if "spend" in categories(proposal_type) else 0
    new, _reason = adjust_verdict(
        verdict,
        effective=effective,
        proposal_type=proposal_type,
        safety=safety,
        arguments=arguments,
        spend_today_idr=today,
    )
    if new == "allowed" and "spend" in categories(proposal_type):
        record_auto_spend(company_id, helper, proposal_type, amount_idr(arguments))
    return new
