"""Temporary probe route: GET /v1/_whoami.

Used by Task 5 tests to verify RLS isolation via a real query as omilo_app.
Task 7 removes this route.

Returns:
    {company_id, role, channel_ids: [...]}

The channel_ids are fetched through the tenant-scoped session (SET LOCAL ROLE
omilo_app + app.company_id GUC set), so Postgres FORCE RLS limits results to
the active company's channels only.  This is the runtime isolation proof.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["probe"])


class WhoAmIResponse(BaseModel):
    company_id: str
    role: str
    channel_ids: list[str]


@router.get("/_whoami", response_model=WhoAmIResponse)
def whoami(
    ctx: RequestContext = Depends(get_context),
    db: Session = Depends(get_tenant_db),
) -> WhoAmIResponse:
    """Return resolved identity + RLS-scoped channel IDs.

    The SELECT runs as omilo_app (non-superuser) inside a transaction where
    app.company_id is set — so FORCE RLS on the channel table means we can
    only see the active company's channels.  B's channels are invisible.
    """
    rows = db.execute(text("SELECT id FROM channel ORDER BY created_at")).fetchall()
    channel_ids = [row[0] for row in rows]

    return WhoAmIResponse(
        company_id=ctx.company_id,
        role=ctx.role,
        channel_ids=channel_ids,
    )
