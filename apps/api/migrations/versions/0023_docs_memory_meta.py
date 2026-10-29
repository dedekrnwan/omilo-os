"""0023_docs_memory_meta — docs / handbook / lessons (sweep/docs).

Adds:
  - memory_doc: title, kind, area, pinned, created_by, created_at, version, meta
    (all nullable or server-defaulted — additive).
  - memory_doc_version: per-save history of a doc (tenant, RLS).
  - handbook_suggestion: proposed handbook edits (tenant, RLS).
  - lesson: learned memories with a review status (tenant, RLS).

Revision ID: 0023_docs_memory_meta
Revises: 0022_flow_settings
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0023_docs_memory_meta"
down_revision: Union[str, Sequence[str], None] = "0022_flow_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TENANT_TABLES = ["memory_doc_version", "handbook_suggestion", "lesson"]


def _ts(name: str, nullable: bool = False) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=nullable)


def upgrade() -> None:
    op.add_column("memory_doc", sa.Column("title", sa.Text(), nullable=True))
    op.add_column("memory_doc", sa.Column("kind", sa.Text(), nullable=True))
    op.add_column("memory_doc", sa.Column("area", sa.Text(), nullable=True))
    op.add_column("memory_doc", sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("memory_doc", sa.Column("created_by", sa.Text(), nullable=True))
    op.add_column("memory_doc", _ts("created_at", nullable=True))
    op.add_column("memory_doc", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("memory_doc", sa.Column("meta", JSONB(), nullable=False, server_default="{}"))
    op.create_index("ix_memory_doc_kind", "memory_doc", ["kind"])

    op.create_table(
        "memory_doc_version",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("doc_id", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        _ts("created_at"),
    )
    op.create_index("ix_memory_doc_version_company_id", "memory_doc_version", ["company_id"])
    op.create_index("ix_memory_doc_version_doc_id", "memory_doc_version", ["doc_id"])

    op.create_table(
        "handbook_suggestion",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("doc_id", sa.Text(), nullable=False),
        sa.Column("helper_id", sa.Text(), nullable=True),
        sa.Column("author", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("proposed_content", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="open"),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        _ts("created_at"),
    )
    op.create_index("ix_handbook_suggestion_company_id", "handbook_suggestion", ["company_id"])
    op.create_index("ix_handbook_suggestion_doc_id", "handbook_suggestion", ["doc_id"])

    op.create_table(
        "lesson",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("helper_id", sa.Text(), nullable=True),
        sa.Column("tag", sa.Text(), nullable=False, server_default="lesson"),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.Text(), nullable=False, server_default="review"),
        sa.Column("created_by", sa.Text(), nullable=False, server_default=""),
        _ts("created_at"),
        _ts("updated_at", nullable=True),
    )
    op.create_index("ix_lesson_company_id", "lesson", ["company_id"])
    op.create_index("ix_lesson_helper_id", "lesson", ["helper_id"])

    for tbl in NEW_TENANT_TABLES:
        op.execute(sa.text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO omilo_app"))
        op.execute(sa.text(f"ALTER TABLE {tbl} ENABLE ROW LEVEL SECURITY"))
        op.execute(sa.text(f"ALTER TABLE {tbl} FORCE ROW LEVEL SECURITY"))
        op.execute(
            sa.text(
                f"CREATE POLICY tenant_isolation ON {tbl} "
                f"USING (company_id = current_setting('app.company_id', true))"
            )
        )


def downgrade() -> None:
    for tbl in reversed(NEW_TENANT_TABLES):
        op.execute(sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl}"))
        op.drop_table(tbl)
    op.drop_index("ix_memory_doc_kind", table_name="memory_doc")
    for col in ("meta", "version", "created_at", "created_by", "pinned", "area", "kind", "title"):
        op.drop_column("memory_doc", col)
