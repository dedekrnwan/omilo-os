"""Task 1: register "local" as a first-class provider in the engine-auth registry.

Tests:
- _engine_for("local", ...) returns {"type":"claude-code","auth":"local",...}
  and _provider_of(...) round-trips back to "local"
- _apply_ai accepts provider="local" with no Claude key set (no 400)
"""
import pytest


def test_local_engine_round_trip():
    """_engine_for("local") produces auth==local; _provider_of maps it back to "local"."""
    from omilo_api.routers.api import _engine_for, _provider_of

    # Without a model
    engine = _engine_for("local", None)
    assert engine == {"type": "claude-code", "auth": "local"}, f"Unexpected engine: {engine}"
    assert _provider_of(engine) == "local", f"Round-trip failed: {_provider_of(engine)}"

    # With a model
    engine_m = _engine_for("local", "claude-opus-4-5")
    assert engine_m == {"type": "claude-code", "auth": "local", "model": "claude-opus-4-5"}, (
        f"Unexpected engine with model: {engine_m}"
    )
    assert _provider_of(engine_m) == "local", f"Round-trip with model failed: {_provider_of(engine_m)}"

    # Existing paths must not regress
    assert _provider_of({"type": "claude-code", "auth": "api"}) == "claude"
    assert _provider_of({"type": "claude-code", "auth": "auto"}) == "claude-code"
    assert _provider_of({"type": "claude-code"}) == "claude-code"


def test_apply_ai_local_requires_no_key(owner, monkeypatch):
    """POST /api/ai {provider:"local"} succeeds even when no Claude API key is set."""
    import os

    from omilo_api import services as S
    from omilo_api.db import session_scope

    # Ensure no Claude key in DB
    with session_scope() as db:
        keys = dict(S.get_setting(db, "ai_keys", None) or {})
        keys.pop("claude", None)
        S.set_setting(db, "ai_keys", keys)

    # Ensure no key in env
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    r = owner.post("/api/ai", json={"provider": "local"})
    assert r.status_code == 200, f"Expected 200 for local provider with no key, got {r.status_code}: {r.text}"
    state = r.json()
    assert state["provider"] == "local", f"Expected provider==local, got {state['provider']}"

    # Reset to fake
    owner.post("/api/ai", json={"provider": "fake"})
