"""0010_harness_account_tag — Add real tag column to harness_account.

Adds a dedicated nullable Text column ``tag`` to the ``harness_account``
table so that the AI-accounts pool can store a user-facing tag without
overloading the ``tokens`` column.

Revision ID: 0010_harness_account_tag
Revises: 0009_helper_access
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0010_harness_account_tag"
down_revision: Union[str, Sequence[str], None] = "0009_helper_access"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "harness_account",
        sa.Column("tag", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("harness_account", "tag")
