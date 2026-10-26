"""Auth router: sign-up, sign-in, /me.

Endpoints
---------
POST /auth/sign-up   {email, name, password}  → 201 {user, session}
POST /auth/sign-in   {email, password}         → 200 {user, session, companies[]}
GET  /me                                       → 200 {user, member, company}
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from omilo.auth.deps import get_current_user
from omilo.auth.passwords import hash_password, verify_password
from omilo.auth.tokens import make_access_token
from omilo.db import SessionLocal
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


class SignInRequest(BaseModel):
    email: str
    password: str


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


# ---------------------------------------------------------------------------
# POST /auth/sign-up
# ---------------------------------------------------------------------------

@router.post("/sign-up", response_model=SignUpResponse, status_code=201)
def sign_up(body: SignUpRequest) -> SignUpResponse:
    """Create a new User, Company (owner workspace), and Member in one transaction."""
    with SessionLocal() as session:
        with session.begin():
            # Check for duplicate email before trying to insert (nicer error).
            existing = session.query(User).filter_by(email=body.email).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A user with that email already exists.",
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

        # Transaction committed; objects are still accessible (expire_on_commit=False).
        token, expires_at = make_access_token(user.id, company.id, "owner")

        return SignUpResponse(
            user=_user_out(user),
            session=SessionOut(access=token, expires_at=expires_at),
        )


# ---------------------------------------------------------------------------
# POST /auth/sign-in
# ---------------------------------------------------------------------------

@router.post("/sign-in", response_model=SignInResponse)
def sign_in(body: SignInRequest) -> SignInResponse:
    """Authenticate with email + password; return token and companies list."""
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

        # Load all companies this user belongs to.
        members = session.query(Member).filter_by(user_id=user.id).all()
        if not members:
            raise _401  # should not happen for a properly created account

        # Use the first company (owner's workspace) as the active company.
        active_member = members[0]
        companies = []
        for m in members:
            cmp = session.get(Company, m.company_id)
            if cmp:
                companies.append(CompanyOut(id=cmp.id, name=cmp.name))

        token, expires_at = make_access_token(
            user.id, active_member.company_id, active_member.role
        )

        return SignInResponse(
            user=_user_out(user),
            session=SessionOut(access=token, expires_at=expires_at),
            companies=companies,
        )


# ---------------------------------------------------------------------------
# GET /me
# ---------------------------------------------------------------------------

@me_router.get("/me", response_model=MeResponse)
def me(current_user: User = Depends(get_current_user)) -> MeResponse:
    """Return the authenticated user's profile, active member, and company."""
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

    return MeResponse(
        user=_user_out(current_user),
        member=MemberOut(role=role),
        company=CompanyOut(id=company.id, name=company.name),
    )
