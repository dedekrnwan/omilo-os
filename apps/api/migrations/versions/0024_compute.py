"""0024_compute — ComputeWorker + ComputeJob tenant tables.

Creates two tenant tables (ENABLE + FORCE RLS, tenant_isolation policy,
GRANT to omilo_app) used by the compute control-plane (Tasks 3–6):

  - compute_worker: self-hosted worker node registered to a company.
    status: 'online' | 'offline'
    capacity / in_use: concurrency accounting
    last_seen_at: heartbeat timestamp
    token_hash: sha256 of the registration secret

  - compute_job: unit of work dispatched to (or awaiting) a worker.
    worker_id → compute_worker.id (nullable — unassigned when queued)
    status: 'queued' | 'dispatched' | 'running' | 'done' | 'error'
    spec: JSONB work payload
    lease_expires_at: stale-dispatch deadline
    result / artifact / error: output fields

Revision ID: 0024_compute
Revises: 0023_email_notifications
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0024_compute"
down_revision: Union[str, Sequence[str], None] = "0023_email_notifications"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

NEW_TENANT_TABLES = ["compute_worker", "compute_job"]


def upgrade() -> None:
    """Create compute_worker and compute_job tables with FORCE RLS."""

    # ── Step A: Create compute_worker ────────────────────────────────────────
    op.create_table(
        "compute_worker",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("company_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="offline"),
        sa.Column("capacity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("in_use", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_compute_worker_company_id"),
        "compute_worker",
        ["company_id"],
        unique=False,
    )

    # ── Step B: Create compute_job ────────────────────────────────────────────
    op.create_table(
        "compute_job",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("company_id", sa.Text(), nullable=False),
        sa.Column(
            "worker_id",
            sa.Text(),
            sa.ForeignKey("compute_worker.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column(
            "spec",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "lease_expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "result",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("artifact", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_compute_job_company_id"),
        "compute_job",
        ["company_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_compute_job_worker_id"),
        "compute_job",
        ["worker_id"],
        unique=False,
    )

    # ── Step C: Grant CRUD to omilo_app on new tenant tables ─────────────────
    for tbl in NEW_TENANT_TABLES:
        op.execute(
            sa.text(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO omilo_app"
            )
        )

    # ── Step D: Enable FORCE RLS + tenant_isolation policy ───────────────────
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
    """Drop compute_job, then compute_worker (reverse order; drop policies first)."""

    # Drop tenant_isolation policies (must precede DROP TABLE)
    for tbl in reversed(NEW_TENANT_TABLES):
        op.execute(
            sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl}")
        )

    # Drop compute_job indexes + table
    op.drop_index(op.f("ix_compute_job_worker_id"), table_name="compute_job")
    op.drop_index(op.f("ix_compute_job_company_id"), table_name="compute_job")
    op.drop_table("compute_job")

    # Drop compute_worker indexes + table
    op.drop_index(op.f("ix_compute_worker_company_id"), table_name="compute_worker")
    op.drop_table("compute_worker")
