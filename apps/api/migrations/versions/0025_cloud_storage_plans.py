"""0025_cloud_storage_plans — Cloud plans per company, sized by storage.

Owner decision (2026-10-29): the subscription pays for Omilo Cloud (hosting +
storage) per company; AI is bring-your-own (partner per-token pricing later).
Starter 5 GB · Team 50 GB · Business 250 GB, unlimited people, no included
credits, no seats. Values are frozen here; the API re-syncs the live catalog
(omilo.billing.catalog) on start-up so later price edits need no migration.

Revision ID: 0025_cloud_storage_plans
Revises: 0024_control_plans
"""
from __future__ import annotations

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025_cloud_storage_plans"
down_revision: Union[str, Sequence[str], None] = "0024_control_plans"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _feats(gb, bullets, badge=None):
    f = {"max_seats": None, "max_helpers": None, "storage_gb": gb, "seat_price_idr": None, "bullets": bullets}
    if badge:
        f["badge"] = badge
    return json.dumps(f)


_PLANS = [
    ("plan_self_hosted", "self_hosted", "Self-Hosted", 0, 0, _feats(None, ["Runs on your computer",
                                                                          "Unlimited people, helpers and storage",
                                                                          "Your own AI"])),
    ("plan_starter", "starter", "Starter", 9.31, 149000, _feats(5, ["5 GB for docs, files and knowledge",
                                                                    "Unlimited people and helpers",
                                                                    "Always on in Omilo Cloud", "Your own AI key"])),
    ("plan_team", "team", "Team", 31.19, 499000, _feats(50, ["50 GB for docs, files and knowledge",
                                                              "Unlimited people and helpers",
                                                              "Always on in Omilo Cloud", "Email support"],
                                                         "Most popular")),
    ("plan_business", "business", "Business", 93.69, 1499000, _feats(250, ["250 GB for docs, files and knowledge",
                                                                           "Unlimited people and helpers",
                                                                           "SSO and audit log",
                                                                           "Priority WhatsApp support"])),
]

_UPSERT = sa.text(
    """
    INSERT INTO plan (id, tier, name, monthly_price_usd, monthly_price_idr,
                      yearly_price_usd, yearly_price_idr, included_credits,
                      credit_overage_usd, seats, features)
    VALUES (:id, :tier, :name, :m_usd, :m_idr, :y_usd, :y_idr, 0, 0, 9999, CAST(:features AS jsonb))
    ON CONFLICT (id) DO UPDATE SET
      tier = EXCLUDED.tier, name = EXCLUDED.name,
      monthly_price_usd = EXCLUDED.monthly_price_usd, monthly_price_idr = EXCLUDED.monthly_price_idr,
      yearly_price_usd = EXCLUDED.yearly_price_usd, yearly_price_idr = EXCLUDED.yearly_price_idr,
      included_credits = 0, seats = 9999, features = EXCLUDED.features
    """
)


def upgrade() -> None:
    bind = op.get_bind()
    for pid, tier, name, usd, idr, feats in _PLANS:
        bind.execute(_UPSERT, {"id": pid, "tier": tier, "name": name, "m_usd": usd, "m_idr": idr,
                               "y_usd": round(usd * 10, 2), "y_idr": idr * 10, "features": feats})


def downgrade() -> None:
    # Prices/features only; 0024's catalog is restored by downgrading through 0024 → re-upgrade.
    pass
