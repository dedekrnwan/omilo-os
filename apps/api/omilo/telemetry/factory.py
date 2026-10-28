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


def telemetry_is_active(settings) -> bool:
    """Return True iff the factory would return PostHogTelemetry for *settings*.

    Shared predicate used by both get_telemetry() and the config endpoint so
    backend and frontend always agree on whether telemetry is live.

    Does NOT consider the per-company opt-out flag — that layer sits above
    this helper (enabled = telemetry_is_active(settings) and not opted_out).

    Rules (mirrors get_telemetry() selection logic):
      1. TELEMETRY_ENABLED is explicitly False → False (kill-switch).
      2. POSTHOG_API_KEY unset/empty → False (unconfigured).
      3. OMILO_MODE=local AND TELEMETRY_ENABLED is not True → False (privacy default).
      4. Otherwise → True.
    """
    telemetry_enabled = getattr(settings, "telemetry_enabled", None)

    # 1. Explicit kill-switch.
    if telemetry_enabled is False:
        return False

    # 2. No API key → unconfigured.
    api_key = getattr(settings, "posthog_api_key", "") or ""
    if not api_key.strip():
        return False

    # 3. Local mode without explicit opt-in.
    raw_mode = getattr(settings, "omilo_mode", "cloud") or "cloud"
    mode = _normalize_mode(raw_mode)
    if mode == "local" and telemetry_enabled is not True:
        return False

    return True


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

    if not telemetry_is_active(settings):
        return NoopTelemetry()

    # Configured + not local (or local with opt-in) → PostHog.
    api_key = (getattr(settings, "posthog_api_key", "") or "").strip()
    host = getattr(settings, "posthog_host", "https://us.i.posthog.com") or "https://us.i.posthog.com"
    return PostHogTelemetry(api_key=api_key, host=host)
