"""omilo.telemetry.noop — No-op Telemetry implementation.

Used when:
- OMILO_MODE=local (air-gap privacy: nothing leaves the process by default).
- POSTHOG_API_KEY is unset or empty (unconfigured = off everywhere).
- TELEMETRY_ENABLED is explicitly False.

NoopTelemetry.capture() is a pure no-op — it accepts any arguments and
immediately returns without touching the network, allocating memory, or
logging anything.  It is safe to call on every hot path with zero cost.
"""
from __future__ import annotations


class NoopTelemetry:
    """No-op Telemetry implementation.  capture() is always a silent no-op."""

    def capture(
        self,
        event: str,
        *,
        company_id: str | None = None,
        user_id: str | None = None,
        props: dict | None = None,
    ) -> None:
        """Accept and discard all arguments — no-op, never raises."""
        return  # intentionally empty
