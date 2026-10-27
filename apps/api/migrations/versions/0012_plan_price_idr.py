"""0012_plan_price_idr — Add monthly_price_idr to plan; backfill IDR prices.

Adds monthly_price_idr (Integer, NOT NULL, server_default=0) to the plan table
and backfills the three seeded tiers with IDR prices at a rate of ~16 000 IDR/USD,
rounded to the nearest 50 000 IDR:

  free   ($0)   →       0 IDR
  growth ($49)  → 800 000 IDR   (49 × 16 000 = 784 000 → rounded up to 800 000)
  scale  ($199) → 3 200 000 IDR (199 × 16 000 = 3 184 000 → rounded to 3 200 000)

Revision ID: 0012_plan_price_idr
Revises: 0011_p5a_commerce
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0012_plan_price_idr"
down_revision: Union[str, Sequence[str], None] = "0011_p5a_commerce"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add monthly_price_idr column and backfill existing plan rows."""
    op.add_column(
        "plan",
        sa.Column(
            "monthly_price_idr",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )

    # Backfill the three seeded plans with sensible IDR prices.
    # Conversion rate: ~16 000 IDR/USD, rounded to nearest 50 000 IDR.
    op.execute(
        sa.text("UPDATE plan SET monthly_price_idr = 0 WHERE id = 'pln_free'")
    )
    op.execute(
        sa.text(
            "UPDATE plan SET monthly_price_idr = 800000 WHERE id = 'pln_growth'"
        )
    )
    op.execute(
        sa.text(
            "UPDATE plan SET monthly_price_idr = 3200000 WHERE id = 'pln_scale'"
        )
    )


def downgrade() -> None:
    """Remove monthly_price_idr from plan."""
    op.drop_column("plan", "monthly_price_idr")
