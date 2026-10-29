"""omilo.billing.autotopup — Wallet auto-topup: pending payment + inbox alert.

Public API:
    maybe_auto_topup(db, company, provider=None) -> DoitPayment | None

Design rules (INVARIANTS — never deviate):
  1. DoitProvider path: creates a PENDING DoitPayment + InboxItem(kind="alert")
     with hosted_url in actions.  Credits are NEVER granted here — only the
     webhook (T3 payment.paid) grants them.  No silent charge, ever.
  2. One-pending guard: at most one pending auto-topup at a time.  If a
     DoitPayment(kind="topup", status="pending", raw contains auto=True)
     already exists → return None (idempotent).
  3. ManualProvider path: offline dev convenience only.  Since there's no real
     redirect or webhook in dev mode, we grant credits instantly via
     grant_credits() and return None.  This DIVERGES from Doit on purpose —
     document this clearly and gate it on isinstance(ManualProvider).
  4. Best-effort: any exception is caught, logged, and swallowed.  A failure
     here MUST NEVER propagate to the caller.
  5. Prerequisite: WalletSettings.auto_topup_enabled must be True AND
     balance(db, company) < auto_topup_threshold_credits.
"""
from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy.orm import Session

from omilo.billing.catalog import PACKS
from omilo.billing.balance import balance, grant_credits
from omilo.models.base import prefixed_id
from omilo.models.commerce import DoitPayment, WalletSettings

if TYPE_CHECKING:
    from omilo.models.tenancy import Company

logger = logging.getLogger(__name__)


def maybe_auto_topup(
    db: Session,
    company: "Company",
    provider: Any = None,
) -> DoitPayment | None:
    """Trigger an auto-topup for *company* if conditions are met.

    Evaluation order:
      1. No WalletSettings or auto_topup_enabled=False → return None.
      2. balance >= threshold → return None (enough credits).
      3. One-pending guard: existing pending auto DoitPayment → return None.
      4. Resolve pack (fallback "medium") → credits + amount_idr.
      5a. DoitProvider: call charge_one_off → create pending DoitPayment +
          InboxItem(kind="alert", needs_you=True, actions=[{hosted_url}]).
          DO NOT grant credits.  Return the DoitPayment.
      5b. ManualProvider: call grant_credits instantly (offline convenience).
          This diverges from Doit intentionally — there's no real payment
          redirect or webhook in offline dev mode.  Return None.

    Args:
        db:       Company-scoped (or superuser) SQLAlchemy session.
        company:  The Company ORM object.
        provider: PaymentProvider instance.  If None, calls
                  get_payment_provider() to resolve.

    Returns:
        The created DoitPayment (Doit path) or None (all other cases).

    Never raises.  Best-effort: any exception is caught and logged.
    """
    try:
        return _maybe_auto_topup_inner(db, company, provider)
    except Exception as exc:
        logger.warning(
            "auto-topup failed for company_id=%s — skipped: %s",
            company.id if company else "?",
            exc,
        )
        return None


# ---------------------------------------------------------------------------
# Internal implementation
# ---------------------------------------------------------------------------


def _maybe_auto_topup_inner(
    db: Session,
    company: "Company",
    provider: Any,
) -> DoitPayment | None:
    """Inner (raising) implementation.  Wrapped by maybe_auto_topup."""
    # ── 0. Resolve provider if not injected ──────────────────────────────────
    if provider is None:
        from omilo.billing.provider import get_payment_provider
        provider = get_payment_provider()

    # ── 1. Load WalletSettings ────────────────────────────────────────────────
    ws = db.query(WalletSettings).filter_by(company_id=company.id).first()
    if ws is None or not ws.auto_topup_enabled:
        return None

    # ── 2. Balance check ──────────────────────────────────────────────────────
    current_balance = balance(db, company)
    threshold = ws.auto_topup_threshold_credits or 0
    if current_balance >= threshold:
        return None

    # ── 3. One-pending guard ──────────────────────────────────────────────────
    # Only apply to Doit path (ManualProvider has no pending state).
    from omilo.billing.provider import ManualProvider
    if not isinstance(provider, ManualProvider):
        existing_pending = (
            db.query(DoitPayment)
            .filter(
                DoitPayment.company_id == company.id,
                DoitPayment.kind == "topup",
                DoitPayment.status == "pending",
            )
            .all()
        )
        # Check if any of these are auto-topup rows (raw["auto"] == True)
        for p in existing_pending:
            if p.raw and p.raw.get("auto"):
                return None  # already have one pending auto-topup

    # ── 4. Resolve pack ───────────────────────────────────────────────────────
    from omilo.billing.catalog import resolve_pack_id
    pack_name = resolve_pack_id(ws.auto_topup_pack or "5000")
    if pack_name not in PACKS:
        pack_name = "5000"
    pack = PACKS[pack_name]
    credits_to_grant = pack["credits"]
    amount_idr = pack["amount_idr"]

    # ── 5a. ManualProvider: instant offline grant ─────────────────────────────
    # Divergence documented: ManualProvider has no real payment redirect or
    # webhook.  For offline/dev convenience we grant directly and return None.
    # This path is gated on isinstance(ManualProvider) so it can NEVER fire
    # in production where DoitProvider is configured.
    if isinstance(provider, ManualProvider):
        logger.info(
            "auto-topup ManualProvider: instant grant %d credits for company_id=%s "
            "(offline dev convenience — diverges from Doit pending path)",
            credits_to_grant,
            company.id,
        )
        grant_credits(
            db,
            company,
            credits_to_grant,
            reason="topup",
            meta={"auto": True, "pack": pack_name, "provider": "manual"},
        )
        return None

    # ── 5b. DoitProvider (or any non-Manual): create pending payment + alert ──
    short_id = uuid.uuid4().hex[:8]
    reference = f"autotopup:{company.id}:{pack_name}:{short_id}"

    # Call the provider to create a real Doit payment.
    charge_result = provider.charge_one_off(
        company,
        amount_idr,
        reference,
        metadata={"auto": True, "pack": pack_name, "credits": credits_to_grant},
    )

    # Persist a pending DoitPayment.  raw["auto"]=True is our idempotency marker.
    raw_payload = charge_result.get("raw") if charge_result else {}
    if isinstance(raw_payload, dict):
        raw_payload = dict(raw_payload)
    else:
        raw_payload = {}
    raw_payload["auto"] = True  # idempotency / one-pending marker

    pay = DoitPayment(
        id=prefixed_id("pay"),
        company_id=company.id,
        kind="topup",
        credits=credits_to_grant,
        amount_idr=amount_idr,
        reference=reference,
        provider_payment_id=charge_result["provider_payment_id"] if charge_result else None,
        hosted_url=charge_result.get("hosted_url") if charge_result else None,
        status="pending",
        raw=raw_payload,
    )
    db.add(pay)
    db.flush()  # assign pay.id before creating the inbox item

    # Create InboxItem(kind="alert") — user must act to complete payment.
    _create_autotopup_alert(db, company, pay)

    logger.info(
        "auto-topup: created pending DoitPayment pay_id=%s, company_id=%s, "
        "credits=%d, amount_idr=%d, hosted_url=%s",
        pay.id,
        company.id,
        credits_to_grant,
        amount_idr,
        pay.hosted_url,
    )

    return pay


def _create_autotopup_alert(
    db: Session,
    company: "Company",
    pay: DoitPayment,
) -> None:
    """Create a 'Balance low' alert InboxItem pointing at the payment's hosted_url.

    Best-effort: if InboxItem creation fails, log and continue — the payment
    row is the critical artefact; the alert is supplemental.
    """
    try:
        from omilo.models.inbox import InboxItem

        actions: list[dict] = [
            {
                "label": "Top up",
                "primary": True,
                "hosted_url": pay.hosted_url,
            }
        ]

        item = InboxItem(
            id=prefixed_id("inb"),
            company_id=company.id,
            title="Balance low — top up to keep agents working",
            summary=(
                f"Your credit balance has dropped below the auto-topup threshold. "
                f"A payment of Rp {pay.amount_idr:,} has been prepared — "
                f"complete it to add {pay.credits:,} credits to your wallet."
            ),
            session_id="",
            channel_id="",
            kind="alert",
            status="pending",
            asker="system",
            asker_area="ops",
            needs_you=True,
            proposals=None,
            actions=actions,
        )
        db.add(item)
        db.flush()
    except Exception as exc:
        logger.warning(
            "auto-topup alert InboxItem creation failed for company_id=%s pay_id=%s: %s",
            company.id,
            pay.id,
            exc,
        )
