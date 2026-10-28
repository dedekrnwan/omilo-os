"""0017_telemetry_opted_out — P7 Task 3: add telemetry_opted_out to company.

Adds:
  company.telemetry_opted_out  BOOLEAN  NOT NULL  DEFAULT false

Additive column — no data loss on rollback (just drops the column).
Company is the global tenant-root (no RLS); omilo_app already has full
access via the original P0 migration grants.

Revision ID: 0017_telemetry_opted_out
Revises: 0016_install_token
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers (single head — 0017 follows 0016_install_token)
# ---------------------------------------------------------------------------

revision: str = "0017_telemetry_opted_out"
down_revision: Union[str, Sequence[str], None] = "0016_install_token"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add telemetry_opted_out column to company table (default false)."""
    op.add_column(
        "company",
        sa.Column(
            "telemetry_opted_out",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    """Remove telemetry_opted_out column from company table."""
    op.drop_column("company", "telemetry_opted_out")
