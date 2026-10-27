"""0005_helper_mcp_token — Add mcp_token_hash column to helper.

Additive migration: adds a nullable text column `mcp_token_hash` to the
existing `helper` table.  Helper already has RLS from P0; no RLS changes needed.

Revision ID: 0005_helper_mcp_token
Revises: 0004_p2_platform
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0005_helper_mcp_token"
down_revision: Union[str, Sequence[str], None] = "0004_p2_platform"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add mcp_token_hash (nullable text) to helper."""
    op.add_column(
        "helper",
        sa.Column("mcp_token_hash", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Remove mcp_token_hash from helper."""
    op.drop_column("helper", "mcp_token_hash")
