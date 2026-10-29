"""Auth router: sign-up, sign-in, /me.

Endpoints
---------
POST /auth/sign-up   {email, name, password}  → 201 {user, session}
POST /auth/sign-in   {email, password}         → 200 {user, session, companies[]}
GET  /me                                       → 200 {user, member, company}
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from omilo.auth import codes, emails
from omilo.auth.bootstrap import seed_new_company
from omilo.auth.deps import get_current_user
from omilo.auth.passwords import hash_password, verify_password
from omilo.auth.tokens import make_access_token
from omilo.config import get_settings
from omilo.db import SessionLocal
from omilo.models.auth_codes import (
    Invite,
    PURPOSE_EMAIL_VERIFY,
    PURPOSE_PASSWORD_RESET,
    PURPOSE_SIGNIN_CODE,
    PURPOSE_TWO_FACTOR,
)
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Company, Member, User

router = APIRouter(prefix="/auth", tags=["auth"])
me_router = APIRouter(tags=["auth"])


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class SignUpRequest(BaseModel):
    email: str
    name: str
    password: str


# "Keep me signed in" issues a token with a 30-day TTL instead of the short default.
REMEMBER_TTL_SECONDS = 30 * 24 * 3600


class SignInRequest(BaseModel):
    email: str
    password: str
    remember: bool = False


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    created_at: datetime


class SessionOut(BaseModel):
    access: str
    expires_at: datetime


class CompanyOut(BaseModel):
    id: str
    name: str
    # P5d profile fields — nullable, defaulting to None / "IDR"
    industry: str | None = None
    team_size: str | None = None
    region: str | None = None
    currency: str = "IDR"
    pic_role: str | None = None
    # Workspace autonomy dial (the column the enforcement engine reads)
    autonomy_default: str = "ask"
    # P13 onboarding gate — True once the company finishes the onboarding wizard
    onboarded: bool = False


class SignUpResponse(BaseModel):
    user: UserOut
    session: SessionOut


class SignInResponse(BaseModel):
    user: UserOut
    session: SessionOut
    companies: list[CompanyOut]


class MemberOut(BaseModel):
    role: str


class MeResponse(BaseModel):
    user: UserOut
    member: MemberOut
    company: CompanyOut
    companies: list[CompanyOut]


class SwitchCompanyRequest(BaseModel):
    company_id: str


class UpdateMeRequest(BaseModel):
    name: str | None = None


# ── Email-based flow schemas (verify / code sign-in / reset / 2FA / invite) ────

class SimpleOk(BaseModel):
    ok: bool = True


class VerifiedOut(BaseModel):
    verified: bool = True


class EmailRequest(BaseModel):
    email: str


class EmailCodeRequest(BaseModel):
    email: str
    code: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


class TwoFactorChallenge(BaseModel):
    """Returned by sign-in when 2FA is on — no session yet."""

    two_factor_required: bool = True
    email: str


class CreateInviteRequest(BaseModel):
    email: str
    role: str = "member"
    channels: str | None = None


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    channels: str | None = None
    expires_at: datetime


class InvitePreview(BaseModel):
    email: str
    role: str
    channels: str | None = None
    company_name: str
    inviter_name: str | None = None
    expires_at: datetime
    has_account: bool


class AcceptInviteRequest(BaseModel):
    token: str
    name: str | None = None
    password: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        created_at=user.created_at,
    )


def _company_out(company: Company) -> CompanyOut:
    """Serialize a Company ORM object to CompanyOut including profile fields."""
    return CompanyOut(
        id=company.id,
        name=company.name,
        industry=company.industry,
        team_size=company.team_size,
        region=company.region,
        currency=getattr(company, "currency", "IDR") or "IDR",
        pic_role=company.pic_role,
        autonomy_default=getattr(company, "autonomy_default", "ask") or "ask",
        onboarded=company.onboarded_at is not None,
    )


def _build_sign_in_response(
    session: Session,
    user: User,
    active_company_id: str | None = None,
    remember: bool = False,
) -> SignInResponse:
    """Build the full sign-in payload (token + companies) for *user*.

    Shared by password sign-in, magic-code sign-in, two-factor verify, password
    reset, and invite accept.  ``active_company_id`` pins which company the issued
    token is scoped to (defaults to the user's first membership).  ``remember``
    issues a long-lived (30-day) token instead of the short default.
    """
    members = session.query(Member).filter_by(user_id=user.id).all()
    companies: list[CompanyOut] = []
    for m in members:
        cmp = session.get(Company, m.company_id)
        if cmp:
            companies.append(_company_out(cmp))

    active = None
    if active_company_id:
        active = next((m for m in members if m.company_id == active_company_id), None)
    if active is None:
        active = members[0] if members else None
    if active is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Account has no workspace.",
        )

    ttl_s = REMEMBER_TTL_SECONDS if remember else None
    token, expires_at = make_access_token(
        user.id, active.company_id, active.role, ttl_s=ttl_s
    )
    return SignInResponse(
        user=_user_out(user),
        session=SessionOut(access=token, expires_at=expires_at),
        companies=companies,
    )


# ---------------------------------------------------------------------------
# POST /auth/sign-up
# ---------------------------------------------------------------------------

@router.post("/sign-up", response_model=SignUpResponse, status_code=201)
def sign_up(body: SignUpRequest) -> SignUpResponse:
    """Create a new User, Company (owner workspace), and Member in one transaction."""
    with SessionLocal() as session:
        try:
            with session.begin():
                # Check for duplicate email before trying to insert (nicer error).
                existing = session.query(User).filter_by(email=body.email).first()
                if existing:
                    # An UNVERIFIED account from an earlier attempt (e.g. the
                    # verification email failed to send) must not hard-block the
                    # user. Signal the frontend with a machine-readable detail so
                    # it can resend the code + route to verification instead of a
                    # dead "already exists". A VERIFIED account is a real conflict.
                    unverified = getattr(existing, "email_verified_at", None) is None
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="email_unverified" if unverified else "A user with that email already exists.",
                    )

                # Create user
                user = User(
                    id=prefixed_id("usr"),
                    email=body.email,
                    name=body.name,
                    password_hash=hash_password(body.password),
                )
                session.add(user)

                # Create company (owner's workspace)
                company = Company(
                    id=prefixed_id("cmp"),
                    name=f"{body.name}'s workspace",
                    color="#6366f1",  # default indigo
                    timezone="UTC",
                )
                session.add(company)

                # Flush to get DB-generated defaults (created_at etc.) before we
                # need IDs for the Member FK.
                session.flush()

                # Create owner member (no RLS set_config needed — Member.company_id
                # is stamped explicitly; RLS would block if set_config were set to
                # a different company, but we're inserting directly here).
                member = Member(
                    id=prefixed_id("mem"),
                    company_id=company.id,
                    user_id=user.id,
                    role="owner",
                )
                session.add(member)

                # Seed the workspace: a default "General" area + a Chief Helper
                # so goal-create / chat / flow-publish work out of the box
                # (otherwise POST /v1/goals returns 409 "No Chief Helper found").
                seed_new_company(session, company.id)

        except IntegrityError:
            # Concurrent duplicate slipped past the pre-flight check; return 409
            # instead of propagating a 500 Internal Server Error.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with that email already exists.",
            )

        # Transaction committed; objects are still accessible (expire_on_commit=False).
        token, expires_at = make_access_token(user.id, company.id, "owner")

        return SignUpResponse(
            user=_user_out(user),
            session=SessionOut(access=token, expires_at=expires_at),
        )


# ---------------------------------------------------------------------------
# POST /auth/sign-in
# ---------------------------------------------------------------------------

@router.post("/sign-in", response_model=None)
def sign_in(body: SignInRequest) -> SignInResponse | TwoFactorChallenge:
    """Authenticate with email + password.

    Returns the full session, UNLESS the user has two-step verification enabled —
    then we email a 6-digit code and return a ``TwoFactorChallenge`` instead; the
    client finishes via ``POST /auth/two-factor/verify``.
    """
    _401 = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    with SessionLocal() as session:
        user = session.query(User).filter_by(email=body.email).first()
        if user is None:
            raise _401
        if not user.password_hash or not verify_password(body.password, user.password_hash):
            raise _401

        # Must belong to at least one company (should always be true).
        members = session.query(Member).filter_by(user_id=user.id).all()
        if not members:
            raise _401

        # Two-step verification: email a code, defer the session.
        if user.two_factor_enabled:
            _, code = codes.issue_code(
                session, email=user.email, purpose=PURPOSE_TWO_FACTOR, user_id=user.id
            )
            session.commit()
            emails.send_two_factor_code(user.email, code)
            return TwoFactorChallenge(email=user.email)

        return _build_sign_in_response(session, user, remember=body.remember)


# ---------------------------------------------------------------------------
# POST /auth/switch-company
# ---------------------------------------------------------------------------

@router.post("/switch-company", response_model=SignInResponse)
def switch_company(
    body: SwitchCompanyRequest,
    current_user: User = Depends(get_current_user),
) -> SignInResponse:
    """Re-issue a token with a different active company.

    The requesting user must be a Member of `company_id`.
    Returns the same shape as sign-in so clients can store/use it identically.
    """
    with SessionLocal() as session:
        # 1. Verify the company exists.
        company = session.get(Company, body.company_id)
        if company is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Company not found.",
            )

        # 2. Verify the user is a member of that company.
        member = (
            session.query(Member)
            .filter_by(user_id=current_user.id, company_id=body.company_id)
            .first()
        )
        if member is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of that company.",
            )

        # 3. Build the full companies list (mirrors sign_in).
        members = session.query(Member).filter_by(user_id=current_user.id).all()
        companies: list[CompanyOut] = []
        for m in members:
            cmp = session.get(Company, m.company_id)
            if cmp:
                companies.append(_company_out(cmp))

        # 4. Re-issue the token with the new active company.
        token, expires_at = make_access_token(
            current_user.id, body.company_id, member.role
        )

        return SignInResponse(
            user=_user_out(current_user),
            session=SessionOut(access=token, expires_at=expires_at),
            companies=companies,
        )


# ---------------------------------------------------------------------------
# Email verification
# ---------------------------------------------------------------------------

@router.post("/verify-email/request", response_model=SimpleOk)
def verify_email_request(body: EmailRequest) -> SimpleOk:
    """Email a 6-digit verification code (no-op/200 if already verified or unknown)."""
    with SessionLocal() as session:
        user = session.query(User).filter_by(email=body.email).first()
        if user and user.email_verified_at is None:
            _, code = codes.issue_code(
                session, email=user.email, purpose=PURPOSE_EMAIL_VERIFY, user_id=user.id
            )
            session.commit()
            emails.send_verify_email(user.email, code)
    # Always 200 — never reveal whether an account exists.
    return SimpleOk()


@router.post("/verify-email/confirm", response_model=VerifiedOut)
def verify_email_confirm(body: EmailCodeRequest) -> VerifiedOut:
    """Confirm the email with the 6-digit code; stamps ``email_verified_at``."""
    with SessionLocal() as session:
        row = codes.verify_code(
            session, email=body.email, purpose=PURPOSE_EMAIL_VERIFY, code=body.code
        )
        if row is None:
            session.commit()  # persist attempt increment
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That code is invalid or has expired.",
            )
        user = session.query(User).filter_by(email=body.email).first()
        if user is not None and user.email_verified_at is None:
            user.email_verified_at = datetime.now(timezone.utc)
        session.commit()
    return VerifiedOut()


# ---------------------------------------------------------------------------
# Magic-code sign-in ("email me a sign-in code")
# ---------------------------------------------------------------------------

@router.post("/code/request", response_model=SimpleOk)
def code_request(body: EmailRequest) -> SimpleOk:
    """Email a 6-digit sign-in code (200 even for unknown emails)."""
    with SessionLocal() as session:
        user = session.query(User).filter_by(email=body.email).first()
        if user:
            _, code = codes.issue_code(
                session, email=user.email, purpose=PURPOSE_SIGNIN_CODE, user_id=user.id
            )
            session.commit()
            emails.send_signin_code(user.email, code)
    return SimpleOk()


@router.post("/code/verify", response_model=None)
def code_verify(body: EmailCodeRequest) -> SignInResponse:
    """Exchange a valid sign-in code for a session."""
    with SessionLocal() as session:
        row = codes.verify_code(
            session, email=body.email, purpose=PURPOSE_SIGNIN_CODE, code=body.code
        )
        if row is None:
            session.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That code is invalid or has expired.",
            )
        user = session.query(User).filter_by(email=body.email).first()
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That code is invalid or has expired.",
            )
        # Possession of the emailed code proves ownership → mark verified.
        if user.email_verified_at is None:
            user.email_verified_at = datetime.now(timezone.utc)
        resp = _build_sign_in_response(session, user)
        session.commit()
        return resp


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------

@router.post("/password/forgot", response_model=SimpleOk)
def password_forgot(body: ForgotPasswordRequest) -> SimpleOk:
    """Email a reset link (200 even for unknown emails — no enumeration)."""
    with SessionLocal() as session:
        user = session.query(User).filter_by(email=body.email).first()
        if user:
            token = codes.generate_url_token()
            codes.issue_code(
                session,
                email=user.email,
                purpose=PURPOSE_PASSWORD_RESET,
                user_id=user.id,
                ttl_minutes=30,
                raw=token,
            )
            session.commit()
            link = f"{get_settings().frontend_base}/auth/reset-password?token={token}"
            emails.send_password_reset(user.email, link)
    return SimpleOk()


@router.post("/password/reset", response_model=None)
def password_reset(body: ResetPasswordRequest) -> SignInResponse:
    """Set a new password from a valid reset token; returns a fresh session."""
    if len(body.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters.",
        )
    with SessionLocal() as session:
        row = codes.verify_token(
            session, purpose=PURPOSE_PASSWORD_RESET, token=body.token
        )
        if row is None:
            session.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This reset link is invalid or has expired.",
            )
        user = session.query(User).filter_by(email=row.email).first()
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This reset link is invalid or has expired.",
            )
        user.password_hash = hash_password(body.password)
        if user.email_verified_at is None:
            user.email_verified_at = datetime.now(timezone.utc)
        resp = _build_sign_in_response(session, user)
        session.commit()
        return resp


# ---------------------------------------------------------------------------
# Two-step verification
# ---------------------------------------------------------------------------

@router.post("/two-factor/verify", response_model=None)
def two_factor_verify(body: EmailCodeRequest) -> SignInResponse:
    """Finish a 2FA sign-in with the emailed code → full session."""
    with SessionLocal() as session:
        row = codes.verify_code(
            session, email=body.email, purpose=PURPOSE_TWO_FACTOR, code=body.code
        )
        if row is None:
            session.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That code is invalid or has expired.",
            )
        user = session.query(User).filter_by(email=body.email).first()
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="That code is invalid or has expired.",
            )
        resp = _build_sign_in_response(session, user)
        session.commit()
        return resp


@router.post("/two-factor/enable", response_model=SimpleOk)
def two_factor_enable(current_user: User = Depends(get_current_user)) -> SimpleOk:
    """Turn on two-step verification for the signed-in user."""
    with SessionLocal() as session:
        user = session.get(User, current_user.id)
        if user is None:
            raise HTTPException(status_code=404, detail="User not found.")
        user.two_factor_enabled = True
        session.commit()
    return SimpleOk()


@router.post("/two-factor/disable", response_model=SimpleOk)
def two_factor_disable(current_user: User = Depends(get_current_user)) -> SimpleOk:
    """Turn off two-step verification for the signed-in user."""
    with SessionLocal() as session:
        user = session.get(User, current_user.id)
        if user is None:
            raise HTTPException(status_code=404, detail="User not found.")
        user.two_factor_enabled = False
        session.commit()
    return SimpleOk()


# ---------------------------------------------------------------------------
# Invites
# ---------------------------------------------------------------------------

@router.post("/invites", response_model=InviteOut, status_code=201)
def create_invite(
    body: CreateInviteRequest, current_user: User = Depends(get_current_user)
) -> InviteOut:
    """Invite someone to the signed-in user's active company (owner/admin only)."""
    claims = current_user._jwt_claims  # type: ignore[attr-defined]
    company_id: str = claims["cmp"]
    role: str = claims.get("role") or "member"
    if role not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owners and admins can invite people.",
        )

    with SessionLocal() as session:
        company = session.get(Company, company_id)
        if company is None:
            raise HTTPException(status_code=404, detail="Company not found.")

        token = codes.generate_url_token()
        invite = Invite(
            id=prefixed_id("inv"),
            company_id=company_id,
            email=body.email,
            role=body.role or "member",
            channels=body.channels,
            token_hash=codes.hash_secret(token),
            invited_by_user_id=current_user.id,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
        session.add(invite)
        session.commit()

        link = f"{get_settings().frontend_base}/auth/invite?token={token}"
        emails.send_invite(
            body.email,
            link,
            company.name,
            getattr(current_user, "name", None),
            invite.role,
        )
        return InviteOut(
            id=invite.id,
            email=invite.email,
            role=invite.role,
            channels=invite.channels,
            expires_at=invite.expires_at,
        )


@router.get("/invite", response_model=InvitePreview)
def get_invite(token: str) -> InvitePreview:
    """Preview a pending invite by token (for the accept page)."""
    with SessionLocal() as session:
        invite = (
            session.query(Invite)
            .filter_by(token_hash=codes.hash_secret(token))
            .first()
        )
        if invite is None or not invite.is_open(datetime.now(timezone.utc)):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="This invite is invalid or has expired.",
            )
        company = session.get(Company, invite.company_id)
        inviter = (
            session.get(User, invite.invited_by_user_id)
            if invite.invited_by_user_id
            else None
        )
        existing = session.query(User).filter_by(email=invite.email).first()
        return InvitePreview(
            email=invite.email,
            role=invite.role,
            channels=invite.channels,
            company_name=company.name if company else "",
            inviter_name=inviter.name if inviter else None,
            expires_at=invite.expires_at,
            has_account=existing is not None,
        )


@router.post("/invite/accept", response_model=None)
def accept_invite(body: AcceptInviteRequest) -> SignInResponse:
    """Accept an invite: join the company and get a session.

    Existing users join directly (the emailed token proves ownership).  New
    users must supply ``name`` + ``password`` to create their account.
    """
    with SessionLocal() as session:
        invite = (
            session.query(Invite)
            .filter_by(token_hash=codes.hash_secret(body.token))
            .first()
        )
        now = datetime.now(timezone.utc)
        if invite is None or not invite.is_open(now):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This invite is invalid or has expired.",
            )

        user = session.query(User).filter_by(email=invite.email).first()
        if user is None:
            if not body.name or not body.password:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Name and password are required to create your account.",
                )
            if len(body.password) < 8:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Password must be at least 8 characters.",
                )
            user = User(
                id=prefixed_id("usr"),
                email=invite.email,
                name=body.name,
                password_hash=hash_password(body.password),
                email_verified_at=now,  # the invite was emailed to this address
            )
            session.add(user)
            session.flush()

        member = (
            session.query(Member)
            .filter_by(company_id=invite.company_id, user_id=user.id)
            .first()
        )
        if member is None:
            member = Member(
                id=prefixed_id("mem"),
                company_id=invite.company_id,
                user_id=user.id,
                role=invite.role,
            )
            session.add(member)

        invite.accepted_at = now
        session.flush()
        resp = _build_sign_in_response(
            session, user, active_company_id=invite.company_id
        )
        session.commit()
        return resp


# ---------------------------------------------------------------------------
# GET /me
# ---------------------------------------------------------------------------

@me_router.get("/me", response_model=MeResponse)
def me(current_user: User = Depends(get_current_user)) -> MeResponse:
    """Return the authenticated user's profile, active member, company, and all companies."""
    claims = current_user._jwt_claims  # type: ignore[attr-defined]
    company_id: str = claims["cmp"]
    role: str = claims["role"]

    with SessionLocal() as session:
        company = session.get(Company, company_id)

        if company is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Active company not found.",
            )

        # Load ALL companies this user belongs to (mirrors sign-in behaviour).
        members = session.query(Member).filter_by(user_id=current_user.id).all()
        all_companies: list[CompanyOut] = []
        for m in members:
            cmp = session.get(Company, m.company_id)
            if cmp:
                all_companies.append(_company_out(cmp))

    return MeResponse(
        user=_user_out(current_user),
        member=MemberOut(role=role),
        company=_company_out(company),
        companies=all_companies,
    )


@me_router.patch("/me", response_model=MeResponse)
def update_me(
    body: UpdateMeRequest,
    current_user: User = Depends(get_current_user),
) -> MeResponse:
    """Update the authenticated user's own profile (currently: name).

    Self-service — any authed user may update their own ``User.name`` (a global,
    non-tenant column).  Returns the same shape as GET /me so the frontend can
    reuse its session hydration.
    """
    claims = current_user._jwt_claims  # type: ignore[attr-defined]
    company_id: str = claims["cmp"]
    role: str = claims["role"]

    with SessionLocal() as session:
        user = session.get(User, current_user.id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found.",
            )
        if body.name is not None:
            name = body.name.strip()
            if not name:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Name must not be empty.",
                )
            user.name = name
        session.commit()

        company = session.get(Company, company_id)
        if company is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Active company not found.",
            )

        members = session.query(Member).filter_by(user_id=user.id).all()
        all_companies: list[CompanyOut] = []
        for m in members:
            cmp = session.get(Company, m.company_id)
            if cmp:
                all_companies.append(_company_out(cmp))

        return MeResponse(
            user=_user_out(user),
            member=MemberOut(role=role),
            company=_company_out(company),
            companies=all_companies,
        )
