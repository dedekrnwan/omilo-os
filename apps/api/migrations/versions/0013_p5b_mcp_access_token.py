"""0013_p5b_mcp_access_token — P5b MCP access token model + ToolCall.actor column.

Creates:
  - TENANT table (grants + ENABLE+FORCE RLS + tenant_isolation policy):
    mcp_access_token
Extends:
  - tool_call: adds actor (Text, NOT NULL, server_default "agent")

Revision ID: 0013_p5b_mcp_access_token
Revises: 0012_plan_price_idr
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0013_p5b_mcp_access_token"
down_revision: Union[str, Sequence[str], None] = "0012_plan_price_idr"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NEW_TENANT_TABLES = ["mcp_access_token"]


def upgrade() -> None:
    """Create mcp_access_token table with RLS; add tool_call.actor column."""

    # ── Step A: Create mcp_access_token ──────────────────────────────────────
    op.create_table(
        "mcp_access_token",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("helper_id", sa.String(), nullable=False),
        sa.Column(
            "scopes",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "last_used_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "revoked_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_mcp_access_token_hash"),
    )
    op.create_index(
        op.f("ix_mcp_access_token_company_id"),
        "mcp_access_token",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_mcp_access_token_helper_id"),
        "mcp_access_token",
        ["helper_id"],
        unique=False,
    )

    # ── Step B: Grant CRUD to omilo_app on new tenant table ──────────────────
    for tbl in NEW_TENANT_TABLES:
        op.execute(
            sa.text(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO omilo_app"
            )
        )

    # ── Step C: Enable FORCE RLS + tenant_isolation policy ───────────────────
    for tbl in NEW_TENANT_TABLES:
        op.execute(sa.text(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY"))
        op.execute(sa.text(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY"))
        op.execute(
            sa.text(
                f"CREATE POLICY tenant_isolation ON {tbl} "
                f"USING (company_id = current_setting('app.company_id', true))"
            )
        )

    # ── Step D: Add actor column to tool_call (additive, server_default) ─────
    # Existing rows will receive "agent" via the server_default backfill.
    op.add_column(
        "tool_call",
        sa.Column(
            "actor",
            sa.Text(),
            nullable=False,
            server_default="agent",
        ),
    )


def downgrade() -> None:
    """Remove P5b changes: drop actor column, RLS policies, mcp_access_token table."""

    # Drop additive column from tool_call first
    op.drop_column("tool_call", "actor")

    # Drop tenant_isolation policies (must precede DROP TABLE)
    for tbl in reversed(NEW_TENANT_TABLES):
        op.execute(
            sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl}")
        )

    # Drop indexes + new table
    op.drop_index(
        op.f("ix_mcp_access_token_helper_id"),
        table_name="mcp_access_token",
    )
    op.drop_index(
        op.f("ix_mcp_access_token_company_id"),
        table_name="mcp_access_token",
    )
    op.drop_table("mcp_access_token")
