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


def test_engine_from_onboarding_local(base_url):
    """_engine_from_onboarding returns provider=='local' + engine {type:claude-code,auth:local}
    when onboarding_ai is stored as {provider:'local'}, not silently degraded to 'fake'."""
    from omilo_api import services as S
    from omilo_api.db import session_scope
    from omilo_api.routers.api import _engine_from_onboarding

    with session_scope() as db:
        S.set_setting(db, "onboarding_ai", {"provider": "local"})
        pid, engine = _engine_from_onboarding(db)

    assert pid == "local", f"Expected pid=='local', got {pid!r}"
    assert engine == {"type": "claude-code", "auth": "local"}, f"Unexpected engine: {engine}"


# ---------------------------------------------------------------------------
# Task 3: local_login_status detection
# ---------------------------------------------------------------------------

def test_local_login_status_detects_credentials(tmp_path, monkeypatch):
    """With a fake claude on PATH and a credentials file present -> logged_in True."""
    from omilo_api import harness as H

    # Point CLAUDE_CONFIG_DIR at tmp_path and write a non-empty .credentials.json
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(tmp_path))
    creds = tmp_path / ".credentials.json"
    creds.write_text('{"token": "fake-oauth-token"}')

    # Provide a fake CLI path so installed=True
    fake_cli = str(tmp_path / "claude")
    (tmp_path / "claude").write_text("#!/bin/sh\n")
    (tmp_path / "claude").chmod(0o755)
    monkeypatch.setattr(H, "find_cli", lambda: fake_cli)

    status = H.local_login_status(fake_cli)
    assert status["installed"] is True, f"Expected installed=True, got {status}"
    assert status["logged_in"] is True, f"Expected logged_in=True, got {status}"


def test_local_login_status_absent(monkeypatch):
    """No claude installed -> exactly {"installed": False, "logged_in": False}."""
    from omilo_api import harness as H

    monkeypatch.setattr(H, "find_cli", lambda: None)
    # Ensure no credential env/files interfere
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)

    status = H.local_login_status(None)
    assert status == {"installed": False, "logged_in": False}, f"Unexpected: {status}"


def test_health_local_auth_reflects_login_status(monkeypatch):
    """health({"auth":"local"}) returns ok=True when local_login_status says logged_in."""
    import asyncio

    import omilo_api.harness as H
    from omilo_api.engines.claude_code import ClaudeCodeEngine

    engine = ClaudeCodeEngine()

    # Patch local_login_status to simulate logged-in state
    monkeypatch.setattr(H, "local_login_status", lambda cli=None: {"installed": True, "logged_in": True})
    result = asyncio.run(engine.health({"auth": "local"}))
    assert result["ok"] is True, f"Expected ok=True, got {result}"

    # Now simulate installed-but-not-logged-in
    monkeypatch.setattr(H, "local_login_status", lambda cli=None: {"installed": True, "logged_in": False})
    result2 = asyncio.run(engine.health({"auth": "local"}))
    assert result2["ok"] is False, f"Expected ok=False, got {result2}"

    # Not installed
    monkeypatch.setattr(H, "local_login_status", lambda cli=None: {"installed": False, "logged_in": False})
    result3 = asyncio.run(engine.health({"auth": "local"}))
    assert result3["ok"] is False, f"Expected ok=False, got {result3}"


def test_ai_state_contains_local_login(owner):
    """GET /api/ai includes a 'local_login' key with the right shape."""
    r = owner.get("/api/ai")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "local_login" in data, f"'local_login' key missing from /api/ai response: {list(data.keys())}"
    ll = data["local_login"]
    assert "installed" in ll and "logged_in" in ll, f"local_login shape wrong: {ll}"
    assert isinstance(ll["installed"], bool), f"installed should be bool: {ll}"
    assert isinstance(ll["logged_in"], bool), f"logged_in should be bool: {ll}"
