"""0004_p2_platform — P2 platform models + migration (RLS).

Adds 4 columns to Goal (additive, Goal already has RLS from P0).
Creates 5 new tenant tables: routine, routine_run, flow, flow_run, tool_call.
Grants DML to omilo_app; enables ENABLE + FORCE ROW LEVEL SECURITY with
tenant_isolation policy on all 5 new tenant tables (Goal is already covered).

Revision ID: 0004_p2_platform
Revises: 0003_company_autonomy_default
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0004_p2_platform"
down_revision: Union[str, Sequence[str], None] = "0003_company_autonomy_default"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# All 5 new P2 tables are tenant tables (company_id + RLS)
# ---------------------------------------------------------------------------

NEW_TENANT_TABLES = [
    "routine",
    "routine_run",
    "flow",
    "flow_run",
    "tool_call",
]


def upgrade() -> None:
    """Add Goal columns; create 5 new tables; grant DML; enable FORCE RLS."""

    # ── Step A: Additive columns on Goal (already has RLS) ──────────────────

    op.add_column(
        "goal",
        sa.Column("target", sa.Text(), nullable=False, server_default=""),
    )
    op.add_column(
        "goal",
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
    )
    op.add_column(
        "goal",
        sa.Column("autonomy_override", sa.Text(), nullable=True),
    )
    op.add_column(
        "goal",
        sa.Column("owner_helper_id", sa.Text(), nullable=True),
    )

    # ── Step B: Create new tenant tables ────────────────────────────────────

    # routine — recurring scheduled task for a Helper (os Shift)
    op.create_table(
        "routine",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("helper_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("subtitle", sa.Text(), server_default="", nullable=False),
        sa.Column("instructions", sa.Text(), server_default="", nullable=False),
        sa.Column("freq", sa.String(), nullable=False),  # RoutineFreq
        sa.Column("at", sa.String(), server_default="09:00", nullable=False),
        sa.Column(
            "days",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("monthly", sa.Text(), nullable=True),
        sa.Column("timezone", sa.String(), server_default="UTC", nullable=False),
        sa.Column("cron", sa.Text(), nullable=True),
        sa.Column(
            "sends_to",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("paused", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "managed_by_chief", sa.Boolean(), server_default="false", nullable=False
        ),
        sa.Column("next_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "goal_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("created_by", sa.String(), server_default="operator", nullable=False),
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
        op.f("ix_routine_company_id"), "routine", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_routine_helper_id"), "routine", ["helper_id"], unique=False
    )

    # routine_run — thin history row per Routine firing
    op.create_table(
        "routine_run",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("routine_id", sa.String(), nullable=False),
        sa.Column("job_id", sa.Text(), nullable=True),
        sa.Column("when", sa.DateTime(timezone=True), nullable=True),
        sa.Column("outcome", sa.Text(), nullable=True),
        sa.Column("duration", sa.Integer(), nullable=True),
        sa.Column("skipped", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("cost_credits", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_routine_run_company_id"), "routine_run", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_routine_run_routine_id"), "routine_run", ["routine_id"], unique=False
    )

    # flow — visual automation / workflow (os Workflow)
    op.create_table(
        "flow",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "channel_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "areas",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "trigger",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "poll_cursor",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "nodes",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "edges",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("status", sa.String(), server_default="draft", nullable=False),
        sa.Column("created_by", sa.String(), server_default="operator", nullable=False),
        sa.Column(
            "proposed_from_pattern",
            sa.Boolean(),
            server_default="false",
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
        op.f("ix_flow_company_id"), "flow", ["company_id"], unique=False
    )

    # flow_run — a single execution of a Flow
    op.create_table(
        "flow_run",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("flow_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="running", nullable=False),
        sa.Column("trigger_summary", sa.Text(), nullable=True),
        sa.Column("started_by", sa.Text(), nullable=True),
        sa.Column("cost_credits", sa.Integer(), server_default="0", nullable=False),
        sa.Column("duration", sa.Integer(), nullable=True),
        sa.Column("waiting_for", sa.Text(), nullable=True),
        sa.Column(
            "job_ids",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
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
        op.f("ix_flow_run_company_id"), "flow_run", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_flow_run_flow_id"), "flow_run", ["flow_id"], unique=False
    )

    # tool_call — audit record for every MCP tool invocation
    op.create_table(
        "tool_call",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("helper_id", sa.String(), nullable=False),
        sa.Column("job_id", sa.Text(), nullable=True),
        sa.Column("tool", sa.String(), nullable=False),
        sa.Column("decision", sa.String(), nullable=False),
        sa.Column(
            "detail",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column(
            "at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_tool_call_company_id"), "tool_call", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_tool_call_helper_id"), "tool_call", ["helper_id"], unique=False
    )

    # ── Step C: Grant DML on all 5 new tables to omilo_app ──────────────────
    for tbl in NEW_TENANT_TABLES:
        op.execute(
            sa.text(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO omilo_app"
            )
        )

    # ── Step D: Enable FORCE RLS + tenant_isolation policy on all 5 tables ──
    for tbl in NEW_TENANT_TABLES:
        op.execute(sa.text(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY"))
        op.execute(sa.text(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY"))
        op.execute(
            sa.text(
                f"CREATE POLICY tenant_isolation ON {tbl} "
                f"USING (company_id = current_setting('app.company_id', true))"
            )
        )


def downgrade() -> None:
    """Drop RLS policies, new tables (in safe order), and Goal columns."""

    # Drop tenant_isolation policies first
    for tbl in reversed(NEW_TENANT_TABLES):
        op.execute(
            sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl}")
        )

    # Drop new tables in reverse dependency order
    op.drop_index(op.f("ix_tool_call_helper_id"), table_name="tool_call")
    op.drop_index(op.f("ix_tool_call_company_id"), table_name="tool_call")
    op.drop_table("tool_call")

    op.drop_index(op.f("ix_flow_run_flow_id"), table_name="flow_run")
    op.drop_index(op.f("ix_flow_run_company_id"), table_name="flow_run")
    op.drop_table("flow_run")

    op.drop_index(op.f("ix_flow_company_id"), table_name="flow")
    op.drop_table("flow")

    op.drop_index(op.f("ix_routine_run_routine_id"), table_name="routine_run")
    op.drop_index(op.f("ix_routine_run_company_id"), table_name="routine_run")
    op.drop_table("routine_run")

    op.drop_index(op.f("ix_routine_helper_id"), table_name="routine")
    op.drop_index(op.f("ix_routine_company_id"), table_name="routine")
    op.drop_table("routine")

    # Drop P2 Goal columns (additive, safe to remove in downgrade)
    op.drop_column("goal", "owner_helper_id")
    op.drop_column("goal", "autonomy_override")
    op.drop_column("goal", "status")
    op.drop_column("goal", "target")
