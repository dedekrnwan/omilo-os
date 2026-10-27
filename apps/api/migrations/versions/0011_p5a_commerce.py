"""0011_p5a_commerce — P5a commerce models: DoitPayment, WalletSettings, billing extensions.

Creates:
  - TENANT tables (grants + ENABLE+FORCE RLS + tenant_isolation policy):
    doit_payment, wallet_settings
Extends:
  - invoice: adds provider_ref (Text nullable, server_default NULL)
  - subscription: adds provider_ref (Text nullable, server_default NULL)

Revision ID: 0011_p5a_commerce
Revises: 0010_harness_account_tag
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0011_p5a_commerce"
down_revision: Union[str, Sequence[str], None] = "0010_harness_account_tag"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# Table lists
# ---------------------------------------------------------------------------

NEW_TENANT_TABLES = ["doit_payment", "wallet_settings"]


def upgrade() -> None:
    """Create doit_payment + wallet_settings; GRANT+RLS; extend invoice/subscription."""

    # ── Step A: Create doit_payment ──────────────────────────────────────────
    op.create_table(
        "doit_payment",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), server_default="doit", nullable=False),
        sa.Column("provider_payment_id", sa.Text(), nullable=True),
        sa.Column("reference", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("amount_idr", sa.Integer(), nullable=False),
        sa.Column("credits", sa.Integer(), server_default="0", nullable=False),
        sa.Column("rail", sa.Text(), nullable=True),
        sa.Column("hosted_url", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("plan_id", sa.Text(), nullable=True),
        sa.Column("granted", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "raw",
            postgresql.JSONB(astext_type=sa.Text()),
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
        sa.UniqueConstraint(
            "company_id",
            "provider_payment_id",
            name="uq_doit_payment_company_ppid",
        ),
    )
    op.create_index(
        op.f("ix_doit_payment_company_id"),
        "doit_payment",
        ["company_id"],
        unique=False,
    )

    # ── Step B: Create wallet_settings ───────────────────────────────────────
    op.create_table(
        "wallet_settings",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column(
            "auto_topup_enabled",
            sa.Boolean(),
            server_default="false",
            nullable=False,
        ),
        sa.Column(
            "auto_topup_threshold_credits",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column("auto_topup_pack", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("company_id"),
    )

    # ── Step C: Grant CRUD to omilo_app on both new tenant tables ─────────────
    for tbl in NEW_TENANT_TABLES:
        op.execute(
            sa.text(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO omilo_app"
            )
        )

    # ── Step D: Enable FORCE RLS + tenant_isolation policy on both tables ─────
    for tbl in NEW_TENANT_TABLES:
        op.execute(sa.text(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY"))
        op.execute(sa.text(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY"))
        op.execute(
            sa.text(
                f"CREATE POLICY tenant_isolation ON {tbl} "
                f"USING (company_id = current_setting('app.company_id', true))"
            )
        )

    # ── Step E: Additive columns on invoice + subscription ────────────────────
    # server_default=None means NULL — existing rows get NULL, which is correct
    # for optional Doit provider references.
    op.add_column(
        "invoice",
        sa.Column("provider_ref", sa.Text(), nullable=True),
    )
    op.add_column(
        "subscription",
        sa.Column("provider_ref", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    """Remove P5a changes: drop additive columns, RLS policies, new tables."""

    # Drop additive columns from invoice + subscription (reverse of upgrade)
    op.drop_column("subscription", "provider_ref")
    op.drop_column("invoice", "provider_ref")

    # Drop tenant_isolation policies (must precede DROP TABLE)
    for tbl in reversed(NEW_TENANT_TABLES):
        op.execute(
            sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl}")
        )

    # Drop indexes + new tables (reverse creation order)
    op.drop_index(op.f("ix_doit_payment_company_id"), table_name="doit_payment")
    op.drop_table("doit_payment")
    op.drop_table("wallet_settings")
