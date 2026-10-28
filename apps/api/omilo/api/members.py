"""omilo.api.members — List company members.

Endpoint
--------
GET /v1/members
    Bearer auth (get_context) → list the authenticated company's members.
    Returns [{id, user_id, name, email, role}] — one entry per Member row,
    joined with User for name/email. Tenant-scoped via ctx.company_id; the
    superuser session is used intentionally (Member and User are queried
    together, and User is a global table without RLS).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.db import SessionLocal
from omilo.models.tenancy import Member, User
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context

router = APIRouter(tags=["members"])


class MemberOut(BaseModel):
    id: str
    user_id: str
    name: str
    email: str
    role: str


@router.get("/members", response_model=list[MemberOut])
def list_members(ctx: RequestContext = Depends(get_context)) -> list[MemberOut]:
    """Return all members of the authenticated company.

    Uses a privileged (superuser) session to join Member + User — User is a
    global table (no RLS), so it cannot be queried under omilo_app. The result
    is still scoped to ctx.company_id, so no cross-company data leaks.
    """
    with SessionLocal() as session:
        rows = (
            session.query(Member, User)
            .join(User, User.id == Member.user_id)
            .filter(Member.company_id == ctx.company_id)
            .order_by(Member.created_at)
            .all()
        )

    return [
        MemberOut(
            id=member.id,
            user_id=member.user_id,
            name=user.name,
            email=user.email,
            role=member.role,
        )
        for member, user in rows
    ]
