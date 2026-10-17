"""LiteLLM engine loop tests: monkeypatch litellm.acompletion with canned OpenAI-shaped responses."""
import asyncio
import json
import types
from unittest.mock import AsyncMock, patch

import pytest

from omilo_api.engines import EngineResult
from omilo_api.engines.litellm_engine import LiteLLMEngine, mcp_tools_to_openai, resolve_key

# ---------------------------------------------------------------------------
# Fake response helpers — mimic litellm ModelResponse shape
# ---------------------------------------------------------------------------

def _usage(prompt=10, completion=5, cache_read=0, cache_create=0):
    u = types.SimpleNamespace(
        prompt_tokens=prompt,
        completion_tokens=completion,
        cache_read_input_tokens=cache_read,
        cache_creation_input_tokens=cache_create,
    )
    return u


def _resp(content="done", tool_calls=None, prompt=10, completion=5, cache_read=0, cache_create=0):
    """Build a minimal OpenAI-shaped ModelResponse for one turn."""
    msg = types.SimpleNamespace(content=content, tool_calls=tool_calls)
    choice = types.SimpleNamespace(message=msg)
    resp = types.SimpleNamespace(
        choices=[choice],
        usage=_usage(prompt, completion, cache_read, cache_create),
    )
    return resp


def _tool_call(tc_id, name, arguments: dict):
    fn = types.SimpleNamespace(name=name, arguments=json.dumps(arguments))
    return types.SimpleNamespace(id=tc_id, function=fn)


# ---------------------------------------------------------------------------
# Minimal fake MCPClient (no network)
# ---------------------------------------------------------------------------

class FakeMCP:
    def __init__(self, tools=None, results=None):
        self._tools = tools or [{"name": "echo", "description": "echo", "inputSchema": {"type": "object"}}]
        self._results = results or {}  # name -> (out, is_error)

    async def list_tools(self):
        return self._tools

    async def call_raw(self, name, args):
        return self._results.get(name, (json.dumps({"ok": True}), False))


# ---------------------------------------------------------------------------
# Test 1: tool loop runs until no tool_calls
# ---------------------------------------------------------------------------

def test_openai_tool_loop_runs_until_no_tool_calls():
    """One turn with a tool_call, then a plain text turn → returns text, tokens summed."""
    tc = _tool_call("tc_1", "echo", {"msg": "hi"})
    turn1 = _resp(content=None, tool_calls=[tc], prompt=10, completion=4)
    turn2 = _resp(content="all done", tool_calls=None, prompt=8, completion=3)
    call_count = {"n": 0}

    async def fake_acompletion(**kwargs):
        call_count["n"] += 1
        return turn1 if call_count["n"] == 1 else turn2

    mcp = FakeMCP(results={"echo": ('{"result":"hi"}', False)})
    engine = LiteLLMEngine()
    cfg = {"provider": "groq", "api_key": "sk-test-groq"}

    with patch("litellm.acompletion", side_effect=fake_acompletion):
        with patch("litellm.completion_cost", return_value=0.001):
            r = asyncio.run(engine._loop(cfg, "sys", [{"role": "user", "content": "hello"}], mcp, None, 10, 30))

    assert r.error == ""
    assert r.text == "all done"
    assert call_count["n"] == 2
    # prompt_tokens: 10+8=18, completion_tokens: 4+3=7, total=25
    assert r.tokens == 25
    # cost: 0.001 * 2 = 0.002
    assert abs(r.cost_usd - 0.002) < 1e-9


# ---------------------------------------------------------------------------
# Test 2: cache_control sent only for cache-supporting providers
# ---------------------------------------------------------------------------

def test_cache_control_sent_only_for_cache_providers():
    """Anthropic provider → system block list with cache_control; Groq → plain system string."""
    calls = {}

    async def fake_acompletion(**kwargs):
        calls["last"] = kwargs
        return _resp("ok")

    engine = LiteLLMEngine()
    msgs = lambda: [{"role": "user", "content": "hi"}]

    # Anthropic (supports_cache=True) → system is a content-block list
    with patch("litellm.acompletion", side_effect=fake_acompletion):
        with patch("litellm.completion_cost", return_value=0.0):
            asyncio.run(engine._loop({"provider": "anthropic", "api_key": "sk-ant-x"}, "stable prompt", msgs(), None, None, 1, 10))

    sys_anthropic = calls["last"]["messages"][0]
    assert sys_anthropic["role"] == "system"
    assert isinstance(sys_anthropic["content"], list)
    assert sys_anthropic["content"][0]["cache_control"] == {"type": "ephemeral"}

    # Groq (supports_cache=False) → system is a plain string
    with patch("litellm.acompletion", side_effect=fake_acompletion):
        with patch("litellm.completion_cost", return_value=0.0):
            asyncio.run(engine._loop({"provider": "groq", "api_key": "sk-groq-x"}, "stable prompt", msgs(), None, None, 1, 10))

    sys_groq = calls["last"]["messages"][0]
    assert sys_groq["role"] == "system"
    assert isinstance(sys_groq["content"], str)
    assert sys_groq["content"] == "stable prompt"


# ---------------------------------------------------------------------------
# Test 3: token and cost accounting
# ---------------------------------------------------------------------------

def test_token_and_cost_accounting():
    """usage prompt+completion+cache_* all summed; completion_cost() folded into cost_usd."""
    resp = _resp("ok", prompt=100, completion=20, cache_read=50, cache_create=40)

    async def fake_acompletion(**kwargs):
        return resp

    engine = LiteLLMEngine()
    with patch("litellm.acompletion", side_effect=fake_acompletion):
        with patch("litellm.completion_cost", return_value=0.005):
            r = asyncio.run(engine._loop(
                {"provider": "anthropic", "api_key": "sk-x"},
                "sys",
                [{"role": "user", "content": "hello"}],
                None, None, 1, 10
            ))

    # 100+20+50+40 = 210
    assert r.tokens == 210
    assert abs(r.cost_usd - 0.005) < 1e-9


# ---------------------------------------------------------------------------
# Test 4: completion_cost returning None defaults to 0.0 (no raise)
# ---------------------------------------------------------------------------

def test_completion_cost_none_defaults_zero():
    """completion_cost -> None must not raise; cost_usd stays 0.0."""
    async def fake_acompletion(**kwargs):
        return _resp("ok")

    engine = LiteLLMEngine()
    with patch("litellm.acompletion", side_effect=fake_acompletion):
        with patch("litellm.completion_cost", return_value=None):
            r = asyncio.run(engine._loop(
                {"provider": "groq", "api_key": "sk-groq-x"},
                "sys",
                [{"role": "user", "content": "hello"}],
                None, None, 1, 10
            ))

    assert r.error == ""
    assert r.cost_usd == 0.0


# ---------------------------------------------------------------------------
# Test 5: malformed response with no tool_calls terminates immediately
# ---------------------------------------------------------------------------

def test_malformed_response_without_tool_calls_terminates():
    """choices[0].message.tool_calls is None/[] → loop ends, returns text."""
    call_count = {"n": 0}

    async def fake_acompletion(**kwargs):
        call_count["n"] += 1
        return _resp("finished", tool_calls=None)

    engine = LiteLLMEngine()
    mcp = FakeMCP()
    with patch("litellm.acompletion", side_effect=fake_acompletion):
        with patch("litellm.completion_cost", return_value=0.0):
            r = asyncio.run(engine._loop(
                {"provider": "groq", "api_key": "sk-groq-x"},
                "sys",
                [{"role": "user", "content": "go"}],
                mcp, None, 5, 10
            ))

    assert r.text == "finished"
    assert r.error == ""
    assert call_count["n"] == 1  # terminated after first turn with no tool_calls


# ---------------------------------------------------------------------------
# Test 6: assistant message content is non-None on a tool-only turn (I2)
# ---------------------------------------------------------------------------

def test_tool_only_turn_assistant_content_not_none():
    """When the model returns tool_calls with content=None, the appended assistant message
    must have content="" (not None) so Mistral/Groq don't reject the next request."""
    tc = _tool_call("tc_x", "echo", {"msg": "test"})
    # Turn 1: tool-only response (content=None, has tool_calls)
    turn1 = _resp(content=None, tool_calls=[tc], prompt=5, completion=3)
    # Turn 2: plain text to end the loop
    turn2 = _resp(content="finished", tool_calls=None, prompt=4, completion=2)

    call_count = {"n": 0}
    captured_msgs = {}

    async def fake_acompletion(**kwargs):
        call_count["n"] += 1
        if call_count["n"] == 2:
            # Capture the messages sent on the second call so we can inspect the assistant msg
            captured_msgs["second_call"] = list(kwargs["messages"])
        return turn1 if call_count["n"] == 1 else turn2

    mcp = FakeMCP(results={"echo": ('{"result":"test"}', False)})
    engine = LiteLLMEngine()
    cfg = {"provider": "groq", "api_key": "sk-test-groq"}

    with patch("litellm.acompletion", side_effect=fake_acompletion):
        with patch("litellm.completion_cost", return_value=0.0):
            r = asyncio.run(engine._loop(cfg, "sys", [{"role": "user", "content": "go"}], mcp, None, 10, 30))

    assert r.error == ""
    # Find the assistant turn in the messages sent to the second call
    assistant_msgs = [m for m in captured_msgs["second_call"] if m["role"] == "assistant"]
    assert len(assistant_msgs) == 1
    assert assistant_msgs[0]["content"] is not None, "content must not be None (breaks Mistral/Groq)"
    assert isinstance(assistant_msgs[0]["content"], str)


# ---------------------------------------------------------------------------
# Test 7: missing key returns EngineResult(error=...) without making a network call
# ---------------------------------------------------------------------------

def test_missing_key_returns_error_result(monkeypatch):
    """No key in cfg, no DB key, no env var → EngineResult(error=...), no network call.

    Exercises the real resolve_key → _key_from_db → env fallback chain:
    _key_from_db is patched to return None (simulates no DB key stored),
    the provider env var is unset via monkeypatch, and cfg has no api_key.
    """
    engine = LiteLLMEngine()

    # Ensure the provider env var is absent so env fallback also returns ""
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    called = {"n": 0}

    async def should_not_be_called(**kwargs):
        called["n"] += 1
        return _resp("never")

    with patch("litellm.acompletion", side_effect=should_not_be_called):
        # Patch _key_from_db to return None — no DB key — while leaving resolve_key intact
        with patch("omilo_api.engines.litellm_engine._key_from_db", return_value=None):
            r = asyncio.run(engine._loop(
                {"provider": "groq"},  # no api_key in cfg
                "sys",
                [{"role": "user", "content": "hello"}],
                None, None, 5, 10
            ))

    assert r.error != ""
    assert called["n"] == 0  # no network call made


# ---------------------------------------------------------------------------
# Unit tests for helpers
# ---------------------------------------------------------------------------

def test_mcp_tools_to_openai_shape():
    mcp_tools = [
        {"name": "my_tool", "description": "does stuff", "inputSchema": {"type": "object", "properties": {"x": {"type": "string"}}}},
        {"name": "bare_tool"},  # missing description and inputSchema
    ]
    result = mcp_tools_to_openai(mcp_tools)
    assert result[0] == {
        "type": "function",
        "function": {
            "name": "my_tool",
            "description": "does stuff",
            "parameters": {"type": "object", "properties": {"x": {"type": "string"}}},
        },
    }
    assert result[1]["function"]["description"] == ""
    assert result[1]["function"]["parameters"] == {"type": "object"}


def test_resolve_key_cfg_takes_precedence():
    assert resolve_key({"api_key": "from-cfg"}, "groq") == "from-cfg"


def test_resolve_key_env_fallback(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "from-env")
    # no cfg key, no DB (patching DB lookup)
    with patch("omilo_api.engines.litellm_engine._key_from_db", return_value=None):
        assert resolve_key({}, "groq") == "from-env"


def test_resolve_key_empty_when_nothing(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    with patch("omilo_api.engines.litellm_engine._key_from_db", return_value=None):
        assert resolve_key({}, "groq") == ""


# ---------------------------------------------------------------------------
# Task 3 tests: get_engine factory + run_task/chat/health wrappers
# ---------------------------------------------------------------------------

def test_get_engine_routes_litellm():
    """get_engine({"type":"litellm","provider":"openai"}) returns a LiteLLMEngine."""
    from omilo_api.engines import get_engine
    from omilo_api.engines.litellm_engine import LiteLLMEngine

    engine = get_engine({"type": "litellm", "provider": "openai"})
    assert isinstance(engine, LiteLLMEngine)


def test_run_task_defaults_balanced_tier():
    """run_task with no tier in engine_config -> 'balanced' tier -> groq/llama-3.3-70b-versatile."""
    import asyncio
    from omilo_api.engines import TaskContext
    from omilo_api.engines.litellm_engine import LiteLLMEngine

    captured = {}

    async def fake_acompletion(**kwargs):
        captured["model"] = kwargs["model"]
        return _resp("ok")

    engine = LiteLLMEngine()
    ctx = TaskContext(
        staff_id="s1",
        staff_name="Aria",
        job="test job",
        is_chief=False,
        task_id="t1",
        origin="test",
        brief="do something",
        founder_note="",
        checkpoint=None,
        proposal=None,
        mcp_url="http://fake",
        mcp_token="tok",
        # No tier key -> engine must default to "balanced"
        engine_config={"provider": "groq", "api_key": "sk-groq-test"},
        emit=lambda kind, **d: None,
        resources=None,
    )

    class FakeMCPCtx:
        """Context manager wrapping FakeMCP."""
        async def __aenter__(self):
            return FakeMCP()
        async def __aexit__(self, *_):
            pass

    with patch("litellm.acompletion", side_effect=fake_acompletion):
        with patch("litellm.completion_cost", return_value=0.0):
            with patch("omilo_api.engines.litellm_engine.MCPClient", return_value=FakeMCPCtx()):
                r = asyncio.run(engine.run_task(ctx))

    # groq balanced tier -> llama-3.3-70b-versatile; with groq prefix -> "groq/llama-3.3-70b-versatile"
    assert "llama-3.3-70b-versatile" in captured.get("model", ""), \
        f"Expected balanced model (llama-3.3-70b-versatile), got: {captured.get('model')}"


def test_chat_defaults_fast_tier():
    """chat with no tier in engine_config -> 'fast' tier -> groq/llama-3.1-8b-instant."""
    import asyncio
    from omilo_api.engines import ChatContext
    from omilo_api.engines.litellm_engine import LiteLLMEngine

    captured = {}

    async def fake_acompletion(**kwargs):
        captured["model"] = kwargs["model"]
        return _resp("ok")

    engine = LiteLLMEngine()
    ctx = ChatContext(
        staff_id="s1",
        staff_name="Aria",
        job="test job",
        is_chief=False,
        thread_id="th1",
        scope="general",
        history=[{"role": "owner", "text": "hello"}],
        context_note="",
        mcp_url="http://fake",
        mcp_token="tok",
        # No tier key -> engine must default to "fast"
        engine_config={"provider": "groq", "api_key": "sk-groq-test"},
        emit=lambda kind, **d: None,
        resources=None,
    )

    class FakeMCPCtx:
        async def __aenter__(self):
            return FakeMCP()
        async def __aexit__(self, *_):
            pass

    with patch("litellm.acompletion", side_effect=fake_acompletion):
        with patch("litellm.completion_cost", return_value=0.0):
            with patch("omilo_api.engines.litellm_engine.MCPClient", return_value=FakeMCPCtx()):
                r = asyncio.run(engine.chat(ctx))

    # groq fast tier -> llama-3.1-8b-instant; with prefix -> "groq/llama-3.1-8b-instant"
    assert "llama-3.1-8b-instant" in captured.get("model", ""), \
        f"Expected fast model (llama-3.1-8b-instant), got: {captured.get('model')}"


def test_run_task_requires_mcp_token():
    """run_task with mcp_token=None returns EngineResult(error=...) without calling _loop."""
    import asyncio
    from omilo_api.engines import TaskContext
    from omilo_api.engines.litellm_engine import LiteLLMEngine

    engine = LiteLLMEngine()
    ctx = TaskContext(
        staff_id="s1",
        staff_name="Aria",
        job="test job",
        is_chief=False,
        task_id="t1",
        origin="test",
        brief="do something",
        founder_note="",
        checkpoint=None,
        proposal=None,
        mcp_url="http://fake",
        mcp_token=None,  # <-- no token
        engine_config={"provider": "groq", "api_key": "sk-groq-test"},
        emit=lambda kind, **d: None,
        resources=None,
    )

    r = asyncio.run(engine.run_task(ctx))
    assert r.error != "", "Expected an error when mcp_token is None"
    assert r.text == ""


# ---------------------------------------------------------------------------
# Test: Bedrock _loop passes aws_secret_access_key and aws_region_name to acompletion
# ---------------------------------------------------------------------------

def test_bedrock_loop_passes_aws_credentials(monkeypatch):
    """When provider is bedrock, _loop must spread aws_secret_access_key and
    aws_region_name into litellm.acompletion kwargs so Bedrock is actually callable.

    Finding #2 fix: without these kwargs, Bedrock passes the key guard then
    fails at the LiteLLM/boto3 layer.
    """
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAIOSFODNN7EXAMPLE")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")
    monkeypatch.setenv("AWS_REGION", "eu-west-1")

    captured = {}

    async def fake_acompletion(**kwargs):
        captured.update(kwargs)
        return _resp("done")

    engine = LiteLLMEngine()
    cfg = {"provider": "bedrock", "api_key": "AKIAIOSFODNN7EXAMPLE"}

    with patch("litellm.acompletion", side_effect=fake_acompletion):
        with patch("litellm.completion_cost", return_value=0.0):
            asyncio.run(engine._loop(
                cfg, "sys",
                [{"role": "user", "content": "hello"}],
                None, None, 1, 10,
            ))

    assert "aws_secret_access_key" in captured, "aws_secret_access_key must be forwarded to acompletion"
    assert captured["aws_secret_access_key"] == "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    assert "aws_region_name" in captured, "aws_region_name must be forwarded to acompletion"
    assert captured["aws_region_name"] == "eu-west-1"
