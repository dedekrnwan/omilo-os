"""Start over (`make reset`): everything is moved aside, nothing is deleted.

- the data folder (docs, files, keys) → <data_dir>-old-<stamp>
- each company's Postgres schema co_<id> → old<stamp>_co_<id> (same stamp, so `make restore-connectors` can find both)
- this install's Redis keys are cleared (they only hold live state)
"""
from __future__ import annotations

import datetime as dt
import sys

from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

from .config import get_settings


def old_schema(stamp: str, schema: str) -> str:
    return f"old{stamp.replace('-', '')}_{schema}"[:63]


def main(argv: list[str] | None = None) -> int:
    cfg = get_settings()
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    moved = []
    eng = create_engine(cfg.resolved_database_url(), poolclass=NullPool)
    try:
        with eng.begin() as c:
            for (name,) in c.exec_driver_sql("SELECT nspname FROM pg_namespace WHERE left(nspname, 3) = 'co_'").all():
                new = old_schema(stamp, name)
                c.exec_driver_sql(f'ALTER SCHEMA "{name}" RENAME TO "{new}"')
                moved.append(f"{name} → {new}")
    except Exception as e:  # noqa: BLE001
        print(f"Could not reach the database ({e}); only the data folder is moved aside.")
    finally:
        eng.dispose()
    d = cfg.data_dir
    if d.exists():
        d.rename(d.with_name(f"{d.name}-old-{stamp}"))
        moved.append(f"{d} → {d.name}-old-{stamp}")
    try:
        from . import bus

        r = bus.r()
        for k in r.scan_iter(f"{cfg.redis_prefix}:*", count=500):
            r.delete(k)
    except Exception:  # noqa: BLE001 - Redis only holds live state
        pass
    if not moved:
        print("Nothing to reset.")
        return 0
    print("Moved aside (not deleted):\n  " + "\n  ".join(moved))
    print("Start again with `make dev`. Connectors can come back: make restore-connectors")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
