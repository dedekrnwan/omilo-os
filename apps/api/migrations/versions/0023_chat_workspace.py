"""0023_chat_workspace — persist sidebar edits, folders, sharing, Chief DM.

Adds:
  - session: kind, owner_user_id, goal_id, model, pinned_by (jsonb), archived_at,
    deleted_at (soft delete), shares (jsonb), general_access
  - folder: icon, color, instructions, shares (jsonb)
  - channel: color
  - folder_file        — files attached to a folder (tenant, RLS)
  - chief_nudge_state  — per-user dismiss/snooze of derived Chief nudges (tenant, RLS)

Revision ID: 0023_chat_workspace
Revises: 0023_team_analytics_helpers
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0023_chat_workspace"
down_revision: Union[str, Sequence[str], None] = "0023_team_analytics_helpers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TENANT_TABLES = ("folder_file", "chief_nudge_state")


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    )


def upgrade() -> None:
    # ── session ──────────────────────────────────────────────────────────────
    op.add_column("session", sa.Column("kind", sa.Text(), nullable=False, server_default="chat"))
    op.add_column("session", sa.Column("owner_user_id", sa.Text(), nullable=True))
    op.add_column("session", sa.Column("goal_id", sa.Text(), nullable=True))
    op.add_column("session", sa.Column("model", sa.Text(), nullable=True))
    op.add_column("session", sa.Column("pinned_by", JSONB(), nullable=False, server_default="[]"))
    op.add_column("session", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("session", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("session", sa.Column("shares", JSONB(), nullable=False, server_default="[]"))
    op.add_column(
        "session",
        sa.Column("general_access", sa.Text(), nullable=False, server_default="restricted"),
    )
    op.create_index("ix_session_kind_owner", "session", ["kind", "owner_user_id"], unique=False)

    # ── folder ───────────────────────────────────────────────────────────────
    op.add_column("folder", sa.Column("icon", sa.Text(), nullable=True))
    op.add_column("folder", sa.Column("color", sa.Text(), nullable=True))
    op.add_column("folder", sa.Column("instructions", sa.Text(), nullable=False, server_default=""))
    op.add_column("folder", sa.Column("shares", JSONB(), nullable=False, server_default="[]"))

    # ── channel ──────────────────────────────────────────────────────────────
    op.add_column("channel", sa.Column("color", sa.Text(), nullable=True))

    # ── folder_file ──────────────────────────────────────────────────────────
    op.create_table(
        "folder_file",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("folder_id", sa.String(), sa.ForeignKey("folder.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mime", sa.Text(), nullable=True),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("uploaded_by", sa.Text(), nullable=True),
        _created_at(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_folder_file_company_id", "folder_file", ["company_id"], unique=False)
    op.create_index("ix_folder_file_folder_id", "folder_file", ["folder_id"], unique=False)

    # ── chief_nudge_state ────────────────────────────────────────────────────
    op.create_table(
        "chief_nudge_state",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("nudge_key", sa.Text(), nullable=False),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("snooze_until", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "user_id", "nudge_key", name="uq_chief_nudge_state_key"),
    )
    op.create_index("ix_chief_nudge_state_company_id", "chief_nudge_state", ["company_id"], unique=False)
    op.create_index("ix_chief_nudge_state_user_id", "chief_nudge_state", ["user_id"], unique=False)

    for tbl in NEW_TENANT_TABLES:
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO omilo_app")
        op.execute(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {tbl}
                USING (company_id = current_setting('app.company_id', true))
            """
        )


def downgrade() -> None:
    for tbl in NEW_TENANT_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl}")
    op.drop_index("ix_chief_nudge_state_user_id", table_name="chief_nudge_state")
    op.drop_index("ix_chief_nudge_state_company_id", table_name="chief_nudge_state")
    op.drop_table("chief_nudge_state")
    op.drop_index("ix_folder_file_folder_id", table_name="folder_file")
    op.drop_index("ix_folder_file_company_id", table_name="folder_file")
    op.drop_table("folder_file")

    op.drop_column("channel", "color")

    op.drop_column("folder", "shares")
    op.drop_column("folder", "instructions")
    op.drop_column("folder", "color")
    op.drop_column("folder", "icon")

    op.drop_index("ix_session_kind_owner", table_name="session")
    for col in (
        "general_access",
        "shares",
        "deleted_at",
        "archived_at",
        "pinned_by",
        "model",
        "goal_id",
        "owner_user_id",
        "kind",
    ):
        op.drop_column("session", col)
