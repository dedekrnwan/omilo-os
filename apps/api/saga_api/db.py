import threading
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from . import company as C
from .config import get_settings


class Base(DeclarativeBase):
    pass


# one engine per company (each company has its own database); the login lives in the first company's
_engines: dict[str, object] = {}
_makers: dict[str, sessionmaker] = {}
_lock = threading.RLock()


def _url(cid: str) -> str:
    cfg = get_settings()
    if cid == C.MAIN:
        return cfg.resolved_database_url()
    if cfg.database_url and "{company}" in cfg.database_url:  # e.g. postgresql://…/saga_{company}
        return cfg.database_url.replace("{company}", cid.replace("-", "_"))
    return f"sqlite:///{C.dir_for(cid) / 'saga.db'}"


def engine(cid: str | None = None):
    cid = cid or C.current()
    if cid in _engines:
        return _engines[cid]
    with _lock:
        if cid in _engines:
            return _engines[cid]
        url = _url(cid)
        kwargs = {"pool_pre_ping": True}
        if url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False, "timeout": 30}
        eng = create_engine(url, **kwargs)
        if url.startswith("sqlite"):

            @event.listens_for(eng, "connect")
            def _sqlite_pragmas(conn, _):  # WAL: the API and the worker can work at the same time
                cur = conn.cursor()
                cur.execute("PRAGMA journal_mode=WAL")
                cur.execute("PRAGMA foreign_keys=ON")
                cur.execute("PRAGMA synchronous=NORMAL")   # safe with WAL, far fewer disk syncs
                cur.execute("PRAGMA cache_size=-20000")    # ~20 MB page cache
                cur.execute("PRAGMA temp_store=MEMORY")
                cur.execute("PRAGMA busy_timeout=30000")
                cur.close()

        from . import models  # noqa: F401  (register tables)

        Base.metadata.create_all(eng)
        _migrate(eng)
        _engines[cid] = eng
        _makers[cid] = sessionmaker(bind=eng, expire_on_commit=False)
    return _engines[cid]


def _migrate(eng) -> None:
    """Data migrations that run once per database when it is opened."""
    from sqlalchemy.orm import Session as _S

    from .models import Staff

    with _S(eng) as db:
        changed = False
        for st in db.query(Staff):
            e = dict(st.engine or {})
            if e.get("type") in ("hermes", "openai"):  # Hermes is gone: Claude Code with the company's API key
                keep = {k: v for k, v in e.items() if k in ("timeout_s", "max_turns")}
                model = e.get("claude_model") or (e.get("model") if str(e.get("model", "")).startswith("claude") else None)
                st.engine = {"type": "claude-code", "auth": "api", **({"model": model} if model else {}), **keep}
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
