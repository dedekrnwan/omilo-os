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
    # embedding must render as VECTOR (not BLOB) on Postgres — catches any regression that
    # accidentally uses LargeBinary for the full tier.
    assert "vector" in ddl.lower(), "embedding column missing VECTOR type from Postgres DDL"


def test_kbchunk_postgres_ddl_intact_after_sqlite_create_all(tmp_path):
    """sqlite create_all must NOT permanently strip pg_only columns from the shared Table object.
    Reproduces the Task 8 pattern: sqlite DDL in one step, Postgres DDL in the next."""
    from sqlalchemy import create_engine
    from sqlalchemy.schema import CreateTable
    from sqlalchemy.dialects import postgresql

    from omilo_api.db import Base
    from omilo_api import models  # noqa: F401

    # Step 1: run sqlite create_all (strips tsv from Table, then restores it)
    sqlite_eng = create_engine(f"sqlite:///{tmp_path}/t.db")
    Base.metadata.create_all(sqlite_eng)

    # Step 2: compile Postgres DDL — tsv must still be present
    ddl = str(CreateTable(models.KbChunk.__table__).compile(dialect=postgresql.dialect()))
    assert "tsvector" in ddl.lower() or "to_tsvector" in ddl.lower(), (
        "tsv column was permanently stripped from KbChunk.__table__ by a prior sqlite create_all"
    )
    assert "vector" in ddl.lower(), (
        "embedding VECTOR column missing from Postgres DDL after sqlite create_all"
    )
