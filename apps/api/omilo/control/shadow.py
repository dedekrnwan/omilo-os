"""omilo.control.shadow — Company shadow sync for runtime mode.

In RUNTIME mode the authoritative Company/account registry lives in the cloud
control plane.  The local runtime needs a minimal Company row in its own
Postgres so that:
  - RLS scoping (set_company) works correctly.
  - db.get(Company, company_id) succeeds in billing gate / runner calls.
  - The UI can display company display fields (name, edition, etc.).

This module provides one public function::

    sync_company_shadow(db, company_id, control_plane) -> Company

It upserts (INSERT ON CONFLICT DO NOTHING, then UPDATE if existing) a local
Company row populated from ``control_plane.get_entitlements(company_id)``.

CLOUD MODE: this function should NOT be called — the authoritative Company
already exists in the local DB.  Call sites MUST guard on OMILO_MODE before
calling.  The function itself does not enforce this (it can be tested without
mode awareness).

Wiring
------
The shadow is created at the request-auth boundary in runtime mode.
``omilo.auth.deps`` calls ``sync_company_shadow`` after ``verify_token``
resolves company_id — so every authenticated request in runtime mode ensures
the shadow exists before any business logic runs.
See ``omilo/auth/deps.py`` for the runtime wiring.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from omilo.models.tenancy import Company

if TYPE_CHECKING:
    from omilo.control import ControlPlane

logger = logging.getLogger(__name__)

# Sentinel display name for shadow companies (not locally authoritative)
_SHADOW_NAME = "omilo-runtime-shadow"
_SHADOW_COLOR = "#000000"


def sync_company_shadow(
    db: Session,
    company_id: str,
    control_plane: "ControlPlane",
) -> Company:
    """Upsert a minimal local Company row from cloud entitlements.

    Fetches ``get_entitlements(company_id)`` from the control plane and
    writes/updates a ``Company`` row in the local DB with:
      - id = company_id
      - edition = entitlements.edition
      - plan_id = entitlements.plan_id
      - overage_policy = entitlements.overage_policy
      - credit_balance = 0  (placeholder — never authoritative locally)
      - name / color = sentinel values (not available in Entitlements)

    The upsert is idempotent: calling twice with the same company_id is safe.
    Only the entitlement-derived fields are updated on conflict; display-only
    fields that may have been locally enriched (e.g. ``name`` set during
    onboarding) are NOT overwritten.

    Args:
        db:            SQLAlchemy Session (superuser or app context).
        company_id:    The company to sync.
        control_plane: A ControlPlane instance (typically RemoteControlPlane
                       in runtime mode, or FakeControlPlane in tests).

    Returns:
        The local Company ORM object (refreshed from DB).

    Raises:
        ControlPlaneUnreachable: if the entitlements call fails and there is
            no cached value.  Callers should handle this gracefully.
    """
    entitlements = control_plane.get_entitlements(company_id)

    # Upsert: insert if not exists, update entitlement fields on conflict.
    # We use PostgreSQL's INSERT ... ON CONFLICT DO UPDATE (merge semantics).
    stmt = (
        pg_insert(Company)
        .values(
            id=company_id,
            name=_SHADOW_NAME,
            color=_SHADOW_COLOR,
            autonomy_default="ask",
            edition=entitlements.edition or "runtime",
            plan_id=entitlements.plan_id,
            overage_policy=entitlements.overage_policy or "soft",
            credit_balance=0,  # placeholder — cloud is authoritative
        )
        .on_conflict_do_update(
            index_elements=["id"],
            set_={
                # Update entitlement-derived fields
                "edition": entitlements.edition or "runtime",
                "plan_id": entitlements.plan_id,
                "overage_policy": entitlements.overage_policy or "soft",
                # Do NOT overwrite: name, color, credit_balance, autonomy_default
                # (those may be enriched locally or managed by cloud sync jobs)
            },
        )
    )
    db.execute(stmt)
    db.flush()

    company = db.get(Company, company_id)
    if company is None:
        # Should never happen after a successful upsert, but be safe
        raise RuntimeError(
            f"sync_company_shadow: Company {company_id!r} not found after upsert — "
            "this is a bug; check DB connectivity and RLS settings."
        )

    logger.debug(
        "sync_company_shadow: upserted company_id=%s edition=%s plan_id=%s",
        company_id,
        entitlements.edition,
        entitlements.plan_id,
    )
    return company
