"""Task 2 (+ corrective): KbChunk must be fully SQLite-safe — DDL *and* ORM INSERT/SELECT — while
keeping the Postgres full-text `tsv` column (now added by kb.ensure_indexes, not create_all)."""
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session


def test_kbchunk_create_all_on_sqlite(tmp_path):
    from omilo_api import models  # noqa: F401
    from omilo_api.db import Base

    eng = create_engine(f"sqlite:///{tmp_path}/t.db")
    Base.metadata.create_all(eng)          # must not raise
    insp = inspect(eng)
    cols = {c["name"] for c in insp.get_columns("kb_chunk")}
    # embedding stays (BLOB on sqlite); tsv is Postgres-only and never ORM-mapped.
    assert "embedding" in cols and "tsv" not in cols


def test_kbchunk_orm_roundtrip_on_sqlite(tmp_path):
    """The real corrective: ORM INSERT/SELECT of KbChunk must work on sqlite (no `tsv` column in
    the emitted SQL) and `id` must autoincrement as an INTEGER PRIMARY KEY (rowid alias)."""
    from omilo_api.db import Base
    from omilo_api.models import KbChunk, KbSource

    eng = create_engine(f"sqlite:///{tmp_path}/t.db")
    Base.metadata.create_all(eng)
    with Session(eng) as s:
        src = KbSource(kind="doc", ref="r1", title="T")
        s.add(src)
        s.flush()
        s.add(KbChunk(source_id=src.id, text="hi", dim=0))
        s.commit()
        row = s.scalar(select(KbChunk))
        assert row is not None
        assert row.text == "hi"
        assert isinstance(row.id, int) and row.id >= 1   # autoincremented integer id, no tsv error


def test_tsv_absent_from_create_all_added_by_ensure_indexes():
    """`tsv` must NOT be in the dialect-neutral create_all DDL (it would break sqlite), and it must
    be the generated column that kb.ensure_indexes installs on Postgres. embedding stays VECTOR on PG."""
    import inspect as _inspect

    from sqlalchemy.dialects import postgresql
    from sqlalchemy.schema import CreateTable

    from omilo_api import (
        kb,
        models,  # noqa: F401
    )

    ddl = str(CreateTable(models.KbChunk.__table__).compile(dialect=postgresql.dialect()))
    assert "tsv" not in ddl.lower(), "tsv must no longer be emitted by create_all — it's added by ensure_indexes"
    assert "vector" in ddl.lower(), "embedding column missing VECTOR type from Postgres DDL"

    # ensure_indexes is where tsv now lives: a generated tsvector STORED column.
    ei_src = _inspect.getsource(kb.ensure_indexes)
    assert "tsv tsvector" in ei_src and "generated always as" in ei_src.lower()
    assert "to_tsvector('simple', coalesce(heading, '') || ' ' || text)" in ei_src
