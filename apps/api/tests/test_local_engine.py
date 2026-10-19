"""Task 2: the ``_run_local`` engine path — run the user's OWN locally-logged-in ``claude``.

The compliant path: Omilo injects NO credential. Neither CLAUDE_CODE_OAUTH_TOKEN nor
ANTHROPIC_API_KEY nor CLAUDE_CONFIG_DIR are set, so the user's own ~/.claude login resolves.

Tests:
- _run_local DIRECTLY (patch asyncio.create_subprocess_exec): capture env + args.
  Assert no CLAUDE_CODE_OAUTH_TOKEN, no ANTHROPIC_API_KEY, no CLAUDE_CONFIG_DIR, and --mcp-config present.
- The fallback ladder in _run (monkeypatch H.local_login_status / api_key):
  logged_in True -> _run_local; False + key -> _run_api; False + no key -> EngineResult error.
"""
import asyncio

import pytest

from omilo_api import harness as H
from omilo_api.engines import claude_code as CC
from omilo_api.engines.claude_code import ClaudeCodeEngine


class _FakeProc:
    """A stand-in for the claude subprocess: one result line, clean exit."""

    def __init__(self, line: bytes):
        self.returncode = 0
        self.stdout = self._Lines([line])
        self.stderr = self._Empty()

    class _Lines:
        def __init__(self, lines):
            self._lines = list(lines)

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self._lines:
                raise StopAsyncIteration
            return self._lines.pop(0)

    class _Empty:
        async def read(self):
            return b""

    async def wait(self):
        self.returncode = 0
        return 0

    def kill(self):  # pragma: no cover - never reached on clean exit
        pass


def _capture_subprocess(monkeypatch):
    """Patch create_subprocess_exec; return a dict that fills with the captured call."""
    seen: dict = {}
    result_line = b'{"type":"result","subtype":"success","result":"done","session_id":"sess-1","usage":{"input_tokens":3,"output_tokens":2}}\n'

    async def fake_exec(cli, *args, cwd=None, env=None, **kwargs):
        seen["cli"] = cli
        seen["args"] = list(args)
        seen["cwd"] = cwd
        seen["env"] = dict(env or {})
        return _FakeProc(result_line)

    monkeypatch.setattr(CC.asyncio, "create_subprocess_exec", fake_exec)
    return seen


def _cfg() -> dict:
    return {"auth": "local", "_mcp_url": "http://127.0.0.1:0/mcp", "_mcp_token": "tok", "model": "claude-opus-4-5"}


def _emit_sink():
    events: list[tuple] = []
    return events, (lambda kind, **kw: events.append((kind, kw)))


def test_run_local_injects_no_credential_and_no_config_dir(monkeypatch, tmp_path):
    """_run_local must not set any auth var nor CLAUDE_CONFIG_DIR; --mcp-config is still passed."""
    seen = _capture_subprocess(monkeypatch)
    # make sure a stray env var would be visible if (wrongly) forwarded — STRIP_ENV should drop it
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-should-be-stripped")
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-should-be-stripped")

    events, emit = _emit_sink()
    mcp_file = tmp_path / "mcp.json"
    mcp_file.write_text("{}")
    cwd = tmp_path

    e = ClaudeCodeEngine()
    remembered: list[str] = []
    res = asyncio.run(e._run_local(
        "claude", _cfg(), "SYSTEM", "do a thing", None, emit, 30, remembered.append,
        tools=["mcp__omilo", "Read"], extra=["--add-dir", str(tmp_path)], mcp_file=mcp_file, cwd=cwd,
    ))

    assert res.error == "", f"expected a clean run, got error: {res.error!r}"
    assert res.text == "done", res

    env = seen["env"]
    assert "CLAUDE_CODE_OAUTH_TOKEN" not in env, f"OAuth token must not be injected: {env.get('CLAUDE_CODE_OAUTH_TOKEN')!r}"
    assert "ANTHROPIC_API_KEY" not in env, f"API key must not be injected: {env.get('ANTHROPIC_API_KEY')!r}"
    assert "CLAUDE_CONFIG_DIR" not in env, f"CLAUDE_CONFIG_DIR must not be set (user's own ~/.claude resolves): {env.get('CLAUDE_CONFIG_DIR')!r}"

    args = seen["args"]
    assert "--mcp-config" in args and str(mcp_file) in args, f"--mcp-config {mcp_file} missing from args: {args}"
    assert "--strict-mcp-config" in args, f"--strict-mcp-config missing: {args}"
    assert "--model" in args and "claude-opus-4-5" in args, f"model flag missing: {args}"

    # it announces the user's own sign-in, not the pool or a key
    statuses = [kw for (k, kw) in events if k == "status"]
    assert any(s.get("account") == "your Claude sign-in" for s in statuses), f"missing local-sign-in status: {statuses}"


def test_run_local_resume_passes_session(monkeypatch, tmp_path):
    seen = _capture_subprocess(monkeypatch)
    _, emit = _emit_sink()
    mcp_file = tmp_path / "mcp.json"
    mcp_file.write_text("{}")

    e = ClaudeCodeEngine()
    asyncio.run(e._run_local(
        "claude", _cfg(), "SYSTEM", "continue", "prev-session", emit, 30, lambda s: None,
        tools=["Read"], extra=[], mcp_file=mcp_file, cwd=tmp_path,
    ))
    args = seen["args"]
    assert "--resume" in args and "prev-session" in args, f"--resume prev-session missing: {args}"


def _run_through_gate(monkeypatch, tmp_path, logged_in: bool, has_key: bool):
    """Drive the real _run() so the fallback ladder (local -> api -> error) is exercised.

    _run_local / _run_api are stubbed to tag which path fired; subprocess is never launched.
    """
    # company_dir for _dirs()
    from omilo_api.config import get_settings
    monkeypatch.setattr(type(get_settings()), "company_dir", tmp_path, raising=False)

    monkeypatch.setattr(H, "find_cli", lambda: "claude")
    monkeypatch.setattr(H, "local_login_status", lambda cli=None: {"installed": True, "logged_in": logged_in})
    monkeypatch.setattr(CC, "api_key", (lambda: "sk-ant-key") if has_key else (lambda: None))

    called: dict = {}

    async def fake_local(self, *a, **k):
        called["path"] = "local"
        return CC.EngineResult(text="local-ran")

    async def fake_api(self, *a, **k):
        called["path"] = "api"
        return CC.EngineResult(text="api-ran")

    monkeypatch.setattr(ClaudeCodeEngine, "_run_local", fake_local)
    monkeypatch.setattr(ClaudeCodeEngine, "_run_api", fake_api)

    _, emit = _emit_sink()
    e = ClaudeCodeEngine()
    res = asyncio.run(e._run(
        "staff-1", _cfg(), "SYSTEM", "prompt", None, emit, 30, lambda s: None, None,
    ))
    return called, res


def test_ladder_logged_in_uses_local(monkeypatch, tmp_path):
    called, res = _run_through_gate(monkeypatch, tmp_path, logged_in=True, has_key=True)
    assert called.get("path") == "local", f"expected local path, got {called}"
    assert res.text == "local-ran", res


def test_ladder_not_logged_in_with_key_uses_api(monkeypatch, tmp_path):
    called, res = _run_through_gate(monkeypatch, tmp_path, logged_in=False, has_key=True)
    assert called.get("path") == "api", f"expected api fallback, got {called}"
    assert res.text == "api-ran", res


def test_ladder_not_logged_in_no_key_returns_error(monkeypatch, tmp_path):
    called, res = _run_through_gate(monkeypatch, tmp_path, logged_in=False, has_key=False)
    assert called.get("path") is None, f"no subprocess path should fire: {called}"
    assert res.error, "expected an EngineResult with an error, not a crash"
    low = res.error.lower()
    assert "sign in" in low and ("api key" in low or "settings" in low), f"error should guide the user: {res.error!r}"


def test_harness_local_login_status_has_correct_shape():
    """local_login_status returns the required shape: {"installed": bool, "logged_in": bool}."""
    out = H.local_login_status()
    assert "installed" in out and "logged_in" in out
    assert isinstance(out["installed"], bool)
    assert isinstance(out["logged_in"], bool)
