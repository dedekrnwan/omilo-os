"""Database engine, session factory, declarative base, and RLS helpers.

Design:
- SQLAlchemy 2.0 `DeclarativeBase` style.
- Sync `Session` (psycopg3 sync driver).
- `set_company(session, company_id)` calls `set_config('app.company_id', cmp, true)`
  (transaction-local, equivalent to SET LOCAL) so Postgres RLS policies can
  read it via `current_setting('app.company_id', true)`.
- `get_db(ctx)` is the FastAPI dependency that opens a transaction, calls
  `set_company`, and yields the session.  Task 5 will wire `ctx` from JWT
  auth; for now the signature accepts an optional RequestContext.
"""
from __future__ import annotations

from collections.abc import Generator
from typing import Optional

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
# FastAPI dependency
# ---------------------------------------------------------------------------

def get_db(ctx: Optional["RequestContext"] = None) -> Generator[Session, None, None]:  # noqa: F821
    """Sync generator dependency: open a transaction, set RLS, yield session.

    Usage (FastAPI route)::

        @router.get("/items")
        def list_items(db: Session = Depends(get_db)):
            ...

    Task 5 will wrap this (or replace the default) to pass a resolved
    RequestContext from the JWT auth dependency.  The body is deliberately
    minimal so that refactoring is surgical.
    """
    with SessionLocal() as session:
        with session.begin():
            if ctx is not None:
                set_company(session, ctx.company_id)
            yield session
