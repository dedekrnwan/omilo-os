"""omilo.kb.db — Knowledge-store session dependency (P11a seam).

``get_knowledge_db`` is the FastAPI Depends target for all KB/memory endpoints.

Default behaviour (``knowledge_database_url`` is None):
    Delegates 100 % to ``get_tenant_db`` — same RLS-scoped, company-GUC-set
    session that every other domain route uses.  Zero observable change.

Future behaviour (``knowledge_database_url`` is set, P11b):
    Constructs a dedicated Engine for the KB store and yields a plain Session
    on it.  RLS / company scoping on the separate engine is not implemented
    here — see the TODO below.  This path exists so the routing branch is
    testable; it is NOT production-complete in this slice.

Usage (FastAPI route)::

    from omilo.kb.db import get_knowledge_db

    @router.post("/knowledge/sources")
    def post_knowledge_source(
        req: IndexSourceRequest,
        db: Session = Depends(get_knowledge_db),
    ) -> dict:
        ...
"""
from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

from fastapi import Depends
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from omilo.config import get_settings
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db


# ---------------------------------------------------------------------------
# Separate-engine cache (only used when knowledge_database_url is set)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_knowledge_engine():
    """Build (and cache) the dedicated knowledge Engine.

    Called only when ``settings.knowledge_database_url`` is not None.
    The lru_cache ensures we construct the engine once per process.
    """
    settings = get_settings()
    url = settings.knowledge_database_url
    if url is None:  # pragma: no cover — guard; callers check first
        raise RuntimeError(
            "knowledge_database_url is not set; cannot construct knowledge engine."
        )
    return create_engine(url, pool_pre_ping=True)


@lru_cache(maxsize=1)
def _get_knowledge_sessionmaker():
    """Build (and cache) the SessionMaker bound to the knowledge engine."""
    engine = _get_knowledge_engine()
    return sessionmaker(
        bind=engine,
        class_=Session,
        autocommit=False,
        autoflush=False,
        expire_on_commit=False,
    )


# ---------------------------------------------------------------------------
# Public FastAPI dependency
# ---------------------------------------------------------------------------

def get_knowledge_db(
    ctx: RequestContext = Depends(get_context),
) -> Generator[Session, None, None]:
    """FastAPI dependency: yield a Session for KB/memory operations.

    When ``knowledge_database_url`` is None (default):
        Delegates to ``get_tenant_db`` — the tenant-scoped, RLS-enforced
        session backed by the main Postgres database.  Behaviour is
        byte-identical to what the KB endpoints used before this seam was
        introduced.

    When ``knowledge_database_url`` is set (future, P11b):
        Opens a plain Session on the separate knowledge Engine.

        # TODO(P11b): RLS/company scoping + migrations on the separate
        #   knowledge engine.  A single-tenant local store scopes by
        #   company_id explicitly (WHERE company_id = ctx.company_id in
        #   every query) rather than relying on Postgres RLS.  For now the
        #   separate-URL path is wired but not hardened for multi-tenant use.
    """
    settings = get_settings()

    if settings.knowledge_database_url is None:
        # ── DEFAULT (no-op) path ────────────────────────────────────────────
        # Yield from get_tenant_db so the RLS session is set up identically:
        # SET LOCAL ROLE omilo_app + set_config('app.company_id', …, true).
        yield from get_tenant_db(ctx)
    else:
        # ── SEPARATE ENGINE path (P11b-incomplete) ──────────────────────────
        # TODO(P11b): RLS/company scoping + migrations on the separate
        #   knowledge engine.
        KnowledgeSession = _get_knowledge_sessionmaker()
        with KnowledgeSession() as session:
            with session.begin():
                yield session
