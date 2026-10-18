"""GraphEngine — a small LangGraph "brain" behind the existing Engine contract.

Why this shape
--------------
The rest of Omilo talks to engines through exactly two calls — ``run_task`` and
``chat`` — and resolves them through the single ``get_engine`` factory. This engine
keeps that contract untouched: ``worker.run_task`` and the factory barely change.
When a staff opts into ``brain="graph"`` the factory hands back a ``GraphEngine``
whose ``run_task`` runs a tiny ``StateGraph``:

    START → supervisor → worker → review ─┬─(not done & step<cap)→ supervisor
                                          └─(done | step>=cap)────→ END

The heavy lifting still happens in the *underlying* engine (Claude Code first, a
fake engine in tests). The graph nodes only orchestrate: the supervisor advances a
bounded plan, the worker delegates the real work to ``get_engine(underlying).run_task``,
and review decides whether one pass was enough. Phase 1 has no human-in-the-loop and
no risk gate yet (Task 4 adds the gate using ``pending_action``/``risk`` on the state
and the ``graph.risk.classify_risk`` router); this task only establishes the loop and
its depth cap so a confused graph ends with an error, not unbounded pool spend.

Import-cycle note
-----------------
``engines/__init__.py`` imports ``GraphEngine`` *lazily*, inside the ``"graph"``
branch of ``get_engine`` only. So importing the ``engines`` package does NOT import
this module, and this module may safely import ``Engine``/``TaskContext``/
``EngineResult``/``get_engine`` from ``engines`` at top level. (``get_engine`` is
bound at module scope here specifically so tests can monkeypatch the underlying
engine without a live MCP server.)
"""
from __future__ import annotations

import dataclasses

from langgraph.graph import END, START, StateGraph

from ..engines import ChatContext, Engine, EngineResult, TaskContext, get_engine
from .state import GraphState

# The supervisor↔worker loop is bounded: a graph that never satisfies review ends
# with an error after this many steps instead of spinning forever.
MAX_GRAPH_STEPS = 12

# Default underlying engine when a graph staff has no ``exec_engine`` configured.
_DEFAULT_EXEC_CONFIG: dict = {"type": "fake"}


class GraphEngine(Engine):
    """Runs a LangGraph StateGraph whose work node delegates to a real engine."""

    type = "graph"

    # ------------------------------------------------------------------ chat
    async def chat(self, ctx: ChatContext) -> EngineResult:
        """Phase 1: the graph is for tasks. Chat delegates straight to the
        underlying engine so conversational turns behave exactly as before."""
        underlying_cfg = self._underlying_config(ctx.engine_config)
        return await get_engine(underlying_cfg).chat(ctx)

    # ------------------------------------------------------------- run_task
    async def run_task(self, ctx: TaskContext) -> EngineResult:
        underlying_cfg = self._underlying_config(ctx.engine_config)

        # Aggregate cost/tokens across every underlying call the worker makes.
        # Kept off the LangGraph state (which only holds the declared GraphState
        # keys) and on a per-run accumulator closed over by the worker node.
        agg = {"cost_usd": 0.0, "tokens": 0, "error": ""}

        graph = self._build_graph(ctx, underlying_cfg, agg)

        initial: GraphState = {
            "task_id": ctx.task_id,
            "brief": ctx.brief,
            "messages": [],
            "plan": [],
            "worker_output": "",
            "pending_action": None,
            "risk": "low",
            "step": 0,
            "done": False,
            "result_text": "",
        }

        # The conditional edge already caps recursion at MAX_GRAPH_STEPS; give
        # LangGraph's own recursion guard headroom so our cap is what fires.
        final: GraphState = await graph.ainvoke(
            initial, config={"recursion_limit": MAX_GRAPH_STEPS * 4 + 10}
        )

        if not final.get("done"):
            # Loop exhausted without review ever being satisfied.
            return EngineResult(
                error=f"graph did not converge in {MAX_GRAPH_STEPS} steps",
                cost_usd=agg["cost_usd"],
                tokens=agg["tokens"],
            )

        return EngineResult(
            text=final.get("result_text", ""),
            error=agg["error"],
            cost_usd=agg["cost_usd"],
            tokens=agg["tokens"],
        )

    # ----------------------------------------------------------- internals
    @staticmethod
    def _underlying_config(engine_config: dict | None) -> dict:
        """The real engine config lives under ``exec_engine``; default to fake."""
        cfg = (engine_config or {}).get("exec_engine")
        if not cfg:
            return dict(_DEFAULT_EXEC_CONFIG)
        return cfg

    def _build_graph(self, ctx: TaskContext, underlying_cfg: dict, agg: dict):
        """Compile the supervisor → worker → review StateGraph for this run."""

        def supervisor(state: GraphState) -> dict:
            """One bounded planning step. Phase 1 keeps this structural (no
            separate LLM call): it advances the plan and the step counter. The
            heavy reasoning is the worker's underlying-engine call."""
            step = state["step"] + 1
            plan = list(state.get("plan") or [])
            if not plan:
                plan = ["understand the brief", "do the work", "review the output"]
            messages = list(state.get("messages") or [])
            messages.append({"role": "supervisor", "step": step})
            return {"step": step, "plan": plan, "messages": messages}

        async def worker(state: GraphState) -> dict:
            """Delegate the actual work to the underlying engine."""
            derived = self._derive_ctx(ctx, underlying_cfg)
            res = await get_engine(underlying_cfg).run_task(derived)
            agg["cost_usd"] += res.cost_usd
            agg["tokens"] += res.tokens
            if res.error and not agg["error"]:
                agg["error"] = res.error
            text = res.text or ""
            return {"worker_output": text, "result_text": text}

        def review(state: GraphState) -> dict:
            """Phase 1: one worker pass satisfies review unless output is empty."""
            done = bool(state.get("worker_output"))
            return {"done": done}

        def route_after_review(state: GraphState) -> str:
            """Loop back to the supervisor unless we're done or out of steps."""
            if state.get("done"):
                return "end"
            if state["step"] >= MAX_GRAPH_STEPS:
                return "end"
            return "loop"

        builder = StateGraph(GraphState)
        builder.add_node("supervisor", supervisor)
        builder.add_node("worker", worker)
        builder.add_node("review", review)

        builder.add_edge(START, "supervisor")
        builder.add_edge("supervisor", "worker")
        builder.add_edge("worker", "review")
        builder.add_conditional_edges(
            "review", route_after_review, {"loop": "supervisor", "end": END}
        )

        return builder.compile()

    @staticmethod
    def _derive_ctx(ctx: TaskContext, underlying_cfg: dict) -> TaskContext:
        """A copy of the incoming TaskContext whose engine_config is the UNDERLYING
        engine's config, so the delegated engine sees a plain single-engine run."""
        return dataclasses.replace(ctx, engine_config=underlying_cfg)
