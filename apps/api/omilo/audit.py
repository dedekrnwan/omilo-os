"""Activity log writer (sweep/control).

``record(...)`` appends one ``AuditEvent`` row for the control-panel
Activity section.  It is best-effort: it opens its own privileged session and
NEVER raises, so a logging failure can't break the mutation that called it.

Event types (the Activity filters):
  members | billing | settings | helpers | connectors | approvals |
  channels | skills | data | account
"""
from __future__ import annotations

import logging
from typing import Any

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id

logger = logging.getLogger(__name__)

TYPES = (
    "members",
    "billing",
    "settings",
    "helpers",
    "connectors",
    "approvals",
    "channels",
    "skills",
    "data",
    "account",
)


def _user_name(session: Any, user_id: str | None) -> str:
    if not user_id:
        return ""
    from omilo.models.tenancy import User

    user = session.get(User, user_id)
    return user.name if user is not None else ""


def record(
    company_id: str | None,
    *,
    type: str,  # noqa: A002 — mirrors the column name
    action: str,
    target: str = "",
    actor_id: str | None = None,
    actor_name: str | None = None,
    actor_type: str = "person",
    actor_area: str | None = None,
    channel: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    """Append an activity-log row. Never raises.

    ``actor_name`` defaults to the User's name when ``actor_id`` is a user id
    and ``actor_type == "person"``.
    """
    if not company_id:
        return
    try:
        from omilo.models.control import AuditEvent

        with SessionLocal() as session:
            with session.begin():
                name = actor_name
                if name is None and actor_type == "person":
                    name = _user_name(session, actor_id)
                session.add(
                    AuditEvent(
                        id=prefixed_id("aud"),
                        company_id=company_id,
                        actor_type=actor_type,
                        actor_id=actor_id,
                        actor_name=name or ("System" if actor_type == "system" else ""),
                        actor_area=actor_area,
                        type=type,
                        action=action,
                        target=target or "",
                        channel=channel,
                        meta=meta or {},
                    )
                )
    except Exception as exc:  # pragma: no cover — best-effort
        logger.warning("audit.record failed (%s/%s): %s", type, action, exc)


def record_ctx(ctx: Any, **kwargs: Any) -> None:
    """Shorthand for a person acting through a RequestContext."""
    record(
        getattr(ctx, "company_id", None),
        actor_id=getattr(ctx, "user_id", None),
        **kwargs,
    )
