import threading
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from . import company as C
from .config import get_settings


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


def engine(cid: str | None = None):
    cid = cid or C.current()
    if cid in _engines:
        return _engines[cid]
    with _lock:
        if cid in _engines:
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
    ("staff", "access", "JSON"),
    ("staff", "brain", "VARCHAR(16) NOT NULL DEFAULT 'single_engine'"),
    ("staff", "autonomy", "VARCHAR(16) NOT NULL DEFAULT 'standard'"),
    ("staff", "voice", "TEXT NOT NULL DEFAULT ''"),
]


def _add_columns(eng) -> None:
    with eng.begin() as c:
        for table, col, ddl in _COLUMNS:
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
    engine(C.MAIN)
    for cid in C.ids():
        engine(cid)
    from .import_sqlite import import_all  # data from SQLite versions (before 0.4) moves in once

    import_all()


def get_db() -> Iterator[Session]:
    """The current company's database."""
    db = _maker()()
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


@contextmanager
def session_scope(cid: str | None = None) -> Iterator[Session]:
    db = _maker(cid)()
    try:
        yield db
        db.commit()
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
