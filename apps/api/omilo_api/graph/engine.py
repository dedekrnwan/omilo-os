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
from .delegation import GateContext
from .delegation import gate as gate_node
from .state import GraphState

# The supervisor↔worker loop is bounded: a graph that never satisfies review ends
# with an error after this many steps instead of spinning forever.
MAX_GRAPH_STEPS = 12

# Default underlying engine when a graph staff has no ``exec_engine`` configured.
_DEFAULT_EXEC_CONFIG: dict = {"type": "fake"}

# LangGraph marks a suspended (interrupted) run by putting an ``__interrupt__`` key on
# the state ``ainvoke`` returns. We detect it to end the run WAITING without executing.
_INTERRUPT_KEY = "__interrupt__"


def _interrupt_title(interrupts) -> str:
    """Pull the human-readable title out of the gate's interrupt payload.

    ``interrupts`` is the tuple/list under ``__interrupt__`` — a sequence of
    ``Interrupt`` objects whose ``.value`` is the dict the gate passed to
    ``interrupt(...)``. Falls back gracefully if the shape is unexpected.
    """
    try:
        payload = interrupts[0].value
        if isinstance(payload, dict):
            return payload.get("title") or "the proposed action"
    except (IndexError, AttributeError, TypeError):
        pass
    return "the proposed action"


# ---------------------------------------------------------------------------
# Persistent checkpointer
# ---------------------------------------------------------------------------
#
# High-risk runs suspend on an ``interrupt`` and must resume from a DIFFERENT process
# (Task 5 resumes from an HTTP request), so the checkpoint has to be PERSISTENT, not
# in-memory. We use a Postgres-backed saver keyed by ``thread_id = task_id``.
#
# The saver's own tables live in the default search_path (``public``); checkpoints are
# keyed by the globally-unique task id, so they do not need the per-company schema.
#
# An async Postgres connection is bound to the event loop that opened it, so a cached
# process-wide saver breaks as soon as a new loop runs (e.g. between tests). We instead
# open a FRESH saver per run via its async context manager — scoped to the running loop
# and closed when the run ends. ``.setup()`` is idempotent (CREATE TABLE IF NOT
# EXISTS), so paying it once per run is cheap, and this mirrors how Task 5 will open its
# own saver to resume from another process.

_tables_ready = False  # set once per process: skip the redundant .setup() on later runs


def _checkpointer_dsn() -> str:
    """A plain psycopg DSN (no SQLAlchemy ``+psycopg`` suffix) for the saver."""
    from ..config import get_settings

    url = get_settings().resolved_database_url()
    return url.replace("postgresql+psycopg://", "postgresql://", 1)


def open_checkpointer():
    """Open a fresh async Postgres checkpointer as an async context manager.

    Use as ``async with open_checkpointer() as cp:``. Call ``ensure_setup(cp)`` once
    inside to create the checkpoint tables the first time this process runs.
    """
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    return AsyncPostgresSaver.from_conn_string(_checkpointer_dsn())


async def ensure_setup(checkpointer) -> None:
    """Create the checkpoint tables once per process (idempotent in the database)."""
    global _tables_ready
    if _tables_ready:
        return
    await checkpointer.setup()
    _tables_ready = True


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

        # thread_id = task_id keys the checkpoint so a high-risk suspend can be resumed
        # later from another process (Task 5). The conditional edge already caps
        # recursion at MAX_GRAPH_STEPS; give LangGraph's own guard headroom so our cap
        # is what fires.
        config = {
            "configurable": {"thread_id": ctx.task_id},
            "recursion_limit": MAX_GRAPH_STEPS * 4 + 10,
        }
        async with open_checkpointer() as checkpointer:
            await ensure_setup(checkpointer)
            graph = self._build_graph(ctx, underlying_cfg, agg, checkpointer)
            final: GraphState = await graph.ainvoke(initial, config=config)

        # A high-risk action suspended the graph: a Proposal is pending the owner's
        # decision. Report WAITING and execute nothing — the task stays unfinished for
        # the resume path (Task 5) to complete on the decision.
        interrupts = final.get(_INTERRUPT_KEY)
        if interrupts:
            title = _interrupt_title(interrupts)
            return EngineResult(
                text=f"Waiting for your approval: {title}",
                cost_usd=agg["cost_usd"],
                tokens=agg["tokens"],
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

    def _build_graph(self, ctx: TaskContext, underlying_cfg: dict, agg: dict, checkpointer):
        """Compile the supervisor → worker → gate → review StateGraph for this run."""

        # The pending_action the worker wants the gate to rule on. In Phase 1 the test
        # harness (and Task 6's real wiring) supplies it via engine_config; a run with
        # no pending_action is a pure internal task and the gate is a no-op.
        injected_pending = (ctx.engine_config or {}).get("pending_action")

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
            """Delegate the actual work to the underlying engine, and surface the
            action (if any) the worker wants to take for the gate to rule on."""
            derived = self._derive_ctx(ctx, underlying_cfg)
            res = await get_engine(underlying_cfg).run_task(derived)
            agg["cost_usd"] += res.cost_usd
            agg["tokens"] += res.tokens
            if res.error and not agg["error"]:
                agg["error"] = res.error
            text = res.text or ""
            return {"worker_output": text, "result_text": text, "pending_action": injected_pending}

        def gate(state: GraphState) -> dict:
            """The CoS delegation gate: auto-approve low/medium, escalate high.

            For a high-risk action this calls ``interrupt`` and does NOT return on the
            suspending pass — LangGraph checkpoints and raises, ending the run WAITING.
            """
            gctx = GateContext(task_id=ctx.task_id, staff_id=ctx.staff_id)
            return gate_node(state, gctx)

        def review(state: GraphState) -> dict:
            """Phase 1: one worker pass satisfies review unless output is empty.
            The gate may already have set ``done`` after an auto-approval; honour it."""
            done = bool(state.get("done")) or bool(state.get("worker_output"))
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
        builder.add_node("gate", gate)
        builder.add_node("review", review)

        builder.add_edge(START, "supervisor")
        builder.add_edge("supervisor", "worker")
        builder.add_edge("worker", "gate")
        builder.add_edge("gate", "review")
        builder.add_conditional_edges(
            "review", route_after_review, {"loop": "supervisor", "end": END}
        )

        return builder.compile(checkpointer=checkpointer)

    @staticmethod
    def _derive_ctx(ctx: TaskContext, underlying_cfg: dict) -> TaskContext:
        """A copy of the incoming TaskContext whose engine_config is the UNDERLYING
        engine's config, so the delegated engine sees a plain single-engine run."""
        return dataclasses.replace(ctx, engine_config=underlying_cfg)
