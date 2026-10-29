"""0023_inbox_flows_inbox_state — inbox read state + proposal edit fields.

Adds (all nullable / additive):
  - inbox_item.read_at      timestamptz  — set by POST /v1/inbox/{id}/read, /read-all
  - inbox_item.updated_at   timestamptz  — bumped on status change ("Done today")
  - inbox_item.proposal_id  text (index) — the Proposal a decision item resolves;
    backfilled from the legacy ``proposals`` JSONB dict ({proposal_id,type,risk}).
  - proposal.assignee       text         — "Assign to someone else" (review dialog)
  - proposal.due            text         — "Change due date" (review dialog)
  - proposal.params         jsonb        — action params (amended on approve, flow_id…)

Revision ID: 0023_inbox_flows_inbox_state
Revises: 0022_flow_settings
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0023_inbox_flows_inbox_state"
down_revision: Union[str, Sequence[str], None] = "0022_flow_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("inbox_item", sa.Column("read_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("inbox_item", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("inbox_item", sa.Column("proposal_id", sa.Text(), nullable=True))
    op.create_index("ix_inbox_item_proposal_id", "inbox_item", ["proposal_id"])
    # Backfill from the legacy dict shape written by runner / flows / skills / mcp.
    op.execute(
        """
        UPDATE inbox_item
           SET proposal_id = proposals->>'proposal_id'
         WHERE proposals IS NOT NULL
           AND jsonb_typeof(proposals) = 'object'
           AND proposals ? 'proposal_id'
        """
    )
    op.add_column("proposal", sa.Column("assignee", sa.Text(), nullable=True))
    op.add_column("proposal", sa.Column("due", sa.Text(), nullable=True))
    op.add_column("proposal", sa.Column("params", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("proposal", "params")
    op.drop_column("proposal", "due")
    op.drop_column("proposal", "assignee")
    op.drop_index("ix_inbox_item_proposal_id", table_name="inbox_item")
    op.drop_column("inbox_item", "proposal_id")
    op.drop_column("inbox_item", "updated_at")
    op.drop_column("inbox_item", "read_at")
