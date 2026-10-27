"""0014_company_profile — P5d Task 1b: add profile columns to company table.

Adds:
  - company.industry    (Text, nullable)
  - company.team_size   (Text, nullable)
  - company.region      (Text, nullable)
  - company.currency    (Text, NOT NULL, server_default='IDR')
  - company.pic_role    (Text, nullable)

Company is the global tenant-root (no RLS) — plain add_column / drop_column,
no grants or RLS policies needed (omilo_app already has default DML privileges).

Revision ID: 0014_company_profile
Revises: 0013_p5b_mcp_access_token
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0014_company_profile"
down_revision: Union[str, Sequence[str], None] = "0013_p5b_mcp_access_token"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add 5 company profile columns (currency with IDR default for backfill)."""
    op.add_column("company", sa.Column("industry", sa.Text(), nullable=True))
    op.add_column("company", sa.Column("team_size", sa.Text(), nullable=True))
    op.add_column("company", sa.Column("region", sa.Text(), nullable=True))
    op.add_column(
        "company",
        sa.Column(
            "currency",
            sa.Text(),
            nullable=False,
            server_default="IDR",
        ),
    )
    op.add_column("company", sa.Column("pic_role", sa.Text(), nullable=True))


def downgrade() -> None:
    """Drop the 5 company profile columns."""
    op.drop_column("company", "pic_role")
    op.drop_column("company", "currency")
    op.drop_column("company", "region")
    op.drop_column("company", "team_size")
    op.drop_column("company", "industry")
