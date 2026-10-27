"""0007_p4_billing — P4 billing/engine-pool/connector models + migration.

Creates:
  - GLOBAL tables (grants to omilo_app, NO RLS): plan, piece
  - TENANT tables (grants + ENABLE+FORCE RLS + tenant_isolation policy):
    credit_ledger, subscription, invoice, harness_account, provider_key, connector
Extends company with 4 additive columns: plan_id, credit_balance, edition,
overage_policy.
Seeds 3 plan rows: free, growth, scale.

Revision ID: 0007_p4_billing
Revises: 0006_p3_rag
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0007_p4_billing"
down_revision: Union[str, Sequence[str], None] = "0006_p3_rag"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# Table lists for grants and RLS
# ---------------------------------------------------------------------------

GLOBAL_TABLES = ["plan", "piece"]

NEW_TENANT_TABLES = [
    "credit_ledger",
    "subscription",
    "invoice",
    "harness_account",
    "provider_key",
    "connector",
]


def upgrade() -> None:
    """Create P4 tables; extend company; grant omilo_app; enable FORCE RLS on tenant tables; seed plans."""

    # ── Step A: Create GLOBAL tables (no company_id, no RLS) ─────────────────

    # plan — billing plan catalog (global)
    op.create_table(
        "plan",
        sa.Column("tier", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column(
            "monthly_price_usd",
            sa.Numeric(),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "included_credits",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "credit_overage_usd",
            sa.Numeric(),
            server_default="0",
            nullable=False,
        ),
        sa.Column("seats", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "features",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("id", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    # piece — integration catalog (global, slug TEXT PK)
    op.create_table(
        "piece",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("type", sa.String(), server_default="piece", nullable=False),
        sa.Column("runtime", sa.String(), server_default="http", nullable=False),
        sa.Column(
            "auth_descriptor",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "actions",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "mcp",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "triggers",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("logo", sa.Text(), nullable=True),
        sa.Column("catalog_commit", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), server_default="ok", nullable=False),
        sa.Column(
            "errors",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # ── Step B: Create TENANT tables ─────────────────────────────────────────

    # credit_ledger — per-tenant credit accounting
    op.create_table(
        "credit_ledger",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("delta", sa.Integer(), nullable=False),
        sa.Column("balance_after", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("job_id", sa.Text(), nullable=True),
        sa.Column("helper_id", sa.Text(), nullable=True),
        sa.Column(
            "provider_cost_usd",
            sa.Numeric(),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "credits_charged",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column(
            "meta",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_credit_ledger_company_id"),
        "credit_ledger",
        ["company_id"],
        unique=False,
    )

    # subscription — per-tenant plan subscription
    op.create_table(
        "subscription",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("plan_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="active", nullable=False),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seats", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "provider", sa.String(), server_default="manual", nullable=False
        ),
        sa.Column("external_ref", sa.Text(), nullable=True),
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
        op.f("ix_subscription_company_id"),
        "subscription",
        ["company_id"],
        unique=False,
    )

    # invoice — per-tenant billing invoice
    op.create_table(
        "invoice",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("amount", sa.Numeric(), nullable=False),
        sa.Column("currency", sa.String(), server_default="USD", nullable=False),
        sa.Column(
            "status", sa.String(), server_default="offline", nullable=False
        ),
        sa.Column("period", sa.String(), nullable=False),
        sa.Column(
            "provider", sa.String(), server_default="manual", nullable=False
        ),
        sa.Column("external_ref", sa.Text(), nullable=True),
        sa.Column("pdf_url", sa.Text(), nullable=True),
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
        op.f("ix_invoice_company_id"), "invoice", ["company_id"], unique=False
    )

    # harness_account — pooled LLM harness account
    op.create_table(
        "harness_account",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("harness", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("token_enc", sa.Text(), nullable=False),
        sa.Column("token_hint", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("status", sa.String(), server_default="ready", nullable=False),
        sa.Column("cooldown_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pct_window", sa.Integer(), server_default="0", nullable=False),
        sa.Column("tokens", sa.Text(), server_default="", nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("runs", sa.Integer(), server_default="0", nullable=False),
        sa.Column("cost_credits", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
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
        op.f("ix_harness_account_company_id"),
        "harness_account",
        ["company_id"],
        unique=False,
    )

    # provider_key — external provider API key
    op.create_table(
        "provider_key",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("key_enc", sa.Text(), nullable=False),
        sa.Column("key_hint", sa.Text(), nullable=False),
        sa.Column(
            "connected", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column(
            "used_by",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
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
        op.f("ix_provider_key_company_id"),
        "provider_key",
        ["company_id"],
        unique=False,
    )

    # connector — per-tenant integration connector instance
    op.create_table(
        "connector",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("piece_id", sa.Text(), nullable=True),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("command", sa.Text(), nullable=True),
        sa.Column(
            "args",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "secrets_enc",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "scopes",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("approval", sa.String(), server_default="ask", nullable=False),
        sa.Column(
            "default_on", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "status", sa.String(), server_default="needs_auth", nullable=False
        ),
        sa.Column(
            "poll_spec",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("health_at", sa.DateTime(timezone=True), nullable=True),
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
        op.f("ix_connector_company_id"), "connector", ["company_id"], unique=False
    )

    # ── Step C: Extend company with 4 new additive columns ───────────────────
    op.add_column("company", sa.Column("plan_id", sa.String(), nullable=True))
    op.add_column(
        "company",
        sa.Column(
            "credit_balance",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.add_column(
        "company",
        sa.Column(
            "edition",
            sa.String(),
            server_default="cloud",
            nullable=False,
        ),
    )
    op.add_column(
        "company",
        sa.Column(
            "overage_policy",
            sa.String(),
            server_default="soft",
            nullable=False,
        ),
    )

    # ── Step D: Grant CRUD on all new tables to omilo_app ────────────────────
    for tbl in GLOBAL_TABLES + NEW_TENANT_TABLES:
        op.execute(
            sa.text(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO omilo_app"
            )
        )

    # ── Step E: Enable FORCE RLS + tenant_isolation policy on tenant tables ──
    for tbl in NEW_TENANT_TABLES:
        op.execute(sa.text(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY"))
        op.execute(sa.text(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY"))
        op.execute(
            sa.text(
                f"CREATE POLICY tenant_isolation ON {tbl} "
                f"USING (company_id = current_setting('app.company_id', true))"
            )
        )

    # ── Step F: Seed 3 Plans (free / growth / scale) ─────────────────────────
    plan_table = sa.table(
        "plan",
        sa.column("id", sa.String()),
        sa.column("tier", sa.String()),
        sa.column("name", sa.String()),
        sa.column("monthly_price_usd", sa.Numeric()),
        sa.column("included_credits", sa.Integer()),
        sa.column("credit_overage_usd", sa.Numeric()),
        sa.column("seats", sa.Integer()),
        sa.column("features", postgresql.JSONB()),
    )
    op.bulk_insert(
        plan_table,
        [
            {
                "id": "pln_free",
                "tier": "free",
                "name": "Free",
                "monthly_price_usd": 0,
                "included_credits": 100,
                "credit_overage_usd": 0,
                "seats": 3,
                "features": {},
            },
            {
                "id": "pln_growth",
                "tier": "growth",
                "name": "Growth",
                "monthly_price_usd": 49,
                "included_credits": 2000,
                "credit_overage_usd": "0.02",
                "seats": 10,
                "features": {"advanced_analytics": True},
            },
            {
                "id": "pln_scale",
                "tier": "scale",
                "name": "Scale",
                "monthly_price_usd": 199,
                "included_credits": 10000,
                "credit_overage_usd": "0.015",
                "seats": 50,
                "features": {"advanced_analytics": True, "sso": True, "sla": True},
            },
        ],
    )


def downgrade() -> None:
    """Remove P4 changes: drop RLS policies, tenant tables, global tables, company columns."""

    # Drop tenant_isolation policies first
    for tbl in reversed(NEW_TENANT_TABLES):
        op.execute(
            sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl}")
        )

    # Remove the 4 additive company columns
    op.drop_column("company", "overage_policy")
    op.drop_column("company", "edition")
    op.drop_column("company", "credit_balance")
    op.drop_column("company", "plan_id")

    # Drop tenant table indexes and tables (reverse creation order)
    op.drop_index(op.f("ix_connector_company_id"), table_name="connector")
    op.drop_table("connector")

    op.drop_index(op.f("ix_provider_key_company_id"), table_name="provider_key")
    op.drop_table("provider_key")

    op.drop_index(
        op.f("ix_harness_account_company_id"), table_name="harness_account"
    )
    op.drop_table("harness_account")

    op.drop_index(op.f("ix_invoice_company_id"), table_name="invoice")
    op.drop_table("invoice")

    op.drop_index(op.f("ix_subscription_company_id"), table_name="subscription")
    op.drop_table("subscription")

    op.drop_index(op.f("ix_credit_ledger_company_id"), table_name="credit_ledger")
    op.drop_table("credit_ledger")

    # Drop global tables (no RLS to drop)
    op.drop_table("piece")
    op.drop_table("plan")
