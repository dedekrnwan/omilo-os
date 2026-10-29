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

from datetime import datetime

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
    # sweep/control — channel access (null = all channels) + presence.
    channels: list[str] | None = None
    channel_names: list[str] | None = None
    last_seen_at: datetime | None = None
    avatar_url: str | None = None


class PatchMemberBody(BaseModel):
    role: str | None = None
    # Channel ids this member works in; [] or null → all channels.
    channels: list[str] | None = None
    all_channels: bool | None = None


def _channel_names(session, company_id: str) -> dict[str, str]:
    from omilo.models.workspace import Channel

    rows = session.query(Channel.id, Channel.name).filter(Channel.company_id == company_id).all()
    return {cid: name for cid, name in rows}


def _last_seen(session, user_ids: list[str]) -> dict[str, datetime]:
    from sqlalchemy import func

    from omilo.models.control import UserSession

    if not user_ids:
        return {}
    rows = (
        session.query(UserSession.user_id, func.max(UserSession.last_seen_at))
        .filter(UserSession.user_id.in_(user_ids))
        .group_by(UserSession.user_id)
        .all()
    )
    return {uid: ts for uid, ts in rows if ts is not None}


def _member_out(member: Member, user: User | None, names: dict[str, str], seen: dict[str, datetime]) -> MemberOut:
    chans = member.channels if isinstance(member.channels, list) and member.channels else None
    return MemberOut(
        id=member.id,
        user_id=member.user_id,
        name=user.name if user else "",
        email=user.email if user else "",
        role=member.role,
        channels=chans,
        channel_names=[names[c] for c in chans if c in names] if chans else None,
        last_seen_at=seen.get(member.user_id),
        avatar_url=getattr(user, "avatar_url", None) if user else None,
    )


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
        names = _channel_names(session, ctx.company_id)
        seen = _last_seen(session, [m.user_id for m, _ in rows])

    return [_member_out(member, user, names, seen) for member, user in rows]


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
    if body.role is not None and body.role not in _VALID_ROLES:
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
            if body.role is not None and member.role == "owner" and body.role != "owner":
                if _owner_count(session, ctx.company_id) <= 1:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Cannot demote the last owner of the company.",
                    )

            old_role = member.role
            if body.role is not None:
                member.role = body.role
            names = _channel_names(session, ctx.company_id)
            if body.all_channels:
                member.channels = None
            elif body.channels is not None:
                unknown = [c for c in body.channels if c not in names]
                if unknown:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Unknown channel(s): {', '.join(unknown)}",
                    )
                member.channels = list(body.channels) or None
            session.flush()

            user = session.get(User, member.user_id)
            out = _member_out(member, user, names, _last_seen(session, [member.user_id]))

    from omilo import audit

    if body.role is not None and body.role != old_role:
        audit.record_ctx(ctx, type="members", action="changed role of", target=f"{out.name} → {out.role}")
    if body.channels is not None or body.all_channels:
        audit.record_ctx(
            ctx, type="members", action="changed channels of",
            target=f"{out.name} → {', '.join(out.channel_names or []) or 'All channels'}",
        )
    return out


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

            removed = session.get(User, member.user_id)
            session.delete(member)

    from omilo import audit

    audit.record_ctx(ctx, type="members", action="removed", target=removed.name if removed else member_id)
