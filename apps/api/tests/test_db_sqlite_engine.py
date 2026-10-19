"""Task 3: SQLite engine — file-per-company, WAL + busy_timeout pragmas, busy retry.

These tests drive the light tier (`OMILO_TIER=light`, sqlite data dir). conftest sets a
Postgres OMILO_DATABASE_URL globally; `_use_light` overrides env for one test, clears the
settings lru_cache and forgets any cached engines so engine(cid) re-boots on sqlite.
"""
import threading
import time

import pytest

from omilo_api import company as C
from omilo_api import db
from omilo_api.config import get_settings
from omilo_api.models import Setting


def _use_light(monkeypatch, tmp_path):
    monkeypatch.setenv("OMILO_TIER", "light")
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OMILO_DATABASE_URL", f"sqlite:///{tmp_path}/omilo.db")
    get_settings.cache_clear()
    db.reset_engine()
    C._cache.clear()
    C._cid.set(C.MAIN)


@pytest.fixture(autouse=True)
def _restore_full():
    """After each sqlite test, drop the settings cache and engines so the Postgres env returns."""
    yield
    get_settings.cache_clear()
    db.reset_engine()
    C._cache.clear()
    C._cid.set(C.MAIN)


def test_light_engine_is_file_per_company(tmp_path, monkeypatch):
    _use_light(monkeypatch, tmp_path)
    db.engine("main")
    db.engine("acme")
    # RULING (task-3): each company's db lives at dir_for(cid)/omilo.db.
    assert (tmp_path / "omilo.db").exists()
    assert (tmp_path / "companies" / "acme" / "omilo.db").exists()


def test_company_isolation(tmp_path, monkeypatch):
    _use_light(monkeypatch, tmp_path)
    with db.session_scope("main") as s:
        s.add(Setting(key="company_name", value="A"))
    with db.session_scope("acme") as s:
        assert s.get(Setting, "company_name") is None
    # and the write really landed in main
    with db.session_scope("main") as s:
        got = s.get(Setting, "company_name")
        assert got is not None and got.value == "A"


def test_wal_and_busy_timeout_pragmas(tmp_path, monkeypatch):
    _use_light(monkeypatch, tmp_path)
    eng = db.engine("main")
    assert db.is_sqlite(eng) is True
    with eng.connect() as c:
        assert c.exec_driver_sql("PRAGMA journal_mode").scalar().lower() == "wal"
        assert int(c.exec_driver_sql("PRAGMA busy_timeout").scalar()) == 30000
        assert int(c.exec_driver_sql("PRAGMA foreign_keys").scalar()) == 1


def test_concurrent_write_waits_then_succeeds(tmp_path, monkeypatch):
    """The binding guarantee: a write that starts while another holds the write lock must WAIT
    (via WAL + busy_timeout=30000) and then SUCCEED once the holder releases — never raise
    'database is locked', never 500.

    Design: a background thread opens a RAW sqlite3 connection on the same file, takes an
    EXCLUSIVE write transaction (BEGIN IMMEDIATE + a write) and holds it ~0.8s, then commits and
    closes. The main thread, after the holder has the lock, writes a Setting through
    session_scope (the normal engine, busy_timeout=30000). With busy_timeout the writer blocks
    inside SQLite until the holder releases, then commits successfully. (If busy_timeout were 0
    or the pragma absent, it would raise immediately.)
    """
    import sqlite3

    _use_light(monkeypatch, tmp_path)
    db.engine("main")  # create tables first
    path = db._sqlite_path("main")

    holder_took = threading.Event()
    holder_released = threading.Event()

    def hold_lock():
        con = sqlite3.connect(path, timeout=30)
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("BEGIN IMMEDIATE")
        con.execute("INSERT INTO setting(key, value) VALUES ('lock_holder', '\"x\"')")
        holder_took.set()
        time.sleep(0.8)
        con.commit()
        con.close()
        holder_released.set()

    t = threading.Thread(target=hold_lock, daemon=True)
    t.start()
    assert holder_took.wait(5), "holder failed to take the write lock"

    started = time.monotonic()
    # Must NOT raise — WAL + busy_timeout makes this block then succeed.
    with db.session_scope("main") as s:
        s.add(Setting(key="company_name", value="B"))
    waited = time.monotonic() - started

    t.join(timeout=5)
    assert holder_released.is_set()
    # The writer had to wait for the holder (proves it blocked rather than raising).
    assert waited > 0.3, f"writer did not wait for the lock (waited {waited:.2f}s)"

    with db.session_scope("main") as s:
        got = s.get(Setting, "company_name")
        assert got is not None and got.value == "B"


def test_commit_retry_surfaces_lock_without_runtimeerror(tmp_path, monkeypatch):
    """The commit-retry path (the previously-broken second-yield) must exercise cleanly: on a
    persistent 'database is locked' it re-raises the OperationalError after its bounded retries —
    it must NOT raise 'RuntimeError: generator didn't stop after throw()'.

    Design: force an immediate lock by holding BEGIN IMMEDIATE on a raw connection, then commit a
    probe session whose engine uses busy_timeout=0 (so SQLite errors instantly instead of waiting
    30s). _commit_with_retry retries twice, all fail while the holder keeps the lock, and it
    re-raises the OperationalError. We assert that exact type surfaces — never a RuntimeError.
    """
    import sqlite3

    from sqlalchemy import create_engine
    from sqlalchemy import event as sa_event
    from sqlalchemy.exc import OperationalError
    from sqlalchemy.orm import Session as SASession

    _use_light(monkeypatch, tmp_path)
    db.engine("main")  # create tables first
    path = db._sqlite_path("main")

    # A probe engine that errors immediately on contention (busy_timeout=0) — keeps the test fast.
    probe_eng = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})

    @sa_event.listens_for(probe_eng, "connect")
    def _probe_connect(dbapi_conn, _rec):  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=0")
        cur.close()

    assert db.is_sqlite(probe_eng)

    holder_took = threading.Event()
    release = threading.Event()

    def hold_lock():
        con = sqlite3.connect(path, timeout=30)
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("BEGIN IMMEDIATE")
        con.execute("INSERT INTO setting(key, value) VALUES ('lock_holder2', '\"y\"')")
        holder_took.set()
        release.wait(5)
        con.rollback()
        con.close()

    t = threading.Thread(target=hold_lock, daemon=True)
    t.start()
    assert holder_took.wait(5), "holder failed to take the write lock"

    probe = SASession(probe_eng)
    probe.add(Setting(key="company_name", value="C"))
    try:
        # _commit_with_retry flushes (acquiring the write lock the holder owns); busy_timeout=0 →
        # immediate OperationalError. The key guarantee: it surfaces that OperationalError cleanly —
        # NOT a 'RuntimeError: generator didn't stop after throw()' (the old second-yield bug) and
        # NOT a leaked PendingRollbackError.
        with pytest.raises(OperationalError) as exc:
            db._commit_with_retry(probe)
        assert db._is_locked(exc.value)
        assert not isinstance(exc.value, RuntimeError)
    finally:
        probe.rollback()
        probe.close()

    # Release the holder; the same helper on a fresh session must now commit cleanly (the retry/
    # commit path works end-to-end, no stuck state).
    release.set()
    t.join(timeout=5)
    probe2 = SASession(probe_eng)
    probe2.add(Setting(key="company_name", value="C"))
    try:
        db._commit_with_retry(probe2)  # no lock now → flush + commit succeed
    finally:
        probe2.close()
    probe_eng.dispose()

    with db.session_scope("main") as s:
        got = s.get(Setting, "company_name")
        assert got is not None and got.value == "C"
