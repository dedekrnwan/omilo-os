"""tests/test_doit_provider.py — TDD for DoitClient/FakeDoitClient/DoitProvider/verify_doit_signature.

All tests are offline: FakeDoitClient only, zero network calls.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_sig_header(secret: str, body: bytes | str, t: int | None = None) -> str:
    """Build a valid PayBridge-Signature header value.

    Computes the HMAC the same canonical way Doit does:
        HMAC_SHA256(secret, f"{ts}.".encode("utf-8") + body_bytes)

    This is intentionally NOT a string round-trip so the test is NOT tautological
    with respect to the implementation. A body containing non-ASCII bytes
    (e.g. emoji) must still produce a header that verify_doit_signature accepts.
    """
    ts = t if t is not None else int(time.time())
    body_bytes: bytes = body if isinstance(body, bytes) else body.encode("utf-8")
    signed = f"{ts}.".encode("utf-8") + body_bytes
    v1 = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={v1}"


# ---------------------------------------------------------------------------
# get_payment_provider() factory
# ---------------------------------------------------------------------------


def test_get_payment_provider_default_is_manual():
    """Without any env override get_payment_provider() returns ManualProvider."""
    from omilo.billing.provider import ManualProvider, get_payment_provider

    provider = get_payment_provider()
    assert isinstance(provider, ManualProvider)


def test_get_payment_provider_doit_with_key(monkeypatch):
    """OMILO_PAYMENT_PROVIDER=doit + DOIT_API_KEY + DOIT_SIGNING_SECRET → DoitProvider."""
    from omilo import config as cfg_module

    # Clear the lru_cache so monkeypatched settings take effect
    cfg_module.get_settings.cache_clear()

    monkeypatch.setenv("OMILO_PAYMENT_PROVIDER", "doit")
    monkeypatch.setenv("DOIT_API_KEY", "pb_test_fake123")
    monkeypatch.setenv("DOIT_SIGNING_SECRET", "whsec_test_fake")

    # Re-build settings
    cfg_module.get_settings.cache_clear()

    from omilo.billing.doit_provider import DoitProvider
    from omilo.billing.provider import get_payment_provider

    provider = get_payment_provider()
    assert isinstance(provider, DoitProvider)

    # Cleanup
    cfg_module.get_settings.cache_clear()


def test_get_payment_provider_doit_missing_signing_secret_raises(monkeypatch):
    """provider=doit + api_key set + signing_secret unset → ProviderNotConfigured."""
    from omilo import config as cfg_module
    from omilo.billing.provider import ProviderNotConfigured, get_payment_provider

    cfg_module.get_settings.cache_clear()

    monkeypatch.setenv("OMILO_PAYMENT_PROVIDER", "doit")
    monkeypatch.setenv("DOIT_API_KEY", "pb_test_fake123")
    monkeypatch.delenv("DOIT_SIGNING_SECRET", raising=False)

    cfg_module.get_settings.cache_clear()

    with pytest.raises(ProviderNotConfigured, match="DOIT_SIGNING_SECRET"):
        get_payment_provider()

    cfg_module.get_settings.cache_clear()


def test_get_payment_provider_doit_missing_api_key_raises(monkeypatch):
    """provider=doit + api_key missing → ProviderNotConfigured."""
    from omilo import config as cfg_module
    from omilo.billing.provider import ProviderNotConfigured, get_payment_provider

    cfg_module.get_settings.cache_clear()

    monkeypatch.setenv("OMILO_PAYMENT_PROVIDER", "doit")
    monkeypatch.delenv("DOIT_API_KEY", raising=False)
    monkeypatch.setenv("DOIT_SIGNING_SECRET", "whsec_test_fake")

    cfg_module.get_settings.cache_clear()

    with pytest.raises(ProviderNotConfigured, match="DOIT_API_KEY"):
        get_payment_provider()

    cfg_module.get_settings.cache_clear()


def test_get_payment_provider_doit_key_set_but_flag_unset_returns_manual(monkeypatch):
    """DOIT_API_KEY present but OMILO_PAYMENT_PROVIDER != 'doit' → ManualProvider (not Doit)."""
    from omilo import config as cfg_module
    from omilo.billing.provider import ManualProvider, get_payment_provider

    cfg_module.get_settings.cache_clear()

    monkeypatch.setenv("OMILO_PAYMENT_PROVIDER", "manual")
    monkeypatch.setenv("DOIT_API_KEY", "pb_test_orphan_key")

    cfg_module.get_settings.cache_clear()

    provider = get_payment_provider()
    assert isinstance(provider, ManualProvider)

    cfg_module.get_settings.cache_clear()


# ---------------------------------------------------------------------------
# FakeDoitClient — create_payment / get_payment / mark_paid
# ---------------------------------------------------------------------------


def test_fake_create_payment_returns_deterministic_shape():
    from omilo.billing.doit_client import FakeDoitClient

    client = FakeDoitClient()
    result = client.create_payment(
        amount_idr=50000,
        reference="INV/1",
        rail="qris",
        idempotency_key="ikey-001",
    )
    assert result["id"] == "pay_fake_ikey-001"
    assert result["status"] == "pending"
    assert result["total_amount"] == 50000
    assert result["fee_amount"] == 0
    assert "hosted_url" in result
    assert "pay_fake_ikey-001" in result["hosted_url"]
    assert result["expires_at"] == "2026-12-31T00:00:00.000Z"


def test_fake_create_payment_falls_back_to_reference():
    from omilo.billing.doit_client import FakeDoitClient

    client = FakeDoitClient()
    result = client.create_payment(amount_idr=10000, reference="REF-42")
    assert result["id"] == "pay_fake_REF-42"


def test_fake_get_payment_returns_stored():
    from omilo.billing.doit_client import FakeDoitClient

    client = FakeDoitClient()
    client.create_payment(amount_idr=20000, reference="REF-1", idempotency_key="k1")
    fetched = client.get_payment("pay_fake_k1")
    assert fetched["id"] == "pay_fake_k1"
    assert fetched["status"] == "pending"


def test_fake_mark_paid_flips_status():
    from omilo.billing.doit_client import FakeDoitClient

    client = FakeDoitClient()
    client.create_payment(amount_idr=5000, reference="REF-2", idempotency_key="k2")
    client.mark_paid("pay_fake_k2")
    fetched = client.get_payment("pay_fake_k2")
    assert fetched["status"] == "paid"


def test_fake_refund_flips_status():
    from omilo.billing.doit_client import FakeDoitClient

    client = FakeDoitClient()
    client.create_payment(amount_idr=5000, reference="REF-3", idempotency_key="k3")
    result = client.refund("pay_fake_k3")
    assert result["status"] == "refunded"
    assert client.get_payment("pay_fake_k3")["status"] == "refunded"


def test_fake_create_plan_and_subscription_deterministic():
    from omilo.billing.doit_client import FakeDoitClient

    client = FakeDoitClient()
    plan = client.create_plan("Pro Monthly", 150000, {"unit": "month", "count": 1})
    assert plan["id"].startswith("plan_fake_")

    sub = client.create_subscription(plan["id"], {"name": "ACME", "phone": "08123"})
    assert sub["id"].startswith("sub_fake_")
    assert sub["status"] == "active"


# ---------------------------------------------------------------------------
# DoitProvider.charge_one_off
# ---------------------------------------------------------------------------


def _make_fake_company():
    """Return a lightweight company-like dict (provider only uses .id)."""
    from unittest.mock import MagicMock
    company = MagicMock()
    company.id = "cmp_test"
    company.name = "Test Co"
    return company


def test_charge_one_off_returns_expected_shape():
    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider

    client = FakeDoitClient()
    provider = DoitProvider(client, "whsec_test")
    company = _make_fake_company()

    result = provider.charge_one_off(company, 50000, "INV/1")
    assert result["provider_payment_id"].startswith("pay_fake_")
    assert result["status"] == "pending"
    assert result["hosted_url"]
    assert result["amount_idr"] == 50000
    assert "raw" in result


# ---------------------------------------------------------------------------
# DoitProvider — all 7 protocol methods smoke-test
# ---------------------------------------------------------------------------


def test_ensure_customer_returns_ok():
    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider

    provider = DoitProvider(FakeDoitClient(), "whsec_test")
    company = _make_fake_company()
    result = provider.ensure_customer(company)
    assert result == {"status": "ok"}


def test_start_subscription_returns_provider_ref():
    from unittest.mock import MagicMock

    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider

    provider = DoitProvider(FakeDoitClient(), "whsec_test")
    company = _make_fake_company()
    plan = MagicMock()
    plan.name = "Pro"
    plan.price_idr = 150000

    result = provider.start_subscription(company, plan)
    assert "provider_ref" in result
    assert result["status"] == "active"


def test_change_subscription_returns_provider_ref():
    from unittest.mock import MagicMock

    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider

    provider = DoitProvider(FakeDoitClient(), "whsec_test")
    company = _make_fake_company()
    plan = MagicMock()
    plan.name = "Enterprise"
    plan.price_idr = 500000

    result = provider.change_subscription(company, plan)
    assert "provider_ref" in result


def test_cancel_subscription_best_effort():
    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider

    provider = DoitProvider(FakeDoitClient(), "whsec_test")
    company = _make_fake_company()
    # Should not raise
    result = provider.cancel_subscription(company)
    # Returns a dict or None — just check it doesn't raise
    assert result is None or isinstance(result, dict)


def test_report_usage_is_none():
    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.doit_provider import DoitProvider

    provider = DoitProvider(FakeDoitClient(), "whsec_test")
    company = _make_fake_company()
    result = provider.report_usage(company, 100)
    assert result is None


# ---------------------------------------------------------------------------
# verify_doit_signature
# ---------------------------------------------------------------------------

SECRET = "whsec_test_abc"
BODY = '{"type":"payment.paid","id":"pay_123"}'


def test_verify_valid_signature():
    from omilo.billing.doit_provider import verify_doit_signature

    t = int(time.time())
    header = _make_sig_header(SECRET, BODY, t)
    assert verify_doit_signature(SECRET, header, BODY, now=t) is True


def test_verify_tampered_body_returns_false():
    from omilo.billing.doit_provider import verify_doit_signature

    t = int(time.time())
    header = _make_sig_header(SECRET, BODY, t)
    assert verify_doit_signature(SECRET, header, BODY + "X", now=t) is False


def test_verify_wrong_v1_returns_false():
    from omilo.billing.doit_provider import verify_doit_signature

    t = int(time.time())
    bad_header = f"t={t},v1=deadbeefdeadbeef"
    assert verify_doit_signature(SECRET, bad_header, BODY, now=t) is False


def test_verify_stale_timestamp_returns_false():
    from omilo.billing.doit_provider import verify_doit_signature

    stale_t = int(time.time()) - 3600
    header = _make_sig_header(SECRET, BODY, stale_t)
    now = int(time.time())
    assert verify_doit_signature(SECRET, header, BODY, tolerance_s=300, now=now) is False


def test_verify_malformed_header_returns_false():
    from omilo.billing.doit_provider import verify_doit_signature

    assert verify_doit_signature(SECRET, "not-a-valid-header", BODY) is False
    assert verify_doit_signature(SECRET, "", BODY) is False
    assert verify_doit_signature(SECRET, "t=abc,v1=xyz", BODY) is False


def test_verify_with_bytes_body():
    from omilo.billing.doit_provider import verify_doit_signature

    t = int(time.time())
    header = _make_sig_header(SECRET, BODY, t)
    # Should work with bytes body too
    assert verify_doit_signature(SECRET, header, BODY.encode(), now=t) is True


def test_verify_emoji_body_raw_bytes_round_trip():
    """HMAC is computed over the EXACT raw bytes, not a str round-trip.

    A body with an emoji (multi-byte UTF-8 sequence) must verify correctly
    when the header is built from the same raw bytes — not from a decoded string.
    This test would fail if the impl did a decode→re-encode (e.g. with latin-1 or
    errors="replace") instead of signing over the original byte sequence.
    """
    from omilo.billing.doit_provider import verify_doit_signature

    emoji_body = '{"msg": "paid \U0001f389", "amount": 50000}'.encode("utf-8")
    t = int(time.time())
    # Build header from raw bytes (canonical Doit approach)
    header = _make_sig_header(SECRET, emoji_body, t)
    # verify_doit_signature must accept raw bytes directly
    assert verify_doit_signature(SECRET, header, emoji_body, now=t) is True


def test_verify_hmac_header_built_from_str_matches_bytes():
    """str body and bytes body with identical UTF-8 content produce the same HMAC."""
    from omilo.billing.doit_provider import verify_doit_signature

    ascii_body_str = BODY
    ascii_body_bytes = BODY.encode("utf-8")
    t = int(time.time())

    header_from_bytes = _make_sig_header(SECRET, ascii_body_bytes, t)
    header_from_str = _make_sig_header(SECRET, ascii_body_str, t)
    # Both headers must be identical for pure-ASCII content
    assert header_from_bytes == header_from_str
    # And both must verify against bytes
    assert verify_doit_signature(SECRET, header_from_bytes, ascii_body_bytes, now=t) is True


# ---------------------------------------------------------------------------
# parse_webhook → BillingEvent
# ---------------------------------------------------------------------------


def _make_payment_paid_event(payment_id: str = "pay_123", reference: str = "INV/1") -> dict:
    return {
        "type": "payment.paid",
        "id": "evt_001",
        "payment": {
            "id": payment_id,
            "status": "paid",
            "reference": reference,
            "amount": 50000,
            "metadata": {},
        },
    }


def test_parse_webhook_valid_returns_billing_event():
    from omilo.billing.doit_provider import DoitProvider
    from omilo.billing.doit_client import FakeDoitClient
    from omilo.billing.provider import BillingEvent

    provider = DoitProvider(FakeDoitClient(), SECRET)
    event_body = json.dumps(_make_payment_paid_event())
    t = int(time.time())
    sig_header = _make_sig_header(SECRET, event_body, t)

    headers = {"paybridge-signature": sig_header}
    events = provider.parse_webhook(headers, event_body.encode(), _now=t)

    assert len(events) == 1
    ev = events[0]
    assert isinstance(ev, BillingEvent)
    assert ev.type == "payment.paid"
    assert ev.data["id"] == "pay_123"
    assert ev.data["reference"] == "INV/1"
    assert ev.company_id is None  # T3 resolves from DoitPayment


def test_parse_webhook_bad_signature_raises():
    from omilo.billing.doit_provider import DoitProvider, WebhookVerificationError
    from omilo.billing.doit_client import FakeDoitClient

    provider = DoitProvider(FakeDoitClient(), SECRET)
    event_body = json.dumps(_make_payment_paid_event())
    headers = {"paybridge-signature": "t=999,v1=badhex"}

    with pytest.raises(WebhookVerificationError):
        provider.parse_webhook(headers, event_body.encode())


def test_parse_webhook_missing_signature_raises():
    from omilo.billing.doit_provider import DoitProvider, WebhookVerificationError
    from omilo.billing.doit_client import FakeDoitClient

    provider = DoitProvider(FakeDoitClient(), SECRET)
    event_body = json.dumps(_make_payment_paid_event())
    headers = {}  # no signature header

    with pytest.raises(WebhookVerificationError):
        provider.parse_webhook(headers, event_body.encode())


def test_parse_webhook_case_insensitive_header():
    """PayBridge-Signature header lookup is case-insensitive."""
    from omilo.billing.doit_provider import DoitProvider
    from omilo.billing.doit_client import FakeDoitClient

    provider = DoitProvider(FakeDoitClient(), SECRET)
    event_body = json.dumps(_make_payment_paid_event())
    t = int(time.time())
    sig_header = _make_sig_header(SECRET, event_body, t)

    # Try different casings
    for key in ("PayBridge-Signature", "PAYBRIDGE-SIGNATURE", "paybridge-signature"):
        headers = {key: sig_header}
        events = provider.parse_webhook(headers, event_body.encode(), _now=t)
        assert len(events) == 1, f"Failed for header key: {key}"
