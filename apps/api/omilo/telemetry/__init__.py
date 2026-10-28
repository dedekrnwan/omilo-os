"""omilo.telemetry — Product analytics port (Noop + PostHog).

Public API:
    Telemetry               Protocol (capture method).
    NoopTelemetry           No-op implementation (local mode / unconfigured).
    PostHogTelemetry        PostHog-backed implementation.
    get_telemetry()         Mode+config-aware singleton factory.

Event name constants:
    JOB_COMPLETED, PROPOSAL_DECIDED, CREDIT_TOPUP, PLAN_CHANGED,
    INSTALL_REGISTERED, LOCAL_TO_HYBRID_UPGRADED.

Bucket helpers (coarse bucketing — never emit raw values):
    duration_bucket(seconds: float) -> str
    token_bucket(tokens: int) -> str

Privacy design:
    - local mode → NoopTelemetry by default (nothing leaves the process).
    - unconfigured (no POSTHOG_API_KEY) → NoopTelemetry in all modes.
    - TELEMETRY_ENABLED=True → explicit opt-in (overrides local default).
    - Property ALLOWLIST: every event has a fixed allowed-property set.
      The _filter_props() guard KEEPS ONLY allowlisted keys — content, PII,
      free-text, and any non-enumerated field can NEVER reach PostHog.
    - capture() is ALWAYS best-effort: it never raises, never slows a request.
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Event name constants
# ---------------------------------------------------------------------------

JOB_COMPLETED = "job_completed"
PROPOSAL_DECIDED = "proposal_decided"
CREDIT_TOPUP = "credit_topup"
PLAN_CHANGED = "plan_changed"
INSTALL_REGISTERED = "install_registered"
LOCAL_TO_HYBRID_UPGRADED = "local_to_hybrid_upgraded"


# ---------------------------------------------------------------------------
# Per-event property ALLOWLIST
#
# ONLY keys in this set are ever sent to PostHog for the given event.
# Everything else is silently dropped in _filter_props().
# Allowed properties: counts, enums, coarse buckets — NEVER content/PII/free-text.
# ---------------------------------------------------------------------------

_EVENT_PROPS: dict[str, set[str]] = {
    # Counts/enums from the job record — no text, no IDs of user content.
    JOB_COMPLETED: {"type", "engine_type", "status", "duration_bucket", "token_bucket"},
    # Decision outcome only — no proposal title, body, or user note.
    PROPOSAL_DECIDED: {"decision", "risk"},
    # Pack name only (e.g. "small", "medium", "large") — no amounts, no payment ref.
    CREDIT_TOPUP: {"pack"},
    # Plan tier ID only — no price, no user email.
    PLAN_CHANGED: {"plan_id"},
    # Empty — just the signal that an install was registered.
    INSTALL_REGISTERED: set(),
    # Empty — just the signal that local→hybrid upgrade occurred.
    LOCAL_TO_HYBRID_UPGRADED: set(),
}


def _filter_props(event: str, props: dict | None) -> dict:
    """Keep ONLY allowlisted property keys for the given event.

    Any key not in _EVENT_PROPS[event] is silently dropped.  If the event is
    unknown (no entry in _EVENT_PROPS), ALL props are dropped (safe default).

    Args:
        event: The event name constant (e.g. JOB_COMPLETED).
        props: Raw properties dict from the call site.

    Returns:
        A new dict with only the allowed keys; always a dict (never None).
    """
    if not props:
        return {}
    allowed = _EVENT_PROPS.get(event, set())
    return {k: v for k, v in props.items() if k in allowed}


# ---------------------------------------------------------------------------
# Coarse bucket helpers — never emit raw numeric values
# ---------------------------------------------------------------------------

def duration_bucket(seconds: float) -> str:
    """Bucket a duration in seconds into a coarse label.

    Buckets: 0-1s | 1-5s | 5-30s | 30s+
    """
    if seconds < 1:
        return "0-1s"
    if seconds < 5:
        return "1-5s"
    if seconds < 30:
        return "5-30s"
    return "30s+"


def token_bucket(tokens: int) -> str:
    """Bucket a token count into a coarse label.

    Buckets: <1k | 1k-10k | 10k-100k | 100k+
    """
    if tokens < 1_000:
        return "<1k"
    if tokens < 10_000:
        return "1k-10k"
    if tokens < 100_000:
        return "10k-100k"
    return "100k+"


# ---------------------------------------------------------------------------
# Telemetry Protocol
# ---------------------------------------------------------------------------

@runtime_checkable
class Telemetry(Protocol):
    """Thin analytics port.

    Implementations must be:
    - Best-effort: capture() NEVER raises.
    - Non-blocking: emission is async / batched (no inline HTTP in hot paths).
    - Content-free: the allowlist guard ensures no PII/content reaches PostHog.
    """

    def capture(
        self,
        event: str,
        *,
        company_id: str | None = None,
        user_id: str | None = None,
        props: dict | None = None,
    ) -> None:
        """Emit an analytics event.

        Args:
            event:      Event name constant (e.g. JOB_COMPLETED).
            company_id: Cloud company identifier (used as PostHog group + distinct_id
                        prefix).  May be None in local/anonymous mode.
            user_id:    Opaque user identifier (JWT sub).  Falls back to company_id
                        or "anon" for the PostHog distinct_id.
            props:      Raw properties dict.  Will be filtered by the per-event
                        ALLOWLIST before emission (non-allowlisted keys are dropped).
        """
        ...  # Protocol stub — implementations must override.
