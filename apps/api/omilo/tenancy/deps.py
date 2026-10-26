"""Tenancy FastAPI dependencies: get_context, get_bootstrap_db, get_tenant_db, require_role.

Two session planes
------------------
``get_bootstrap_db``
    Opens a SessionLocal **without** SET LOCAL ROLE; runs as the `omilo`
    superuser (RLS-bypassing).  Used by auth routes (sign-up, sign-in, /me)
    and by get_context for the cross-company membership lookup.  Any query
    against tenant tables on this session MUST filter by user_id explicitly.

``get_tenant_db``
    Composes ``get_context → get_db``: the proper FastAPI Depends target for
    domain-data routes.  Issues ``SET LOCAL ROLE omilo_app`` (non-superuser)
    and ``set_config('app.company_id', …, true)`` inside the transaction.
    FORCE RLS on every tenant table means queries see only the active
    company's rows — enforced by Postgres, not application logic.

Active-company resolution (get_context)
-----------------------------------------
1. Default: JWT ``cmp`` claim.
2. Override: ``X-Company-Id`` header — only if the user has a ``Member`` row
   there.  Lookup uses a privileged session (it crosses companies).  403 if
   no membership.
3. Role is derived from the ``Member`` row for the ACTIVE company (not from
   the JWT ``role`` claim).
4. 403 if the user has no Member row in the active company.
"""
from __future__ import annotations

from collections.abc import Generator

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from omilo.auth.deps import get_current_user
from omilo.db import SessionLocal, get_db
from omilo.models.tenancy import Member, User
from omilo.tenancy.context import RequestContext

_403_no_membership = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="You do not have access to the requested company.",
)


# ---------------------------------------------------------------------------
# Privileged bootstrap session (no RLS; runs as superuser omilo)
# ---------------------------------------------------------------------------

def get_bootstrap_db() -> Generator[Session, None, None]:
    """Open a plain session without SET LOCAL ROLE.

    Runs as the superuser `omilo`, bypassing RLS.  This is intentional for:
    - Auth routes (User is a global table; Member queries span companies).
    - get_context's membership lookup.

    Any query against tenant tables here MUST explicitly filter by the
    authenticated user_id — cross-company reads are inherently scoped by
    user identity, not by company_id GUC.
    """
    with SessionLocal() as session:
        with session.begin():
            yield session


# ---------------------------------------------------------------------------
# Tenant context resolution
# ---------------------------------------------------------------------------

def get_context(
    user: User = Depends(get_current_user),
    x_company_id: str | None = Header(default=None, alias="X-Company-Id"),
) -> RequestContext:
    """Resolve the active company and role for a request.

    Active company:
    - JWT ``cmp`` claim by default.
    - Overridden by ``X-Company-Id`` header if the user is a Member there.

    Role is fetched from the Member row for the ACTIVE company (not from JWT).
    Returns ``RequestContext(user_id, company_id, role)``.
    Raises 403 if no membership in the active company.
    """
    claims = user._jwt_claims  # type: ignore[attr-defined]
    jwt_company_id: str = claims.get("cmp", "")

    if x_company_id is not None:
        # Header override: must verify membership with a privileged query.
        # This query intentionally runs without RLS (as omilo superuser)
        # because it is a cross-company lookup filtered by user_id.
        with SessionLocal() as session:
            member = (
                session.query(Member)
                .filter_by(company_id=x_company_id, user_id=user.id)
                .first()
            )
        if member is None:
            raise _403_no_membership
        return RequestContext(
            user_id=user.id,
            company_id=x_company_id,
            role=member.role,
        )

    # Default: use JWT cmp claim, look up role from Member row.
    active_company_id = jwt_company_id
    with SessionLocal() as session:
        member = (
            session.query(Member)
            .filter_by(company_id=active_company_id, user_id=user.id)
            .first()
        )
    if member is None:
        raise _403_no_membership
    return RequestContext(
        user_id=user.id,
        company_id=active_company_id,
        role=member.role,
    )


# ---------------------------------------------------------------------------
# Tenant-scoped session dependency (composes get_context → get_db)
# ---------------------------------------------------------------------------

def get_tenant_db(
    ctx: RequestContext = Depends(get_context),
) -> Generator[Session, None, None]:
    """Compose get_context + get_db into a single FastAPI Depends target.

    This is the dependency that domain-data routes should declare::

        @router.get("/channels")
        def list_channels(db: Session = Depends(get_tenant_db)):
            ...

    The session runs as ``omilo_app`` (non-superuser) with
    ``app.company_id`` set to the active company, so FORCE RLS on all
    tenant tables enforces isolation at the Postgres level.
    """
    yield from get_db(ctx)


# ---------------------------------------------------------------------------
# require_role guard
# ---------------------------------------------------------------------------

def require_role(*allowed: str):
    """FastAPI dependency factory: 403 if context role not in allowed.

    Usage::

        @router.delete("/team/{id}")
        def delete_member(
            _: None = Depends(require_role("owner", "admin")),
            ctx: RequestContext = Depends(get_context),
        ):
            ...
    """
    def _guard(ctx: RequestContext = Depends(get_context)) -> None:
        if ctx.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{ctx.role}' is not allowed. Required: {list(allowed)}.",
            )

    return _guard
