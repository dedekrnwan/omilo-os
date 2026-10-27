"""0003_company_autonomy_default — add autonomy_default column to company.

Company is a global table (no RLS); this is a simple additive column
with a NOT NULL default of 'ask', matching the workspace-level autonomy
dial from docs/business/autonomy.md §2.

Revision ID: 0003_company_autonomy_default
Revises: 0002_p1_agentloop
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0003_company_autonomy_default"
down_revision: Union[str, Sequence[str], None] = "0002_p1_agentloop"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add autonomy_default text column to company (global table, no RLS)."""
    op.add_column(
        "company",
        sa.Column(
            "autonomy_default",
            sa.Text(),
            nullable=False,
            server_default="ask",
        ),
    )


def downgrade() -> None:
    """Drop autonomy_default column from company."""
    op.drop_column("company", "autonomy_default")
