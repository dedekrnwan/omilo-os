"""Tier detection & SQLite URL in Settings — task-1 tests."""
from omilo_api.config import Settings


def test_sqlite_url_resolves_and_is_light(tmp_path, monkeypatch):
    monkeypatch.setenv("OMILO_DATABASE_URL", f"sqlite:///{tmp_path}/omilo.db")
    s = Settings()
    assert s.resolved_database_url().startswith("sqlite:///")
    assert s.tier == "light"


def test_postgres_url_still_full(monkeypatch):
    monkeypatch.setenv("OMILO_DATABASE_URL", "postgresql://omilo:omilo@127.0.0.1:5432/omilo")
    s = Settings()
    assert s.resolved_database_url().startswith("postgresql+psycopg://")
    assert s.tier == "full"


def test_default_is_light_sqlite(monkeypatch, tmp_path):
    monkeypatch.delenv("OMILO_DATABASE_URL", raising=False)
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    assert Settings().tier == "light"
