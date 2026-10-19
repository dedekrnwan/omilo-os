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


def test_concurrent_writes_retry(tmp_path, monkeypatch):
    """A writer that starts while another holds the write lock must wait/retry past
    busy_timeout and eventually commit — never raise 'database is locked'.

    Design: a background thread opens a RAW sqlite3 connection on the same file, takes an
    EXCLUSIVE write transaction (BEGIN IMMEDIATE + a write) and holds it ~1.5s, then commits
    and closes. The main thread, after the lock is taken, writes through session_scope. With
    busy_timeout=30000 the main writer blocks inside SQLite until the holder releases, then
    succeeds. (If busy_timeout were 0, or the pragma absent, it would raise immediately.)
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
        time.sleep(1.5)
        con.commit()
        con.close()
        holder_released.set()

    t = threading.Thread(target=hold_lock, daemon=True)
    t.start()
    assert holder_took.wait(5), "holder failed to take the write lock"

    started = time.monotonic()
    with db.session_scope("main") as s:
        s.add(Setting(key="company_name", value="B"))
    waited = time.monotonic() - started

    t.join(timeout=5)
    assert holder_released.is_set()
    # The writer had to wait for the holder (proves it blocked/retried rather than raising).
    assert waited > 0.5, f"writer did not wait for the lock (waited {waited:.2f}s)"

    with db.session_scope("main") as s:
        got = s.get(Setting, "company_name")
        assert got is not None and got.value == "B"
