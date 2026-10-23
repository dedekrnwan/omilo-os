import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy import event as _sa_event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from . import company as C
from .config import get_settings

log = logging.getLogger("omilo.db")

# sqlite-vec availability. The connect listener (light tier) tries to load the extension on every
# new sqlite connection; if it ever fails this flips False and the knowledge base falls back to a
# brute-force cosine scan (wired in Task 5, keyed on VEC_OK). Engine creation never fails for this.
VEC_OK = True


class Base(DeclarativeBase):
    pass


# one engine per company: every company is its own Postgres schema in the same database (search_path), so companies
# never see each other's rows. The owner's login lives in the first company's schema.
_engines: dict[str, object] = {}
_makers: dict[str, sessionmaker] = {}
_lock = threading.RLock()


def schema_for(cid: str) -> str:
    """co_main, co_acme_2 … (company ids are already short slugs)."""
    return "co_" + cid.replace("-", "_")


def _url(cid: str) -> str:
    return get_settings().resolved_database_url()


def _sqlite_path(cid: str) -> str:
    """Light tier: each company's database file lives inside its own directory (next to knowledge/,
    files/ …): main → <data_dir>/omilo.db, others → <data_dir>/companies/<cid>/omilo.db."""
    return str(C.dir_for(cid) / "omilo.db")  # dir_for() mkdirs the parent


def is_sqlite(bind) -> bool:
    """True when the engine/connection/session bind speaks sqlite."""
    eng = getattr(bind, "engine", bind)
    return getattr(getattr(eng, "dialect", None), "name", None) == "sqlite"


def _sqlite_engine(cid: str):
    """A per-company SQLite engine: WAL + busy_timeout + foreign keys on every connection, and a
    best-effort sqlite-vec load (failure flips VEC_OK, never breaks the engine)."""
    path = _sqlite_path(cid)
    eng = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 30})

    @_sa_event.listens_for(eng, "connect")
    def _on_connect(dbapi_conn, _rec):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        try:
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=30000")
            cur.execute("PRAGMA foreign_keys=ON")
        finally:
            cur.close()
        global VEC_OK
        try:
            dbapi_conn.enable_load_extension(True)
            import sqlite_vec

            sqlite_vec.load(dbapi_conn)
            dbapi_conn.enable_load_extension(False)
        except Exception as e:  # noqa: BLE001 - search falls back to brute force; engine must still boot
            VEC_OK = False
            log.warning("sqlite-vec unavailable (%s); knowledge base will use a brute-force cosine scan", e)

    from . import models  # noqa: F401  (register tables)

    Base.metadata.create_all(eng)
    _after_create(eng)
    _migrate(eng)
    return eng


def engine(cid: str | None = None):
    cid = cid or C.current()
    if cid in _engines:
        return _engines[cid]
    with _lock:
        if cid in _engines:
            return _engines[cid]
        if get_settings().tier == "light":
            eng = _sqlite_engine(cid)
            _engines[cid] = eng
            _makers[cid] = sessionmaker(bind=eng, expire_on_commit=False, info={"cid": cid})
            return _engines[cid]
        schema = schema_for(cid)
        url = _url(cid)
        # one-time setup with a plain connection: the vector extension (in public) and this company's schema
        boot = create_engine(url, pool_pre_ping=True, poolclass=NullPool)
        try:
            with boot.begin() as c:
                c.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
                c.exec_driver_sql(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        except OperationalError as e:
            raise RuntimeError(f"Can't reach the database ({e.orig}). Start it with `make db` (Postgres + Redis in Docker) "
                               "or set OMILO_DATABASE_URL.") from e
        finally:
            boot.dispose()
        eng = create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=10, pool_recycle=1800,
                            connect_args={"options": f"-csearch_path={schema},public"})

        from . import models  # noqa: F401  (register tables)

        Base.metadata.create_all(eng)
        _after_create(eng)
        _migrate(eng)
        _engines[cid] = eng
        _makers[cid] = sessionmaker(bind=eng, expire_on_commit=False, info={"cid": cid})
    return _engines[cid]


def _after_create(eng) -> None:
    """Indexes create_all can't express (full-text and vector search on the knowledge base)."""
    from .kb import ensure_indexes

    ensure_indexes(eng)


# Columns added to tables that already exist (create_all only creates missing tables). Each runs once per schema,
# guarded by IF NOT EXISTS, so it is safe on every start.
_COLUMNS = [
    ("notice", "item_id", "VARCHAR(32)"),
    ("notice", "who", "VARCHAR(120) NOT NULL DEFAULT ''"),
    ("thread", "pending", "JSON"),
    ("thread", "channel", "VARCHAR(16) NOT NULL DEFAULT 'web'"),
    ("message", "channel", "VARCHAR(16) NOT NULL DEFAULT 'web'"),
    ("inbox_item", "thread_id", "VARCHAR(32)"),
    ("staff", "access", "JSON"),
    ("staff", "brain", "VARCHAR(16) NOT NULL DEFAULT 'single_engine'"),
    ("staff", "autonomy", "VARCHAR(16) NOT NULL DEFAULT 'standard'"),
    ("staff", "voice", "TEXT NOT NULL DEFAULT ''"),
    ("harness_account", "cooldown_estimated", "BOOLEAN NOT NULL DEFAULT false"),
    ("goal", "channel_id", "VARCHAR(32)"),
    ("thread", "channel_id", "VARCHAR(32)"),
]


def _add_columns(eng) -> None:
    sqlite = is_sqlite(eng)
    with eng.begin() as c:
        existing: dict[str, set[str]] = {}
        if sqlite:
            # SQLite has no "ADD COLUMN IF NOT EXISTS": discover present columns via PRAGMA and add
            # only the missing ones (on a fresh create_all none are missing → a no-op).
            for table, _, _ in _COLUMNS:
                if table not in existing:
                    rows = c.exec_driver_sql(f'PRAGMA table_info("{table}")').all()
                    existing[table] = {r[1] for r in rows}
        for table, col, ddl in _COLUMNS:
            if sqlite:
                if col in existing.get(table, set()):
                    continue
                c.exec_driver_sql(f'ALTER TABLE "{table}" ADD COLUMN "{col}" {ddl}')
            else:
                c.exec_driver_sql(f'ALTER TABLE "{table}" ADD COLUMN IF NOT EXISTS "{col}" {ddl}')
        c.exec_driver_sql('CREATE INDEX IF NOT EXISTS ix_notice_item_id ON "notice" (item_id)')


def _migrate(eng) -> None:
    """Data migrations that run once per database when it is opened."""
    from sqlalchemy.orm import Session as _S

    _add_columns(eng)

    from .models import Staff

    with _S(eng) as db:
        from . import growth

        for st in db.query(Staff):  # helpers hired before weekly learning existed get it too
            try:
                growth.ensure_learning_shift(db, st, commit=False)
            except Exception:  # noqa: BLE001 - never block opening the database for this
                db.rollback()
        db.commit()
        changed = False
        for st in db.query(Staff):
            e = dict(st.engine or {})
            if e.get("type") in ("hermes", "openai"):  # Hermes is gone: Claude Code, subscription pool first with API-key overflow
                keep = {k: v for k, v in e.items() if k in ("timeout_s", "max_turns")}
                model = e.get("claude_model") or (e.get("model") if str(e.get("model", "")).startswith("claude") else None)
                st.engine = {"type": "claude-code", "auth": "auto", **({"model": model} if model else {}), **keep}
                changed = True
        if changed:
            db.commit()


def _maker(cid: str | None = None) -> sessionmaker:
    cid = cid or C.current()
    engine(cid)
    return _makers[cid]


def reset_engine():
    """Tests: forget the engines so a new database URL is picked up."""
    for e in _engines.values():
        e.dispose()
    _engines.clear()
    _makers.clear()


def init_db():
    main = engine(C.MAIN)
    for cid in C.ids():
        engine(cid)
    # Pre-0.4 SQLite files move into Postgres once, on the first full-tier start. In the light
    # tier the live database IS SQLite at those same paths, so there is nothing to import — and
    # the importer's Postgres-only sequence reset (setval/GREATEST) can't run on SQLite anyway.
    if not is_sqlite(main):
        from .import_sqlite import import_all

        import_all()


def _is_locked(exc: OperationalError) -> bool:
    """True for a sqlite 'database is locked'/'busy' OperationalError (retry-worthy)."""
    msg = str(getattr(exc, "orig", exc)).lower()
    return "database is locked" in msg or "database is busy" in msg


def get_db() -> Iterator[Session]:
    """The current company's database."""
    db = _maker(C.current())()
    try:
        yield db
    finally:
        db.close()


def get_auth_db() -> Iterator[Session]:
    """Where the owner's login lives (shared by every company)."""
    db = _maker(C.MAIN)()
    try:
        yield db
    finally:
        db.close()


def _commit_with_retry(db: Session) -> None:
    """Commit, retrying briefly on a sqlite 'database is locked'.

    WAL + busy_timeout=30000 already makes a blocked writer WAIT (not fail) while *acquiring* the
    write lock, so this is only reached in the rare case the lock outlives busy_timeout. For sqlite
    we flush once (that is where the write lock is taken; a lock here past busy_timeout is a genuine
    failure and propagates), then retry only the bare COMMIT statement on the SAME session: the
    writes are already buffered in the open transaction, so re-committing does NOT re-run the
    caller's `with` body. Postgres (and any non-sqlite bind) commits once, no retry.
    """
    if not is_sqlite(db.bind):
        db.commit()
        return
    import time

    db.flush()  # acquire the write lock + emit the writes (busy_timeout governs the wait here)
    for attempt in range(3):  # bare COMMIT: initial try + 2 retries
        try:
            db.commit()
            return
        except OperationalError as e:
            if not _is_locked(e) or attempt == 2:
                db.rollback()
                raise
            time.sleep(0.05 * (attempt + 1))


@contextmanager
def session_scope(cid: str | None = None) -> Iterator[Session]:
    db = _maker(cid)()
    try:
        yield db
        _commit_with_retry(db)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# Postgres enforces column lengths (SQLite never did): long free text in a short column is cut to fit instead of
# failing the whole request. Ids and references have room enough; this only trims titles, summaries and the like.
from sqlalchemy import String as _String  # noqa: E402
from sqlalchemy import event as _event  # noqa: E402


@_event.listens_for(Session, "before_flush")
def _fit_strings(session: Session, _ctx, _inst) -> None:
    for obj in list(session.new) + list(session.dirty):
        table = getattr(obj, "__table__", None)
        if table is None:
            continue
        for col in table.columns:
            n = getattr(col.type, "length", None)
            if not n or not isinstance(col.type, _String):
                continue
            v = getattr(obj, col.key, None)
            if isinstance(v, str) and len(v) > n:
                setattr(obj, col.key, v[: n - 1] + "…" if n > 8 else v[:n])
