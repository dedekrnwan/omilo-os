"""GraphEngine (Task 3) — a LangGraph brain that plugs into the Engine contract.

These tests are hermetic: no DB, no MCP server, no live network. The underlying
("exec") engine is a lightweight stub swapped in by monkeypatching the module-level
``get_engine`` that the worker node resolves. The real ``fake`` engine talks to the
MCP endpoint over HTTP, so a pure unit test stubs the underlying engine instead.

What is pinned here:
- the factory routes ``{"type":"graph"}`` → a ``GraphEngine``;
- a graph whose worker produces output runs supervisor → worker → review to ``done``
  and returns an ``EngineResult`` carrying the worker's text + summed cost/tokens;
- a graph whose worker never satisfies review (empty output) terminates with the
  ``MAX_GRAPH_STEPS`` error instead of looping forever (proven under a wall-clock
  timeout).
"""
import asyncio

import pytest

from omilo_api.engines import Engine, EngineResult, TaskContext, get_engine
from omilo_api.graph import engine as graph_engine_mod
from omilo_api.graph.engine import MAX_GRAPH_STEPS, GraphEngine

# ---------------------------------------------------------------------------
# Stub underlying engines (no network) — stand in for exec_engine={"type":"fake"}
# ---------------------------------------------------------------------------

class _StubEngine(Engine):
    """Underlying engine the graph's worker node delegates to."""

    type = "stub"

    def __init__(self, text: str = "", cost: float = 0.0, tokens: int = 0):
        self._text, self._cost, self._tokens = text, cost, tokens
        self.calls = 0

    async def run_task(self, ctx: TaskContext) -> EngineResult:
        self.calls += 1
        return EngineResult(text=self._text, cost_usd=self._cost, tokens=self._tokens)

    async def chat(self, ctx) -> EngineResult:
        return EngineResult(text="chat")


def _ctx(exec_cfg: dict | None, **overrides) -> TaskContext:
    """Build a minimal valid TaskContext (mirrors worker._task_context fields)."""
    engine_config = {"type": "graph"}
    if exec_cfg is not None:
        engine_config["exec_engine"] = exec_cfg
    base = dict(
        staff_id="st_test", staff_name="Tester", job="writer", is_chief=False,
        task_id="tk_test", origin="task", brief="write a short note",
        founder_note="", checkpoint=None, proposal=None,
        mcp_url="http://127.0.0.1:0/mcp", mcp_token="unused-in-stub",
        engine_config=engine_config, emit=lambda *a, **k: None,
    )
    base.update(overrides)
    return TaskContext(**base)


# ---------------------------------------------------------------------------
# Test 1: happy path — worker output flows through to the result, graph reaches done
# ---------------------------------------------------------------------------

async def test_graph_run_task_returns_result(monkeypatch):
    stub = _StubEngine(text="the worker did the thing", cost=0.012, tokens=345)
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)

    eng = get_engine({"type": "graph", "exec_engine": {"type": "fake"}})
    assert isinstance(eng, GraphEngine)

    res = await eng.run_task(_ctx({"type": "fake"}))

    assert isinstance(res, EngineResult)
    assert res.error == ""
    assert res.text == "the worker did the thing"
    # underlying result is aggregated through
    assert res.cost_usd == pytest.approx(0.012)
    assert res.tokens == 345
    # one worker pass satisfied review
    assert stub.calls == 1


# ---------------------------------------------------------------------------
# Test 2: depth cap — a worker that never satisfies review terminates, not loops
# ---------------------------------------------------------------------------

async def test_graph_depth_cap(monkeypatch):
    # Empty worker output → review never sets done → supervisor↔worker loops.
    stub = _StubEngine(text="", cost=0.001, tokens=1)
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)

    eng = GraphEngine()

    # Prove termination: wrap in a wall-clock timeout; if the cap works it finishes fast.
    res = await asyncio.wait_for(eng.run_task(_ctx({"type": "fake"})), timeout=5.0)

    assert res.error == f"graph did not converge in {MAX_GRAPH_STEPS} steps"
    # It ran up to the cap, not forever, and not just once.
    assert stub.calls <= MAX_GRAPH_STEPS
    assert stub.calls >= 2


# ---------------------------------------------------------------------------
# Test 3: factory routes "graph" → GraphEngine
# ---------------------------------------------------------------------------

def test_get_engine_routes_graph():
    eng = get_engine({"type": "graph", "exec_engine": {"type": "fake"}})
    assert isinstance(eng, GraphEngine)
    assert eng.type == "graph"


# ---------------------------------------------------------------------------
# Test 4: missing exec_engine defaults to fake (no crash building the engine)
# ---------------------------------------------------------------------------

async def test_graph_missing_exec_engine_defaults_to_fake(monkeypatch):
    seen: dict = {}

    def _capture(cfg):
        seen["cfg"] = cfg
        return _StubEngine(text="fallback output")

    monkeypatch.setattr(graph_engine_mod, "get_engine", _capture)
    eng = GraphEngine()
    res = await eng.run_task(_ctx(None))  # engine_config has no exec_engine

    assert res.error == ""
    assert res.text == "fallback output"
    assert seen["cfg"] == {"type": "fake"}
