"""0025_worker_token_unique — UNIQUE index on compute_worker.token_hash.

Required so that verify_worker_token can look up a worker by token_hash in O(1)
with a guaranteed-unique match. Without this index the lookup would fall back to
a seq scan and there would be no DB-level enforcement of hash uniqueness.

Revision ID: 0025_worker_token_unique
Revises: 0024_compute
Create Date: 2026-10-29
"""
from typing import Sequence, Union

from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0025_worker_token_unique"
down_revision: Union[str, Sequence[str], None] = "0024_compute"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add UNIQUE index on compute_worker.token_hash."""
    op.create_index(
        "ix_compute_worker_token_hash",
        "compute_worker",
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    """Drop UNIQUE index on compute_worker.token_hash."""
    op.drop_index("ix_compute_worker_token_hash", table_name="compute_worker")
