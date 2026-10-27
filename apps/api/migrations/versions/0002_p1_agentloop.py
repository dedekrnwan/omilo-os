"""0002_p1_agentloop — P1 agent-loop tables + RLS policies.

Creates the 7 P1 tables (helper, job, report, run_event, proposal,
proposal_revision, safety_limit), grants DML to omilo_app, and enables
FORCE ROW LEVEL SECURITY with a tenant_isolation policy on all 7 tables
(all are tenant tables carrying company_id).

Revision ID: 0002_p1_agentloop
Revises: 0001_p0_core
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0002_p1_agentloop"
down_revision: Union[str, Sequence[str], None] = "0001_p0_core"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# All 7 P1 tables are tenant tables (company_id + RLS)
# ---------------------------------------------------------------------------

TENANT_TABLES = [
    "helper",
    "job",
    "report",
    "run_event",
    "proposal",
    "proposal_revision",
    "safety_limit",
]


def upgrade() -> None:
    """Create all P1 tables, grant DML to omilo_app, enable FORCE RLS."""

    # ── Step A: Create tables ────────────────────────────────────────────────

    # helper — AI agent / staff member
    op.create_table(
        "helper",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("area", sa.String(), server_default="ops", nullable=False),
        sa.Column("role", sa.Text(), server_default="", nullable=False),
        sa.Column("job_description", sa.Text(), server_default="", nullable=False),
        sa.Column("is_chief", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "engine",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("autonomy_cap", sa.Text(), nullable=True),
        sa.Column(
            "permissions",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("status", sa.Text(), server_default="active", nullable=False),
        sa.Column(
            "channel_ids",
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
        op.f("ix_helper_company_id"), "helper", ["company_id"], unique=False
    )

    # job — unit of work dispatched to a Helper
    op.create_table(
        "job",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("helper_id", sa.String(), nullable=False),
        sa.Column("origin", sa.String(), nullable=False),
        sa.Column("parent_job_id", sa.Text(), nullable=True),
        sa.Column("goal_id", sa.Text(), nullable=True),
        sa.Column("routine_id", sa.Text(), nullable=True),
        sa.Column("flow_run_id", sa.Text(), nullable=True),
        sa.Column("session_id", sa.Text(), nullable=True),
        sa.Column("brief", sa.Text(), nullable=False),
        sa.Column("operator_note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), server_default="queued", nullable=False),
        sa.Column("proposal_id", sa.Text(), nullable=True),
        sa.Column("cost_credits", sa.Integer(), server_default="0", nullable=False),
        sa.Column("tokens_in", sa.Integer(), server_default="0", nullable=False),
        sa.Column("tokens_out", sa.Integer(), server_default="0", nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("result_text", sa.Text(), nullable=True),
        sa.Column("engine_type", sa.String(), server_default="fake", nullable=False),
        sa.Column(
            "checkpoint",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
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
        op.f("ix_job_company_id"), "job", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_job_helper_id"), "job", ["helper_id"], unique=False
    )

    # report — structured output written by a Helper after a Job
    op.create_table(
        "report",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("job_id", sa.String(), nullable=False),
        sa.Column("helper_id", sa.String(), nullable=False),
        sa.Column("headline", sa.String(), nullable=False),
        sa.Column("body_md", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "kpis",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column(
            "sources",
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
        op.f("ix_report_company_id"), "report", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_report_job_id"), "report", ["job_id"], unique=False
    )

    # run_event — live progress events for a Job (uses `at`, no created_at)
    op.create_table(
        "run_event",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("job_id", sa.String(), nullable=False),
        sa.Column("helper_id", sa.String(), nullable=False),
        sa.Column("session_id", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column(
            "data",
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_run_event_company_id"), "run_event", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_run_event_job_id"), "run_event", ["job_id"], unique=False
    )

    # proposal — request for human approval before a Helper acts
    op.create_table(
        "proposal",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("job_id", sa.String(), nullable=False),
        sa.Column("helper_id", sa.String(), nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("risk", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("body_md", sa.Text(), server_default="", nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("current_revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("decided_by", sa.Text(), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("execution_job_id", sa.Text(), nullable=True),
        sa.Column(
            "result",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
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
        op.f("ix_proposal_company_id"), "proposal", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_proposal_job_id"), "proposal", ["job_id"], unique=False
    )

    # proposal_revision — full history of edits to a Proposal (uses `at`, no created_at)
    op.create_table(
        "proposal_revision",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("proposal_id", sa.String(), nullable=False),
        sa.Column("n", sa.Integer(), nullable=False),
        sa.Column("body_md", sa.Text(), server_default="", nullable=False),
        sa.Column("author", sa.String(), nullable=False),
        sa.Column("summary", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_proposal_revision_company_id"),
        "proposal_revision",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_proposal_revision_proposal_id"),
        "proposal_revision",
        ["proposal_id"],
        unique=False,
    )

    # safety_limit — operator-set hard caps (Control-Panel → Safety & limits)
    op.create_table(
        "safety_limit",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.Column("scope", sa.String(), server_default="workspace", nullable=False),
        sa.Column("block_or_warn", sa.String(), server_default="block", nullable=False),
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
        op.f("ix_safety_limit_company_id"),
        "safety_limit",
        ["company_id"],
        unique=False,
    )

    # ── Step B: Grant DML on all new tables to omilo_app ────────────────────
    # omilo_app was created in 0001; default privileges cover new tables, but
    # we grant explicitly for clarity and idempotency.
    for tbl in TENANT_TABLES:
        op.execute(
            sa.text(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO omilo_app"
            )
        )

    # ── Step C: Enable FORCE RLS + tenant_isolation policy on all 7 tables ──
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
    """Drop RLS policies, indexes, and tables in dependency order."""

    # Drop tenant_isolation policies first
    for tbl in reversed(TENANT_TABLES):
        op.execute(
            sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl}")
        )

    # Drop tables and indexes in reverse dependency order
    op.drop_index(op.f("ix_safety_limit_company_id"), table_name="safety_limit")
    op.drop_table("safety_limit")

    op.drop_index(
        op.f("ix_proposal_revision_proposal_id"), table_name="proposal_revision"
    )
    op.drop_index(
        op.f("ix_proposal_revision_company_id"), table_name="proposal_revision"
    )
    op.drop_table("proposal_revision")

    op.drop_index(op.f("ix_proposal_job_id"), table_name="proposal")
    op.drop_index(op.f("ix_proposal_company_id"), table_name="proposal")
    op.drop_table("proposal")

    op.drop_index(op.f("ix_run_event_job_id"), table_name="run_event")
    op.drop_index(op.f("ix_run_event_company_id"), table_name="run_event")
    op.drop_table("run_event")

    op.drop_index(op.f("ix_report_job_id"), table_name="report")
    op.drop_index(op.f("ix_report_company_id"), table_name="report")
    op.drop_table("report")

    op.drop_index(op.f("ix_job_helper_id"), table_name="job")
    op.drop_index(op.f("ix_job_company_id"), table_name="job")
    op.drop_table("job")

    op.drop_index(op.f("ix_helper_company_id"), table_name="helper")
    op.drop_table("helper")
