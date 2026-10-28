"""0015_channel_area_fields — P5d Task 2b: add icon/purpose/context_scope to channel.

Adds three columns to the existing `channel` tenant table:
  - channel.icon           (Text, nullable)
  - channel.purpose        (Text, nullable)
  - channel.context_scope  (Text, NOT NULL, server_default='isolated')

channel already has RLS + grants (omilo_app) from its original migration —
plain add_column / drop_column, no new policy or grant needed.
context_scope server_default 'isolated' backfills existing rows.

Revision ID: 0015_channel_area_fields
Revises: 0014_company_profile
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0015_channel_area_fields"
down_revision: Union[str, Sequence[str], None] = "0014_company_profile"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add icon, purpose, context_scope to channel (context_scope backfills 'isolated')."""
    op.add_column("channel", sa.Column("icon", sa.Text(), nullable=True))
    op.add_column("channel", sa.Column("purpose", sa.Text(), nullable=True))
    op.add_column(
        "channel",
        sa.Column(
            "context_scope",
            sa.Text(),
            nullable=False,
            server_default="isolated",
        ),
    )


def downgrade() -> None:
    """Drop icon, purpose, context_scope from channel."""
    op.drop_column("channel", "context_scope")
    op.drop_column("channel", "purpose")
    op.drop_column("channel", "icon")
