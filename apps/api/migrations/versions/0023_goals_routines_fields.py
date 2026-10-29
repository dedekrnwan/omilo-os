"""0023_goals_routines_fields — goal + routine fields for the dummy-UI sweep.

Adds (all additive / nullable or defaulted):
  goal:
    - due            text        — free-form due label/date ("2026-12-31", "Nov 30")
    - measured_by    text        — "Measured by" metric description
    - helper_ids     jsonb []    — Helpers assigned to the goal
    - period         text        — reporting period, e.g. "2026-Q4"
    - session_id     text        — the goal's chat session (created once, reused)
    - status_set_by  text        — 'user' when the operator overrode the status,
                                   otherwise NULL/'system' (status derived)
  routine:
    - paused_until          timestamptz — auto-resume time for a paused routine
    - allow_chief_shift     bool true   — Chief may move it ±1h to avoid clashes
    - skip_holidays         bool false  — skip public holidays
    - ask_before_sending    bool false  — hold outputs for approval
    - dismissed_suggestions jsonb []    — Chief suggestion keys dismissed/applied
  routine_run:
    - trigger   text — 'schedule' | 'manual' | 'resend'
    - error     text — failure reason copied from the job
    - feedback  text — 'up' | 'down' (Was this useful?)

Revision ID: 0023_goals_routines_fields
Revises: 0023_docs_memory_meta
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0023_goals_routines_fields"
down_revision: Union[str, Sequence[str], None] = "0023_docs_memory_meta"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # goal
    op.add_column("goal", sa.Column("due", sa.Text(), nullable=True))
    op.add_column("goal", sa.Column("measured_by", sa.Text(), nullable=True))
    op.add_column(
        "goal",
        sa.Column("helper_ids", JSONB(), nullable=False, server_default="[]"),
    )
    op.add_column("goal", sa.Column("period", sa.Text(), nullable=True))
    op.add_column("goal", sa.Column("session_id", sa.Text(), nullable=True))
    op.add_column("goal", sa.Column("status_set_by", sa.Text(), nullable=True))

    # routine
    op.add_column(
        "routine",
        sa.Column("paused_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "routine",
        sa.Column("allow_chief_shift", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.add_column(
        "routine",
        sa.Column("skip_holidays", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "routine",
        sa.Column("ask_before_sending", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "routine",
        sa.Column("dismissed_suggestions", JSONB(), nullable=False, server_default="[]"),
    )

    # routine_run
    op.add_column("routine_run", sa.Column("trigger", sa.Text(), nullable=True))
    op.add_column("routine_run", sa.Column("error", sa.Text(), nullable=True))
    op.add_column("routine_run", sa.Column("feedback", sa.Text(), nullable=True))


def downgrade() -> None:
    for col in ("feedback", "error", "trigger"):
        op.drop_column("routine_run", col)
    for col in (
        "dismissed_suggestions",
        "ask_before_sending",
        "skip_holidays",
        "allow_chief_shift",
        "paused_until",
    ):
        op.drop_column("routine", col)
    for col in ("status_set_by", "session_id", "period", "helper_ids", "measured_by", "due"):
        op.drop_column("goal", col)
