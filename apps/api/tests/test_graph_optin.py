"""Task 6 — per-staff opt-in to the graph brain + soul-driven prompts.

Two things are pinned here:

1. **Routing is opt-in, no regression.** A ``brain="single_engine"`` staff (the
   default) runs through the ordinary engine path — the graph is NEVER constructed.
   We prove it by monkeypatching ``GraphEngine.run_task`` to raise: a single_engine
   task still succeeds (so it never touched the graph), while a ``brain="graph"``
   staff's effective engine_config becomes ``{"type":"graph","exec_engine": <real>}``
   and ``get_engine`` on it returns a ``GraphEngine``.

2. **Soul → prompt.** The node prompt assembly includes the staff ``voice`` text and
   is shaped by ``autonomy`` (``guided`` vs ``trusted`` produce different prompt text).

The routing tests drive the real DB through the ``owner`` fixture (needed only for the
schema/company context); we scope every assertion to a worker staff WE create.

Hermeticity notes
-----------------
- We never mutate module-level dicts, lists, or class attributes — every config dict
  is function-local and never written back to the module.
- All module-level state changes use ``monkeypatch`` (auto-reverted on teardown).
- Graph-running tests patch ``graph_engine_mod.open_checkpointer`` to a
  ``MemorySaver`` so no Postgres checkpoint state leaks between tests or sessions.
"""
import uuid
from contextlib import asynccontextmanager

import pytest
from langgraph.checkpoint.memory import MemorySaver

from omilo_api.db import session_scope
from omilo_api.engines import Engine, EngineResult, TaskContext, get_engine
from omilo_api.graph import engine as graph_engine_mod
from omilo_api.graph.engine import GraphEngine, build_node_prompt
from omilo_api.models import Staff
from omilo_api.worker import Worker


# ---------------------------------------------------------------------------
# Hermetic checkpointer: replaces the Postgres-backed open_checkpointer with a
# per-test in-memory saver so graph runs in this module never write to Postgres
# and therefore never leave stale checkpoint state under any thread_id.
# ---------------------------------------------------------------------------

@asynccontextmanager
async def _memory_checkpointer():
    """Drop-in async context manager for open_checkpointer using MemorySaver."""
    yield MemorySaver()


async def _noop_ensure_setup(_cp) -> None:
    """MemorySaver needs no table setup."""


# ---------------------------------------------------------------------------
# A fake engine we fully control, swapped in as the staff's underlying engine so
# a single_engine run completes without a live MCP server. We register it under a
# throwaway type and route get_engine to it.
# ---------------------------------------------------------------------------

class _FakeEngine(Engine):
    type = "optin-fake"

    async def run_task(self, ctx: TaskContext) -> EngineResult:
        return EngineResult(text="fake engine did the work")

    async def chat(self, ctx) -> EngineResult:  # pragma: no cover - unused
        return EngineResult(text="chat")


def _make_staff(brain: str, *, voice: str = "", autonomy: str = "standard") -> str:
    sid = f"optin-{brain}-" + uuid.uuid4().hex[:8]
    with session_scope() as db:
        db.add(Staff(
            id=sid, name="Opt-in Worker", role="marketing",
            engine={"type": "optin-fake"}, brain=brain, voice=voice, autonomy=autonomy,
        ))
        db.commit()
    return sid


def _make_task(staff_id: str, brief: str = "do a thing") -> str:
    from omilo_api import services as S

    with session_scope() as db:
        return S.create_task(db, staff_id, "task", brief, created_by="owner").id


# ---------------------------------------------------------------------------
# Test 1: single_engine staff bypass the graph entirely
# ---------------------------------------------------------------------------

async def test_single_engine_staff_bypasses_graph(owner, monkeypatch):
    # Make the underlying engine resolvable without a network.
    monkeypatch.setattr("omilo_api.worker.get_engine", lambda cfg: _FakeEngine())
    # If the graph is ever constructed for this staff, fail loudly.
    def _boom(self, ctx):  # noqa: ANN001
        raise AssertionError("single_engine staff must NEVER enter the GraphEngine")
    monkeypatch.setattr(GraphEngine, "run_task", _boom)

    sid = _make_staff("single_engine")
    task_id = _make_task(sid)

    w = Worker()
    ctx, engine_cfg, _minutes = w._task_context(task_id)

    # Byte-for-byte: the effective config is the staff's own engine, untouched.
    assert engine_cfg == {"type": "optin-fake"}
    assert ctx.engine_config == {"type": "optin-fake"}
    assert "exec_engine" not in engine_cfg

    # And a real run completes via the normal engine (graph.run_task would have raised).
    await w.run_task(task_id)
    with session_scope() as db:
        from omilo_api.models import Task

        t = db.get(Task, task_id)
        assert t.status == "done", f"single_engine task should finish done, got {t.status}"


# ---------------------------------------------------------------------------
# Test 2: brain="graph" staff route through the GraphEngine
# ---------------------------------------------------------------------------

def test_graph_staff_routes_through_graph(owner):
    sid = _make_staff("graph")
    task_id = _make_task(sid)

    # Immediately cancel the queued task so the embedded server worker cannot pick it
    # up and race against later tests.  The test only needs _task_context, not a run.
    with session_scope() as db:
        from omilo_api.models import Task as _Task
        t = db.get(_Task, task_id)
        if t is not None and t.status == "queued":
            t.status = "cancelled"
            db.commit()

    w = Worker()
    ctx, engine_cfg, _minutes = w._task_context(task_id)

    # The effective engine is the graph, wrapping the staff's REAL engine verbatim.
    assert engine_cfg["type"] == "graph"
    assert engine_cfg["exec_engine"] == {"type": "optin-fake"}
    # Both the returned cfg and the ctx config carry the graph wrapper.
    assert ctx.engine_config["type"] == "graph"
    assert ctx.engine_config["exec_engine"] == {"type": "optin-fake"}

    # get_engine on the effective config yields a GraphEngine (single dispatch).
    assert isinstance(get_engine(engine_cfg), GraphEngine)


# ---------------------------------------------------------------------------
# Test 3: the staff's voice + autonomy shape the assembled node prompt
# ---------------------------------------------------------------------------

def test_voice_in_prompt():
    voice = "warm, concise, no jargon"
    prompt = build_node_prompt(brief="write a welcome note", voice=voice, autonomy="standard", role="marketing")
    assert voice in prompt, f"voice text must appear in the node prompt: {prompt!r}"
    assert "write a welcome note" in prompt  # the job/brief is still layered in

    # Autonomy visibly changes behavior guidance: guided vs trusted differ.
    guided = build_node_prompt(brief="x", voice=voice, autonomy="guided", role="marketing")
    trusted = build_node_prompt(brief="x", voice=voice, autonomy="trusted", role="marketing")
    assert guided != trusted, "autonomy must influence the prompt text"
    # And the difference is the expected directionality.
    assert "propose" in guided.lower() or "consult" in guided.lower() or "before acting" in guided.lower()
    assert "act" in trusted.lower()


# ---------------------------------------------------------------------------
# Test 4: the graph run actually feeds the soul-shaped prompt to the underlying
#         engine (voice reaches the worker node's derived brief).
# ---------------------------------------------------------------------------

async def test_graph_run_threads_voice_to_underlying(owner, monkeypatch):
    seen = {}

    class _CaptureEngine(Engine):
        type = "capture"

        async def run_task(self, ctx: TaskContext) -> EngineResult:
            seen["brief"] = ctx.brief
            return EngineResult(text="done")

        async def chat(self, ctx):  # pragma: no cover
            return EngineResult(text="chat")

    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: _CaptureEngine())
    # Use an in-memory checkpointer so this test leaves zero Postgres state.
    monkeypatch.setattr(graph_engine_mod, "open_checkpointer", _memory_checkpointer)
    monkeypatch.setattr(graph_engine_mod, "ensure_setup", _noop_ensure_setup)

    voice = "playful but precise"
    eng = get_engine({
        "type": "graph",
        "exec_engine": {"type": "capture"},
        "voice": voice,
        "autonomy": "trusted",
    })
    ctx = TaskContext(
        staff_id="st_x", staff_name="X", job="marketing", is_chief=False,
        task_id="tk_voice_" + uuid.uuid4().hex[:6], origin="task",
        brief="draft a tagline", founder_note="", checkpoint=None, proposal=None,
        mcp_url="http://127.0.0.1:0/mcp", mcp_token="unused",
        engine_config={"type": "graph", "exec_engine": {"type": "capture"},
                       "voice": voice, "autonomy": "trusted"},
        emit=lambda *a, **k: None,
    )
    res = await eng.run_task(ctx)
    assert res.error == ""
    assert voice in seen.get("brief", ""), f"voice must reach the underlying engine's brief: {seen!r}"
