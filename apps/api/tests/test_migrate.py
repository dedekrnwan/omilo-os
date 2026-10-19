"""Task 8: `omilo migrate --to postgres` — one-way light(SQLite)→full(Postgres) migration.

All-or-nothing: `migrate.run` copies every company's SQLite data into its Postgres schema
(reusing import_sqlite.import_company) and rebuilds the knowledge base, and only after ALL
companies succeed does it flip the install by writing the postgres URL to <data_dir>/.env.
On any failure it raises and leaves .env untouched (no half-flip).

These tests are Postgres-dependent: skipped when the omilo_test database is unreachable.
"""
import os
from pathlib import Path

import pytest
import sqlalchemy as sa

from omilo_api import company as C
from omilo_api import db, import_sqlite, migrate
from omilo_api.config import get_settings
from omilo_api.models import Setting, Staff

PG_URL = os.environ.get("OMILO_TEST_DATABASE_URL", "postgresql+psycopg://omilo:omilo@127.0.0.1:5432/omilo_test")


def _pg_reachable() -> bool:
    try:
        eng = sa.create_engine(PG_URL, poolclass=sa.pool.NullPool)
        with eng.connect():
            pass
        eng.dispose()
        return True
    except Exception:  # noqa: BLE001
        return False


# Applied per-test to the PG-gated end-to-end tests only; the *-INDEPENDENT tests below run always.
_requires_pg = pytest.mark.skipif(not _pg_reachable(), reason="Postgres (omilo_test) not reachable")


def _drop_schemas() -> None:
    eng = sa.create_engine(PG_URL, poolclass=sa.pool.NullPool)
    with eng.begin() as c:
        for (name,) in c.exec_driver_sql("SELECT nspname FROM pg_namespace WHERE left(nspname, 3) = 'co_'").all():
            c.exec_driver_sql(f'DROP SCHEMA "{name}" CASCADE')
    eng.dispose()


@pytest.fixture
def light_env(tmp_path, monkeypatch):
    """A fresh light-tier install in tmp_path: sqlite URL, OMILO_TIER=light, own data dir.

    Clears the postgres schemas this test family uses, and restores the conftest full-tier
    env (settings cache + engines + bus) afterwards so other tests are unaffected.
    """
    _drop_schemas()
    monkeypatch.setenv("OMILO_TIER", "light")
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OMILO_DATABASE_URL", f"sqlite:///{tmp_path}/omilo.db")
    monkeypatch.delenv("OMILO_REDIS_URL", raising=False)
    get_settings.cache_clear()
    db.reset_engine()
    C._cache.clear()
    C._cid.set(C.MAIN)
    try:
        yield tmp_path
    finally:
        get_settings.cache_clear()
        db.reset_engine()
        C._cache.clear()
        C._cid.set(C.MAIN)
        _drop_schemas()


def _seed_light(tmp_path: Path) -> list[str]:
    """Create 'main' + one more company on SQLite with a few rows each. Returns the company ids."""
    second = C.create("Beta Co")  # registers it and creates its sqlite db
    for cid in (C.MAIN, second):
        with db.session_scope(cid) as s:
            s.add(Setting(key="company_name", value=cid))
            s.add(Staff(id=f"stf_{cid}", name=f"Agent {cid}"))
    return [C.MAIN, second]


@_requires_pg
def test_migrate_copies_all_companies(light_env, monkeypatch):
    ids = _seed_light(light_env)
    env_file = light_env / ".env"

    out = migrate.run(PG_URL)

    assert out["flipped"] is True
    assert env_file.is_file()
    assert "OMILO_DATABASE_URL" in env_file.read_text()
    assert PG_URL in env_file.read_text()

    for cid in ids:
        assert cid in out["companies"]
        assert out["companies"][cid]["rows"] > 0

    # The rows must now exist in each company's Postgres schema. Point settings at PG and read.
    monkeypatch.setenv("OMILO_TIER", "full")
    monkeypatch.setenv("OMILO_DATABASE_URL", PG_URL)
    get_settings.cache_clear()
    db.reset_engine()
    for cid in ids:
        with db.session_scope(cid) as s:
            got = s.get(Setting, "company_name")
            assert got is not None and got.value == cid
            staff = s.get(Staff, f"stf_{cid}")
            assert staff is not None and staff.name == f"Agent {cid}"


# ---------------------------------------------------------------------------
# Postgres-INDEPENDENT tests of the durable-flip safety invariant.
#
# These run with NO skipif: they stub out every Postgres-touching collaborator
# (import_company, kb.reindex, db.session_scope/reset_engine, bus.reset) so that
# migrate.run exercises its orchestration — company loop + atomic .env flip — on
# a pure tmp_path, proving "copy all, then flip; on failure never flip".
# ---------------------------------------------------------------------------


@pytest.fixture
def stub_env(tmp_path, monkeypatch):
    """Isolate migrate.run from Postgres: tmp data dir, stubbed PG collaborators."""
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OMILO_TIER", "light")
    monkeypatch.setenv("OMILO_DATABASE_URL", f"sqlite:///{tmp_path}/omilo.db")
    monkeypatch.delenv("OMILO_REDIS_URL", raising=False)
    get_settings.cache_clear()

    # Two companies, discovered without hitting any DB.
    monkeypatch.setattr(C, "ids", lambda include_archived=False: [C.MAIN, "co_beta"])
    # session_scope must be a context manager that yields something harmless.
    import contextlib

    @contextlib.contextmanager
    def _fake_scope(cid=None):
        yield object()

    monkeypatch.setattr(db, "session_scope", _fake_scope)
    monkeypatch.setattr(db, "reset_engine", lambda: None)
    monkeypatch.setattr(migrate.bus, "reset", lambda: None)
    monkeypatch.setattr(migrate.kb, "reindex", lambda session: 0)
    yield tmp_path
    get_settings.cache_clear()


def test_flip_writes_env_atomically_and_merges(stub_env, monkeypatch):
    """A successful run writes <data_dir>/.env with the postgres URL, preserving an
    unrelated pre-existing key (atomic merge, not a clobber)."""
    data_dir = stub_env
    env_file = data_dir / ".env"
    env_file.write_text("OMILO_PUBLIC_URL=http://keep.me\n")

    monkeypatch.setattr(import_sqlite, "import_company", lambda cid, force=False: {"settings": 1})

    out = migrate.run(PG_URL)

    assert out["flipped"] is True
    text = env_file.read_text()
    assert "OMILO_DATABASE_URL" in text
    assert PG_URL in text
    # The unrelated key must survive the merge.
    assert "OMILO_PUBLIC_URL=http://keep.me" in text

    # End-to-end flip proof (no live PG): a fresh Settings with only OMILO_DATA_DIR set
    # (no OMILO_DATABASE_URL / OMILO_TIER in os.environ) reads <data_dir>/.env and resolves
    # to the postgres URL -> tier == "full".
    monkeypatch.delenv("OMILO_DATABASE_URL", raising=False)
    monkeypatch.delenv("OMILO_TIER", raising=False)
    monkeypatch.setenv("OMILO_DATA_DIR", str(data_dir))
    from omilo_api.config import Settings

    fresh = Settings()
    assert fresh.resolved_database_url().startswith("postgresql+psycopg://")
    assert fresh.tier == "full"


def test_failure_leaves_env_without_postgres_url(stub_env, monkeypatch):
    """A failure on the 2nd company raises and leaves .env WITHOUT the postgres URL."""
    data_dir = stub_env
    env_file = data_dir / ".env"

    calls = {"n": 0}

    def _raise_on_second(cid, force=False):
        calls["n"] += 1
        if calls["n"] >= 2:
            raise RuntimeError("boom on the second company")
        return {"settings": 1}

    monkeypatch.setattr(import_sqlite, "import_company", _raise_on_second)

    with pytest.raises(RuntimeError):
        migrate.run(PG_URL)

    assert not env_file.is_file() or "OMILO_DATABASE_URL" not in env_file.read_text()


@_requires_pg
def test_migrate_aborts_before_flip_on_failure(light_env, monkeypatch):
    ids = _seed_light(light_env)
    env_file = light_env / ".env"

    calls = {"n": 0}
    real = import_sqlite.import_company

    def _raise_on_second(cid, force=False):
        calls["n"] += 1
        if calls["n"] >= 2:
            raise RuntimeError("boom on the second company")
        return real(cid, force)

    monkeypatch.setattr(import_sqlite, "import_company", _raise_on_second)

    with pytest.raises(RuntimeError):
        migrate.run(PG_URL)

    # No half-flip: .env must not carry the postgres URL (the install stays on the light tier).
    assert not env_file.is_file() or "OMILO_DATABASE_URL" not in env_file.read_text()
    assert len(ids) == 2
