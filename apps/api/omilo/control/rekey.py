"""omilo.control.rekey — Atomic tenant re-key migration.

``rekey_company(db, old_company_id, new_company_id) -> int``

Re-keys every tenant table in the local Postgres from ``old_company_id`` to
``new_company_id`` in a single atomic transaction.  Used by the
``local → hybrid`` upgrade flow (P6b Task 2).

Design decisions
----------------
* **Programmatic enumeration:** tenant tables are discovered by iterating
  ``Base.metadata.tables.values()`` and selecting tables that have a
  ``company_id`` column.  This guarantees no tenant table is missed when new
  models are added — no hardcoded list.

* **Global table exclusions:** ``company``, ``user``, ``plan``, ``piece``,
  ``install_token`` are global/cross-tenant tables handled separately or not
  rekeyed by company_id.  ``company`` is handled explicitly (insert new,
  rekey children, delete old).  ``user`` has no company_id.  ``plan``/``piece``
  are global catalog tables.  ``install_token`` has company_id but is
  cloud-authoritative and gets re-keyed as part of tenant tables naturally
  (idempotent).

* **WalletSettings special case:** ``wallet_settings.company_id`` is the
  PRIMARY KEY (not a regular indexed column).  We handle it via INSERT … SELECT
  … with the new company_id, then DELETE the old row — a standard PK re-key
  pattern.  All other tenant tables have a separate ``id`` PK and are handled
  with a simple UPDATE.

* **Company row ordering:** insert the new Company first (copying display
  fields), then re-key all child tenant tables, then delete the old Company.
  This keeps FK constraints valid throughout.  The ``member`` table is re-keyed
  like any other tenant table (company_id is a non-PK column there).

* **ALL IN ONE TRANSACTION:** the caller passes an open Session (inside a
  ``session.begin()`` block).  If any statement raises, the entire transaction
  rolls back — the install stays usable as local.  Callers MUST NOT commit the
  session passed in; the transaction lifecycle belongs to the caller.

* **Privileged session required:** the caller MUST pass a session that is NOT
  under ``SET LOCAL ROLE omilo_app`` (i.e. a bootstrap/superuser session,
  bypassing RLS).  Re-keying crosses the tenant boundary intentionally.
"""
from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from omilo.db import Base
from omilo.models.tenancy import Company

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tables excluded from the generic UPDATE sweep.
# These are handled explicitly or are not tenant-scoped by company_id.
# ---------------------------------------------------------------------------
# 'company' — handled explicitly (insert/delete, not UPDATE company_id)
# 'user'    — no company_id column, naturally excluded by the column check
# 'plan'    — global catalog, no company_id
# 'piece'   — global catalog, no company_id
#
# 'wallet_settings' — company_id IS the PK → special case (INSERT+DELETE)
# 'install_token'   — cloud-authoritative, company_id is a regular non-PK
#                     column → handled by the generic UPDATE sweep normally
_EXPLICIT_EXCLUDE_FROM_GENERIC_UPDATE: frozenset[str] = frozenset({
    "company",      # handled explicitly
    "wallet_settings",  # PK re-key, handled separately
})


def _discover_tenant_tables(exclude: frozenset[str]) -> list[str]:
    """Return table names that have a ``company_id`` column, minus exclusions.

    Iterates the SQLAlchemy metadata registry.  All models must be imported
    before calling this so their tables are registered on Base.metadata.

    We import both the public `omilo.models` package (which covers most models)
    AND the extra model modules not yet included in `omilo.models.__init__`
    (install_token, mcp_token, commerce) to guarantee full coverage even if
    the models/__init__.py is not yet fully populated.
    """
    # Trigger registration of all model classes onto Base.metadata.
    import omilo.models  # noqa: F401  — registers the main model set
    # Extra modules not yet in omilo.models.__init__ — import for side-effect.
    import omilo.models.install     # noqa: F401  — InstallToken (company_id)
    import omilo.models.mcp_token   # noqa: F401  — McpAccessToken (company_id)
    import omilo.models.commerce    # noqa: F401  — DoitPayment, WalletSettings (company_id)

    result: list[str] = []
    for table in Base.metadata.tables.values():
        if "company_id" in table.c and table.name not in exclude:
            result.append(table.name)
    return result


def rekey_company(db: Session, old_company_id: str, new_company_id: str) -> int:
    """Re-key all tenant data from ``old_company_id`` to ``new_company_id``.

    This function MUST be called inside an open transaction on a **privileged**
    (superuser/bootstrap) session — one that bypasses RLS.  Do NOT call it with
    a session that has ``SET LOCAL ROLE omilo_app`` in effect.

    The function does NOT commit or rollback.  Transaction lifecycle is the
    caller's responsibility.  On error the caller's transaction will roll back
    all changes atomically.

    Args:
        db:               Open privileged Session (superuser, RLS-bypassed).
        old_company_id:   The local company UUID to re-key from.
        new_company_id:   The cloud company UUID to re-key to.

    Returns:
        Total number of rows updated across all tenant tables (including the
        Company row creation and old deletion which counts as 1 each but is
        returned separately as 2 in the tally — the caller sees the aggregate).

    Raises:
        ValueError: if old_company_id == new_company_id.
        sqlalchemy.exc.SQLAlchemyError: any DB error (caller's transaction
            rolls back).
    """
    if old_company_id == new_company_id:
        raise ValueError(
            f"rekey_company: old and new company_id are identical: {old_company_id!r}"
        )

    rows_moved = 0

    # -----------------------------------------------------------------------
    # Step 1: Insert new Company row (copy display fields from the old one).
    #         Must happen BEFORE re-keying children so FK constraints stay valid.
    # -----------------------------------------------------------------------
    old_company = db.get(Company, old_company_id)
    if old_company is None:
        raise ValueError(
            f"rekey_company: no Company found with id={old_company_id!r}"
        )

    existing_new_company = db.get(Company, new_company_id)
    if existing_new_company is None:
        new_company = Company(
            id=new_company_id,
            name=old_company.name,
            color=old_company.color,
            timezone=old_company.timezone,
            autonomy_default=old_company.autonomy_default,
            plan_id=old_company.plan_id,
            credit_balance=old_company.credit_balance,
            edition=old_company.edition,
            overage_policy=old_company.overage_policy,
            industry=old_company.industry,
            team_size=old_company.team_size,
            region=old_company.region,
            currency=old_company.currency,
            pic_role=old_company.pic_role,
        )
        db.add(new_company)
        db.flush()  # write the new company row without committing
        logger.info(
            "rekey_company: created Company %s (shadow of %s)",
            new_company_id, old_company_id,
        )
    else:
        logger.info(
            "rekey_company: Company %s already exists — skipping creation",
            new_company_id,
        )

    # -----------------------------------------------------------------------
    # Step 2: Re-key all regular tenant tables (company_id is a non-PK column).
    # -----------------------------------------------------------------------
    tenant_tables = _discover_tenant_tables(_EXPLICIT_EXCLUDE_FROM_GENERIC_UPDATE)
    logger.info(
        "rekey_company: discovered %d tenant tables to re-key: %s",
        len(tenant_tables), sorted(tenant_tables),
    )

    for table_name in tenant_tables:
        result = db.execute(
            text(f"UPDATE {table_name} SET company_id = :new WHERE company_id = :old"),  # noqa: S608
            {"new": new_company_id, "old": old_company_id},
        )
        n = result.rowcount
        rows_moved += n
        if n > 0:
            logger.info(
                "rekey_company: %s — moved %d row(s)", table_name, n
            )

    # -----------------------------------------------------------------------
    # Step 3: Re-key wallet_settings (company_id IS the PK).
    #         Insert a new row with the new PK, then delete the old row.
    # -----------------------------------------------------------------------
    has_wallet = db.execute(
        text("SELECT 1 FROM wallet_settings WHERE company_id = :old"),
        {"old": old_company_id},
    ).fetchone()

    if has_wallet is not None:
        db.execute(
            text(
                "INSERT INTO wallet_settings "
                "(company_id, auto_topup_enabled, auto_topup_threshold_credits, auto_topup_pack, updated_at) "
                "SELECT :new, auto_topup_enabled, auto_topup_threshold_credits, auto_topup_pack, updated_at "
                "FROM wallet_settings WHERE company_id = :old"
                " ON CONFLICT (company_id) DO NOTHING"
            ),
            {"new": new_company_id, "old": old_company_id},
        )
        db.execute(
            text("DELETE FROM wallet_settings WHERE company_id = :old"),
            {"old": old_company_id},
        )
        rows_moved += 1
        logger.info("rekey_company: wallet_settings — re-keyed 1 row (PK migration)")

    # -----------------------------------------------------------------------
    # Step 4: Delete the old Company row (after all children have been moved).
    # -----------------------------------------------------------------------
    db.delete(old_company)
    db.flush()
    logger.info(
        "rekey_company: deleted old Company %s — re-key complete (%d rows moved)",
        old_company_id, rows_moved,
    )

    return rows_moved
