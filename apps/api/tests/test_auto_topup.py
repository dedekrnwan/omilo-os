"""TDD — P5a Task 5: Wallet auto-topup (pending payment + inbox alert, never silent charge).

`maybe_auto_topup(db, company, provider=None) -> DoitPayment | None`

Design invariants tested here:
  - DoitProvider: creates a PENDING DoitPayment + InboxItem(kind="alert") with
    hosted_url; balance is NEVER touched (no silent charge).
  - One-pending guard: calling again while an auto-topup is pending → None,
    no duplicate payment, no duplicate inbox item.
  - After webhook pays → balance rises; a new low-balance can trigger again.
  - auto_topup_enabled=False → None (nothing created).
  - balance >= threshold → None (no topup needed).
  - ManualProvider path → instant grant (offline dev convenience); balance rises.
  - Company-scoped: company B is unaffected by company A's auto-topup.

RED → implement → GREEN.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from omilo.db import SessionLocal, set_company
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger
from omilo.models.commerce import DoitPayment, WalletSettings
from omilo.models.inbox import InboxItem
from omilo.models.tenancy import Company

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TEST_SECRET = "whsec_autotopup_test"
MEDIUM_CREDITS = 5_000
MEDIUM_IDR = 238_000  # canonical 5,000-credit pack (catalog.PACK_CATALOG)


# ---------------------------------------------------------------------------
# Signature helper (mirrors test_doit_webhook.py)
# ---------------------------------------------------------------------------

def _make_sig_header(secret: str, body: bytes | str, t: int | None = None) -> str:
    ts = t if t is not None else int(time.time())
    body_bytes: bytes = body if isinstance(body, bytes) else body.encode("utf-8")
    signed = f"{ts}.".encode("utf-8") + body_bytes
    v1 = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={v1}"


def _signed_request(body: bytes, *, secret: str = TEST_SECRET):
    t = int(time.time())
    sig = _make_sig_header(secret, body, t)
    return {"PayBridge-Signature": sig, "content-type": "application/json"}, body


def _payment_paid_body(payment_id: str) -> bytes:
    return json.dumps({
        "type": "payment.paid",
        "payment": {
            "id": payment_id,
            "status": "paid",
            "reference": "INV/auto",
            "amount": MEDIUM_IDR,
            "metadata": {},
        },
    }).encode()


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def _superuser_session():
    class _S:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type is not None:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _S()


def _tenant_session(company_id: str):
    class _T:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            self._sess.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(self._sess, company_id)
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type is not None:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _T()


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

def _seed_company(name: str, initial_balance: int = 0) -> str:
    """Seed a Company with optional initial balance. Returns company_id."""
    cmp = Company(
        id=prefixed_id("cmp"),
        name=name,
        color="#1a1a2e",
        timezone="Asia/Jakarta",
        credit_balance=initial_balance,
    )
    with _superuser_session() as sess:
        sess.add(cmp)
    return cmp.id


def _seed_wallet_settings(
    company_id: str,
    *,
    enabled: bool = True,
    threshold: int = 1000,
    pack: str = "medium",
) -> None:
    """Seed or upsert WalletSettings for the given company."""
    with _superuser_session() as sess:
        # WalletSettings is RLS-protected; use superuser session for seeding
        existing = sess.query(WalletSettings).filter_by(company_id=company_id).first()
        if existing:
            existing.auto_topup_enabled = enabled
            existing.auto_topup_threshold_credits = threshold
            existing.auto_topup_pack = pack
        else:
            ws = WalletSettings(
                company_id=company_id,
                auto_topup_enabled=enabled,
                auto_topup_threshold_credits=threshold,
                auto_topup_pack=pack,
            )
            sess.add(ws)


def _get_balance(company_id: str) -> int:
    with _superuser_session() as sess:
        cmp = sess.get(Company, company_id)
        return int(cmp.credit_balance or 0)


def _get_pending_auto_topups(company_id: str) -> list[DoitPayment]:
    with _superuser_session() as sess:
        rows = (
            sess.query(DoitPayment)
            .filter(
                DoitPayment.company_id == company_id,
                DoitPayment.kind == "topup",
                DoitPayment.status == "pending",
            )
            .all()
        )
        return rows


def _get_all_topup_payments(company_id: str) -> list[DoitPayment]:
    with _superuser_session() as sess:
        return (
            sess.query(DoitPayment)
            .filter(
                DoitPayment.company_id == company_id,
                DoitPayment.kind == "topup",
            )
            .all()
        )


def _get_inbox_alerts(company_id: str) -> list[InboxItem]:
    with _superuser_session() as sess:
        return (
            sess.query(InboxItem)
            .filter(
                InboxItem.company_id == company_id,
                InboxItem.kind == "alert",
            )
            .all()
        )


def _get_ledger_rows(company_id: str, reason: str | None = None) -> list:
    with _superuser_session() as sess:
        q = sess.query(CreditLedger).filter(CreditLedger.company_id == company_id)
        if reason:
            q = q.filter(CreditLedger.reason == reason)
        return q.all()


# ---------------------------------------------------------------------------
# Doit app fixture (same injection pattern as T3/T4)
# ---------------------------------------------------------------------------

def _make_doit_app():
    """Return (app, fake_client) with DoitProvider(FakeDoitClient) injected."""
    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider
    from omilo.billing.provider import get_payment_provider
    from omilo.main import create_app

    app = create_app()
    fake_client = FakeDoitClient()
    fake_provider = DoitProvider(fake_client, TEST_SECRET)
    app.dependency_overrides[get_payment_provider] = lambda: fake_provider
    return app, fake_client


def _make_doit_provider():
    """Return a DoitProvider(FakeDoitClient) for direct calls."""
    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider
    return DoitProvider(FakeDoitClient(), TEST_SECRET)


# ---------------------------------------------------------------------------
# Test 1: DoitProvider path — pending payment + inbox alert, balance UNCHANGED
# ---------------------------------------------------------------------------


def test_auto_topup_doit_creates_pending_payment_and_inbox_alert_balance_unchanged():
    """DoitProvider + balance < threshold → pending DoitPayment + InboxItem(alert).
    Balance MUST remain 500 (never silently charged).
    """
    from omilo.billing.autotopup import maybe_auto_topup

    company_id = _seed_company("AutoTopup Doit A", initial_balance=500)
    _seed_wallet_settings(company_id, enabled=True, threshold=1000, pack="medium")

    provider = _make_doit_provider()

    with _superuser_session() as sess:
        company = sess.get(Company, company_id)
        result = maybe_auto_topup(sess, company, provider=provider)

    # Returns a DoitPayment
    assert result is not None, "maybe_auto_topup should return a DoitPayment"
    assert isinstance(result, DoitPayment)
    assert result.status == "pending"
    assert result.credits == MEDIUM_CREDITS
    assert result.amount_idr == MEDIUM_IDR
    assert result.kind == "topup"

    # hosted_url must be present
    assert result.hosted_url, "hosted_url must be set for Doit payment"

    # Balance UNCHANGED — the critical invariant
    assert _get_balance(company_id) == 500, (
        "DoitProvider auto-topup must NEVER touch balance — only the webhook does"
    )

    # An InboxItem(kind="alert") must exist with the hosted_url
    alerts = _get_inbox_alerts(company_id)
    assert len(alerts) == 1, f"Expected 1 alert inbox item, got {len(alerts)}"
    alert = alerts[0]
    assert alert.kind == "alert"
    assert alert.needs_you is True
    # actions must include the hosted_url so the user can pay
    assert alert.actions is not None
    hosted_urls_in_actions = [
        a.get("hosted_url") for a in alert.actions if a.get("hosted_url")
    ]
    assert hosted_urls_in_actions, "InboxItem actions must include hosted_url"

    # No credit ledger row created (no grant)
    ledger = _get_ledger_rows(company_id, reason="topup")
    assert len(ledger) == 0, "No credits should be granted for Doit auto-topup"


# ---------------------------------------------------------------------------
# Test 2: One-pending guard — calling again → None, no duplicate
# ---------------------------------------------------------------------------


def test_auto_topup_one_pending_guard_returns_none_on_second_call():
    """Calling maybe_auto_topup again while a pending auto-topup exists → None.
    No second DoitPayment, no second InboxItem.
    """
    from omilo.billing.autotopup import maybe_auto_topup

    company_id = _seed_company("AutoTopup Guard B", initial_balance=200)
    _seed_wallet_settings(company_id, enabled=True, threshold=1000, pack="medium")

    provider = _make_doit_provider()

    # First call — creates the pending payment
    with _superuser_session() as sess:
        company = sess.get(Company, company_id)
        first = maybe_auto_topup(sess, company, provider=provider)

    assert first is not None, "First call should create a pending payment"

    # Second call — should be idempotent
    with _superuser_session() as sess:
        company = sess.get(Company, company_id)
        second = maybe_auto_topup(sess, company, provider=provider)

    assert second is None, "Second call while pending auto-topup exists must return None"

    # Still only one pending payment
    pending = _get_pending_auto_topups(company_id)
    assert len(pending) == 1, f"Expected 1 pending auto-topup, got {len(pending)}"

    # Still only one inbox alert
    alerts = _get_inbox_alerts(company_id)
    assert len(alerts) == 1, f"Expected 1 inbox alert, got {len(alerts)}"


# ---------------------------------------------------------------------------
# Test 3: Webhook pays → balance rises; new low-balance can trigger again
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auto_topup_webhook_then_new_trigger():
    """After a payment.paid webhook grants credits, balance rises.
    A subsequent low-balance (if still below threshold) can trigger a new auto-topup.
    """
    from omilo.billing.autotopup import maybe_auto_topup

    company_id = _seed_company("AutoTopup WebhookThen C", initial_balance=500)
    _seed_wallet_settings(company_id, enabled=True, threshold=1000, pack="medium")

    provider = _make_doit_provider()

    # Step 1: trigger auto-topup → pending payment
    with _superuser_session() as sess:
        company = sess.get(Company, company_id)
        payment = maybe_auto_topup(sess, company, provider=provider)

    assert payment is not None
    provider_payment_id = payment.provider_payment_id
    assert provider_payment_id, "provider_payment_id must be set"

    assert _get_balance(company_id) == 500  # still unchanged

    # Step 2: send signed payment.paid webhook
    app, _ = _make_doit_app()
    body = _payment_paid_body(provider_payment_id)
    headers, body = _signed_request(body)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/webhooks/doit", content=body, headers=headers)

    assert resp.status_code == 200, resp.text

    # Balance should have risen by MEDIUM_CREDITS
    assert _get_balance(company_id) == 500 + MEDIUM_CREDITS, (
        f"Expected {500 + MEDIUM_CREDITS}, got {_get_balance(company_id)}"
    )

    # Step 3: balance is now 5500, above threshold 1000 → auto-topup returns None
    with _superuser_session() as sess:
        company = sess.get(Company, company_id)
        result_above = maybe_auto_topup(sess, company, provider=provider)

    assert result_above is None, "Above threshold after grant → should return None"

    # Step 4: manually drop balance below threshold again (simulate usage)
    with _superuser_session() as sess:
        company = sess.get(Company, company_id)
        company.credit_balance = 300
        sess.flush()

    # Step 5: now a new auto-topup should be possible
    with _superuser_session() as sess:
        company = sess.get(Company, company_id)
        new_result = maybe_auto_topup(sess, company, provider=provider)

    assert new_result is not None, "After previous payment cleared, new auto-topup allowed"
    assert new_result.status == "pending"


# ---------------------------------------------------------------------------
# Test 4: auto_topup_enabled=False → None
# ---------------------------------------------------------------------------


def test_auto_topup_disabled_returns_none():
    """WalletSettings.auto_topup_enabled=False → None, nothing created."""
    from omilo.billing.autotopup import maybe_auto_topup

    company_id = _seed_company("AutoTopup Disabled D", initial_balance=0)
    _seed_wallet_settings(company_id, enabled=False, threshold=1000, pack="medium")

    provider = _make_doit_provider()

    with _superuser_session() as sess:
        company = sess.get(Company, company_id)
        result = maybe_auto_topup(sess, company, provider=provider)

    assert result is None, "Disabled auto-topup must return None"

    payments = _get_all_topup_payments(company_id)
    assert len(payments) == 0
    alerts = _get_inbox_alerts(company_id)
    assert len(alerts) == 0


# ---------------------------------------------------------------------------
# Test 5: balance >= threshold → None
# ---------------------------------------------------------------------------


def test_auto_topup_balance_above_threshold_returns_none():
    """Balance >= threshold → None, no payment created."""
    from omilo.billing.autotopup import maybe_auto_topup

    company_id = _seed_company("AutoTopup AboveThresh E", initial_balance=5000)
    _seed_wallet_settings(company_id, enabled=True, threshold=1000, pack="medium")

    provider = _make_doit_provider()

    with _superuser_session() as sess:
        company = sess.get(Company, company_id)
        result = maybe_auto_topup(sess, company, provider=provider)

    assert result is None, "Balance >= threshold → should return None"
    assert len(_get_all_topup_payments(company_id)) == 0


# ---------------------------------------------------------------------------
# Test 6: ManualProvider path → instant grant (offline dev convenience)
# ---------------------------------------------------------------------------


def test_auto_topup_manual_provider_grants_instantly():
    """ManualProvider: balance 500, threshold 1000, enabled → grants instantly.
    This is the offline dev convenience path — documented divergence from Doit.
    Balance should rise to 500 + MEDIUM_CREDITS.
    """
    from omilo.billing.autotopup import maybe_auto_topup
    from omilo.billing.provider import ManualProvider

    company_id = _seed_company("AutoTopup Manual F", initial_balance=500)
    _seed_wallet_settings(company_id, enabled=True, threshold=1000, pack="medium")

    provider = ManualProvider()

    with _superuser_session() as sess:
        company = sess.get(Company, company_id)
        result = maybe_auto_topup(sess, company, provider=provider)

    # ManualProvider returns None or a DoitPayment marked paid (implementation detail)
    # What matters: balance rises
    assert _get_balance(company_id) == 500 + MEDIUM_CREDITS, (
        "ManualProvider auto-topup must instantly grant credits (offline convenience)"
    )

    # A topup ledger row should exist
    ledger = _get_ledger_rows(company_id, reason="topup")
    assert len(ledger) == 1, "ManualProvider auto-topup must create a CreditLedger row"


# ---------------------------------------------------------------------------
# Test 7: Company-scoped — company B unaffected
# ---------------------------------------------------------------------------


def test_auto_topup_company_scoped_does_not_affect_other_company():
    """Auto-topup for company A must not touch company B's balance or payments."""
    from omilo.billing.autotopup import maybe_auto_topup

    company_a_id = _seed_company("AutoTopup CompanyA", initial_balance=200)
    company_b_id = _seed_company("AutoTopup CompanyB", initial_balance=200)

    _seed_wallet_settings(company_a_id, enabled=True, threshold=1000, pack="medium")
    # company B has no WalletSettings (or disabled)

    provider = _make_doit_provider()

    with _superuser_session() as sess:
        company_a = sess.get(Company, company_a_id)
        result = maybe_auto_topup(sess, company_a, provider=provider)

    assert result is not None, "Company A should get auto-topup"

    # Company B: balance unchanged, no payments, no alerts
    assert _get_balance(company_b_id) == 200
    assert len(_get_all_topup_payments(company_b_id)) == 0
    assert len(_get_inbox_alerts(company_b_id)) == 0
