"""Task 10: graduation nudge – light tier tells users to migrate once KB exceeds a soft threshold.

TDD order:
  1. Tests are written here first (RED).
  2. `health.py` is then created to make them GREEN.

Fixtures mirror `test_worker_light_queue.py`: force OMILO_TIER=light + sqlite URL + tmp data dir,
clear the settings lru_cache, reset engines and bus, bring up the main company.
The full-tier tests rely on the global conftest Postgres env; no fixture is needed for them.
"""
import pytest

from omilo_api import bus
from omilo_api import company as C
from omilo_api import db
from omilo_api.config import get_settings


# --------------------------------------------------------------------------- light-tier fixture
@pytest.fixture
def light_company(monkeypatch, tmp_path):
    """Force the light tier: SQLite in tmp_path, no Redis."""
    monkeypatch.setenv("OMILO_TIER", "light")
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OMILO_DATABASE_URL", f"sqlite:///{tmp_path}/omilo.db")
    monkeypatch.setenv("OMILO_EMBED_PROVIDER", "hash")
    get_settings.cache_clear()
    db.reset_engine()
    bus.reset()
    C._cache.clear()
    C._cid.set(C.MAIN)
    db.engine("main")  # create tables
    yield
    get_settings.cache_clear()
    db.reset_engine()
    bus.reset()
    C._cache.clear()
    C._cid.set(C.MAIN)


# --------------------------------------------------------------------------- tests
def test_light_tier_nudges_after_threshold(light_company, monkeypatch):
    from omilo_api import health

    monkeypatch.setattr(health, "_kb_chunk_total", lambda: 6000)
    hint = health.graduate_hint()
    assert hint is not None
    assert "postgres" in hint.lower()
    assert "migrate" in hint.lower()


def test_light_tier_no_nudge_below_threshold(light_company, monkeypatch):
    from omilo_api import health

    monkeypatch.setattr(health, "_kb_chunk_total", lambda: 10)
    assert health.graduate_hint() is None


def test_full_tier_no_nudge(monkeypatch):
    """Full tier (Postgres settings, like the global conftest env) must NEVER nudge, even at high count."""
    from omilo_api import health

    monkeypatch.setattr(health, "_kb_chunk_total", lambda: 9999)
    # The global conftest sets OMILO_DATABASE_URL to postgresql://…, so get_settings().tier == "full".
    # graduate_hint() must return None without even looking at the count.
    assert health.graduate_hint() is None


def test_healthz_includes_graduate_hint(light_company, monkeypatch):
    """When the nudge fires, /healthz must expose the 'graduate' key."""
    from fastapi.testclient import TestClient

    from omilo_api import health
    from omilo_api.main import app

    monkeypatch.setattr(health, "_kb_chunk_total", lambda: 6000)
    r = TestClient(app).get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert "graduate" in body
    assert "postgres" in body["graduate"].lower()


def test_healthz_no_graduate_key_in_full_tier(monkeypatch):
    """In the full tier (global conftest env) /healthz must NOT include 'graduate'."""
    from fastapi.testclient import TestClient

    from omilo_api import health
    from omilo_api.main import app

    monkeypatch.setattr(health, "_kb_chunk_total", lambda: 9999)
    r = TestClient(app).get("/healthz")
    # 200 OR 503 (if Postgres not running in test env) — we only care the key is absent
    body = r.json()
    assert "graduate" not in body
