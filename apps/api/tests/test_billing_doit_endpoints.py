"""TDD — P5a Task 4: Real topup/change-plan wired to Doit + wallet endpoints.

Tests (real DB, FakeDoitClient injected via dependency override — same
pattern as test_doit_webhook.py T3):

1.  Doit topup: POST /v1/billing/topup {pack:"medium"}
    → 200/201 with hosted_url + status:"pending"; balance UNCHANGED;
      a pending DoitPayment(credits=5000, amount_idr=70000) exists.
2.  Pending → webhook → credited end-to-end:
    After posting a signed payment.paid webhook the balance increases by 5000.
3.  Doit change-plan: POST {plan_id} → pending subscription DoitPayment +
    hosted_url; Subscription NOT yet active (still pending).
4.  GET /v1/wallet → default WalletSettings created (auto_topup_enabled=false).
5.  PUT /v1/wallet → upsert WalletSettings (set auto_topup).
6.  GET /v1/wallet/payments → lists the company's DoitPayment rows (newest first).
7.  GET /v1/wallet/payments/{id} → returns one payment's status/hosted_url.
8.  Company B cannot see company A's wallet payments (company-scoped isolation).
9.  Manual provider still instant: with the DEFAULT ManualProvider (no override),
    the existing P4 topup/change-plan behaviour works unchanged.

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

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.billing import Plan, Subscription
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


def _signed_request(body: bytes, *, secret: str = TEST_SECRET):
    """Return (headers, body) for a signed webhook request."""
    t = int(time.time())
    sig = _make_sig_header(secret, body, t)
    return {"PayBridge-Signature": sig, "content-type": "application/json"}, body


def _payment_paid_body(payment_id: str) -> bytes:
    return json.dumps({
        "type": "payment.paid",
        "payment": {
            "id": payment_id,
            "status": "paid",
            "reference": "INV/t4",
            "amount": 70000,
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


def _get_balance(company_id: str) -> int:
    with _superuser_session() as sess:
        cmp = sess.get(Company, company_id)
        return int(cmp.credit_balance or 0)


def _get_doit_payments(company_id: str) -> list[DoitPayment]:
    with _superuser_session() as sess:
        return (
            sess.query(DoitPayment)
            .filter(DoitPayment.company_id == company_id)
            .order_by(DoitPayment.created_at.desc())
            .all()
        )


def _get_subscription(company_id: str, status: str) -> Subscription | None:
    with _superuser_session() as sess:
        return (
            sess.query(Subscription)
            .filter(
                Subscription.company_id == company_id,
                Subscription.status == status,
            )
            .first()
        )


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def _seed_plan(included_credits: int = 2000, monthly_price_idr: int = 800_000) -> str:
    """Seed a Plan with included_credits and return its id."""
    plan_id = prefixed_id("pln")
    with _superuser_session() as sess:
        plan = Plan(
            id=plan_id,
            tier="pro",
            name="Pro Monthly",
            monthly_price_usd=Decimal("49.00"),
            monthly_price_idr=monthly_price_idr,
            included_credits=included_credits,
            credit_overage_usd=Decimal("0.01"),
            seats=5,
            features={},
        )
        sess.add(plan)
    return plan_id


# ---------------------------------------------------------------------------
# App fixture — Doit provider injected (mirrors T3 pattern exactly)
# ---------------------------------------------------------------------------


def _make_doit_app():
    """Return a FastAPI app with DoitProvider(FakeDoitClient()) injected."""
    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider
    from omilo.billing.provider import get_payment_provider
    from omilo.main import create_app

    app = create_app()
    fake_client = FakeDoitClient()
    fake_provider = DoitProvider(fake_client, TEST_SECRET)
    app.dependency_overrides[get_payment_provider] = lambda: fake_provider
    return app, fake_client


# ---------------------------------------------------------------------------
# Sign-up / auth helpers (reuse standard flow)
# ---------------------------------------------------------------------------


async def _sign_up(client, *, name: str = "Doit Tester") -> tuple[str, str]:
    """Sign up + return (access_token, company_id)."""
    email = f"doit_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": "testDoitP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    company_id = me_resp.json()["company"]["id"]
    return token, company_id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Test 1: Doit topup returns pending + hosted_url; balance UNCHANGED
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_doit_topup_returns_pending_hosted_url_balance_unchanged():
    """POST /v1/billing/topup {pack:"medium"} under DoitProvider
    → returns {payment_id, hosted_url, status:"pending", credits:5000, amount_idr:70000};
      balance UNCHANGED; a pending DoitPayment(credits=5000, amount_idr=70000) is created.
    """
    app, _fake_client = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, company_id = await _sign_up(client, name="Doit Topup Test")

        balance_before = _get_balance(company_id)

        resp = await client.post(
            "/v1/billing/topup",
            json={"pack": "medium"},
            headers=_auth(token),
        )

    assert resp.status_code in (200, 201), resp.text
    data = resp.json()

    # Must return pending shape (not balance/invoice)
    assert data["status"] == "pending", f"Expected status:pending, got {data}"
    assert data["hosted_url"] is not None, "hosted_url must be set"
    assert "payment_id" in data, f"payment_id missing from {data}"
    assert data["credits"] == 5000
    assert data["amount_idr"] == 70000

    # Balance UNCHANGED
    assert _get_balance(company_id) == balance_before, (
        f"Balance should be unchanged. Before={balance_before}, "
        f"after={_get_balance(company_id)}"
    )

    # A pending DoitPayment row must exist
    payments = _get_doit_payments(company_id)
    assert len(payments) >= 1
    pay = payments[0]
    assert pay.status == "pending"
    assert pay.credits == 5000
    assert pay.amount_idr == 70000
    assert pay.kind == "topup"


# ---------------------------------------------------------------------------
# Test 2: End-to-end pending → webhook → credited
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_doit_topup_webhook_credits_balance():
    """After topup creates a pending DoitPayment, posting a signed payment.paid
    webhook for that payment_id credits the balance by 5000 (end-to-end).
    """
    app, fake_client = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, company_id = await _sign_up(client, name="Doit E2E Test")

        # Step 1: create topup (pending)
        resp = await client.post(
            "/v1/billing/topup",
            json={"pack": "medium"},
            headers=_auth(token),
        )
        assert resp.status_code in (200, 201), resp.text
        data = resp.json()
        assert data["status"] == "pending"

        balance_before = _get_balance(company_id)

        # Step 2: find the provider_payment_id stored in DoitPayment
        payments = _get_doit_payments(company_id)
        assert len(payments) >= 1
        provider_payment_id = payments[0].provider_payment_id
        assert provider_payment_id is not None

        # Step 3: post signed payment.paid webhook
        body = _payment_paid_body(provider_payment_id)
        headers, body = _signed_request(body)
        wh_resp = await client.post("/v1/webhooks/doit", content=body, headers=headers)
        assert wh_resp.status_code == 200, wh_resp.text

    # Balance should have increased by 5000 regardless of starting balance
    balance_after = _get_balance(company_id)
    assert balance_after == balance_before + 5000, (
        f"Expected balance delta +5000. Before={balance_before}, after={balance_after}"
    )


# ---------------------------------------------------------------------------
# Test 3: Doit change-plan → pending subscription DoitPayment; plan NOT active
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_doit_change_plan_returns_pending_no_activation():
    """POST /v1/billing/change-plan {plan_id} under DoitProvider
    → returns {payment_id, hosted_url, status:"pending", plan_id};
      Subscription NOT yet active (status="pending");
      a pending subscription DoitPayment exists.
    """
    app, _fake_client = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, company_id = await _sign_up(client, name="Doit ChangePlan Test")
        plan_id = _seed_plan(included_credits=2000)

        resp = await client.post(
            "/v1/billing/change-plan",
            json={"plan_id": plan_id},
            headers=_auth(token),
        )

    assert resp.status_code in (200, 201), resp.text
    data = resp.json()

    assert data["status"] == "pending", f"Expected pending, got {data}"
    assert data["hosted_url"] is not None, "hosted_url must be set"
    assert "payment_id" in data
    assert data["plan_id"] == plan_id

    # Balance unchanged (no credits granted yet)
    assert _get_balance(company_id) == 0

    # No active subscription yet
    active_sub = _get_subscription(company_id, "active")
    assert active_sub is None, "Subscription should NOT be active until webhook"

    # A pending subscription DoitPayment exists
    payments = _get_doit_payments(company_id)
    assert len(payments) >= 1
    pay = payments[0]
    assert pay.status == "pending"
    assert pay.kind == "subscription"
    assert pay.plan_id == plan_id


# ---------------------------------------------------------------------------
# Test 3b: Doit change-plan → pending DoitPayment has amount_idr == plan.monthly_price_idr
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_doit_change_plan_amount_idr_matches_plan():
    """POST /v1/billing/change-plan for a paid plan → pending DoitPayment.amount_idr
    equals plan.monthly_price_idr (non-zero); confirms the IDR price is wired correctly.
    """
    app, _fake_client = _make_doit_app()
    idr_price = 800_000
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, company_id = await _sign_up(client, name="Doit ChangePlan IDR Test")
        plan_id = _seed_plan(included_credits=2000, monthly_price_idr=idr_price)

        resp = await client.post(
            "/v1/billing/change-plan",
            json={"plan_id": plan_id},
            headers=_auth(token),
        )

    assert resp.status_code in (200, 201), resp.text

    payments = _get_doit_payments(company_id)
    sub_payments = [p for p in payments if p.kind == "subscription"]
    assert len(sub_payments) >= 1, "Expected at least one subscription DoitPayment"
    pay = sub_payments[0]
    assert pay.amount_idr == idr_price, (
        f"Expected amount_idr={idr_price}, got {pay.amount_idr}. "
        "plan.monthly_price_idr must be used, not a hardcoded 0."
    )


# ---------------------------------------------------------------------------
# Test 4: GET /v1/wallet → default WalletSettings created
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wallet_get_creates_default():
    """GET /v1/wallet → creates default WalletSettings (auto_topup_enabled=false)."""
    app, _ = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, company_id = await _sign_up(client, name="Wallet Default Test")

        resp = await client.get("/v1/wallet", headers=_auth(token))

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["auto_topup_enabled"] is False
    assert "auto_topup_threshold_credits" in data
    assert "auto_topup_pack" in data


# ---------------------------------------------------------------------------
# Test 5: PUT /v1/wallet → upsert WalletSettings
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wallet_put_upsert():
    """PUT /v1/wallet → upserts WalletSettings."""
    app, _ = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, company_id = await _sign_up(client, name="Wallet Upsert Test")

        resp = await client.put(
            "/v1/wallet",
            json={
                "auto_topup_enabled": True,
                "auto_topup_threshold_credits": 500,
                "auto_topup_pack": "small",
            },
            headers=_auth(token),
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["auto_topup_enabled"] is True
    assert data["auto_topup_threshold_credits"] == 500
    assert data["auto_topup_pack"] == "small"


# ---------------------------------------------------------------------------
# Test 6: GET /v1/wallet/payments → lists company's DoitPayment rows newest first
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wallet_payments_list():
    """GET /v1/wallet/payments lists the company's DoitPayment rows, newest first."""
    app, _ = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, company_id = await _sign_up(client, name="Wallet Payments List Test")

        # Create two topups
        for pack in ("small", "medium"):
            r = await client.post(
                "/v1/billing/topup",
                json={"pack": pack},
                headers=_auth(token),
            )
            assert r.status_code in (200, 201), r.text

        resp = await client.get("/v1/wallet/payments", headers=_auth(token))

    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert isinstance(rows, list)
    assert len(rows) >= 2

    # All rows belong to this company
    for row in rows:
        assert row["company_id"] == company_id

    # Newest first
    if len(rows) >= 2:
        assert rows[0]["created_at"] >= rows[1]["created_at"]


# ---------------------------------------------------------------------------
# Test 7: GET /v1/wallet/payments/{id} → single payment status/hosted_url
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wallet_payment_get_single():
    """GET /v1/wallet/payments/{id} returns one payment's status and hosted_url."""
    app, _ = _make_doit_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, company_id = await _sign_up(client, name="Wallet Single Payment Test")

        # Create a topup
        topup_resp = await client.post(
            "/v1/billing/topup",
            json={"pack": "large"},
            headers=_auth(token),
        )
        assert topup_resp.status_code in (200, 201), topup_resp.text
        payment_id = topup_resp.json()["payment_id"]

        resp = await client.get(
            f"/v1/wallet/payments/{payment_id}",
            headers=_auth(token),
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["id"] == payment_id
    assert data["status"] == "pending"
    assert data["hosted_url"] is not None


# ---------------------------------------------------------------------------
# Test 8: Company B cannot see company A's wallet payments
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wallet_payments_company_scoped():
    """Company B cannot see company A's DoitPayment rows (isolation)."""
    app_a, _ = _make_doit_app()
    app_b, _ = _make_doit_app()

    async with AsyncClient(transport=ASGITransport(app=app_a), base_url="http://test") as client_a:
        token_a, company_a_id = await _sign_up(client_a, name="Isolation A")

        # Company A creates a topup
        r = await client_a.post(
            "/v1/billing/topup",
            json={"pack": "small"},
            headers=_auth(token_a),
        )
        assert r.status_code in (200, 201), r.text
        pay_id_a = r.json()["payment_id"]

    async with AsyncClient(transport=ASGITransport(app=app_b), base_url="http://test") as client_b:
        token_b, company_b_id = await _sign_up(client_b, name="Isolation B")

        # Company B lists their payments — should not see A's payment
        list_resp = await client_b.get("/v1/wallet/payments", headers=_auth(token_b))
        assert list_resp.status_code == 200
        b_payments = list_resp.json()
        b_ids = [p["id"] for p in b_payments]
        assert pay_id_a not in b_ids, (
            f"Company B should NOT see company A's payment {pay_id_a}"
        )

        # Company B trying to GET company A's payment should 404
        get_resp = await client_b.get(
            f"/v1/wallet/payments/{pay_id_a}",
            headers=_auth(token_b),
        )
        assert get_resp.status_code == 404


# ---------------------------------------------------------------------------
# Test 9: Manual provider still instant (P4 behavior unchanged)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_manual_provider_topup_still_instant():
    """With default ManualProvider (no override), topup instantly grants credits."""
    from omilo.main import create_app

    app = create_app()  # No override → ManualProvider
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, company_id = await _sign_up(client, name="Manual Still Instant Test")
        balance_before = _get_balance(company_id)

        resp = await client.post(
            "/v1/billing/topup",
            json={"pack": "medium"},
            headers=_auth(token),
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Must have the P4 instant-grant shape: balance + invoice (not pending)
    assert "balance" in data, f"Expected P4 balance key, got {data}"
    assert "invoice" in data, f"Expected P4 invoice key, got {data}"
    assert data["balance"] == balance_before + 5000
    assert _get_balance(company_id) == balance_before + 5000
