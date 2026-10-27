"""0009_helper_access — Add helper_access tenant table.

Creates:
  - TENANT table (grants + ENABLE+FORCE RLS + tenant_isolation policy):
    helper_access

helper_access grants a Helper access to a connector/folder/skill by ref_id.

Revision ID: 0009_helper_access
Revises: 0008_helper_budget_credits_month
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0009_helper_access"
down_revision: Union[str, Sequence[str], None] = "0008_helper_budget_credits_month"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TENANT_TABLE = "helper_access"


def upgrade() -> None:
    """Create helper_access tenant table; grant omilo_app; enable FORCE RLS."""

    op.create_table(
        NEW_TENANT_TABLE,
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False, index=True),
        sa.Column("helper_id", sa.String(), nullable=False, index=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("ref_id", sa.String(), nullable=False),
        sa.Column("access", sa.String(), server_default="read", nullable=False),
        sa.Column("default_on", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Grant omilo_app CRUD on the new table
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON {NEW_TENANT_TABLE} TO omilo_app"
    )

    # Enable RLS (row-level security) and FORCE RLS
    op.execute(f"ALTER TABLE {NEW_TENANT_TABLE} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {NEW_TENANT_TABLE} FORCE ROW LEVEL SECURITY")

    # Create tenant_isolation policy: each row visible only to the active company
    op.execute(
        f"""
        CREATE POLICY tenant_isolation ON {NEW_TENANT_TABLE}
            USING (company_id = current_setting('app.company_id', true))
        """
    )


def downgrade() -> None:
    op.drop_table(NEW_TENANT_TABLE)
