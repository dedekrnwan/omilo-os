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

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from omilo.db import SessionLocal
from omilo.models.tenancy import Member, User
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, require_role

router = APIRouter(tags=["members"])

_VALID_ROLES = frozenset({"owner", "admin", "member", "viewer"})


class MemberOut(BaseModel):
    id: str
    user_id: str
    name: str
    email: str
    role: str


class PatchMemberBody(BaseModel):
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


def _owner_count(session, company_id: str, *, exclude_member_id: str | None = None) -> int:
    """Count owner Members for a company, optionally excluding one member id."""
    q = session.query(Member).filter(
        Member.company_id == company_id, Member.role == "owner"
    )
    if exclude_member_id is not None:
        q = q.filter(Member.id != exclude_member_id)
    return q.count()


@router.patch("/members/{member_id}", response_model=MemberOut)
def patch_member(
    member_id: str,
    body: PatchMemberBody,
    _guard: None = Depends(require_role("owner", "admin")),
    ctx: RequestContext = Depends(get_context),
) -> MemberOut:
    """Change a member's role. Owner/admin only.

    Refuses (400) demoting the last remaining owner. 404 if the member is not
    in the authed company. Uses a privileged session scoped to ctx.company_id
    (Member join + User is a global table).
    """
    if body.role not in _VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role {body.role!r}. Allowed: {sorted(_VALID_ROLES)}.",
        )

    with SessionLocal() as session:
        with session.begin():
            member = (
                session.query(Member)
                .filter(Member.id == member_id, Member.company_id == ctx.company_id)
                .first()
            )
            if member is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Member not found."
                )

            # Last-owner guard: refuse demoting the only owner.
            if member.role == "owner" and body.role != "owner":
                if _owner_count(session, ctx.company_id) <= 1:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Cannot demote the last owner of the company.",
                    )

            member.role = body.role
            session.flush()

            user = session.get(User, member.user_id)
            return MemberOut(
                id=member.id,
                user_id=member.user_id,
                name=user.name if user else "",
                email=user.email if user else "",
                role=member.role,
            )


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_member(
    member_id: str,
    _guard: None = Depends(require_role("owner", "admin")),
    ctx: RequestContext = Depends(get_context),
) -> None:
    """Remove a member from the authed company. Owner/admin only.

    Refuses (400) removing the last remaining owner. 404 if the member is not
    in the authed company.
    """
    with SessionLocal() as session:
        with session.begin():
            member = (
                session.query(Member)
                .filter(Member.id == member_id, Member.company_id == ctx.company_id)
                .first()
            )
            if member is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="Member not found."
                )

            if member.role == "owner" and _owner_count(session, ctx.company_id) <= 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot remove the last owner of the company.",
                )

            session.delete(member)
