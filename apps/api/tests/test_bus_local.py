"""Task 4: in-process LocalBus for the light tier (no Redis).

The `light` fixture forces OMILO_TIER=light, clears the settings lru_cache so bus sees the
new tier, and resets the bus (which also clears _LocalBus state). After each test it restores
the Postgres/full env that conftest set globally. The full-tier test proves the new
mark_pending/pop_pending helpers hit Redis on exactly gkey("kb:pending"), so Task 6's swap is
behaviour-preserving.
"""
import sys
import time

import pytest

from omilo_api import bus
from omilo_api import company as C
from omilo_api.config import get_settings


@pytest.fixture
def light(monkeypatch):
    monkeypatch.setenv("OMILO_TIER", "light")
    get_settings.cache_clear()
    bus.reset()
    C._cid.set(C.MAIN)
    yield
    get_settings.cache_clear()
    bus.reset()
    C._cid.set(C.MAIN)


def test_local_lock_is_exclusive(light):
    with bus.lock("x") as a:
        assert a is True
    # claim/release round-trip
    assert bus.claim("c", 10) is True
    assert bus.claim("c", 10) is False
    bus.release("c")
    assert bus.claim("c", 10) is True


def test_local_set_json_ttl(light):
    bus.set_json("k", {"v": 1}, ttl_s=0.01)
    time.sleep(0.02)
    assert bus.get_json("k") is None


def test_local_set_json_roundtrip(light):
    bus.set_json("k", {"v": 1})
    assert bus.get_json("k") == {"v": 1}


def test_local_throttle(light):
    assert bus.throttle("t", 10) is True
    assert bus.throttle("t", 10) is False


def test_local_pending_queue(light):
    bus.mark_pending("acme")
    assert "acme" in bus.pop_pending(10)
    assert bus.pop_pending(10) == []


def test_local_marks_roundtrip(light):
    bus.add_marks(["doc|a.md", "doc|b.md"], cid="acme")
    got = bus.pop_marks(10, cid="acme")
    assert set(got) == {"doc|a.md", "doc|b.md"}
    assert bus.pop_marks(10, cid="acme") == []


def test_local_drop(light):
    bus.set_json("kb:error", {"msg": "boom"}, cid="acme")
    assert bus.get_json("kb:error", cid="acme") == {"msg": "boom"}
    bus.drop("kb:error", cid="acme")
    assert bus.get_json("kb:error", cid="acme") is None


def test_no_redis_import_in_light(light, monkeypatch):
    # Even with the redis package hidden, check() must not raise or connect.
    monkeypatch.setitem(sys.modules, "redis", None)
    bus.check()  # must not raise, must not connect to redis


def test_local_publish_to_subscriber(light):
    import asyncio

    async def run():
        q = bus.subscribe("acme", [f"ch:{'x'}"])
        bus.publish("x", {"hi": 1}, cid="acme")
        msg = await asyncio.wait_for(q.get(), timeout=1)
        bus.unsubscribe(q)
        return msg

    msg = asyncio.run(run())
    assert msg["data"] == {"hi": 1}


def test_local_publish_no_subscriber_is_noop(light):
    # Never raises when nobody is listening.
    bus.publish("nobody", {"x": 1}, cid="acme")


# ------------------------------------------------------------------ full tier
def test_full_pending_roundtrip_uses_redis_gkey():
    """FULL tier: mark_pending/pop_pending go through Redis on gkey("kb:pending")."""
    get_settings.cache_clear()
    bus.reset()
    assert get_settings().tier == "full"
    key = bus.gkey("kb:pending")
    bus.r().delete(key)
    try:
        bus.mark_pending("acme")
        bus.mark_pending("beta")
        # The helper wrote to exactly gkey("kb:pending").
        assert bus.r().sismember(key, "acme")
        got = bus.pop_pending(10)
        assert set(got) == {"acme", "beta"}
        assert bus.pop_pending(10) == []
    finally:
        bus.r().delete(key)
