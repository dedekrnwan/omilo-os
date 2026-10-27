"""omilo.flows.triggers — Flow trigger dispatch layer (P2 Task 6).

Public API:
    fire_scheduled_flows(db, now) -> int
    poll_connector_flows(db, now) -> int
    fire_internal(db, event_type, subject=None) -> int

Design:
- Only ``published`` (status=="published") + ``enabled=True`` flows fire.
  Draft flows never fire — this is enforced in every query.
- fire_scheduled_flows: finds schedule flows whose poll_cursor.next_at <= now,
  fires them, advances poll_cursor.next_at via croniter (idempotent: a second
  tick with the same `now` finds next_at > now and skips).
- poll_connector_flows: finds connector_poll flows; calls _fake_poll(connector,
  cursor) which returns items when the cursor is older than a threshold. If items
  found → run_flow + advance poll_cursor. If nothing new → no run, no cursor
  change.
- fire_internal: finds internal_event flows matching event_type (optionally
  subject). Fires each once with no recursion guard needed beyond the fact that
  fire_internal is called with a specific db session — it does NOT recursively
  call itself; callers are responsible for not calling fire_internal from inside
  a flow step (wired at the endpoint/post-job level, not inside run_flow).
- Company-scoped: caller opens a company-scoped DB session (RLS). Queries see
  only the active company's rows — tenancy is enforced by Postgres RLS.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from croniter import croniter
from sqlalchemy.orm import Session

from omilo.flows.engine import run_flow
from omilo.models.flows import Flow


# ---------------------------------------------------------------------------
# Threshold: fake poll source considers a cursor "stale" if it is this old
# ---------------------------------------------------------------------------

_POLL_STALE_THRESHOLD = timedelta(hours=1)

# Sentinel next_at string used when a schedule flow has no poll_cursor yet
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# 1. fire_scheduled_flows
# ---------------------------------------------------------------------------


def fire_scheduled_flows(db: Session, now: datetime) -> int:
    """Find and fire published+enabled schedule flows that are due.

    Args:
        db:  Company-scoped SQLAlchemy session.
        now: Reference time (UTC-aware).

    Returns:
        Number of flows fired.
    """
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    # Find all candidate schedule flows for this company (RLS scopes company)
    candidates: list[Flow] = (
        db.query(Flow)
        .filter(
            Flow.status == "published",
            Flow.enabled.is_(True),
            Flow.trigger["kind"].as_string() == "schedule",
        )
        .all()
    )

    fired = 0
    for flow in candidates:
        if not _schedule_is_due(flow, now):
            continue

        # Advance poll_cursor.next_at BEFORE firing so a second tick with the
        # same `now` finds next_at > now → skips (idempotent).
        _advance_schedule_cursor(flow, now)
        db.flush()

        run_flow(
            db,
            flow,
            trigger_summary="schedule",
            started_by="schedule",
        )
        fired += 1

    return fired


def _schedule_is_due(flow: Flow, now: datetime) -> bool:
    """Return True if this schedule flow's next_at is <= now."""
    cursor = flow.poll_cursor or {}
    next_at_str = cursor.get("next_at", _EPOCH)
    try:
        next_at = datetime.fromisoformat(next_at_str)
        if next_at.tzinfo is None:
            next_at = next_at.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        # Malformed cursor → treat as epoch (always due)
        return True
    return next_at <= now


def _advance_schedule_cursor(flow: Flow, now: datetime) -> None:
    """Advance flow.poll_cursor.next_at to the next cron occurrence after `now`."""
    spec = flow.trigger.get("spec", {}) if isinstance(flow.trigger, dict) else {}
    cron_expr = spec.get("cron", "0 9 * * *")

    now_naive = now.replace(tzinfo=None)
    cit = croniter(cron_expr, now_naive)
    next_naive = cit.get_next(datetime)
    next_utc = next_naive.replace(tzinfo=timezone.utc)

    # Reassign (not mutate) so SQLAlchemy JSONB change detection fires
    existing = dict(flow.poll_cursor) if flow.poll_cursor else {}
    existing["next_at"] = next_utc.isoformat()
    flow.poll_cursor = existing


# ---------------------------------------------------------------------------
# 2. poll_connector_flows
# ---------------------------------------------------------------------------


def poll_connector_flows(db: Session, now: datetime) -> int:
    """Find and fire published+enabled connector_poll flows that have new items.

    Args:
        db:  Company-scoped SQLAlchemy session.
        now: Reference time (UTC-aware).

    Returns:
        Number of flows fired.
    """
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    candidates: list[Flow] = (
        db.query(Flow)
        .filter(
            Flow.status == "published",
            Flow.enabled.is_(True),
            Flow.trigger["kind"].as_string() == "connector_poll",
        )
        .all()
    )

    fired = 0
    for flow in candidates:
        spec = flow.trigger.get("spec", {}) if isinstance(flow.trigger, dict) else {}
        connector = spec.get("connector", "unknown")
        cursor = flow.poll_cursor or {}

        items = _fake_poll(connector, cursor, now)
        if not items:
            # Nothing new — no run, cursor unchanged
            continue

        # Advance cursor BEFORE firing
        new_cursor = _advance_poll_cursor(cursor, items, now)
        flow.poll_cursor = new_cursor
        db.flush()

        run_flow(
            db,
            flow,
            trigger_summary=f"{connector} poll · {len(items)} new",
            started_by=f"{connector} poll",
        )
        fired += 1

    return fired


def _fake_poll(connector: str, cursor: dict, now: datetime) -> list[dict[str, Any]]:
    """Deterministic fake poll source.

    Returns 1 new item if the cursor's 'at' timestamp is older than
    _POLL_STALE_THRESHOLD (i.e. the cursor is stale → there is "new" data).
    Returns [] if the cursor is recent (up-to-date → nothing new).

    Args:
        connector: The connector slug (unused by the fake; included for realism).
        cursor:    The current poll_cursor dict (may have 'at' key).
        now:       Current reference time.
    """
    at_str = cursor.get("at")
    if not at_str:
        # No cursor at all → treat as first poll → return 1 item
        return [{"id": "item_1", "at": now.isoformat()}]

    try:
        at = datetime.fromisoformat(at_str)
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        # Malformed cursor → return 1 item (safe default)
        return [{"id": "item_1", "at": now.isoformat()}]

    if (now - at) > _POLL_STALE_THRESHOLD:
        # Cursor is old → there are new items
        return [{"id": "item_1", "at": now.isoformat()}]

    # Cursor is fresh → nothing new
    return []


def _advance_poll_cursor(
    old_cursor: dict, items: list[dict[str, Any]], now: datetime
) -> dict:
    """Advance the poll cursor to the newest item's marker."""
    newest = items[-1]
    return {
        "last_id": newest.get("id", "item_unknown"),
        "at": newest.get("at", now.isoformat()),
    }


# ---------------------------------------------------------------------------
# 3. fire_internal
# ---------------------------------------------------------------------------


def fire_internal(
    db: Session,
    event_type: str,
    subject: str | None = None,
) -> int:
    """Fire all published+enabled internal_event flows matching event_type.

    No recursion: this function fires flows once per call. It does NOT call
    itself — the engine's run_flow does not invoke fire_internal. The caller
    is responsible for not calling fire_internal from inside a flow's ai_step
    (i.e. wire it at endpoint/post-job level, not inside run_flow).

    Args:
        db:         Company-scoped SQLAlchemy session.
        event_type: The event kind (e.g. "flow.finished", "goal.updated",
                    "routine.done").
        subject:    Optional subject identifier (e.g. goal_id, flow_id).
                    Currently used only in the trigger_summary; spec-level
                    subject matching is not yet enforced (all matching
                    event-type flows fire regardless of subject).

    Returns:
        Number of flows fired.
    """
    candidates: list[Flow] = (
        db.query(Flow)
        .filter(
            Flow.status == "published",
            Flow.enabled.is_(True),
            Flow.trigger["kind"].as_string() == "internal_event",
            Flow.trigger["spec"]["event"].as_string() == event_type,
        )
        .all()
    )

    summary_parts = [f"event:{event_type}"]
    if subject:
        summary_parts.append(subject)
    trigger_summary = " · ".join(summary_parts)

    fired = 0
    for flow in candidates:
        run_flow(
            db,
            flow,
            trigger_summary=trigger_summary,
            started_by="internal",
        )
        fired += 1

    return fired
