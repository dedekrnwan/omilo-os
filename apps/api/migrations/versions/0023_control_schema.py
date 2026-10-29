"""0023_control_schema — control-panel sweep: audit log, exports, MCP servers,
sign-in sessions, per-user preferences, logo/avatar, channel archive/mute,
member channel access.

Adds:
  - company.logo_url            (text, nullable — data: URL)
  - user.avatar_url             (text, nullable — data: URL)
  - user.preferences            (jsonb, not null, default '{}')
  - member.channels             (jsonb, nullable — channel ids; null = all)
  - channel.archived_at         (timestamptz, nullable)
  - channel.muted               (bool, not null, default false)
  - audit_event   TENANT (grants + FORCE RLS + tenant_isolation)
  - data_export   TENANT (grants + FORCE RLS + tenant_isolation)
  - mcp_server    TENANT (grants + FORCE RLS + tenant_isolation)
  - user_session  GLOBAL (queried by user/session id on the privileged plane)

Revision ID: 0023_control_schema
Revises: 0023_chat_workspace
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0023_control_schema"
down_revision: Union[str, Sequence[str], None] = "0023_chat_workspace"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TENANT_TABLES = ("audit_event", "data_export", "mcp_server")


def _created_at() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    )


def upgrade() -> None:
    # ── additive columns ─────────────────────────────────────────────────────
    op.add_column("company", sa.Column("logo_url", sa.Text(), nullable=True))
    op.add_column("user", sa.Column("avatar_url", sa.Text(), nullable=True))
    op.add_column(
        "user",
        sa.Column("preferences", JSONB(), nullable=False, server_default="{}"),
    )
    op.add_column("member", sa.Column("channels", JSONB(), nullable=True))
    op.add_column(
        "channel", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "channel",
        sa.Column("muted", sa.Boolean(), nullable=False, server_default="false"),
    )

    # ── audit_event ──────────────────────────────────────────────────────────
    op.create_table(
        "audit_event",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column(
            "at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("actor_type", sa.String(), nullable=False, server_default="person"),
        sa.Column("actor_id", sa.String(), nullable=True),
        sa.Column("actor_name", sa.String(), nullable=False, server_default=""),
        sa.Column("actor_area", sa.String(), nullable=True),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("target", sa.String(), nullable=False, server_default=""),
        sa.Column("channel", sa.String(), nullable=True),
        sa.Column("meta", JSONB(), nullable=False, server_default="{}"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_audit_event_company_id"), "audit_event", ["company_id"])
    op.create_index(op.f("ix_audit_event_at"), "audit_event", ["at"])
    op.create_index(op.f("ix_audit_event_type"), "audit_event", ["type"])

    # ── data_export ──────────────────────────────────────────────────────────
    op.create_table(
        "data_export",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("requested_by", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("filename", sa.String(), nullable=False, server_default=""),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("summary", JSONB(), nullable=False, server_default="{}"),
        sa.Column("content", sa.LargeBinary(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_data_export_company_id"), "data_export", ["company_id"])

    # ── mcp_server ───────────────────────────────────────────────────────────
    op.create_table(
        "mcp_server",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False, server_default="remote"),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("auth_type", sa.String(), nullable=False, server_default="none"),
        sa.Column("token_enc", sa.Text(), nullable=True),
        sa.Column("token_hint", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("tools", JSONB(), nullable=False, server_default="[]"),
        sa.Column("spec", JSONB(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        _created_at(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_mcp_server_company_id"), "mcp_server", ["company_id"])

    for tbl in NEW_TENANT_TABLES:
        op.execute(sa.text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO omilo_app"))
        op.execute(sa.text(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY"))
        op.execute(sa.text(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY"))
        op.execute(
            sa.text(
                f"CREATE POLICY tenant_isolation ON {tbl} "
                f"USING (company_id = current_setting('app.company_id', true))"
            )
        )

    # ── user_session (global) ────────────────────────────────────────────────
    op.create_table(
        "user_session",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=True),
        sa.Column("method", sa.String(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("ip", sa.String(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        _created_at(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_session_user_id"), "user_session", ["user_id"])
    op.execute(sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON user_session TO omilo_app"))


def downgrade() -> None:
    op.drop_index(op.f("ix_user_session_user_id"), table_name="user_session")
    op.drop_table("user_session")

    for tbl in reversed(NEW_TENANT_TABLES):
        op.execute(sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl}"))

    op.drop_index(op.f("ix_mcp_server_company_id"), table_name="mcp_server")
    op.drop_table("mcp_server")
    op.drop_index(op.f("ix_data_export_company_id"), table_name="data_export")
    op.drop_table("data_export")
    op.drop_index(op.f("ix_audit_event_type"), table_name="audit_event")
    op.drop_index(op.f("ix_audit_event_at"), table_name="audit_event")
    op.drop_index(op.f("ix_audit_event_company_id"), table_name="audit_event")
    op.drop_table("audit_event")

    op.drop_column("channel", "muted")
    op.drop_column("channel", "archived_at")
    op.drop_column("member", "channels")
    op.drop_column("user", "preferences")
    op.drop_column("user", "avatar_url")
    op.drop_column("company", "logo_url")
