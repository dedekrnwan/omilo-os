"""0006_p3_rag — P3 RAG/memory/skill/improvement models + pgvector migration.

Creates 5 new tenant tables: kb_source, kb_chunk, memory_doc, skill, improvement.
Enables the pgvector extension; adds HNSW index on kb_chunk.embedding and GIN
index on kb_chunk.tsv. Grants DML to omilo_app; enables ENABLE + FORCE ROW
LEVEL SECURITY with tenant_isolation policy on all 5 tables.

Revision ID: 0006_p3_rag
Revises: 0005_helper_mcp_token
Create Date: 2026-10-27
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "0006_p3_rag"
down_revision: Union[str, Sequence[str], None] = "0005_helper_mcp_token"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# All 5 new P3 tables are tenant tables (company_id + RLS)
# ---------------------------------------------------------------------------

NEW_TENANT_TABLES = [
    "kb_source",
    "kb_chunk",
    "memory_doc",
    "skill",
    "improvement",
]


def upgrade() -> None:
    """Enable pgvector; create 5 new RAG/memory tables; grant DML; enable FORCE RLS."""

    # ── Step A: Enable pgvector extension ───────────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── Step B: Create new tenant tables ────────────────────────────────────

    # kb_source — a knowledge-base source document / integration entry
    op.create_table(
        "kb_source",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("ref", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column("helper_id", sa.Text(), nullable=True),
        sa.Column(
            "meta",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
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
        op.f("ix_kb_source_company_id"), "kb_source", ["company_id"], unique=False
    )

    # kb_chunk — a single chunk of text from a KbSource, with optional embedding
    op.create_table(
        "kb_chunk",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("source_id", sa.String(), nullable=False),
        sa.Column("heading", sa.Text(), server_default="", nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("dim", sa.Integer(), server_default="256", nullable=False),
        sa.Column("embedding", Vector(256), nullable=True),
        sa.Column("embedding_model", sa.Text(), server_default="hash", nullable=False),
        sa.Column("embedded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("tsv", postgresql.TSVECTOR(), nullable=True),
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
        op.f("ix_kb_chunk_company_id"), "kb_chunk", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_kb_chunk_source_id"), "kb_chunk", ["source_id"], unique=False
    )

    # memory_doc — a persistent memory document for a Helper or company
    op.create_table(
        "memory_doc",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("helper_id", sa.Text(), nullable=True),
        sa.Column("path", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_memory_doc_company_id"), "memory_doc", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_memory_doc_helper_id"), "memory_doc", ["helper_id"], unique=False
    )

    # skill — a learned / authored callable skill for a Helper
    op.create_table(
        "skill",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("helper_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("body_md", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), server_default="draft", nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("usage_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_by", sa.String(), nullable=False),
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
        op.f("ix_skill_company_id"), "skill", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_skill_helper_id"), "skill", ["helper_id"], unique=False
    )

    # improvement — records a proposed or applied improvement to a Helper
    op.create_table(
        "improvement",
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("by", sa.String(), nullable=False),
        sa.Column("helper_id", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("ref", sa.Text(), nullable=True),
        sa.Column(
            "before",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "after",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "baseline",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "result",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column("status", sa.String(), server_default="active", nullable=False),
        sa.Column("task_id", sa.Text(), nullable=True),
        sa.Column("id", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_improvement_company_id"), "improvement", ["company_id"], unique=False
    )
    op.create_index(
        op.f("ix_improvement_helper_id"), "improvement", ["helper_id"], unique=False
    )

    # ── Step C: Specialised vector + FTS indexes on kb_chunk ────────────────

    # HNSW index for fast approximate nearest-neighbour cosine search
    op.execute(
        "CREATE INDEX ix_kb_chunk_embedding_hnsw "
        "ON kb_chunk USING hnsw (embedding vector_cosine_ops)"
    )

    # GIN index for full-text search on tsv column
    op.execute(
        "CREATE INDEX ix_kb_chunk_tsv "
        "ON kb_chunk USING gin (tsv)"
    )

    # ── Step D: Grant DML on all 5 new tables to omilo_app ──────────────────
    for tbl in NEW_TENANT_TABLES:
        op.execute(
            sa.text(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON {tbl} TO omilo_app"
            )
        )

    # ── Step E: Enable FORCE RLS + tenant_isolation policy on all 5 tables ──
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
    """Drop RLS policies, specialised indexes, and new tables."""

    # Drop tenant_isolation policies first
    for tbl in reversed(NEW_TENANT_TABLES):
        op.execute(
            sa.text(f"DROP POLICY IF EXISTS tenant_isolation ON {tbl}")
        )

    # Drop specialised indexes
    op.execute("DROP INDEX IF EXISTS ix_kb_chunk_embedding_hnsw")
    op.execute("DROP INDEX IF EXISTS ix_kb_chunk_tsv")

    # Drop new tables in reverse dependency order
    op.drop_index(op.f("ix_improvement_helper_id"), table_name="improvement")
    op.drop_index(op.f("ix_improvement_company_id"), table_name="improvement")
    op.drop_table("improvement")

    op.drop_index(op.f("ix_skill_helper_id"), table_name="skill")
    op.drop_index(op.f("ix_skill_company_id"), table_name="skill")
    op.drop_table("skill")

    op.drop_index(op.f("ix_memory_doc_helper_id"), table_name="memory_doc")
    op.drop_index(op.f("ix_memory_doc_company_id"), table_name="memory_doc")
    op.drop_table("memory_doc")

    op.drop_index(op.f("ix_kb_chunk_source_id"), table_name="kb_chunk")
    op.drop_index(op.f("ix_kb_chunk_company_id"), table_name="kb_chunk")
    op.drop_table("kb_chunk")

    op.drop_index(op.f("ix_kb_source_company_id"), table_name="kb_source")
    op.drop_table("kb_source")

    # Note: extension `vector` is intentionally retained on downgrade to avoid
    # accidental data loss in shared PG instances.
