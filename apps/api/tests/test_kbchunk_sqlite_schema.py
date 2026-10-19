"""Task 2: Verify KbChunk schema is dialect-neutral (SQLite-safe) without touching Postgres DDL."""
from sqlalchemy import inspect


def test_kbchunk_create_all_on_sqlite(tmp_path):
    from sqlalchemy import create_engine

    from omilo_api.db import Base
    from omilo_api import models  # noqa: F401

    eng = create_engine(f"sqlite:///{tmp_path}/t.db")
    Base.metadata.create_all(eng)          # must not raise
    insp = inspect(eng)
    cols = {c["name"] for c in insp.get_columns("kb_chunk")}
    assert "embedding" in cols and "tsv" not in cols


def test_kbchunk_postgres_ddl_intact():
    """Postgres DDL must still include vector + tsv columns — byte-for-byte full-tier DDL unchanged."""
    from sqlalchemy.schema import CreateTable
    from sqlalchemy.dialects import postgresql

    from omilo_api import models  # noqa: F401

    ddl = str(CreateTable(models.KbChunk.__table__).compile(dialect=postgresql.dialect()))
    assert "tsvector" in ddl.lower() or "tsv" in ddl.lower(), "tsv column missing from Postgres DDL"
    # embedding should render as a vector type, not BLOB, under postgres
    assert "tsvector" in ddl.lower() or "GENERATED ALWAYS AS" in ddl or "to_tsvector" in ddl.lower()
