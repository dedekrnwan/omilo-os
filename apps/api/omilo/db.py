"""Database engine, session factory, declarative base, and RLS helpers.

Design
------
- SQLAlchemy 2.0 ``DeclarativeBase`` style.
- Sync ``Session`` (psycopg3 sync driver).
- Two session planes:

  ``get_db(ctx)`` — **tenant-scoped**.  Requires a ``RequestContext`` from
  ``get_context``.  Opens a transaction, issues
  ``SET LOCAL ROLE omilo_app`` (non-superuser → FORCE RLS enforced), then
  ``set_config('app.company_id', ctx.company_id, true)`` (transaction-local
  GUC).  All domain-data routes use this dependency.

  ``get_bootstrap_db`` (in omilo/tenancy/deps.py) — **privileged**.  Opens a
  plain session as the superuser ``omilo`` (RLS-bypassing).  Auth routes and
  cross-company lookups use it; they MUST filter by user_id explicitly.

- ``set_company(session, company_id)`` — internal helper used by ``get_db``.
"""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from omilo.config import get_settings


# ---------------------------------------------------------------------------
# Engine + Session factory
# ---------------------------------------------------------------------------

def _make_engine():
    settings = get_settings()
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        # psycopg3 supports both autocommit and transaction modes; we manage
        # transactions explicitly via session.begin() / get_db's context.
    )


engine = _make_engine()

SessionLocal = sessionmaker(
    bind=engine,
    class_=Session,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


# ---------------------------------------------------------------------------
# Declarative base (all ORM models inherit from this)
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    """Project-wide declarative base.  Alembic targets Base.metadata."""


# ---------------------------------------------------------------------------
# RLS helper
# ---------------------------------------------------------------------------

def set_company(session: Session, company_id: str) -> None:
    """Set the transaction-local app.company_id GUC for Postgres RLS.

    Calls ``SELECT set_config('app.company_id', company_id, true)`` which is
    identical in effect to ``SET LOCAL app.company_id = …`` but — unlike the
    latter — accepts a bound parameter (Postgres does not allow parameters in
    SET statements).  The ``true`` third argument makes the change
    transaction-local, so it reverts automatically on COMMIT or ROLLBACK.

    Must be called *after* a transaction has been opened (e.g. inside
    ``with session.begin():``) so that the change is scoped to that
    transaction only.

    The Postgres RLS policies use:
        current_setting('app.company_id', true)
    The ``true`` flag (missing_ok) means an unset GUC yields NULL, which
    causes all tenant-table policies to match no rows — zero-trust by default.
    """
    # Postgres SET LOCAL does not accept bound parameters; use set_config()
    # instead, which does.  The third argument `true` makes the change
    # transaction-local — identical semantics to SET LOCAL.
    session.execute(
        text("SELECT set_config('app.company_id', :cmp, true)"),
        {"cmp": company_id},
    )


# ---------------------------------------------------------------------------
# Tenant-scoped FastAPI dependency (the primary domain-data session)
# ---------------------------------------------------------------------------

def get_db(ctx: "RequestContext") -> Generator[Session, None, None]:  # noqa: F821
    """Tenant-scoped session dependency.

    Opens a transaction, issues:
    1. ``SET LOCAL ROLE omilo_app`` — drops to non-superuser so Postgres
       FORCE ROW LEVEL SECURITY applies.
    2. ``set_config('app.company_id', ctx.company_id, true)`` — sets the
       transaction-local GUC that the tenant_isolation policies read.

    Because ``omilo_app`` is a non-superuser and all tenant tables have
    FORCE RLS, queries see only the active company's rows.  Any attempt to
    read another tenant's data is silently filtered to zero rows by Postgres —
    not by application logic.

    This function is not meant to be used directly as a FastAPI Depends target.
    Route authors should use ``get_tenant_db`` from ``omilo.tenancy.deps`` which
    composes ``get_context`` → ``get_db``.

    Usage (FastAPI route)::

        from omilo.tenancy.deps import get_tenant_db

        @router.get("/channels")
        def list_channels(db: Session = Depends(get_tenant_db)):
            return db.query(Channel).all()  # RLS scopes to active company
    """
    with SessionLocal() as session:
        with session.begin():
            # Step 1: become non-superuser so FORCE RLS applies
            session.execute(text("SET LOCAL ROLE omilo_app"))
            # Step 2: set the GUC that tenant_isolation policies check
            set_company(session, ctx.company_id)
            yield session
