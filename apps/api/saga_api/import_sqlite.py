"""Move data from the SQLite files of earlier Saga OS versions into Postgres.

Before 0.4 every company was a SQLite file (<data_dir>/saga.db and <data_dir>/companies/<id>/saga.db). The first time
Saga OS starts on Postgres it copies each of them into that company's schema, once, if the schema is still empty. The
SQLite files are left where they are. Docs, files and keys already live in the data folder and need nothing.

CLI: python -m saga_api.import_sqlite [--force]   (--force: import even if the company already has data; rows that
already exist are skipped)
"""
from __future__ import annotations

import datetime as dt
import logging
import sqlite3
import sys
from pathlib import Path

from sqlalchemy import Integer, create_engine, func, inspect, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.pool import NullPool

from . import company as C
from .config import get_settings

log = logging.getLogger("saga.import")
SKIP = {"kb_source", "kb_chunk", "kb_query"}  # new in 0.4: built from the data, not copied


def sqlite_file(cid: str) -> Path:
    return C.dir_for(cid) / "saga.db"


def _empty(eng) -> bool:
    from .models import Setting, Staff, User

    with eng.connect() as c:
        if c.execute(select(func.count()).select_from(Setting.__table__).where(Setting.__table__.c.key == "imported_from_sqlite")).scalar():
            return False
        n = c.execute(select(func.count()).select_from(Staff.__table__)).scalar() or 0
        n += c.execute(select(func.count()).select_from(User.__table__)).scalar() or 0
    return n == 0


def _fix(v):
    if isinstance(v, dt.datetime) and v.tzinfo is None:
        return v.replace(tzinfo=dt.UTC)  # SQLite kept UTC without the zone
    return v


def import_company(cid: str, force: bool = False) -> dict | None:
    """Copy one company's SQLite file into its Postgres schema. Returns counts, or None when there is nothing to do."""
    from . import db as DB
    from .db import Base

    f = sqlite_file(cid)
    if not f.is_file() or f.stat().st_size == 0:
        return None
    eng = DB.engine(cid)
    if not force and not _empty(eng):
        return None
    src = create_engine(f"sqlite:///{f}", poolclass=NullPool)
    have = set(inspect(src).get_table_names())
    counts: dict[str, int] = {}
    with src.connect() as s, eng.begin() as d:
        for table in Base.metadata.sorted_tables:
            if table.name in SKIP or table.name not in have:
                continue
            cols_old = {c["name"] for c in inspect(src).get_columns(table.name)}
            cols = [c for c in table.columns if c.name in cols_old and not c.computed]
            rows = s.execute(select(*cols)).mappings().all()
            batch = []
            for r in rows:
                batch.append({k: _fix(v) for k, v in r.items()})
                if len(batch) >= 500:
                    d.execute(pg_insert(table).values(batch).on_conflict_do_nothing())
                    batch = []
            if batch:
                d.execute(pg_insert(table).values(batch).on_conflict_do_nothing())
            counts[table.name] = len(rows)
            pk = list(table.primary_key.columns)
            if len(pk) == 1 and isinstance(pk[0].type, Integer):
                d.exec_driver_sql(f"SELECT setval(pg_get_serial_sequence('\"{table.name}\"', '{pk[0].name}'), "
                                  f"GREATEST((SELECT COALESCE(MAX(\"{pk[0].name}\"), 0) FROM \"{table.name}\"), 1))")
        from .models import Setting

        d.execute(pg_insert(Setting.__table__).values(key="imported_from_sqlite", value={"file": str(f), "at": dt.datetime.now(dt.UTC).isoformat(),
                                                                                         "rows": sum(counts.values())}).on_conflict_do_nothing())
    src.dispose()
    log.info("imported %s from %s: %s rows", cid, f, sum(counts.values()))
    return counts


def import_all(force: bool = False) -> dict[str, dict]:
    out = {}
    for cid in [C.MAIN, *[c for c in C.ids() if c != C.MAIN]]:
        try:
            with C.use(cid):
                r = import_company(cid, force)
            if r is not None:
                out[cid] = r
        except (sqlite3.Error, Exception) as e:  # noqa: BLE001 - one company's file never blocks the start
            log.exception("importing %s failed: %s", cid, e)
    return out


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    logging.basicConfig(level=logging.INFO)
    res = import_all(force="--force" in args)
    if not res:
        print(f"Nothing to import (no SQLite files in {get_settings().data_dir}, or Postgres already has the data).")
        return 0
    for cid, counts in res.items():
        print(f"{cid}: {sum(counts.values())} rows ({', '.join(f'{k} {v}' for k, v in counts.items() if v)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
