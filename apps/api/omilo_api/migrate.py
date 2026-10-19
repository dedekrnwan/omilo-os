"""`omilo migrate --to postgres` — one-way graduation from the light tier (SQLite) to the full
tier (Postgres + pgvector + Redis).

The light tier keeps every company in its own SQLite file (<data_dir>/omilo.db and
<data_dir>/companies/<id>/omilo.db). Graduating means copying each of those into the matching
Postgres schema and flipping the install's persistent config to point at Postgres.

It is **all-or-nothing**. We copy every company first; only once they have ALL succeeded do we
write OMILO_DATABASE_URL (and OMILO_REDIS_URL) to <data_dir>/.env — the single durable switch
Settings reads on the next start. If any company fails we raise and the .env is never touched,
so the install stays on the light tier exactly as it was.

How the copy targets Postgres: `import_sqlite.import_company(cid)` writes into whatever
`db.engine(cid)` builds, which follows `get_settings().tier`. So we point the live settings at
the target Postgres (env + cache_clear + engine/bus reset), then import. The SQLite *source*
files are still found via `company.dir_for(cid)/omilo.db` because we deliberately do NOT change
OMILO_DATA_DIR.

Re-embedding: `kb.reindex` rebuilds kb_source/kb_chunk from the freshly-imported data and marks
the chunks pending; it does NOT compute vectors here. The worker embeds them after the flip —
re-embedding a large knowledge base is slow and must not block (or fail) the migration.
Full-text search works immediately after reindex; semantic search fills in as the worker runs.
"""
from __future__ import annotations

import argparse
import os
import sys

from . import bus
from . import company as C
from . import db
from . import import_sqlite
from . import kb
from .config import get_settings

# The env keys migrate overrides, so the finally-block can restore exactly what was there before.
_SWITCH_KEYS = ("OMILO_DATABASE_URL", "OMILO_REDIS_URL", "OMILO_TIER")


def _reset_runtime() -> None:
    """Make the live process pick up the current OMILO_* env: new Settings, engines and bus."""
    get_settings.cache_clear()
    db.reset_engine()
    bus.reset()


def _write_env(data_dir, database_url: str, redis_url: str | None) -> None:
    """Persist the switch to <data_dir>/.env atomically (temp file + os.replace), preserving any
    other keys already there. This is the one durable change migrate makes."""
    env_path = data_dir / ".env"
    lines: list[str] = []
    overrides = {"OMILO_DATABASE_URL": database_url}
    if redis_url:
        overrides["OMILO_REDIS_URL"] = redis_url
    seen: set[str] = set()
    if env_path.is_file():
        for raw in env_path.read_text().splitlines():
            key = raw.split("=", 1)[0].strip()
            if key in overrides:
                lines.append(f"{key}={overrides[key]}")
                seen.add(key)
            else:
                lines.append(raw)
    for key, val in overrides.items():
        if key not in seen:
            lines.append(f"{key}={val}")
    data_dir.mkdir(parents=True, exist_ok=True)
    tmp = env_path.with_suffix(".env.tmp")
    tmp.write_text("\n".join(lines) + "\n")
    os.replace(tmp, env_path)


def run(database_url: str, redis_url: str | None = None, *, dry_run: bool = False) -> dict:
    """Migrate every company from SQLite into the target Postgres, all-or-nothing.

    Returns ``{"companies": {cid: {"rows": N, ...}}, "flipped": bool}``. On any company's failure
    this raises and does NOT write the .env (the install stays on the light tier).
    """
    # 1) Capture the world BEFORE switching: the (tier-independent, file-based) company list and the
    #    data dir where the SQLite source files live, plus the env we must restore afterwards.
    cids = C.ids(include_archived=True)
    cids = [C.MAIN, *[c for c in cids if c != C.MAIN]]  # MAIN first
    data_dir = get_settings().data_dir
    saved_env = {k: os.environ.get(k) for k in _SWITCH_KEYS}

    companies: dict[str, dict] = {}
    try:
        # 2) Point the live settings at the TARGET Postgres. Keep OMILO_DATA_DIR unchanged so the
        #    SQLite sources are still found at dir_for(cid)/omilo.db.
        os.environ["OMILO_DATABASE_URL"] = database_url
        os.environ["OMILO_TIER"] = "full"
        if redis_url:
            os.environ["OMILO_REDIS_URL"] = redis_url
        _reset_runtime()

        # 3) Copy every company into Postgres, then rebuild its knowledge base. ALL must succeed.
        for cid in cids:
            with C.use(cid):
                counts = import_sqlite.import_company(cid, force=True) or {}
                # kb.reindex opens a session on the now-Postgres engine and rebuilds kb_source/
                # kb_chunk from the imported rows + the on-disk docs, marking chunks pending.
                with db.session_scope(cid) as session:
                    reindexed = kb.reindex(session)
            companies[cid] = {"rows": sum(counts.values()), "tables": counts, "reindexed": reindexed}

        # 4) All companies succeeded. Flip the install (unless this was a dry run).
        flipped = False
        if not dry_run:
            _write_env(data_dir, database_url, redis_url)
            flipped = True
        return {"companies": companies, "flipped": flipped}
    finally:
        # 6) Leave an in-process caller (the tests) clean: restore the pre-migration env + runtime.
        #    In the real one-shot CLI the process exits anyway; the .env is the durable switch.
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        _reset_runtime()


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="omilo-migrate", description="Migrate Omilo from the light tier (SQLite) to the full tier (Postgres).")
    p.add_argument("--to", choices=["postgres"], required=True, help="target tier (only 'postgres' is supported)")
    p.add_argument("--database-url", required=True, help="target Postgres URL, e.g. postgresql://omilo:omilo@127.0.0.1:5432/omilo")
    p.add_argument("--redis-url", default=None, help="target Redis URL (optional; defaults to the built-in)")
    p.add_argument("--dry-run", action="store_true", help="prove the migration works but do NOT flip the config")
    args = p.parse_args(sys.argv[1:] if argv is None else argv)

    try:
        res = run(args.database_url, args.redis_url, dry_run=args.dry_run)
    except Exception as e:  # noqa: BLE001 - surface the failure; the install stays on the light tier
        print(f"migration failed: {e}", file=sys.stderr)
        print("Nothing was changed — this install is still on the light tier.", file=sys.stderr)
        return 1

    total = sum(c["rows"] for c in res["companies"].values())
    print(f"Migrated {len(res['companies'])} companies, {total} rows into Postgres:")
    for cid, c in res["companies"].items():
        print(f"  {cid}: {c['rows']} rows, {c['reindexed']} chunks queued for embedding")
    if res["flipped"]:
        print("Flipped this install to the full tier (wrote OMILO_DATABASE_URL to the data dir's .env).")
        print("Vectors re-embed in the background on the next start; full-text search works now.")
    elif args.dry_run:
        print("Dry run: verified the migration but left the config unchanged (still light tier).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
