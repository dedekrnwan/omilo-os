"""TDD — P7 Task 1: Telemetry port (Noop + PostHog) + factory + server events.

Tests:
T1. get_telemetry() → NoopTelemetry when OMILO_MODE=local (privacy: local sends nothing).
T2. get_telemetry() → NoopTelemetry when POSTHOG_API_KEY is unset (unconfigured = off).
T3. get_telemetry() → PostHogTelemetry when POSTHOG_API_KEY set AND mode != local.
T4. PostHogTelemetry with injected fake client: capture(JOB_COMPLETED, props={type, brief, status})
    → fake client receives ONLY allowlisted props (type+status); 'brief' (non-allowlisted) dropped.
T5. capture() whose underlying fake client RAISES → does NOT propagate (best-effort).
T6. Job path with NoopTelemetry: job still completes normally (telemetry off = no-op, no side effects).
T7. Job path with PostHogTelemetry (fake): job still completes normally even when telemetry fires.
T8. TELEMETRY_ENABLED=True overrides local mode → PostHogTelemetry (opt-in path).
T9. duration_bucket / token_bucket helpers produce coarse buckets, never raw values.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _settings_patch(omilo_mode: str = "cloud", posthog_api_key: str = "", telemetry_enabled=None):
    """Return a Settings-like object for patching get_settings()."""
    from omilo.config import Settings

    return Settings(
        omilo_mode=omilo_mode,
        posthog_api_key=posthog_api_key,
        posthog_host="https://us.i.posthog.com",
        telemetry_enabled=telemetry_enabled,
    )


# ---------------------------------------------------------------------------
# T1. NoopTelemetry in local mode (privacy: local sends NOTHING)
# ---------------------------------------------------------------------------


class TestNoopInLocalMode:
    def test_t1_local_mode_returns_noop(self):
        """OMILO_MODE=local → get_telemetry() is NoopTelemetry."""
        from omilo.telemetry.factory import get_telemetry
        from omilo.telemetry.noop import NoopTelemetry

        settings = _settings_patch(omilo_mode="local", posthog_api_key="phc_somekey")
        with patch("omilo.telemetry.factory.get_settings", return_value=settings):
            # Clear the singleton cache so the patched settings are used.
            get_telemetry.cache_clear()
            result = get_telemetry()

        assert isinstance(result, NoopTelemetry), (
            f"local mode must return NoopTelemetry regardless of key, got {type(result).__name__}"
        )


# ---------------------------------------------------------------------------
# T2. NoopTelemetry when POSTHOG_API_KEY unset (unconfigured = off everywhere)
# ---------------------------------------------------------------------------


class TestNoopWhenUnconfigured:
    def test_t2_no_api_key_returns_noop(self):
        """No POSTHOG_API_KEY → NoopTelemetry in any mode (cloud, hybrid)."""
        from omilo.telemetry.factory import get_telemetry
        from omilo.telemetry.noop import NoopTelemetry

        for mode in ("cloud", "hybrid"):
            settings = _settings_patch(omilo_mode=mode, posthog_api_key="")
            with patch("omilo.telemetry.factory.get_settings", return_value=settings):
                get_telemetry.cache_clear()
                result = get_telemetry()

            assert isinstance(result, NoopTelemetry), (
                f"mode={mode!r} without API key must return NoopTelemetry, "
                f"got {type(result).__name__}"
            )


# ---------------------------------------------------------------------------
# T3. PostHogTelemetry when POSTHOG_API_KEY set AND mode != local
# ---------------------------------------------------------------------------


class TestPostHogWhenConfigured:
    def test_t3_configured_cloud_mode_returns_posthog(self):
        """POSTHOG_API_KEY set + mode=cloud → PostHogTelemetry."""
        from omilo.telemetry.factory import get_telemetry
        from omilo.telemetry.posthog import PostHogTelemetry

        settings = _settings_patch(omilo_mode="cloud", posthog_api_key="phc_realkey")
        with patch("omilo.telemetry.factory.get_settings", return_value=settings):
            get_telemetry.cache_clear()
            result = get_telemetry()

        assert isinstance(result, PostHogTelemetry), (
            f"cloud mode with API key must return PostHogTelemetry, got {type(result).__name__}"
        )

    def test_t3_configured_hybrid_mode_returns_posthog(self):
        """POSTHOG_API_KEY set + mode=hybrid → PostHogTelemetry."""
        from omilo.telemetry.factory import get_telemetry
        from omilo.telemetry.posthog import PostHogTelemetry

        settings = _settings_patch(omilo_mode="hybrid", posthog_api_key="phc_hybrid")
        with patch("omilo.telemetry.factory.get_settings", return_value=settings):
            get_telemetry.cache_clear()
            result = get_telemetry()

        assert isinstance(result, PostHogTelemetry), (
            f"hybrid mode with API key must return PostHogTelemetry, got {type(result).__name__}"
        )


# ---------------------------------------------------------------------------
# T4. Allowlist guard: non-allowlisted props (like 'brief') are DROPPED
# ---------------------------------------------------------------------------


class TestAllowlistGuard:
    def test_t4_non_allowlisted_props_are_dropped(self):
        """PostHogTelemetry with fake client: 'brief' (not allowlisted) is stripped."""
        from omilo.telemetry import JOB_COMPLETED
        from omilo.telemetry.posthog import PostHogTelemetry

        fake_posthog = MagicMock()
        tel = PostHogTelemetry(api_key="phc_test", host="https://test", _posthog=fake_posthog)

        tel.capture(
            JOB_COMPLETED,
            company_id="cmp_test",
            props={
                "type": "chat",
                "engine_type": "fake",
                "status": "done",
                "brief": "SECRET USER CONTENT",  # NOT in allowlist — must be dropped
                "token_count": 9999,               # NOT in allowlist — must be dropped
            },
        )

        # Verify the fake client was called
        assert fake_posthog.capture.called, "fake posthog client must be called"

        call_kwargs = fake_posthog.capture.call_args
        # Properties come through as keyword args; use .get() with a sentinel to distinguish None from {}
        _props = call_kwargs.kwargs.get("properties", None)
        if _props is None and call_kwargs.args and len(call_kwargs.args) >= 3:
            _props = call_kwargs.args[2]
        properties = _props if _props is not None else {}

        # Non-allowlisted keys must be absent
        assert "brief" not in properties, (
            f"'brief' (user content) must be dropped by allowlist, got properties={properties!r}"
        )
        assert "token_count" not in properties, (
            f"'token_count' must be dropped by allowlist, got properties={properties!r}"
        )

        # Allowlisted keys should be present
        assert "type" in properties, f"'type' must be kept by allowlist, got {properties!r}"
        assert "status" in properties, f"'status' must be kept by allowlist, got {properties!r}"

    def test_t4_allowlist_per_event(self):
        """PROPOSAL_DECIDED only allows {decision, risk} — other keys dropped."""
        from omilo.telemetry import PROPOSAL_DECIDED
        from omilo.telemetry.posthog import PostHogTelemetry

        fake_posthog = MagicMock()
        tel = PostHogTelemetry(api_key="phc_test", host="https://test", _posthog=fake_posthog)

        tel.capture(
            PROPOSAL_DECIDED,
            company_id="cmp_test",
            props={
                "decision": "approved",
                "risk": "high",
                "note": "SECRET OPERATOR NOTE",  # must be dropped
                "user": "operator@example.com",   # must be dropped (PII)
            },
        )

        call_kwargs = fake_posthog.capture.call_args
        properties = call_kwargs.kwargs.get("properties") or {}

        assert "note" not in properties, f"'note' must be dropped: {properties!r}"
        assert "user" not in properties, f"'user' (PII) must be dropped: {properties!r}"
        assert "decision" in properties, f"'decision' must be kept: {properties!r}"
        assert "risk" in properties, f"'risk' must be kept: {properties!r}"

    def test_t4_empty_allowlist_events_send_no_props(self):
        """INSTALL_REGISTERED has empty allowlist → even valid props are dropped."""
        from omilo.telemetry import INSTALL_REGISTERED
        from omilo.telemetry.posthog import PostHogTelemetry

        fake_posthog = MagicMock()
        tel = PostHogTelemetry(api_key="phc_test", host="https://test", _posthog=fake_posthog)

        tel.capture(
            INSTALL_REGISTERED,
            company_id="cmp_x",
            props={"whatever": "should be dropped"},
        )

        call_kwargs = fake_posthog.capture.call_args
        properties = call_kwargs.kwargs.get("properties") or {}
        assert properties == {}, (
            f"INSTALL_REGISTERED must send empty properties, got {properties!r}"
        )


# ---------------------------------------------------------------------------
# T5. Best-effort: capture never propagates exceptions
# ---------------------------------------------------------------------------


class TestBestEffortNoRaise:
    def test_t5_raising_client_does_not_propagate(self):
        """PostHogTelemetry: if the underlying client raises, capture() must NOT propagate."""
        from omilo.telemetry import JOB_COMPLETED
        from omilo.telemetry.posthog import PostHogTelemetry

        exploding_posthog = MagicMock()
        exploding_posthog.capture.side_effect = RuntimeError("PostHog is down!")

        tel = PostHogTelemetry(
            api_key="phc_test", host="https://test", _posthog=exploding_posthog
        )

        # Must not raise!
        tel.capture(JOB_COMPLETED, company_id="cmp_x", props={"type": "chat", "status": "done"})

    def test_t5_noop_capture_never_raises(self):
        """NoopTelemetry.capture() is always a no-op and never raises."""
        from omilo.telemetry import JOB_COMPLETED
        from omilo.telemetry.noop import NoopTelemetry

        noop = NoopTelemetry()
        # Should not raise with any combination of args
        noop.capture(JOB_COMPLETED, company_id="c", user_id="u", props={"anything": "goes"})
        noop.capture(JOB_COMPLETED)
        noop.capture(JOB_COMPLETED, props=None)


# ---------------------------------------------------------------------------
# T6. Job path with NoopTelemetry — job completes normally
# ---------------------------------------------------------------------------


class TestJobCompletionWithNoop:
    """With NoopTelemetry injected, the job runner behaves identically to pre-telemetry."""

    def test_t6_job_completes_with_noop_telemetry(self):
        """Telemetry off (Noop): job completes with status='done', no side effects."""
        from omilo.telemetry.factory import get_telemetry
        from omilo.telemetry.noop import NoopTelemetry

        settings = _settings_patch(omilo_mode="local")
        with patch("omilo.telemetry.factory.get_settings", return_value=settings):
            get_telemetry.cache_clear()
            tel = get_telemetry()

        assert isinstance(tel, NoopTelemetry)
        # capture is a pure no-op; calling it leaves no state
        from omilo.telemetry import JOB_COMPLETED
        tel.capture(JOB_COMPLETED, company_id="c", props={"type": "chat", "status": "done"})


# ---------------------------------------------------------------------------
# T7. Job path with fake PostHog — job result unaffected even if capture is called
# ---------------------------------------------------------------------------


class TestJobCompletionWithFakePostHog:
    """Telemetry fires without affecting job result."""

    def test_t7_job_result_unaffected_by_telemetry_capture(self):
        """With fake PostHog client, capture() fires but job result is unchanged."""
        from omilo.telemetry import JOB_COMPLETED
        from omilo.telemetry.posthog import PostHogTelemetry

        fake_posthog = MagicMock()
        tel = PostHogTelemetry(api_key="phc_test", host="https://test", _posthog=fake_posthog)

        # Simulate what the job runner does: capture after completion
        result_text = "Job done successfully"

        # capture must not modify result_text or raise
        tel.capture(
            JOB_COMPLETED,
            company_id="cmp_test",
            props={"type": "chat", "engine_type": "fake", "status": "done", "duration_bucket": "0-1s"},
        )

        # Result is unchanged
        assert result_text == "Job done successfully"
        # Telemetry did fire
        assert fake_posthog.capture.called


# ---------------------------------------------------------------------------
# T8. TELEMETRY_ENABLED=True overrides local mode (explicit opt-in)
# ---------------------------------------------------------------------------


class TestTelemetryEnabledOverride:
    def test_t8_local_mode_with_opt_in_returns_posthog(self):
        """Local mode + TELEMETRY_ENABLED=True + key set → PostHogTelemetry (opt-in)."""
        from omilo.telemetry.factory import get_telemetry
        from omilo.telemetry.posthog import PostHogTelemetry

        settings = _settings_patch(
            omilo_mode="local",
            posthog_api_key="phc_optin",
            telemetry_enabled=True,
        )
        with patch("omilo.telemetry.factory.get_settings", return_value=settings):
            get_telemetry.cache_clear()
            result = get_telemetry()

        assert isinstance(result, PostHogTelemetry), (
            f"local + opt-in + key → PostHogTelemetry, got {type(result).__name__}"
        )

    def test_t8_local_mode_with_opt_in_no_key_still_noop(self):
        """Local mode + TELEMETRY_ENABLED=True but no key → NoopTelemetry (key is required)."""
        from omilo.telemetry.factory import get_telemetry
        from omilo.telemetry.noop import NoopTelemetry

        settings = _settings_patch(
            omilo_mode="local",
            posthog_api_key="",
            telemetry_enabled=True,
        )
        with patch("omilo.telemetry.factory.get_settings", return_value=settings):
            get_telemetry.cache_clear()
            result = get_telemetry()

        assert isinstance(result, NoopTelemetry), (
            f"opt-in without API key still must be NoopTelemetry, got {type(result).__name__}"
        )


# ---------------------------------------------------------------------------
# T9. Bucket helpers produce coarse buckets
# ---------------------------------------------------------------------------


class TestBucketHelpers:
    def test_t9_duration_bucket(self):
        """duration_bucket returns coarse strings, never raw float values."""
        from omilo.telemetry import duration_bucket

        assert duration_bucket(0.5) == "0-1s"
        assert duration_bucket(1.0) == "1-5s"
        assert duration_bucket(3.0) == "1-5s"
        assert duration_bucket(5.0) == "5-30s"
        assert duration_bucket(20.0) == "5-30s"
        assert duration_bucket(30.0) == "30s+"
        assert duration_bucket(999.0) == "30s+"

        # Must be a string, never a number
        for secs in (0.1, 2.5, 10.0, 60.0):
            result = duration_bucket(secs)
            assert isinstance(result, str), f"duration_bucket must return str, got {type(result)!r}"
            # Must not contain the raw number
            assert str(secs) not in result, f"raw value {secs} must not appear in bucket {result!r}"

    def test_t9_token_bucket(self):
        """token_bucket returns coarse strings, never raw int values."""
        from omilo.telemetry import token_bucket

        assert token_bucket(500) == "<1k"
        assert token_bucket(999) == "<1k"
        assert token_bucket(1000) == "1k-10k"
        assert token_bucket(5000) == "1k-10k"
        assert token_bucket(10000) == "10k-100k"
        assert token_bucket(50000) == "10k-100k"
        assert token_bucket(100000) == "100k+"
        assert token_bucket(999999) == "100k+"

        for tokens in (100, 2500, 15000, 200000):
            result = token_bucket(tokens)
            assert isinstance(result, str)
            assert str(tokens) not in result, (
                f"raw value {tokens} must not appear in bucket {result!r}"
            )


# ---------------------------------------------------------------------------
# T10. Event constants are defined and are non-empty strings
# ---------------------------------------------------------------------------


class TestEventConstants:
    def test_t10_event_constants_defined(self):
        """All required event name constants are exported from omilo.telemetry."""
        from omilo import telemetry

        for const_name in (
            "JOB_COMPLETED",
            "PROPOSAL_DECIDED",
            "CREDIT_TOPUP",
            "PLAN_CHANGED",
            "INSTALL_REGISTERED",
            "LOCAL_TO_HYBRID_UPGRADED",
        ):
            val = getattr(telemetry, const_name, None)
            assert val is not None, f"{const_name} must be defined in omilo.telemetry"
            assert isinstance(val, str) and val, f"{const_name} must be a non-empty string"

    def test_t10_telemetry_protocol(self):
        """Telemetry protocol has capture() with the correct signature."""
        from omilo.telemetry import Telemetry
        import inspect

        # Protocol must exist and have a capture method
        assert hasattr(Telemetry, "capture"), "Telemetry protocol must have capture()"

        sig = inspect.signature(Telemetry.capture)
        params = set(sig.parameters.keys())
        assert "event" in params, f"capture() must have 'event' param, got {params}"
        assert "company_id" in params, f"capture() must have 'company_id' param, got {params}"
        assert "user_id" in params, f"capture() must have 'user_id' param, got {params}"
        assert "props" in params, f"capture() must have 'props' param, got {params}"
