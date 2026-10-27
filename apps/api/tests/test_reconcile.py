"""TDD — P5a Task 6: Reconciliation + shared settle + usage pending fields.

Tests (real DB, FakeDoitClient — no network):

1.  reconcile_pending with provider-paid payment → returns 1; balance += 5000;
    DoitPayment.granted==True, status=="paid".
2.  reconcile_pending run again → returns 0; no double grant (shared guard).
3.  Cross-path idempotency A: reconcile settled first → webhook arrives afterward
    → webhook is a no-op; balance still +5000 once.
4.  Cross-path idempotency B: webhook settled first → reconcile_pending finds
    granted=True → returns 0, balance still +5000 once.
5.  Provider reports "expired" → reconcile sets status="expired"; no grant.
6.  GET /v1/usage → pending_topups count+credits correct; last_payment present.

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
from sqlalchemy import select, text

from omilo.billing.balance import grant_credits
from omilo.billing.doit_client import FakeDoitClient
from omilo.billing.doit_provider import DoitProvider
from omilo.billing.reconcile import reconcile_pending
from omilo.db import SessionLocal, set_company
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger, Plan, Subscription
from omilo.models.commerce import DoitPayment
from omilo.models.tenancy import Company

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TEST_SECRET = "whsec_test"


# ---------------------------------------------------------------------------
# Signature helper (mirrors test_doit_webhook.py T3)
# ---------------------------------------------------------------------------


def _make_sig_header(secret: str, body: bytes | str, t: int | None = None) -> str:
    ts = t if t is not None else int(time.time())
    body_bytes: bytes = body if isinstance(body, bytes) else body.encode("utf-8")
    signed = f"{ts}.".encode("utf-8") + body_bytes
    v1 = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={v1}"


def _signed_webhook_headers(body: bytes, *, secret: str = TEST_SECRET) -> dict:
    """Return signed headers dict for a webhook request."""
    t = int(time.time())
    sig = _make_sig_header(secret, body, t)
    return {"PayBridge-Signature": sig, "content-type": "application/json"}


def _payment_paid_body(payment_id: str) -> bytes:
    return json.dumps({
        "type": "payment.paid",
        "payment": {
            "id": payment_id,
            "status": "paid",
            "reference": "INV/reconcile",
            "amount": 50000,
            "metadata": {},
        },
    }).encode()


# ---------------------------------------------------------------------------
# Session helpers (same pattern as test_doit_webhook.py)
# ---------------------------------------------------------------------------


def _superuser_session():
    """Open a privileged session (bypasses RLS)."""
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
    """Open a company-scoped RLS session."""
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


def _seed_company(name: str) -> str:
    """Seed a Company and return its id."""
    cmp = Company(
        id=prefixed_id("cmp"),
        name=name,
        color="#1a1a2e",
        timezone="Asia/Jakarta",
    )
    with _superuser_session() as sess:
        sess.add(cmp)
    return cmp.id


def _seed_topup_payment(
    company_id: str,
    provider_payment_id: str,
    credits: int = 5000,
) -> str:
    """Seed a pending topup DoitPayment. Returns the payment row id."""
    pay_id = prefixed_id("pay")
    with _superuser_session() as sess:
        pay = DoitPayment(
            id=pay_id,
            company_id=company_id,
            kind="topup",
            amount_idr=credits * 10,
            credits=credits,
            reference=f"INV/{uuid.uuid4().hex[:8]}",
            provider_payment_id=provider_payment_id,
            status="pending",
        )
        sess.add(pay)
    return pay_id


def _get_balance(company_id: str) -> int:
    with _superuser_session() as sess:
        cmp = sess.get(Company, company_id)
        return int(cmp.credit_balance or 0)


def _get_ledger_rows(company_id: str, reason: str | None = None) -> list:
    with _superuser_session() as sess:
        q = sess.query(CreditLedger).filter(CreditLedger.company_id == company_id)
        if reason:
            q = q.filter(CreditLedger.reason == reason)
        return q.all()


def _get_payment(pay_id: str) -> DoitPayment | None:
    with _superuser_session() as sess:
        return sess.get(DoitPayment, pay_id)


# ---------------------------------------------------------------------------
# App fixture helpers
# ---------------------------------------------------------------------------


def _make_doit_app(fake_client: FakeDoitClient | None = None):
    """Return a FastAPI app with DoitProvider(fake_client) injected."""
    from omilo.billing.provider import get_payment_provider
    from omilo.main import create_app

    client = fake_client or FakeDoitClient()
    app = create_app()
    provider = DoitProvider(client, TEST_SECRET)
    app.dependency_overrides[get_payment_provider] = lambda: provider
    return app, provider


# ---------------------------------------------------------------------------
# Test 1: reconcile_pending (provider paid) → grants 1, balance += 5000
# ---------------------------------------------------------------------------


def test_reconcile_pending_settles_paid():
    """reconcile_pending finds provider-paid payment → grants credits, returns 1."""
    company_id = _seed_company("Reconcile Test A")
    ppid = f"pay_r_{uuid.uuid4().hex[:8]}"
    pay_id = _seed_topup_payment(company_id, ppid, credits=5000)

    # Register payment in FakeDoitClient and mark it paid
    fake_client = FakeDoitClient()
    fake_client.create_payment(amount_idr=50000, reference=ppid, idempotency_key=ppid)
    # The create_payment uses f"pay_fake_{key}", but we seeded provider_payment_id=ppid.
    # We need get_payment(ppid) to work — register it directly.
    fake_client._payments[ppid] = {"id": ppid, "status": "pending", "amount": 50000}
    fake_client.mark_paid(ppid)

    provider = DoitProvider(fake_client, TEST_SECRET)

    initial_balance = _get_balance(company_id)
    assert initial_balance == 0

    with _tenant_session(company_id) as db:
        company = db.get(Company, company_id)
        count = reconcile_pending(db, company, provider)

    assert count == 1, "Expected 1 newly settled payment"

    # Balance increased
    assert _get_balance(company_id) == 5000

    # DoitPayment is paid + granted
    pay = _get_payment(pay_id)
    assert pay.status == "paid"
    assert pay.granted is True

    # One ledger row with reason="topup"
    rows = _get_ledger_rows(company_id, reason="topup")
    assert len(rows) == 1


# ---------------------------------------------------------------------------
# Test 2: reconcile_pending again → returns 0, no double grant
# ---------------------------------------------------------------------------


def test_reconcile_pending_idempotent_no_double_grant():
    """Running reconcile_pending again on an already-settled payment → no-op (returns 0)."""
    company_id = _seed_company("Reconcile Idempotent B")
    ppid = f"pay_r2_{uuid.uuid4().hex[:8]}"
    _seed_topup_payment(company_id, ppid, credits=5000)

    fake_client = FakeDoitClient()
    fake_client._payments[ppid] = {"id": ppid, "status": "pending", "amount": 50000}
    fake_client.mark_paid(ppid)
    provider = DoitProvider(fake_client, TEST_SECRET)

    # First run — settle
    with _tenant_session(company_id) as db:
        company = db.get(Company, company_id)
        count1 = reconcile_pending(db, company, provider)

    assert count1 == 1
    assert _get_balance(company_id) == 5000

    # Second run — no-op
    with _tenant_session(company_id) as db:
        company = db.get(Company, company_id)
        count2 = reconcile_pending(db, company, provider)

    assert count2 == 0
    assert _get_balance(company_id) == 5000, "No double grant"

    rows = _get_ledger_rows(company_id, reason="topup")
    assert len(rows) == 1, "Exactly one ledger row — no double-grant"


# ---------------------------------------------------------------------------
# Test 3: Cross-path idempotency A — reconcile settles first, webhook arrives later
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_path_reconcile_then_webhook_noop():
    """Reconcile settles payment first → subsequent webhook for same payment is a no-op."""
    company_id = _seed_company("CrossPath A reconcile-first")
    ppid = f"pay_cp_r_{uuid.uuid4().hex[:8]}"
    _seed_topup_payment(company_id, ppid, credits=5000)

    # Shared FakeDoitClient so both reconcile and webhook provider share state
    fake_client = FakeDoitClient()
    fake_client._payments[ppid] = {"id": ppid, "status": "pending", "amount": 50000}
    fake_client.mark_paid(ppid)

    provider = DoitProvider(fake_client, TEST_SECRET)

    # ── Reconcile first ────────────────────────────────────────────────────
    with _tenant_session(company_id) as db:
        company = db.get(Company, company_id)
        count = reconcile_pending(db, company, provider)

    assert count == 1
    assert _get_balance(company_id) == 5000

    # ── Now post the webhook for the same payment ──────────────────────────
    body = _payment_paid_body(ppid)
    headers = _signed_webhook_headers(body)

    from omilo.billing.provider import get_payment_provider
    from omilo.main import create_app

    app = create_app()
    app.dependency_overrides[get_payment_provider] = lambda: provider

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/webhooks/doit", content=body, headers=headers)

    assert resp.status_code == 200

    # Balance must still be exactly 5000 — no double grant
    assert _get_balance(company_id) == 5000

    rows = _get_ledger_rows(company_id, reason="topup")
    assert len(rows) == 1, "Only one ledger row — webhook was a no-op"


# ---------------------------------------------------------------------------
# Test 4: Cross-path idempotency B — webhook settles first, reconcile finds granted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_path_webhook_then_reconcile_noop():
    """Webhook settles payment first → reconcile_pending finds granted=True → no-op."""
    company_id = _seed_company("CrossPath B webhook-first")
    ppid = f"pay_cp_w_{uuid.uuid4().hex[:8]}"
    _seed_topup_payment(company_id, ppid, credits=5000)

    fake_client = FakeDoitClient()
    fake_client._payments[ppid] = {"id": ppid, "status": "pending", "amount": 50000}
    fake_client.mark_paid(ppid)

    provider = DoitProvider(fake_client, TEST_SECRET)

    # ── Webhook first ──────────────────────────────────────────────────────
    body = _payment_paid_body(ppid)
    headers = _signed_webhook_headers(body)

    from omilo.billing.provider import get_payment_provider
    from omilo.main import create_app

    app = create_app()
    app.dependency_overrides[get_payment_provider] = lambda: provider

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/webhooks/doit", content=body, headers=headers)

    assert resp.status_code == 200
    assert _get_balance(company_id) == 5000

    # ── Reconcile after — must be no-op ────────────────────────────────────
    with _tenant_session(company_id) as db:
        company = db.get(Company, company_id)
        count = reconcile_pending(db, company, provider)

    assert count == 0, "Reconcile should find payment already granted"
    assert _get_balance(company_id) == 5000, "No double grant"

    rows = _get_ledger_rows(company_id, reason="topup")
    assert len(rows) == 1, "Only one ledger row — reconcile was a no-op"


# ---------------------------------------------------------------------------
# Test 5: Provider reports "expired" → status set, no grant
# ---------------------------------------------------------------------------


def test_reconcile_pending_expired():
    """Provider reports expired → DoitPayment.status set to 'expired'; no credits granted."""
    company_id = _seed_company("Reconcile Expired E")
    ppid = f"pay_exp_{uuid.uuid4().hex[:8]}"
    pay_id = _seed_topup_payment(company_id, ppid, credits=5000)

    fake_client = FakeDoitClient()
    fake_client._payments[ppid] = {"id": ppid, "status": "expired", "amount": 50000}

    provider = DoitProvider(fake_client, TEST_SECRET)

    with _tenant_session(company_id) as db:
        company = db.get(Company, company_id)
        count = reconcile_pending(db, company, provider)

    assert count == 0, "Expired payment should not count as settled"
    assert _get_balance(company_id) == 0, "No credits for expired payment"

    pay = _get_payment(pay_id)
    assert pay.status == "expired"
    assert pay.granted is False

    rows = _get_ledger_rows(company_id, reason="topup")
    assert len(rows) == 0


# ---------------------------------------------------------------------------
# Test 6: GET /v1/usage → pending_topups + last_payment
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_usage_pending_topups_and_last_payment():
    """GET /v1/usage returns pending_topups and last_payment reflecting seeded rows."""
    from omilo.main import create_app
    from omilo.tenancy.deps import get_context
    from omilo.tenancy.context import RequestContext

    company_id = _seed_company("Usage Pending Test")
    ppid1 = f"pay_u1_{uuid.uuid4().hex[:8]}"
    ppid2 = f"pay_u2_{uuid.uuid4().hex[:8]}"

    # Seed two pending topup payments
    pay_id1 = _seed_topup_payment(company_id, ppid1, credits=1000)
    pay_id2 = _seed_topup_payment(company_id, ppid2, credits=4000)

    # Mock context to inject company_id
    ctx = RequestContext(company_id=company_id, user_id="usr_test", role="owner")

    app = create_app()
    app.dependency_overrides[get_context] = lambda: ctx

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/v1/usage")

    assert resp.status_code == 200
    data = resp.json()

    # pending_topups: both pending topup payments
    assert "pending_topups" in data
    assert data["pending_topups"]["count"] == 2
    assert data["pending_topups"]["total_credits"] == 5000  # 1000 + 4000

    # last_payment: most recently created (pay_id2 was seeded last)
    assert "last_payment" in data
    lp = data["last_payment"]
    assert lp is not None
    assert lp["kind"] == "topup"
    assert lp["status"] == "pending"
    assert "id" in lp
    assert "amount_idr" in lp
    assert "created_at" in lp

    # Company-scoped: another company's data not mixed in
    other_company_id = _seed_company("Usage Pending Other")
    ppid_other = f"pay_other_{uuid.uuid4().hex[:8]}"
    _seed_topup_payment(other_company_id, ppid_other, credits=9999)

    # Re-query with same company ctx — other company's payment not in pending_topups
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp2 = await client.get("/v1/usage")

    data2 = resp2.json()
    assert data2["pending_topups"]["count"] == 2  # Still only our 2
    assert data2["pending_topups"]["total_credits"] == 5000  # Still 5000, not 14999
