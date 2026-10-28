"""omilo.telemetry.posthog — PostHog-backed Telemetry implementation.

PostHogTelemetry wraps the posthog-python SDK (server-side, batched/async).
All emission is best-effort:
- Exceptions from the SDK are caught + logged; they never propagate to callers.
- The posthog SDK batches captures and flushes in a background thread — no
  inline HTTP on the hot path.

Privacy guarantees:
- _filter_props() (from omilo.telemetry) strips every non-allowlisted key
  before any data reaches the SDK.  Content, PII, free-text, and raw numeric
  values can NEVER appear in the event payload.
- Identity = company_id (PostHog distinct_id + group) or user_id or "anon".
  No local User row data, email, or name is sent.
"""
from __future__ import annotations

import logging
from typing import Any

from omilo.telemetry import _filter_props

logger = logging.getLogger(__name__)


class PostHogTelemetry:
    """PostHog server-side analytics via the posthog-python SDK.

    Args:
        api_key:   PostHog project API key (server-side key).
        host:      PostHog ingest host (default: https://us.i.posthog.com).
        _posthog:  Optional injected client for testing.  When None (default),
                   the real posthog module is imported and configured lazily.
    """

    def __init__(
        self,
        api_key: str,
        host: str = "https://us.i.posthog.com",
        *,
        _posthog: Any = None,
    ) -> None:
        self._api_key = api_key
        self._host = host

        if _posthog is not None:
            # Injected fake/mock client (for tests).
            self._client = _posthog
        else:
            # Configure the real posthog module as a client singleton.
            import posthog as _ph

            _ph.api_key = api_key
            _ph.host = host
            # Disable the SDK's own exception handler so we can catch + log.
            _ph.on_error = None
            self._client = _ph

    def capture(
        self,
        event: str,
        *,
        company_id: str | None = None,
        user_id: str | None = None,
        props: dict | None = None,
    ) -> None:
        """Emit an analytics event to PostHog.  Best-effort — never raises.

        Steps:
        1. Apply the per-event property ALLOWLIST (non-allowlisted keys dropped).
        2. Determine distinct_id = company_id or user_id or "anon".
        3. Call posthog.capture() with optional group identity.
        4. Swallow + log any exception (PostHog outage must never break app).
        """
        try:
            filtered = _filter_props(event, props)
            distinct_id = company_id or user_id or "anon"

            capture_kwargs: dict[str, Any] = {
                "distinct_id": distinct_id,
                "event": event,
                "properties": filtered,
            }

            if company_id:
                capture_kwargs["groups"] = {"company": company_id}

            self._client.capture(**capture_kwargs)

        except Exception as exc:  # noqa: BLE001
            # Best-effort: swallow all exceptions — PostHog failures are never fatal.
            logger.debug(
                "telemetry capture failed for event=%r: %s",
                event,
                exc,
            )
