"""Transient-failure retries: shared jitter helper, built-in Claude engine, and connector calls."""
import asyncio

import httpx


def _run(coro):
    """Run a coroutine without tearing down the thread's event loop.

    asyncio.run() closes the loop and unsets it, which breaks sibling tests that still use the
    legacy asyncio.get_event_loop().run_until_complete() idiom. Reuse/create a loop and leave it set."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


def test_jittered_range_cap_and_variance():
    from omilo_api.services import jittered

    # base 30 * 2**1 = 60, plus jitter up to 25% → [60, 75]
    vals = [jittered(30, 1, frac=0.25) for _ in range(64)]
    assert all(60.0 <= v <= 75.0 for v in vals)
    assert len({round(v, 6) for v in vals}) > 1  # the whole point: the delays differ
    # cap is honoured; frac=0 removes jitter so the value is exact
    assert jittered(1.0, 10, cap=8.0, frac=0.0) == 8.0


def test_connector_retries_transient_then_succeeds(monkeypatch):
    """A connector call that hits 503 twice then 200 is retried to success (connector_retries=2)."""
    from omilo_api import pieces

    manifest = {
        "id": "gh", "auth": {"type": "oauth2", "provider": "github"},
        "actions": [{"name": "ping", "http": {"method": "GET", "url": "https://api.github.com/ping"}}],
    }
    calls = {"n": 0}

    class Resp:
        def __init__(self, code):
            self.status_code = code
            self.text = ""

        def json(self):
            return {"ok": self.status_code == 200}

    def fake_send(self, request):
        calls["n"] += 1
        return Resp(503 if calls["n"] < 3 else 200)  # 503, 503, 200

    monkeypatch.setattr(httpx.Client, "send", fake_send)
    monkeypatch.setattr(pieces, "_check_host", lambda *a, **k: None)
    monkeypatch.setattr(pieces.time, "sleep", lambda *a, **k: None)  # don't actually wait

    summary, meta = pieces.run_action(manifest, "ping", {}, token="x")
    assert calls["n"] == 3, "default connector_retries=2 → 3 total attempts"
    assert meta["status"] == 200
    assert meta["needs_reconnect"] is False


def test_connector_gives_up_after_retries(monkeypatch):
    """Persistent 503 exhausts the retries and surfaces the last (error) response, not an exception."""
    from omilo_api import pieces

    manifest = {
        "id": "gh", "auth": {"type": "oauth2", "provider": "github"},
        "actions": [{"name": "ping", "http": {"method": "GET", "url": "https://api.github.com/ping"}}],
    }
    calls = {"n": 0}

    class Resp:
        status_code = 503
        text = "overloaded"

        def json(self):
            raise ValueError("no body")

    def fake_send(self, request):
        calls["n"] += 1
        return Resp()

    monkeypatch.setattr(httpx.Client, "send", fake_send)
    monkeypatch.setattr(pieces, "_check_host", lambda *a, **k: None)
    monkeypatch.setattr(pieces.time, "sleep", lambda *a, **k: None)

    summary, meta = pieces.run_action(manifest, "ping", {}, token="x")
    assert calls["n"] == 3
    assert meta["status"] == 503


def test_claude_engine_retries_transient_post(monkeypatch):
    """The built-in Claude engine retries a transport blip on /v1/messages instead of failing the run."""
    from omilo_api.engines.claude import ClaudeEngine

    calls = {"n": 0}

    class FakeResp:
        status_code = 200
        text = ""

        def json(self):
            return {"stop_reason": "end_turn", "content": [{"type": "text", "text": "done"}],
                    "usage": {"input_tokens": 1, "output_tokens": 1}}

    async def fake_post(self, url, **kw):
        calls["n"] += 1
        if calls["n"] < 3:
            raise httpx.ConnectError("all connection attempts failed")
        return FakeResp()

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    monkeypatch.setattr(asyncio, "sleep", _no_sleep)

    cfg = {"api_key": "x", "model": "claude-test", "web": False, "max_tokens": 64}
    res = _run(ClaudeEngine()._loop(cfg, "sys", [{"role": "user", "content": "hi"}], None, None, 1, 5.0))
    assert calls["n"] == 3, "two transport blips should be retried before the 200"
    assert not res.error
    assert res.text == "done"


async def _no_sleep(*_a, **_k):
    return None
