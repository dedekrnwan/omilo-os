"""0001_p0_core — P0 core tables + RLS policies.

Creates the 9 P0 tables (company, user, member, channel, folder, goal,
session, message, inbox_item), installs the omilo_app non-superuser role,
grants it DML on all tables, and enables FORCE ROW LEVEL SECURITY with a
tenant_isolation policy on every tenant table.

Revision ID: 0001_p0_core
Revises:
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0001_p0_core"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# Tenant tables that need RLS
# ---------------------------------------------------------------------------

TENANT_TABLES = [
    "member",
    "channel",
    "folder",
    "goal",
    "session",
    "message",
    "inbox_item",
]


def upgrade() -> None:
    """Create all P0 tables, install omilo_app role, grant DML, enable RLS."""

    # ── Step A: Create tables ────────────────────────────────────────────────

    # Global tables (no RLS)
    op.create_table(
        "company",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("color", sa.String(), nullable=False),
        sa.Column("timezone", sa.String(), server_default="UTC", nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "user",
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=True),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )

    # Tenant tables
    op.create_table(
        "channel",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("accent", sa.String(), server_default="general", nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=True),
        sa.Column("agent_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("chat_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("open_items", sa.Integer(), server_default="0", nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_channel_company_id"), "channel", ["company_id"], unique=False
    )

    op.create_table(
        "inbox_item",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("summary", sa.Text(), server_default="", nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("channel_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("asker", sa.String(), nullable=False),
        sa.Column("asker_area", sa.String(), nullable=False),
        sa.Column("asked_ago", sa.Text(), nullable=True),
        sa.Column("needs_you", sa.Boolean(), nullable=True),
        sa.Column(
            "proposals", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "actions", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("reassurance", sa.Text(), nullable=True),
        sa.Column("compact", sa.Boolean(), nullable=True),
        sa.Column(
            "progress", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("meta", sa.Text(), nullable=True),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_inbox_item_company_id"), "inbox_item", ["company_id"], unique=False
    )

    op.create_table(
        "folder",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("channel_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["channel_id"], ["channel.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_folder_company_id"), "folder", ["company_id"], unique=False
    )

    op.create_table(
        "goal",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("channel_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("progress", sa.Integer(), server_default="0", nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["channel_id"], ["channel.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_goal_company_id"), "goal", ["company_id"], unique=False
    )

    op.create_table(
        "member",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("role", sa.String(), server_default="member", nullable=False),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("company_id", "user_id"),
    )
    op.create_index(
        op.f("ix_member_company_id"), "member", ["company_id"], unique=False
    )

    op.create_table(
        "session",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("channel_id", sa.String(), nullable=True),
        sa.Column("folder_id", sa.String(), nullable=True),
        sa.Column("updated", sa.Text(), server_default="now", nullable=False),
        sa.Column("unread", sa.Boolean(), nullable=True),
        sa.Column("goal", sa.Text(), nullable=True),
        sa.Column(
            "participants", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["channel_id"], ["channel.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["folder_id"], ["folder.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_session_company_id"), "session", ["company_id"], unique=False
    )

    op.create_table(
        "message",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("author", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("system", sa.Boolean(), nullable=True),
        sa.Column(
            "attachment", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "actions", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["session_id"], ["session.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_message_company_id"), "message", ["company_id"], unique=False
    )

    # ── Step B: Create omilo_app role (non-superuser, idempotent) ─────────────
    op.execute(
        sa.text(
            """
            DO $$ BEGIN
                IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'omilo_app') THEN
                    CREATE ROLE omilo_app NOLOGIN;
                END IF;
            END $$
            """
        )
    )

    # ── Step C: Grant schema usage + DML on all tables ───────────────────────
    op.execute(sa.text("GRANT USAGE ON SCHEMA public TO omilo_app"))
    op.execute(
        sa.text(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omilo_app"
        )
    )
    # Also set default privileges so future tables are auto-granted
    op.execute(
        sa.text(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
            "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO omilo_app"
        )
    )

    # ── Step D: Enable FORCE RLS + tenant_isolation policy on tenant tables ──
    for tbl in TENANT_TABLES:
        op.execute(sa.text(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY"))
        op.execute(sa.text(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY"))
        op.execute(
            sa.text(
                f"CREATE POLICY tenant_isolation ON {tbl} "
                f"USING (company_id = current_setting('app.company_id', true))"
            )
        )


def downgrade() -> None:
    """Drop RLS policies, tables, and revoke default privileges."""

    # Drop tenant_isolation policies
    for tbl in reversed(TENANT_TABLES):
        op.execute(
            sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl}")
        )

    # Drop indexes and tables in dependency order
    op.drop_index(op.f("ix_message_company_id"), table_name="message")
    op.drop_table("message")
    op.drop_index(op.f("ix_session_company_id"), table_name="session")
    op.drop_table("session")
    op.drop_index(op.f("ix_member_company_id"), table_name="member")
    op.drop_table("member")
    op.drop_index(op.f("ix_goal_company_id"), table_name="goal")
    op.drop_table("goal")
    op.drop_index(op.f("ix_folder_company_id"), table_name="folder")
    op.drop_table("folder")
    op.drop_table("user")
    op.drop_index(op.f("ix_inbox_item_company_id"), table_name="inbox_item")
    op.drop_table("inbox_item")
    op.drop_table("company")
    op.drop_index(op.f("ix_channel_company_id"), table_name="channel")
    op.drop_table("channel")

    # Revoke default privileges (guarded — best effort)
    op.execute(
        sa.text(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
            "REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM omilo_app"
        )
    )
    # NOTE: role omilo_app is intentionally left in place on downgrade
    # (dropping it is disruptive if other objects reference it; it is idempotent
    # to re-create it on next upgrade).
