"""0023_team_analytics_helpers — helper profile/behavior/tools fields + helper_channel.

Adds (all additive / nullable or defaulted):
  helper.title              text null      — job title shown under the name
  helper.reports_to         text null      — 'owner' | helper id
  helper.look               jsonb null     — {color, shape, prop, picture}
  helper.behavior           jsonb '{}'     — Behavior tab settings (limits, topics, handoff, language)
  helper.tool_access        jsonb '{}'     — {builtins: {browser: bool, ...}}
  helper.skill_settings     jsonb '{}'     — {skill_id: {enabled, permission}}
  helper.budget_allow_jobs  int 0          — one-off "allow one more job" overrides past the budget
  helper.retired_at         timestamptz    — set when the helper is let go (status='retired')

Creates TENANT table helper_channel (grants + FORCE RLS + tenant_isolation):
  per-helper external channel bindings (telegram / whatsapp / email), config
  JSON + encrypted secrets, status ('pending_setup' until a delivery
  integration confirms the binding).

Revision ID: 0023_team_analytics_helpers
Revises: 0022_flow_settings
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0023_team_analytics_helpers"
down_revision: Union[str, Sequence[str], None] = "0022_flow_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TENANT_TABLE = "helper_channel"


def upgrade() -> None:
    op.add_column("helper", sa.Column("title", sa.Text(), nullable=True))
    op.add_column("helper", sa.Column("reports_to", sa.Text(), nullable=True))
    op.add_column("helper", sa.Column("look", JSONB(), nullable=True))
    op.add_column("helper", sa.Column("behavior", JSONB(), nullable=False, server_default="{}"))
    op.add_column("helper", sa.Column("tool_access", JSONB(), nullable=False, server_default="{}"))
    op.add_column("helper", sa.Column("skill_settings", JSONB(), nullable=False, server_default="{}"))
    op.add_column(
        "helper",
        sa.Column("budget_allow_jobs", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("helper", sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        NEW_TENANT_TABLE,
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False, index=True),
        sa.Column("helper_id", sa.String(), nullable=False, index=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("config", JSONB(), nullable=False, server_default="{}"),
        sa.Column("secrets_enc", JSONB(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(), nullable=False, server_default="pending_setup"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {NEW_TENANT_TABLE} TO omilo_app")
    op.execute(f"ALTER TABLE {NEW_TENANT_TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {NEW_TENANT_TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON {NEW_TENANT_TABLE}
            USING (company_id = current_setting('app.company_id', true))
        """
    )


def downgrade() -> None:
    op.drop_table(NEW_TENANT_TABLE)
    for col in (
        "retired_at",
        "budget_allow_jobs",
        "skill_settings",
        "tool_access",
        "behavior",
        "look",
        "reports_to",
        "title",
    ):
        op.drop_column("helper", col)
