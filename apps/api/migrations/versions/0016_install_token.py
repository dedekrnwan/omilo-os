"""0016_install_token — P6 Task 2: cloud-authoritative install_token table.

Creates:
  install_token — globally-queried table (no tenant RLS; privileged lookup by
  token_hash → company_id).  omilo_app has SELECT + INSERT + UPDATE.

Storage decision: install_token is NOT a tenant-RLS table because the
/control/* endpoints authenticate by raw token hash only — no company_id GUC
is set when the lookup happens.  The privileged session queries by token_hash
across all tenants (mirrors the MCP external-auth pattern for McpAccessToken
in mcp.external).  Once company_id is resolved from the token, the endpoint
scopes all subsequent business-logic queries to that company.

Revision ID: 0016_install_token
Revises: 0015_channel_area_fields
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers (single head — 0016 follows 0015_channel_area_fields)
# ---------------------------------------------------------------------------

revision: str = "0016_install_token"
down_revision: Union[str, Sequence[str], None] = "0015_channel_area_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create install_token table; grant SELECT/INSERT/UPDATE to omilo_app."""

    op.create_table(
        "install_token",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column(
            "label",
            sa.String(),
            nullable=False,
            server_default="default",
        ),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column(
            "last_seen_at",
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_install_token_hash"),
    )

    op.create_index(
        op.f("ix_install_token_company_id"),
        "install_token",
        ["company_id"],
        unique=False,
    )

    # Grant omilo_app SELECT, INSERT, UPDATE (not DELETE — revocation is soft)
    op.execute(
        sa.text("GRANT SELECT, INSERT, UPDATE ON install_token TO omilo_app")
    )


def downgrade() -> None:
    """Drop install_token table (revoke grant implicitly on DROP)."""

    op.drop_index(op.f("ix_install_token_company_id"), table_name="install_token")
    op.drop_table("install_token")
