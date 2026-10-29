"""0024_inbox_flows_flow_versions — flow run step log + flow version history.

Adds:
  - flow_run.steps jsonb not null default '[]' — per-step log written by the engine
    ({node_id, kind, label, status, duration_ms, output?, note?}).
  - flow_version (TENANT table, FORCE RLS) — graph snapshot taken on create /
    publish / restore. ``status``: pending|live|superseded.

Revision ID: 0024_inbox_flows_flow_versions
Revises: 0023_inbox_flows_inbox_state
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0024_inbox_flows_flow_versions"
down_revision: Union[str, Sequence[str], None] = "0023_inbox_flows_inbox_state"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "flow_version"


def upgrade() -> None:
    op.add_column(
        "flow_run",
        sa.Column("steps", JSONB(), nullable=False, server_default="[]"),
    )

    op.create_table(
        TABLE,
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False, index=True),
        sa.Column("flow_id", sa.String(), nullable=False, index=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("trigger", JSONB(), nullable=False, server_default="{}"),
        sa.Column("nodes", JSONB(), nullable=False, server_default="[]"),
        sa.Column("edges", JSONB(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("created_by", sa.String(), nullable=False, server_default="operator"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {TABLE} TO omilo_app")
    op.execute(f"ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON {TABLE}
            USING (company_id = current_setting('app.company_id', true))
        """
    )


def downgrade() -> None:
    op.drop_table(TABLE)
    op.drop_column("flow_run", "steps")
