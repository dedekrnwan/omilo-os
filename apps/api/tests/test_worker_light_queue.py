"""Task 6: worker KB queue, live-events WS, /healthz and the Claude Code pool leases in the
light tier (in-process, no Redis).

The `light` fixture mirrors tests/test_bus_local.py + test_db_sqlite_engine.py: force
OMILO_TIER=light, point at a sqlite data dir, clear the settings lru_cache so every module
sees the new tier, reset the engines and the bus. The full tier (Postgres+Redis that conftest
sets globally) is restored on teardown.
"""
import asyncio

import pytest

from omilo_api import bus, db, harness
from omilo_api import company as C
from omilo_api.config import get_settings


@pytest.fixture
def light(monkeypatch, tmp_path):
    monkeypatch.setenv("OMILO_TIER", "light")
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OMILO_DATABASE_URL", f"sqlite:///{tmp_path}/omilo.db")
    get_settings.cache_clear()
    db.reset_engine()
    bus.reset()
    harness.reset_leases()
    C._cache.clear()
    C._cid.set(C.MAIN)
    yield
    get_settings.cache_clear()
    db.reset_engine()
    bus.reset()
    harness.reset_leases()
    C._cache.clear()
    C._cid.set(C.MAIN)


# ------------------------------------------------------------------ 1) KB queue drains in-process
def test_light_embed_loop_drains_in_process(light):
    from omilo_api import kb

    with db.session_scope(C.MAIN) as s:
        kb.put(s, "doc", "c.md", "T", "body")  # marks pending in-process (routed through bus)
    assert "main" in bus.pop_pending(10)


# ------------------------------------------------------------------ 2) healthz needs no Redis
def test_healthz_ok_in_light(light):
    from fastapi.testclient import TestClient

    from omilo_api.main import app

    # The health check must be driven only by the DB and must not touch Redis in the light tier.
    r = TestClient(app).get("/healthz")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body.get("redis") != "ok"  # no live Redis ping in light
    assert "ping" not in str(body.get("redis", "")).lower()


# ------------------------------------------------------------------ 3) pool leases in-process
def test_pool_lease_in_process(light):
    acc = "acc-1"
    assert harness._busy_of(acc) == 0
    harness._take(acc)  # must NOT raise in light (the old Redis path would)
    assert harness._busy_of(acc) == 1
    assert harness.busy_counts().get(acc) == 1
    harness._give_back(acc)
    assert harness._busy_of(acc) == 0


def test_pool_lease_expiry_is_pruned(light):
    import time

    acc = "acc-exp"
    # An already-expired lease must be pruned on read (mirrors zremrangebyscore).
    harness._LEASES[harness._lease_key(acc)] = {"tok": time.time() - 1}
    assert harness._busy_of(acc) == 0


# ------------------------------------------------------------------ 4) office publish reaches subscriber
def test_office_publish_reaches_in_process_subscriber(light):
    async def run():
        q = bus.subscribe(C.MAIN, ["ch:office"])
        bus.publish("office", {"n": 1}, cid=C.MAIN)
        msg = await asyncio.wait_for(q.get(), timeout=1)
        bus.unsubscribe(q)
        return msg

    msg = asyncio.run(run())
    assert msg["data"] == {"n": 1}


# ------------------------------------------------------------------ 5) cancel reaches the in-process subscriber
def test_cancel_publish_reaches_in_process_subscriber(light):
    async def run():
        q = bus.subscribe(C.MAIN, ["ch:cancel:chat"])
        bus.publish("cancel:chat", {"thread_id": "th-1"}, cid=C.MAIN)
        msg = await asyncio.wait_for(q.get(), timeout=1)
        bus.unsubscribe(q)
        return msg

    msg = asyncio.run(run())
    assert msg["data"] == {"thread_id": "th-1"}
