"""0024_control_plans — Starter / Team / Business plan catalog.

Owner decision (sweep/control): the control-panel tiers are the plan.

  - Upserts plan_starter, plan_team, plan_business (and keeps plan_self_hosted).
  - Migrates the old single cloud tier: every subscription / company /
    doit_payment on ``plan_cloud`` moves to ``plan_team`` (same 5 included
    seats; Team is the closest match and the trial plan).
  - Removes the ``plan_cloud`` row.

Data values are inlined (not imported from omilo.billing.catalog) so this
revision stays stable if the catalog changes later; ``seed_plans()`` keeps
rows in sync at runtime.

Revision ID: 0024_control_plans
Revises: 0023_control_schema
Create Date: 2026-10-29
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024_control_plans"
down_revision: Union[str, Sequence[str], None] = "0023_control_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PLANS = [
    # id, tier, name, m_usd, m_idr, y_usd, y_idr, credits, seats, features
    ("plan_self_hosted", "self_hosted", "Self-Hosted", 0, 0, 0, 0, 0, 9999,
     {"max_seats": None, "max_helpers": None, "seat_price_idr": 0}),
    ("plan_starter", "starter", "Starter", 30, 500000, 300, 5000000, 6000, 2,
     {"max_seats": 2, "max_helpers": 2, "seat_price_idr": None}),
    ("plan_team", "team", "Team", 120, 2000000, 1200, 20000000, 40000, 5,
     {"max_seats": 15, "max_helpers": 6, "seat_price_idr": 150000}),
    ("plan_business", "business", "Business", 360, 6000000, 3600, 60000000, 120000, 20,
     {"max_seats": None, "max_helpers": None, "seat_price_idr": 150000}),
]

_UPSERT = sa.text(
    """
    INSERT INTO plan (id, tier, name, monthly_price_usd, monthly_price_idr,
                      yearly_price_usd, yearly_price_idr, included_credits,
                      credit_overage_usd, seats, features)
    VALUES (:id, :tier, :name, :m_usd, :m_idr, :y_usd, :y_idr, :credits, 0, :seats,
            CAST(:features AS jsonb))
    ON CONFLICT (id) DO UPDATE SET
      tier = EXCLUDED.tier, name = EXCLUDED.name,
      monthly_price_usd = EXCLUDED.monthly_price_usd,
      monthly_price_idr = EXCLUDED.monthly_price_idr,
      yearly_price_usd = EXCLUDED.yearly_price_usd,
      yearly_price_idr = EXCLUDED.yearly_price_idr,
      included_credits = EXCLUDED.included_credits,
      seats = EXCLUDED.seats, features = EXCLUDED.features
    """
)


def upgrade() -> None:
    bind = op.get_bind()
    for pid, tier, name, m_usd, m_idr, y_usd, y_idr, credits, seats, feats in _PLANS:
        bind.execute(
            _UPSERT,
            {
                "id": pid, "tier": tier, "name": name, "m_usd": m_usd, "m_idr": m_idr,
                "y_usd": y_usd, "y_idr": y_idr, "credits": credits, "seats": seats,
                "features": json.dumps(feats),
            },
        )
    # Move everything on the old single cloud tier to Team.
    bind.execute(sa.text("UPDATE subscription SET plan_id = 'plan_team' WHERE plan_id = 'plan_cloud'"))
    bind.execute(sa.text("UPDATE company SET plan_id = 'plan_team' WHERE plan_id = 'plan_cloud'"))
    bind.execute(sa.text("UPDATE doit_payment SET plan_id = 'plan_team' WHERE plan_id = 'plan_cloud'"))
    bind.execute(sa.text("DELETE FROM plan WHERE id = 'plan_cloud'"))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        _UPSERT,
        {
            "id": "plan_cloud", "tier": "cloud", "name": "Cloud", "m_usd": 19,
            "m_idr": 299000, "y_usd": 190, "y_idr": 2990000, "credits": 2000,
            "seats": 5, "features": "{}",
        },
    )
    for tbl in ("subscription", "company", "doit_payment"):
        bind.execute(
            sa.text(
                f"UPDATE {tbl} SET plan_id = 'plan_cloud' "
                "WHERE plan_id IN ('plan_starter', 'plan_team', 'plan_business')"
            )
        )
    bind.execute(
        sa.text("DELETE FROM plan WHERE id IN ('plan_starter', 'plan_team', 'plan_business')")
    )
