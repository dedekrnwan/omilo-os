"""Activity log API (sweep/control).

  GET /v1/audit?type=&actor=&days=&cursor=&limit=  → {events: [...], next_cursor}
  GET /v1/audit.csv?type=&actor=&days=               → text/csv download

``type`` filters by event type (members, billing, settings, helpers,
connectors, approvals, channels, skills, data, account); ``actor`` filters by
actor_type (person | agent | system).  Cursor = the last event's id (events
are ordered newest first by (at, id)).
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from omilo.models.control import AuditEvent
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["audit"])


def _event_dict(e: AuditEvent) -> dict[str, Any]:
    at = e.at
    if at is not None and at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return {
        "id": e.id,
        "at": at.isoformat() if at else None,
        "actor_type": e.actor_type,
        "actor_id": e.actor_id,
        "actor_name": e.actor_name,
        "actor_area": e.actor_area,
        "type": e.type,
        "action": e.action,
        "target": e.target,
        "channel": e.channel,
        "meta": e.meta or {},
    }


def _query(db: Session, type_: str | None, actor: str | None, days: int | None):
    q = db.query(AuditEvent)
    if type_:
        types = [t.strip() for t in type_.split(",") if t.strip()]
        q = q.filter(AuditEvent.type.in_(types))
    if actor:
        q = q.filter(AuditEvent.actor_type == actor)
    if days:
        since = datetime.now(timezone.utc) - timedelta(days=days)
        q = q.filter(AuditEvent.at >= since)
    return q


@router.get("/audit")
def list_audit(
    type: str | None = None,  # noqa: A002
    actor: str | None = None,
    days: int | None = None,
    cursor: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_tenant_db),
    _ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    limit = max(1, min(limit, 200))
    q = _query(db, type, actor, days)
    if cursor:
        anchor = db.get(AuditEvent, cursor)
        if anchor is None:
            raise HTTPException(status_code=400, detail="Invalid cursor.")
        q = q.filter(
            or_(
                AuditEvent.at < anchor.at,
                and_(AuditEvent.at == anchor.at, AuditEvent.id < anchor.id),
            )
        )
    rows = q.order_by(AuditEvent.at.desc(), AuditEvent.id.desc()).limit(limit + 1).all()
    more = len(rows) > limit
    rows = rows[:limit]
    return {
        "events": [_event_dict(r) for r in rows],
        "next_cursor": rows[-1].id if more and rows else None,
    }


@router.get("/audit.csv")
def export_audit_csv(
    type: str | None = None,  # noqa: A002
    actor: str | None = None,
    days: int | None = None,
    db: Session = Depends(get_tenant_db),
    _ctx: RequestContext = Depends(get_context),
) -> Response:
    rows = (
        _query(db, type, actor, days)
        .order_by(AuditEvent.at.desc(), AuditEvent.id.desc())
        .limit(10_000)
        .all()
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["time", "actor", "actor_type", "type", "action", "target", "channel"])
    for e in rows:
        d = _event_dict(e)
        w.writerow([d["at"], d["actor_name"], d["actor_type"], d["type"], d["action"], d["target"], d["channel"] or ""])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="omilo-activity-{stamp}.csv"'},
    )
