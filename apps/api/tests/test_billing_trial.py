"""TDD — P12-T2: Trial logic, billing interval, plans/subscription endpoints.

Tests:
(a) local company → start_trial returns None, no Subscription, no credits
(b) cloud company → start_trial creates trialing sub (+14d) + grants 2000 credits
    ONCE; 2nd call never double-grants
(c) change-plan interval="yearly" → Doit/Manual uses yearly price + period_end ≈ +1yr
    + billing_interval=="yearly"
(d) GET /v1/billing/plans (cloud) returns plan_cloud with yearly_price_idr + trial_days=14
    (snake_case keys)
(e) GET /v1/billing/subscription exposes is_trial + trial_days_left for trialing sub

RED → implement → GREEN.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy import text

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.billing import Plan, Subscription, CreditLedger
from omilo.models.tenancy import Company

# ---------------------------------------------------------------------------
# Schema guard (module-level)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    from tests.utils import run_alembic
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Helpers
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


def _make_company(name: str = "Trial Test Co") -> Company:
    """Create a fresh Company in the DB and return it (without session)."""
    company_id = prefixed_id("cmp")
    with _superuser_session() as sess:
        cmp = Company(
            id=company_id,
            name=name,
            color="#888888",
            credit_balance=0,
        )
        sess.add(cmp)
    return _get_company(company_id)


def _get_company(company_id: str) -> Company:
    with _superuser_session() as sess:
        return sess.get(Company, company_id)


def _get_subscriptions(company_id: str) -> list[Subscription]:
    with _superuser_session() as sess:
        return (
            sess.query(Subscription)
            .filter(Subscription.company_id == company_id)
            .all()
        )


def _get_credit_balance(company_id: str) -> int:
    with _superuser_session() as sess:
        cmp = sess.get(Company, company_id)
        return int(cmp.credit_balance or 0)


def _get_ledger_rows(company_id: str, reason: str) -> list[CreditLedger]:
    with _superuser_session() as sess:
        return (
            sess.query(CreditLedger)
            .filter(
                CreditLedger.company_id == company_id,
                CreditLedger.reason == reason,
            )
            .all()
        )


async def _sign_up(client, *, name=None, password="testP12Pass!") -> tuple[str, str]:
    """Sign up + return (access_token, company_id)."""
    email = f"trial_{uuid.uuid4().hex[:8]}@test.example"
    name = name or f"Trial User {uuid.uuid4().hex[:4]}"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    company_id = me_resp.json()["company"]["id"]
    return token, company_id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_cloud_plan() -> str:
    """Ensure plan_cloud exists and return 'plan_cloud'."""
    from omilo.billing.catalog import seed_plans
    seed_plans()
    return "plan_cloud"


# ---------------------------------------------------------------------------
# Test (a): local mode — start_trial is a no-op
# ---------------------------------------------------------------------------


def test_start_trial_local_mode_returns_none():
    """In local mode start_trial returns None, creates no Subscription, no credits."""
    from omilo.billing.trial import start_trial

    company = _make_company("Local Co")

    with patch("omilo.billing.trial._normalize_mode", return_value="local"), \
         patch("omilo.billing.trial.get_settings") as mock_settings:
        mock_settings.return_value.omilo_mode = "local"

        with _superuser_session() as sess:
            # Reload company in this session
            cmp = sess.get(Company, company.id)
            result = start_trial(sess, cmp)

    assert result is None, f"Expected None for local mode, got {result!r}"

    # No subscription should exist
    subs = _get_subscriptions(company.id)
    assert len(subs) == 0, f"Expected no subscriptions, got {len(subs)}"

    # No credits should have been granted
    balance = _get_credit_balance(company.id)
    assert balance == 0, f"Expected 0 credits for local company, got {balance}"

    # No trial_grant ledger row
    trial_rows = _get_ledger_rows(company.id, "trial_grant")
    assert len(trial_rows) == 0, f"Expected no trial_grant ledger rows, got {len(trial_rows)}"


# ---------------------------------------------------------------------------
# Test (b): cloud mode — start_trial creates trialing sub + grants credits once
# ---------------------------------------------------------------------------


def test_start_trial_cloud_mode_creates_trialing_sub():
    """In cloud mode start_trial creates a trialing Subscription expiring in 14 days
    and grants plan_cloud.included_credits (2000) ONCE."""
    from omilo.billing.trial import start_trial

    _seed_cloud_plan()
    company = _make_company("Cloud Trial Co")

    with patch("omilo.billing.trial._normalize_mode", return_value="cloud"), \
         patch("omilo.billing.trial.get_settings") as mock_settings:
        mock_settings.return_value.omilo_mode = "cloud"

        with _superuser_session() as sess:
            cmp = sess.get(Company, company.id)
            result = start_trial(sess, cmp)

    # Must return a Subscription
    assert result is not None, "start_trial should return a Subscription in cloud mode"

    # Verify subscription state in DB
    subs = _get_subscriptions(company.id)
    assert len(subs) == 1, f"Expected 1 subscription, got {len(subs)}"
    sub = subs[0]
    assert sub.status == "trialing"
    assert sub.plan_id == "plan_cloud"
    assert sub.billing_interval == "monthly"

    # period_end should be ~14 days from now (within a minute of tolerance)
    now = datetime.now(timezone.utc)
    expected_end = now + timedelta(days=14)
    delta = abs((sub.current_period_end - expected_end).total_seconds())
    assert delta < 120, f"period_end delta too large: {delta}s (expected ~14d from now)"

    # Seats from plan_cloud = 5
    assert sub.seats == 5

    # N1: a trial must be hard-overage so pooled blocks at 0 (no unpaid debt).
    assert _get_company(company.id).overage_policy == "hard"

    # Credits granted: 2000
    balance = _get_credit_balance(company.id)
    assert balance == 2000, f"Expected 2000 credits, got {balance}"

    # trial_grant ledger row exists
    trial_rows = _get_ledger_rows(company.id, "trial_grant")
    assert len(trial_rows) == 1, f"Expected 1 trial_grant ledger row, got {len(trial_rows)}"


def test_start_trial_cloud_mode_no_double_grant():
    """Calling start_trial twice on a cloud company never double-grants credits."""
    from omilo.billing.trial import start_trial

    _seed_cloud_plan()
    company = _make_company("Cloud No Double Grant Co")

    with patch("omilo.billing.trial._normalize_mode", return_value="cloud"), \
         patch("omilo.billing.trial.get_settings") as mock_settings:
        mock_settings.return_value.omilo_mode = "cloud"

        # First call
        with _superuser_session() as sess:
            cmp = sess.get(Company, company.id)
            sub1 = start_trial(sess, cmp)

        # Second call (should be no-op, returns existing sub)
        with _superuser_session() as sess:
            cmp = sess.get(Company, company.id)
            sub2 = start_trial(sess, cmp)

    assert sub1 is not None
    assert sub2 is not None

    # Balance must still be exactly 2000 (not 4000)
    balance = _get_credit_balance(company.id)
    assert balance == 2000, (
        f"Expected 2000 credits after 2 start_trial calls, got {balance} — double-grant!"
    )

    # Only 1 trial_grant ledger row
    trial_rows = _get_ledger_rows(company.id, "trial_grant")
    assert len(trial_rows) == 1, (
        f"Expected 1 trial_grant ledger row after 2 calls, got {len(trial_rows)}"
    )


def test_start_trial_returns_existing_sub_if_already_has_subscription():
    """If company already has a subscription, start_trial returns it without creating another."""
    from omilo.billing.trial import start_trial

    _seed_cloud_plan()
    company = _make_company("Already Has Sub Co")

    # Pre-create an existing active subscription
    existing_sub_id = prefixed_id("sub")
    with _superuser_session() as sess:
        existing_sub = Subscription(
            id=existing_sub_id,
            company_id=company.id,
            plan_id="plan_cloud",
            status="active",
            provider="manual",
            seats=5,
        )
        sess.add(existing_sub)

    with patch("omilo.billing.trial._normalize_mode", return_value="cloud"), \
         patch("omilo.billing.trial.get_settings") as mock_settings:
        mock_settings.return_value.omilo_mode = "cloud"

        with _superuser_session() as sess:
            cmp = sess.get(Company, company.id)
            result = start_trial(sess, cmp)

    # Should return the existing subscription (not create another)
    assert result is not None

    subs = _get_subscriptions(company.id)
    assert len(subs) == 1, (
        f"Expected 1 subscription (existing), got {len(subs)} — double-sub created!"
    )

    # No trial_grant should have been issued
    trial_rows = _get_ledger_rows(company.id, "trial_grant")
    assert len(trial_rows) == 0, "No trial_grant should be issued when sub already exists"


# ---------------------------------------------------------------------------
# Test (c): change-plan with interval="yearly" — price + period_end + billing_interval
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_change_plan_yearly_interval_manual_provider(async_client):
    """POST /v1/billing/change-plan {plan_id, interval:"yearly"} with ManualProvider
    → uses yearly price logic, period_end ≈ now+1yr, billing_interval="yearly".
    """
    token, company_id = await _sign_up(async_client, name="Yearly Interval Test")
    _seed_cloud_plan()

    resp = await async_client.post(
        "/v1/billing/change-plan",
        json={"plan_id": "plan_cloud", "interval": "yearly"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Subscription must have billing_interval="yearly"
    sub_data = data["subscription"]
    assert sub_data["billing_interval"] == "yearly", (
        f"Expected billing_interval='yearly', got {sub_data.get('billing_interval')!r}"
    )

    # period_end should be ~1 year from now
    period_end_str = sub_data.get("current_period_end")
    assert period_end_str is not None, "current_period_end must be set"
    period_end = datetime.fromisoformat(period_end_str)
    if period_end.tzinfo is None:
        period_end = period_end.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    delta_days = (period_end - now).days
    assert 364 <= delta_days <= 366, (
        f"Expected period_end ~365d from now, got delta={delta_days}d"
    )

    # Verify in DB
    with _superuser_session() as sess:
        sub_db = (
            sess.query(Subscription)
            .filter(
                Subscription.company_id == company_id,
                Subscription.status == "active",
            )
            .order_by(Subscription.created_at.desc())
            .first()
        )
    assert sub_db is not None
    assert sub_db.billing_interval == "yearly"


@pytest.mark.asyncio
async def test_change_plan_monthly_interval_is_default(async_client):
    """POST /v1/billing/change-plan {plan_id} without interval defaults to monthly."""
    token, company_id = await _sign_up(async_client, name="Monthly Default Test")
    _seed_cloud_plan()

    resp = await async_client.post(
        "/v1/billing/change-plan",
        json={"plan_id": "plan_cloud"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    sub_data = data["subscription"]
    assert sub_data["billing_interval"] == "monthly", (
        f"Expected billing_interval='monthly', got {sub_data.get('billing_interval')!r}"
    )

    # period_end should be ~1 month from now
    period_end_str = sub_data.get("current_period_end")
    assert period_end_str is not None, "current_period_end must be set for monthly"
    period_end = datetime.fromisoformat(period_end_str)
    if period_end.tzinfo is None:
        period_end = period_end.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    delta_days = (period_end - now).days
    assert 28 <= delta_days <= 32, (
        f"Expected period_end ~30d from now, got delta={delta_days}d"
    )


@pytest.mark.asyncio
async def test_change_plan_yearly_doit_uses_yearly_price():
    """POST /v1/billing/change-plan {plan_id, interval:"yearly"} with DoitProvider
    → pending DoitPayment.amount_idr == plan.yearly_price_idr (2990000)."""
    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider
    from omilo.billing.provider import get_payment_provider
    from omilo.main import create_app

    _seed_cloud_plan()

    app = create_app()
    fake_client = FakeDoitClient()
    fake_provider = DoitProvider(fake_client, "whsec_test")
    app.dependency_overrides[get_payment_provider] = lambda: fake_provider

    from httpx import ASGITransport, AsyncClient as HttpxClient
    async with HttpxClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        token, company_id = await _sign_up(client, name="Doit Yearly Test")

        resp = await client.post(
            "/v1/billing/change-plan",
            json={"plan_id": "plan_cloud", "interval": "yearly"},
            headers=_auth(token),
        )

    assert resp.status_code in (200, 201), resp.text
    data = resp.json()
    assert data["status"] == "pending"

    # Verify amount_idr == plan_cloud.yearly_price_idr == 2990000
    with _superuser_session() as sess:
        from omilo.models.commerce import DoitPayment
        pay = (
            sess.query(DoitPayment)
            .filter(
                DoitPayment.company_id == company_id,
                DoitPayment.kind == "subscription",
            )
            .order_by(DoitPayment.created_at.desc())
            .first()
        )
    assert pay is not None
    assert pay.amount_idr == 2990000, (
        f"Expected yearly_price_idr=2990000, got {pay.amount_idr}"
    )


# ---------------------------------------------------------------------------
# Test (d): GET /v1/billing/plans returns snake_case keys with trial_days
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_plans_cloud_mode_returns_plan_cloud_snake_case(async_client):
    """GET /v1/billing/plans in cloud mode returns plan_cloud with all snake_case keys
    including yearly_price_idr, yearly_price_usd, monthly_price_idr, trial_days=14.
    """
    _seed_cloud_plan()

    token, _ = await _sign_up(async_client, name="Plans Endpoint Test")

    resp = await async_client.get("/v1/billing/plans", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    plans = resp.json()

    assert isinstance(plans, list), f"Expected list, got {type(plans)}"
    assert len(plans) >= 1, "Expected at least one plan"

    # Find plan_cloud
    cloud_plans = [p for p in plans if p.get("id") == "plan_cloud"]
    assert len(cloud_plans) == 1, f"Expected plan_cloud in response, got ids={[p['id'] for p in plans]}"

    plan = cloud_plans[0]

    # All required snake_case keys
    required_keys = [
        "id", "tier", "name",
        "monthly_price_usd", "monthly_price_idr",
        "yearly_price_usd", "yearly_price_idr",
        "included_credits", "seats", "trial_days",
    ]
    for key in required_keys:
        assert key in plan, f"Missing key {key!r} in plan_dict: {list(plan.keys())}"

    # Correct values
    assert plan["id"] == "plan_cloud"
    assert plan["monthly_price_idr"] == 299000
    assert plan["yearly_price_idr"] == 2990000
    assert plan["monthly_price_usd"] == 19.0
    assert plan["yearly_price_usd"] == 190.0
    assert plan["included_credits"] == 2000
    assert plan["trial_days"] == 14


@pytest.mark.asyncio
async def test_get_plans_lazy_starts_trial_for_cloud_company(async_client):
    """GET /v1/billing/plans for a fresh cloud company lazy-starts a trial
    (subscription created + 2000 credits granted).
    """
    _seed_cloud_plan()

    token, company_id = await _sign_up(async_client, name="Lazy Trial Plans Test")

    # No subscription exists yet
    subs_before = _get_subscriptions(company_id)
    assert len(subs_before) == 0

    resp = await async_client.get("/v1/billing/plans", headers=_auth(token))
    assert resp.status_code == 200, resp.text

    # A trialing subscription should now exist
    subs_after = _get_subscriptions(company_id)
    trialing = [s for s in subs_after if s.status == "trialing"]
    assert len(trialing) == 1, (
        f"Expected 1 trialing subscription after GET /v1/billing/plans, got {len(trialing)}"
    )


# ---------------------------------------------------------------------------
# Test (e): GET /v1/billing/subscription exposes is_trial + trial_days_left
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_subscription_exposes_trial_fields_for_trialing_sub(async_client):
    """GET /v1/billing/subscription for a trialing sub returns
    is_trial=True, trial_ends_at (ISO), trial_days_left (int > 0), billing_interval.
    """
    _seed_cloud_plan()

    token, company_id = await _sign_up(async_client, name="Trial Fields Test")

    # Manually seed a trialing subscription
    sub_id = prefixed_id("sub")
    future_end = datetime.now(timezone.utc) + timedelta(days=10)
    with _superuser_session() as sess:
        sub = Subscription(
            id=sub_id,
            company_id=company_id,
            plan_id="plan_cloud",
            status="trialing",
            provider="manual",
            seats=5,
            billing_interval="monthly",
            current_period_end=future_end,
        )
        sess.add(sub)

    resp = await async_client.get("/v1/billing/subscription", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Must expose trial fields
    assert "is_trial" in data, f"Missing 'is_trial' in response: {list(data.keys())}"
    assert "trial_ends_at" in data, f"Missing 'trial_ends_at' in response: {list(data.keys())}"
    assert "trial_days_left" in data, f"Missing 'trial_days_left' in response: {list(data.keys())}"
    assert "billing_interval" in data, f"Missing 'billing_interval' in response: {list(data.keys())}"

    # Values
    assert data["is_trial"] is True, f"Expected is_trial=True, got {data['is_trial']!r}"
    assert data["trial_ends_at"] is not None, "trial_ends_at must be set for trialing sub"
    assert data["trial_days_left"] is not None, "trial_days_left must be set for trialing sub"
    assert data["trial_days_left"] > 0, (
        f"trial_days_left should be > 0 for future-end sub, got {data['trial_days_left']}"
    )
    assert data["trial_days_left"] <= 10, (
        f"trial_days_left should be <= 10 (seeded 10 days), got {data['trial_days_left']}"
    )
    assert data["billing_interval"] == "monthly"
    assert data["status"] == "trialing"


@pytest.mark.asyncio
async def test_subscription_trial_fields_null_for_active_sub(async_client):
    """GET /v1/billing/subscription for an active (non-trial) sub returns
    is_trial=False, trial_ends_at=None, trial_days_left=None.
    """
    _seed_cloud_plan()

    token, company_id = await _sign_up(async_client, name="Active Sub Trial Fields Test")

    # Subscribe normally (active, monthly)
    resp_cp = await async_client.post(
        "/v1/billing/change-plan",
        json={"plan_id": "plan_cloud"},
        headers=_auth(token),
    )
    assert resp_cp.status_code == 200, resp_cp.text

    resp = await async_client.get("/v1/billing/subscription", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["is_trial"] is False, f"Expected is_trial=False for active sub, got {data['is_trial']!r}"
    assert data["trial_ends_at"] is None, f"Expected trial_ends_at=None, got {data['trial_ends_at']!r}"
    assert data["trial_days_left"] is None, f"Expected trial_days_left=None, got {data['trial_days_left']!r}"


@pytest.mark.asyncio
async def test_get_subscription_lazy_starts_trial_for_cloud_company(async_client):
    """GET /v1/billing/subscription for a fresh cloud company lazy-starts a trial."""
    _seed_cloud_plan()

    token, company_id = await _sign_up(async_client, name="Lazy Trial Sub Test")

    subs_before = _get_subscriptions(company_id)
    assert len(subs_before) == 0

    resp = await async_client.get("/v1/billing/subscription", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # After lazy-start, is_trial=True
    assert data["is_trial"] is True, (
        f"Expected is_trial=True after lazy trial start, got {data['is_trial']!r}"
    )
    assert data["status"] == "trialing"

    # A trialing subscription should now exist
    subs_after = _get_subscriptions(company_id)
    trialing = [s for s in subs_after if s.status == "trialing"]
    assert len(trialing) == 1


# ---------------------------------------------------------------------------
# Test: trial expiry — expired trialing sub is NOT active
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_expired_trial_sub_not_returned_as_active(async_client):
    """GET /v1/billing/subscription with an expired trial returns status='trialing'
    but the pooled credit gate naturally blocks at 0 balance.
    The sub remains; we just confirm the endpoint doesn't treat it as 'active'.
    """
    _seed_cloud_plan()

    token, company_id = await _sign_up(async_client, name="Expired Trial Test")

    # Seed an expired trialing subscription (period_end in the past)
    sub_id = prefixed_id("sub")
    past_end = datetime.now(timezone.utc) - timedelta(days=1)
    with _superuser_session() as sess:
        sub = Subscription(
            id=sub_id,
            company_id=company_id,
            plan_id="plan_cloud",
            status="trialing",
            provider="manual",
            seats=5,
            billing_interval="monthly",
            current_period_end=past_end,
        )
        sess.add(sub)

    resp = await async_client.get("/v1/billing/subscription", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # The sub is returned (status=trialing) but trial_days_left should be 0 or negative
    # and is_trial is still True (status-based)
    assert data["is_trial"] is True
    # trial_days_left: expired → should be 0 (ceil of negative = 0 or negative, clamp to 0)
    assert data["trial_days_left"] is not None
    assert data["trial_days_left"] <= 0, (
        f"Expected trial_days_left<=0 for expired trial, got {data['trial_days_left']}"
    )
