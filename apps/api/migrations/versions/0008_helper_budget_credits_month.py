"""0008_helper_budget_credits_month — Add budget_credits_month to helper.

Adds an optional integer column ``budget_credits_month`` to the ``helper``
table.  Null = unlimited.  When a helper's month-to-date credits_charged
reaches this value the runner pauses the helper automatically.

Revision ID: 0008_helper_budget_credits_month
Revises: 0007_p4_billing
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0008_helper_budget_credits_month"
down_revision: Union[str, Sequence[str], None] = "0007_p4_billing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "helper",
        sa.Column(
            "budget_credits_month",
            sa.Integer(),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("helper", "budget_credits_month")
