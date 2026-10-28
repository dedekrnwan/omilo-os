"""omilo.telemetry.factory — get_telemetry() mode+config-aware singleton factory.

Selection logic:
1. If TELEMETRY_ENABLED is explicitly False → NoopTelemetry (forced off).
2. If POSTHOG_API_KEY is unset/empty → NoopTelemetry (unconfigured = off).
3. If OMILO_MODE=local AND TELEMETRY_ENABLED is NOT True → NoopTelemetry
   (local privacy default: nothing leaves the process without explicit opt-in).
4. Otherwise → PostHogTelemetry(key, host).

The singleton is cached via functools.lru_cache.  Tests must call
get_telemetry.cache_clear() before each test that patches get_settings().

Design mirrors omilo.control.factory (get_control_plane pattern).
"""
from __future__ import annotations

from functools import lru_cache

from omilo.config import get_settings
from omilo.control.factory import _normalize_mode


@lru_cache(maxsize=1)
def get_telemetry():
    """Return the appropriate Telemetry implementation for the current config.

    Returns:
        NoopTelemetry when:
        - TELEMETRY_ENABLED is explicitly False.
        - POSTHOG_API_KEY is unset or empty.
        - OMILO_MODE=local AND TELEMETRY_ENABLED is not True.

        PostHogTelemetry(key, host) otherwise.
    """
    from omilo.telemetry.noop import NoopTelemetry
    from omilo.telemetry.posthog import PostHogTelemetry

    settings = get_settings()

    # 1. Explicitly disabled → Noop.
    telemetry_enabled = getattr(settings, "telemetry_enabled", None)
    if telemetry_enabled is False:
        return NoopTelemetry()

    # 2. No API key → Noop (unconfigured = off everywhere).
    api_key = getattr(settings, "posthog_api_key", "") or ""
    if not api_key.strip():
        return NoopTelemetry()

    # 3. Local mode without explicit opt-in → Noop (privacy default).
    raw_mode = getattr(settings, "omilo_mode", "cloud") or "cloud"
    mode = _normalize_mode(raw_mode)
    if mode == "local" and telemetry_enabled is not True:
        return NoopTelemetry()

    # 4. Configured + not local (or local with opt-in) → PostHog.
    host = getattr(settings, "posthog_host", "https://us.i.posthog.com") or "https://us.i.posthog.com"
    return PostHogTelemetry(api_key=api_key, host=host)
