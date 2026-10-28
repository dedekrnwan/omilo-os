"""TDD — P7 Task 3: Telemetry config endpoint + opt-out persistence.

Tests:
T1. GET /v1/telemetry-config — unconfigured (no POSTHOG_API_KEY) →
    {enabled:false, key:null, host:null, mode:..., opted_out:false}.
    Key NEVER leaked when disabled.

T2. GET /v1/telemetry-config — configured + mode hybrid/cloud →
    {enabled:true, key:<the key>, host:<host>, opted_out:false}.

T3. GET /v1/telemetry-config — configured + mode=local (no TELEMETRY_ENABLED) →
    {enabled:false, key:null, host:null} (local off by default; key not leaked).

T4. POST /v1/telemetry-config {opted_out:true} → persists; subsequent GET →
    {enabled:false, key:null} even when configured. POST {opted_out:false} → re-enables.

T5. Company-scoped: opt-out for company A does not affect company B.

RED → implement → GREEN.
"""
from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
import pytest_asyncio

from tests.utils import run_alembic


# ---------------------------------------------------------------------------
# Schema guard — migration must be at head
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, name="TC Tester", password="testP4ss!"):
    """Sign up a user and return (token, company_id)."""
    email = f"tc_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    token = body["session"]["access"]
    me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]
    return token, company_id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _fake_settings(
    *,
    posthog_api_key: str = "",
    posthog_host: str = "https://us.i.posthog.com",
    omilo_mode: str = "cloud",
    telemetry_enabled=None,
):
    """Build a Settings-like object for patching get_settings()."""
    from omilo.config import Settings

    return Settings(
        posthog_api_key=posthog_api_key,
        posthog_host=posthog_host,
        omilo_mode=omilo_mode,
        telemetry_enabled=telemetry_enabled,
    )


# ---------------------------------------------------------------------------
# T1: Unconfigured (no POSTHOG_API_KEY) → enabled:false, key:null
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_t1_unconfigured_returns_disabled(async_client):
    """No POSTHOG_API_KEY → enabled=false, key=null (key NEVER leaked)."""
    token, _ = await _sign_up(async_client, name="TC T1 User")

    with patch("omilo.api.telemetry_config.get_settings", return_value=_fake_settings()):
        resp = await async_client.get(
            "/v1/telemetry-config", headers=_auth(token)
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["enabled"] is False
    assert body["key"] is None, "key must be null when disabled (never leak)"
    assert body["host"] is None, "host must be null when disabled"
    assert "mode" in body
    assert body["opted_out"] is False


# ---------------------------------------------------------------------------
# T2: Configured + mode hybrid/cloud → enabled:true, key returned
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_t2_configured_hybrid_returns_enabled(async_client):
    """POSTHOG_API_KEY set + mode=cloud → enabled=true, key+host returned."""
    token, _ = await _sign_up(async_client, name="TC T2 User")

    settings = _fake_settings(
        posthog_api_key="phc_testkey123",
        posthog_host="https://us.i.posthog.com",
        omilo_mode="cloud",
    )

    with patch("omilo.api.telemetry_config.get_settings", return_value=settings):
        resp = await async_client.get(
            "/v1/telemetry-config", headers=_auth(token)
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["enabled"] is True
    assert body["key"] == "phc_testkey123", "publishable key must be returned when enabled"
    assert body["host"] == "https://us.i.posthog.com"
    assert body["mode"] == "cloud"
    assert body["opted_out"] is False


@pytest.mark.asyncio
async def test_t2b_configured_hybrid_mode_also_enabled(async_client):
    """POSTHOG_API_KEY set + mode=hybrid → enabled=true."""
    token, _ = await _sign_up(async_client, name="TC T2b User")

    settings = _fake_settings(
        posthog_api_key="phc_hybridkey",
        omilo_mode="hybrid",
    )

    with patch("omilo.api.telemetry_config.get_settings", return_value=settings):
        resp = await async_client.get(
            "/v1/telemetry-config", headers=_auth(token)
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["enabled"] is True
    assert body["key"] == "phc_hybridkey"
    assert body["mode"] == "hybrid"


# ---------------------------------------------------------------------------
# T3: Configured + mode=local (no TELEMETRY_ENABLED) → enabled:false, key:null
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_t3_local_mode_returns_disabled(async_client):
    """POSTHOG_API_KEY set + mode=local (no opt-in) → enabled=false, key=null."""
    token, _ = await _sign_up(async_client, name="TC T3 User")

    settings = _fake_settings(
        posthog_api_key="phc_localkey",
        omilo_mode="local",
        telemetry_enabled=None,  # no explicit opt-in
    )

    with patch("omilo.api.telemetry_config.get_settings", return_value=settings):
        resp = await async_client.get(
            "/v1/telemetry-config", headers=_auth(token)
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["enabled"] is False, "local mode without opt-in must be disabled"
    assert body["key"] is None, "key must NOT be returned when disabled (local mode)"
    assert body["host"] is None
    assert body["mode"] == "local"


@pytest.mark.asyncio
async def test_t3b_local_mode_opted_in_enabled(async_client):
    """POSTHOG_API_KEY set + mode=local + TELEMETRY_ENABLED=True → enabled=true."""
    token, _ = await _sign_up(async_client, name="TC T3b User")

    settings = _fake_settings(
        posthog_api_key="phc_localoptin",
        omilo_mode="local",
        telemetry_enabled=True,  # explicit opt-in
    )

    with patch("omilo.api.telemetry_config.get_settings", return_value=settings):
        resp = await async_client.get(
            "/v1/telemetry-config", headers=_auth(token)
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["enabled"] is True, "local + TELEMETRY_ENABLED=True should be enabled"
    assert body["key"] == "phc_localoptin"


# ---------------------------------------------------------------------------
# T4: POST {opted_out} → persists; GET reflects; re-enable works
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_t4_opt_out_persists_and_disables(async_client):
    """POST {opted_out:true} persists; GET shows enabled:false + key:null."""
    token, _ = await _sign_up(async_client, name="TC T4 User")

    settings = _fake_settings(
        posthog_api_key="phc_t4key",
        omilo_mode="cloud",
    )

    with patch("omilo.api.telemetry_config.get_settings", return_value=settings):
        # Initial GET — enabled
        resp = await async_client.get(
            "/v1/telemetry-config", headers=_auth(token)
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["enabled"] is True

        # POST opt-out
        post_resp = await async_client.post(
            "/v1/telemetry-config",
            json={"opted_out": True},
            headers=_auth(token),
        )
        assert post_resp.status_code == 200, post_resp.text
        post_body = post_resp.json()
        assert post_body["opted_out"] is True
        assert post_body["enabled"] is False, "opted-out must disable even when configured"
        assert post_body["key"] is None, "key must be null when opted-out"

        # Subsequent GET — reflects persisted opt-out
        get_resp = await async_client.get(
            "/v1/telemetry-config", headers=_auth(token)
        )
        assert get_resp.status_code == 200, get_resp.text
        get_body = get_resp.json()
        assert get_body["opted_out"] is True
        assert get_body["enabled"] is False
        assert get_body["key"] is None


@pytest.mark.asyncio
async def test_t4b_opt_back_in_re_enables(async_client):
    """POST {opted_out:false} after opt-out → re-enables (enabled=true, key returned)."""
    token, _ = await _sign_up(async_client, name="TC T4b User")

    settings = _fake_settings(
        posthog_api_key="phc_t4bkey",
        omilo_mode="cloud",
    )

    with patch("omilo.api.telemetry_config.get_settings", return_value=settings):
        # First opt out
        await async_client.post(
            "/v1/telemetry-config",
            json={"opted_out": True},
            headers=_auth(token),
        )

        # Then opt back in
        post_resp = await async_client.post(
            "/v1/telemetry-config",
            json={"opted_out": False},
            headers=_auth(token),
        )
        assert post_resp.status_code == 200, post_resp.text
        body = post_resp.json()
        assert body["opted_out"] is False
        assert body["enabled"] is True
        assert body["key"] == "phc_t4bkey", "key must be returned after opt back in"


# ---------------------------------------------------------------------------
# T5: Company-scoped — opt-out for A does not affect B
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_t5_company_scoped_opt_out(async_client):
    """Opt-out for company A does not affect company B's telemetry config."""
    token_a, _ = await _sign_up(async_client, name="TC T5 UserA")
    token_b, _ = await _sign_up(async_client, name="TC T5 UserB")

    settings = _fake_settings(
        posthog_api_key="phc_t5key",
        omilo_mode="cloud",
    )

    with patch("omilo.api.telemetry_config.get_settings", return_value=settings):
        # Company A opts out
        resp_a = await async_client.post(
            "/v1/telemetry-config",
            json={"opted_out": True},
            headers=_auth(token_a),
        )
        assert resp_a.status_code == 200, resp_a.text
        assert resp_a.json()["opted_out"] is True

        # Company B should still be enabled
        resp_b = await async_client.get(
            "/v1/telemetry-config", headers=_auth(token_b)
        )
        assert resp_b.status_code == 200, resp_b.text
        body_b = resp_b.json()
        assert body_b["opted_out"] is False, "Company B's opt-out must be independent"
        assert body_b["enabled"] is True, "Company B must still be enabled"
        assert body_b["key"] == "phc_t5key"

        # Company A still opted out
        resp_a_get = await async_client.get(
            "/v1/telemetry-config", headers=_auth(token_a)
        )
        assert resp_a_get.json()["opted_out"] is True
        assert resp_a_get.json()["enabled"] is False


# ---------------------------------------------------------------------------
# T_KS: Kill-switch (TELEMETRY_ENABLED=False) — backend + endpoint must agree
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_tks_kill_switch_endpoint_disabled(async_client):
    """POSTHOG_API_KEY set + mode=hybrid + TELEMETRY_ENABLED=False →
    GET returns enabled:false + key:null (kill-switch honored by endpoint)."""
    token, _ = await _sign_up(async_client, name="TC KS User")

    settings = _fake_settings(
        posthog_api_key="phc_kskey",
        omilo_mode="hybrid",
        telemetry_enabled=False,  # explicit kill-switch
    )

    with patch("omilo.api.telemetry_config.get_settings", return_value=settings):
        resp = await async_client.get(
            "/v1/telemetry-config", headers=_auth(token)
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["enabled"] is False, "kill-switch must disable endpoint even with key+hybrid"
    assert body["key"] is None, "key must be null when kill-switch active"
    assert body["host"] is None, "host must be null when kill-switch active"


def test_tks_kill_switch_factory_noop():
    """POSTHOG_API_KEY set + mode=hybrid + TELEMETRY_ENABLED=False →
    get_telemetry() returns NoopTelemetry — factory and endpoint agree."""
    from omilo.telemetry.factory import get_telemetry, telemetry_is_active
    from omilo.telemetry.noop import NoopTelemetry

    settings = _fake_settings(
        posthog_api_key="phc_kskey",
        omilo_mode="hybrid",
        telemetry_enabled=False,
    )

    # Shared predicate must return False.
    assert telemetry_is_active(settings) is False, (
        "telemetry_is_active must be False when TELEMETRY_ENABLED=False"
    )

    # Factory must return Noop.
    get_telemetry.cache_clear()
    with patch("omilo.telemetry.factory.get_settings", return_value=settings):
        instance = get_telemetry()
    get_telemetry.cache_clear()

    assert isinstance(instance, NoopTelemetry), (
        f"Expected NoopTelemetry, got {type(instance).__name__}"
    )


# ---------------------------------------------------------------------------
# T6: Unauthenticated → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_t6_unauthenticated_get(async_client):
    """GET /v1/telemetry-config without token → 401."""
    resp = await async_client.get("/v1/telemetry-config")
    assert resp.status_code == 401, resp.text


@pytest.mark.asyncio
async def test_t6b_unauthenticated_post(async_client):
    """POST /v1/telemetry-config without token → 401."""
    resp = await async_client.post(
        "/v1/telemetry-config", json={"opted_out": True}
    )
    assert resp.status_code == 401, resp.text


# ---------------------------------------------------------------------------
# T7: Response shape — all required fields always present
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_t7_response_shape_complete(async_client):
    """GET response always includes {enabled, key, host, mode, opted_out}."""
    token, _ = await _sign_up(async_client, name="TC T7 User")

    with patch("omilo.api.telemetry_config.get_settings", return_value=_fake_settings()):
        resp = await async_client.get(
            "/v1/telemetry-config", headers=_auth(token)
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()

    for field in ("enabled", "key", "host", "mode", "opted_out"):
        assert field in body, f"Field '{field}' missing from response"
