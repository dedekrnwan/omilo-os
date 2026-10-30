"""0026_token_budgets — AI budgets count tokens, not credits.

Adds ``helper.budget_tokens_month`` (per-helper monthly token budget, null =
no limit) and drops ``helper.budget_credits_month``: credits are not a
customer-facing unit any more and there is no fair conversion, so existing
credit budgets are cleared rather than guessed. Flow and routine runs
record the tokens they used (``tokens``).

Revision ID: 0026_token_budgets
Revises: 0025_worker_token_unique
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026_token_budgets"
down_revision: Union[str, Sequence[str], None] = "0025_worker_token_unique"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("helper", sa.Column("budget_tokens_month", sa.BigInteger(), nullable=True))
    op.drop_column("helper", "budget_credits_month")
    for table in ("flow_run", "routine_run"):
        op.add_column(table, sa.Column("tokens", sa.BigInteger(), nullable=False, server_default="0"))


def downgrade() -> None:
    for table in ("flow_run", "routine_run"):
        op.drop_column(table, "tokens")
    op.add_column("helper", sa.Column("budget_credits_month", sa.Integer(), nullable=True))
    op.drop_column("helper", "budget_tokens_month")
