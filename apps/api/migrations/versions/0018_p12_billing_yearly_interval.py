"""0018_p12_billing_yearly_interval — P12-T1: yearly pricing + billing interval.

Adds:
  plan.yearly_price_usd      NUMERIC  NOT NULL  SERVER DEFAULT 0
  plan.yearly_price_idr      INTEGER  NOT NULL  SERVER DEFAULT 0
  subscription.billing_interval  TEXT  NOT NULL  SERVER DEFAULT 'monthly'

Schema-only migration — plan row seeding is handled by seed_plans() in
omilo/billing/catalog.py, not here.

Revision ID: 0018_p12_billing_yearly_interval
Revises: 0017_telemetry_opted_out
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers (single head — 0018 follows 0017_telemetry_opted_out)
# ---------------------------------------------------------------------------

revision: str = "0018_p12_billing_yearly_interval"
down_revision: Union[str, Sequence[str], None] = "0017_telemetry_opted_out"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add yearly pricing columns to plan; add billing_interval to subscription."""
    # plan.yearly_price_usd
    op.add_column(
        "plan",
        sa.Column(
            "yearly_price_usd",
            sa.Numeric(),
            nullable=False,
            server_default="0",
        ),
    )

    # plan.yearly_price_idr
    op.add_column(
        "plan",
        sa.Column(
            "yearly_price_idr",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )

    # subscription.billing_interval
    op.add_column(
        "subscription",
        sa.Column(
            "billing_interval",
            sa.Text(),
            nullable=False,
            server_default="monthly",
        ),
    )


def downgrade() -> None:
    """Remove yearly pricing columns from plan; remove billing_interval from subscription."""
    op.drop_column("subscription", "billing_interval")
    op.drop_column("plan", "yearly_price_idr")
    op.drop_column("plan", "yearly_price_usd")
