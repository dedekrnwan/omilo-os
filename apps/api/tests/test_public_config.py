"""TDD — P9 T1: Public pre-auth config endpoint.

Contract:
  GET /v1/public-config (NO auth required)
  → 200 JSON {"mode": "local"|"hybrid"|"cloud", "signupEnabled": bool}

Rules:
  - mode = _normalize_mode(settings.omilo_mode)
  - signupEnabled = mode != "cloud"

Tests:
  A. No Authorization header → 200 with keys `mode` and `signupEnabled`.
  B. OMILO_MODE=local → mode=="local" and signupEnabled is True.
  C. OMILO_MODE=cloud → mode=="cloud" and signupEnabled is False.
  D. OMILO_MODE=hybrid → mode=="hybrid" and signupEnabled is True.
  E. Response shape — both required fields always present.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest


# ---------------------------------------------------------------------------
# Helper — build a Settings-like object, mirroring test_telemetry_config.py
# ---------------------------------------------------------------------------


def _fake_settings(*, omilo_mode: str = "cloud"):
    from omilo.config import Settings

    return Settings(omilo_mode=omilo_mode)


# ---------------------------------------------------------------------------
# A. No Authorization header → 200 with `mode` and `signupEnabled`
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_no_auth_returns_200(async_client):
    """GET /v1/public-config without any token → 200 (no auth required)."""
    resp = await async_client.get("/v1/public-config")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "mode" in body
    assert "signupEnabled" in body


# ---------------------------------------------------------------------------
# B. OMILO_MODE=local → mode=="local", signupEnabled is True
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_b_local_mode(async_client):
    """OMILO_MODE=local → mode=='local' and signupEnabled is True."""
    settings = _fake_settings(omilo_mode="local")

    with patch("omilo.api.public_config.get_settings", return_value=settings):
        resp = await async_client.get("/v1/public-config")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mode"] == "local"
    assert body["signupEnabled"] is True, "local mode must have signupEnabled=True"


# ---------------------------------------------------------------------------
# C. OMILO_MODE=cloud → mode=="cloud", signupEnabled is False
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_c_cloud_mode(async_client):
    """OMILO_MODE=cloud → mode=='cloud' and signupEnabled is False."""
    settings = _fake_settings(omilo_mode="cloud")

    with patch("omilo.api.public_config.get_settings", return_value=settings):
        resp = await async_client.get("/v1/public-config")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mode"] == "cloud"
    assert body["signupEnabled"] is False, "cloud mode must have signupEnabled=False"


# ---------------------------------------------------------------------------
# D. OMILO_MODE=hybrid → mode=="hybrid", signupEnabled is True
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_d_hybrid_mode(async_client):
    """OMILO_MODE=hybrid → mode=='hybrid' and signupEnabled is True."""
    settings = _fake_settings(omilo_mode="hybrid")

    with patch("omilo.api.public_config.get_settings", return_value=settings):
        resp = await async_client.get("/v1/public-config")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mode"] == "hybrid"
    assert body["signupEnabled"] is True, "hybrid mode must have signupEnabled=True"


# ---------------------------------------------------------------------------
# E. Response shape — both required fields always present
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_e_response_shape_complete(async_client):
    """GET response always includes exactly {mode, signupEnabled} (no extra noise)."""
    resp = await async_client.get("/v1/public-config")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    for field in ("mode", "signupEnabled"):
        assert field in body, f"Field '{field}' missing from response"


# ---------------------------------------------------------------------------
# F. googleEnabled — P10 T1
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_f_google_enabled_false_when_unconfigured(async_client):
    """googleEnabled is False when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are absent."""
    from omilo.config import Settings

    settings = Settings()  # no google creds
    with patch("omilo.api.public_config.get_settings", return_value=settings):
        resp = await async_client.get("/v1/public-config")

    assert resp.status_code == 200, resp.text
    assert resp.json()["googleEnabled"] is False


@pytest.mark.asyncio
async def test_f2_google_enabled_true_when_both_creds_set(async_client):
    """googleEnabled is True when both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set."""
    from omilo.config import Settings

    settings = Settings(
        google_client_id="gid-xxx",
        google_client_secret="gsec-yyy",
    )
    with patch("omilo.api.public_config.get_settings", return_value=settings):
        resp = await async_client.get("/v1/public-config")

    assert resp.status_code == 200, resp.text
    assert resp.json()["googleEnabled"] is True


@pytest.mark.asyncio
async def test_f3_google_enabled_false_when_only_client_id_set(async_client):
    """googleEnabled is False when only GOOGLE_CLIENT_ID is set (secret missing)."""
    from omilo.config import Settings

    settings = Settings(google_client_id="gid-only")
    with patch("omilo.api.public_config.get_settings", return_value=settings):
        resp = await async_client.get("/v1/public-config")

    assert resp.status_code == 200, resp.text
    assert resp.json()["googleEnabled"] is False
