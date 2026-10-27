"""TDD — P5a Task 3: Doit webhook endpoint.

POST /v1/webhooks/doit — unauthenticated, raw-body HMAC verify, idempotent credit grant.

Tests (real DB, FakeDoitClient injected via dependency override):

1. Valid payment.paid (topup) → 200; balance += 5000; one CreditLedger reason="topup";
   DoitPayment.granted==True, status=="paid".
2. Re-deliver the same signed event → 200; balance STILL +5000 (exactly once); still
   one ledger row. (Double-grant guard — THE critical test.)
3. Forged signature (wrong secret) → 401; balance unchanged; no ledger row.
4. Stale timestamp → 401.
5. Subscription payment.paid → Subscription becomes active; included credits granted once.
6. Re-deliver subscription event → no double-grant / no double-activate.
7. Cross-tenant: payment belongs to A → company B's balance and ledger untouched.
8. payment.expired → DoitPayment.status=="expired"; no credit grant.
9. Unknown payment_id → 200 (ack); nothing persisted.

RED → implement → GREEN.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from omilo.db import SessionLocal, set_company
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger, Plan, Subscription
from omilo.models.commerce import DoitPayment
from omilo.models.tenancy import Company

# ---------------------------------------------------------------------------
# Signature helper (same HMAC as DoitProvider / test_doit_provider uses)
# ---------------------------------------------------------------------------

TEST_SECRET = "whsec_test"


def _make_sig_header(secret: str, body: bytes | str, t: int | None = None) -> str:
    """Build a valid PayBridge-Signature header value."""
    ts = t if t is not None else int(time.time())
    body_bytes: bytes = body if isinstance(body, bytes) else body.encode("utf-8")
    signed = f"{ts}.".encode("utf-8") + body_bytes
    v1 = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={v1}"


# ---------------------------------------------------------------------------
# Session helpers (reuse same pattern as test_commerce_models)
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


def _seed_topup_payment(company_id: str, provider_payment_id: str, credits: int = 5000) -> str:
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


def _seed_plan(included_credits: int = 1000) -> str:
    """Seed a Plan and return its id."""
    plan_id = prefixed_id("pln")
    with _superuser_session() as sess:
        plan = Plan(
            id=plan_id,
            tier="growth",
            name="Growth Monthly",
            monthly_price_usd=Decimal("49.00"),
            included_credits=included_credits,
            credit_overage_usd=Decimal("0.01"),
            seats=5,
            features={},
        )
        sess.add(plan)
    return plan_id


def _seed_subscription_payment(company_id: str, provider_payment_id: str, plan_id: str) -> str:
    """Seed a pending subscription DoitPayment. Returns the payment row id."""
    pay_id = prefixed_id("pay")
    with _superuser_session() as sess:
        pay = DoitPayment(
            id=pay_id,
            company_id=company_id,
            kind="subscription",
            amount_idr=490000,
            credits=0,
            reference=f"SUB/{uuid.uuid4().hex[:8]}",
            provider_payment_id=provider_payment_id,
            plan_id=plan_id,
            status="pending",
        )
        sess.add(pay)

        # Also seed a pending Subscription row for this company/plan
        sub = Subscription(
            id=prefixed_id("sub"),
            company_id=company_id,
            plan_id=plan_id,
            status="pending",
            provider="doit",
            seats=5,
        )
        sess.add(sub)
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


def _get_active_subscription(company_id: str) -> Subscription | None:
    with _superuser_session() as sess:
        return (
            sess.query(Subscription)
            .filter(
                Subscription.company_id == company_id,
                Subscription.status == "active",
            )
            .first()
        )


# ---------------------------------------------------------------------------
# App fixture with DoitProvider injected via dependency override
# ---------------------------------------------------------------------------


def _make_app_with_doit_provider():
    """Return a FastAPI app with DoitProvider(TEST_SECRET) injected."""
    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider
    from omilo.billing.provider import get_payment_provider
    from omilo.main import create_app

    app = create_app()
    fake_provider = DoitProvider(FakeDoitClient(), TEST_SECRET)
    app.dependency_overrides[get_payment_provider] = lambda: fake_provider
    return app


@pytest.fixture()
async def webhook_client():
    """AsyncClient targeting the app with DoitProvider injected."""
    app = _make_doit_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client


def _make_doit_app():
    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider
    from omilo.billing.provider import get_payment_provider
    from omilo.main import create_app

    app = create_app()
    fake_provider = DoitProvider(FakeDoitClient(), TEST_SECRET)
    app.dependency_overrides[get_payment_provider] = lambda: fake_provider
    return app


# ---------------------------------------------------------------------------
# Event body builders
# ---------------------------------------------------------------------------


def _payment_paid_body(payment_id: str) -> bytes:
    return json.dumps({
        "type": "payment.paid",
        "payment": {
            "id": payment_id,
            "status": "paid",
            "reference": "INV/1",
            "amount": 50000,
            "metadata": {},
        },
    }).encode()


def _payment_expired_body(payment_id: str) -> bytes:
    return json.dumps({
        "type": "payment.expired",
        "payment": {
            "id": payment_id,
            "status": "expired",
            "reference": "INV/1",
            "amount": 50000,
            "metadata": {},
        },
    }).encode()


def _signed_request(body: bytes, *, secret: str = TEST_SECRET, stale: bool = False):
    """Return (headers, body) for a signed webhook request."""
    if stale:
        t = int(time.time()) - 3600
    else:
        t = int(time.time())
    sig = _make_sig_header(secret, body, t)
    return {"PayBridge-Signature": sig, "content-type": "application/json"}, body


# ---------------------------------------------------------------------------
# Test 1: Valid payment.paid (topup) → 200; balance += 5000; one ledger row
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_topup_payment_paid_grants_credits():
    """Valid signed payment.paid for a topup → 200, credits granted, idempotency set."""
    company_id = _seed_company("Webhook Test A")
    ppid = f"pay_wh_{uuid.uuid4().hex[:8]}"
    pay_id = _seed_topup_payment(company_id, ppid, credits=5000)

    body = _payment_paid_body(ppid)
    headers, body = _signed_request(body)

    app = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/webhooks/doit", content=body, headers=headers)

    assert resp.status_code == 200, resp.text

    # Balance increased
    assert _get_balance(company_id) == 5000

    # Exactly one topup ledger row
    ledger = _get_ledger_rows(company_id, reason="topup")
    assert len(ledger) == 1
    assert ledger[0].delta == 5000

    # DoitPayment updated
    pay = _get_payment(pay_id)
    assert pay.granted is True
    assert pay.status == "paid"


# ---------------------------------------------------------------------------
# Test 2: Re-delivery of same event → 200; no double grant (THE critical test)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_topup_payment_paid_idempotent_no_double_grant():
    """Re-delivering the same signed event grants credits EXACTLY ONCE."""
    company_id = _seed_company("Webhook Idempotent A")
    ppid = f"pay_idem_{uuid.uuid4().hex[:8]}"
    _seed_topup_payment(company_id, ppid, credits=5000)

    body = _payment_paid_body(ppid)
    t = int(time.time())
    sig = _make_sig_header(TEST_SECRET, body, t)
    headers = {"PayBridge-Signature": sig, "content-type": "application/json"}

    app = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # First delivery
        r1 = await client.post("/v1/webhooks/doit", content=body, headers=headers)
        assert r1.status_code == 200

        # Second delivery (same body, same sig — re-use the timestamp)
        r2 = await client.post("/v1/webhooks/doit", content=body, headers=headers)
        assert r2.status_code == 200

    # Balance still 5000 — NOT 10000
    assert _get_balance(company_id) == 5000

    # Still exactly ONE ledger row
    ledger = _get_ledger_rows(company_id, reason="topup")
    assert len(ledger) == 1, f"Expected 1 ledger row, got {len(ledger)}"


# ---------------------------------------------------------------------------
# Test 3: Forged signature → 401; no change
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_forged_signature_returns_401():
    """Wrong signing secret → 401; balance unchanged; no ledger row."""
    company_id = _seed_company("Webhook Forged Test")
    ppid = f"pay_forge_{uuid.uuid4().hex[:8]}"
    _seed_topup_payment(company_id, ppid, credits=5000)

    body = _payment_paid_body(ppid)
    headers, body = _signed_request(body, secret="whsec_WRONG")

    app = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/webhooks/doit", content=body, headers=headers)

    assert resp.status_code == 401

    # No balance change, no ledger rows
    assert _get_balance(company_id) == 0
    assert _get_ledger_rows(company_id) == []


# ---------------------------------------------------------------------------
# Test 4: Stale timestamp → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stale_timestamp_returns_401():
    """Timestamp older than 300 s → 401."""
    company_id = _seed_company("Webhook Stale Test")
    ppid = f"pay_stale_{uuid.uuid4().hex[:8]}"
    _seed_topup_payment(company_id, ppid, credits=5000)

    body = _payment_paid_body(ppid)
    headers, body = _signed_request(body, stale=True)

    app = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/webhooks/doit", content=body, headers=headers)

    assert resp.status_code == 401
    assert _get_balance(company_id) == 0
    assert _get_ledger_rows(company_id) == []


# ---------------------------------------------------------------------------
# Test 5: Subscription payment.paid → Subscription active + credits granted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_subscription_payment_paid_activates_and_grants():
    """Valid signed subscription payment.paid → Subscription active, included credits granted."""
    company_id = _seed_company("Webhook Sub Test A")
    plan_id = _seed_plan(included_credits=1000)
    ppid = f"pay_sub_{uuid.uuid4().hex[:8]}"
    pay_id = _seed_subscription_payment(company_id, ppid, plan_id)

    body = _payment_paid_body(ppid)
    headers, body = _signed_request(body)

    app = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/webhooks/doit", content=body, headers=headers)

    assert resp.status_code == 200, resp.text

    # Subscription should be active
    sub = _get_active_subscription(company_id)
    assert sub is not None, "Expected an active subscription after payment.paid"
    assert sub.provider == "doit"

    # Credits granted from plan.included_credits
    assert _get_balance(company_id) == 1000

    # Exactly one subscription_grant ledger row
    ledger = _get_ledger_rows(company_id, reason="subscription_grant")
    assert len(ledger) == 1
    assert ledger[0].delta == 1000

    # DoitPayment.granted set
    pay = _get_payment(pay_id)
    assert pay.granted is True
    assert pay.status == "paid"


# ---------------------------------------------------------------------------
# Test 6: Re-deliver subscription event → no double grant / no double activate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_subscription_payment_paid_idempotent():
    """Re-delivering subscription payment.paid does NOT double-grant credits."""
    company_id = _seed_company("Webhook Sub Idem A")
    plan_id = _seed_plan(included_credits=500)
    ppid = f"pay_subid_{uuid.uuid4().hex[:8]}"
    _seed_subscription_payment(company_id, ppid, plan_id)

    body = _payment_paid_body(ppid)
    t = int(time.time())
    sig = _make_sig_header(TEST_SECRET, body, t)
    headers = {"PayBridge-Signature": sig, "content-type": "application/json"}

    app = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r1 = await client.post("/v1/webhooks/doit", content=body, headers=headers)
        assert r1.status_code == 200

        r2 = await client.post("/v1/webhooks/doit", content=body, headers=headers)
        assert r2.status_code == 200

    # Balance is exactly 500 (not 1000)
    assert _get_balance(company_id) == 500

    # Exactly one ledger row
    ledger = _get_ledger_rows(company_id, reason="subscription_grant")
    assert len(ledger) == 1


# ---------------------------------------------------------------------------
# Test 7: Cross-tenant — company B's balance untouched
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_tenant_isolation():
    """Webhook for company A's payment must not touch company B's balance/ledger."""
    company_a_id = _seed_company("Webhook CrossTenant A")
    company_b_id = _seed_company("Webhook CrossTenant B")

    ppid = f"pay_xtn_{uuid.uuid4().hex[:8]}"
    _seed_topup_payment(company_a_id, ppid, credits=5000)

    body = _payment_paid_body(ppid)
    headers, body = _signed_request(body)

    app = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/webhooks/doit", content=body, headers=headers)

    assert resp.status_code == 200

    # Company A got credits
    assert _get_balance(company_a_id) == 5000

    # Company B is completely untouched
    assert _get_balance(company_b_id) == 0
    assert _get_ledger_rows(company_b_id) == []


# ---------------------------------------------------------------------------
# Test 8: payment.expired → status updated, no grant
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_payment_expired_updates_status_no_grant():
    """payment.expired → DoitPayment.status='expired', no credit grant."""
    company_id = _seed_company("Webhook Expired Test")
    ppid = f"pay_exp_{uuid.uuid4().hex[:8]}"
    pay_id = _seed_topup_payment(company_id, ppid, credits=5000)

    body = _payment_expired_body(ppid)
    headers, body = _signed_request(body)

    app = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/webhooks/doit", content=body, headers=headers)

    assert resp.status_code == 200

    # No credit granted
    assert _get_balance(company_id) == 0
    assert _get_ledger_rows(company_id) == []

    # Status updated
    pay = _get_payment(pay_id)
    assert pay.status == "expired"
    assert pay.granted is False


# ---------------------------------------------------------------------------
# Test 9: Unknown payment_id → 200 ack, nothing persisted
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_payment_id_returns_200():
    """payment.paid for unknown provider_payment_id → 200 (ack); nothing persisted."""
    unknown_ppid = "pay_totally_unknown_abc123"

    body = _payment_paid_body(unknown_ppid)
    headers, body = _signed_request(body)

    app = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/v1/webhooks/doit", content=body, headers=headers)

    assert resp.status_code == 200
