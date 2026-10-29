"""omilo.flows.engine — Flow run engine (walk nodes, P2).

Public API:
    run_flow(db, flow, *, trigger_summary, started_by, test=False) -> FlowRun

Walk algorithm:
  1. Create a FlowRun (status="running").
  2. Build node/edge lookup structures.
  3. Find the trigger node; if absent, mark failed and return.
  4. Walk the DAG with a visited-set cycle guard and a step counter
     bounded by len(nodes)+1.
  5. Dispatch each node by kind:
     - trigger    → no-op; follow first outgoing edge.
     - ai_step    → start_job(origin="flow"); collect job_id.
     - connector  → test=True: skip (no-op); test=False: fake no-op.
     - condition  → evaluate keyword match against last ai_step output;
                    choose Yes or No outgoing edge.
     - approval   → test=True: record note, continue; test=False: create
                    InboxItem + set needs_you + PAUSE.
  6. End of walk → status="done", ended_at=now.

Design decisions:
- ``_PAUSE`` sentinel: a module-level object() returned by ``_dispatch_node``
  to signal the engine should stop walking and return the run as-is.
- ``context`` dict: mutable dict threaded through the walk to carry
  ``last_output`` from ai_step to condition, without module-level state.
- job_ids JSONB mutation: always reassign (``run.job_ids = run.job_ids + [id]``)
  rather than in-place append — SQLAlchemy JSONB change detection requires
  object identity to change.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from omilo.models.base import prefixed_id
from omilo.models.flows import Flow, FlowRun
from omilo.models.inbox import InboxItem

# ---------------------------------------------------------------------------
# Sentinel: returned by _dispatch_node to pause the walk (approval node)
# ---------------------------------------------------------------------------

_PAUSE = object()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def run_flow(
    db: Session,
    flow: Flow,
    *,
    trigger_summary: str,
    started_by: str,
    test: bool = False,
) -> FlowRun:
    """Create a FlowRun and walk the flow graph to completion (or until an
    approval node pauses it).

    Args:
        db:               Company-scoped SQLAlchemy session (caller owns txn).
        flow:             The Flow ORM object to execute.
        trigger_summary:  Human-readable description of what started this run.
        started_by:       Who / what initiated the run (e.g. "operator").
        test:             If True, side-effecting nodes (connector, approval)
                          are simulated — no real external calls, approval nodes
                          do NOT park the run.

    Returns:
        The FlowRun after the walk completes or pauses.
    """
    # ── 1. Create the FlowRun ────────────────────────────────────────────────
    run = FlowRun(
        id=prefixed_id("frn"),
        company_id=flow.company_id,
        flow_id=flow.id,
        status="running",
        trigger_summary=trigger_summary,
        started_by=started_by,
        job_ids=[],
        steps=[],
        started_at=datetime.now(timezone.utc),
    )
    db.add(run)
    db.flush()

    # ── 2. Build lookup structures ───────────────────────────────────────────
    nodes, nodes_by_id, out_edges = _graph(flow)

    # ── 3. Find the trigger node ─────────────────────────────────────────────
    trigger_node = next(
        (n for n in nodes if n.get("kind") == "trigger"), None
    )
    if trigger_node is None:
        run.status = "failed"
        run.waiting_for = "no trigger node"
        run.ended_at = datetime.now(timezone.utc)
        _finish(db, run)
        return run

    # ── 4. Budget gate (flow Settings › Budget & limits) ─────────────────────
    if not test:
        cap = flow_limits(flow).get("monthly_budget_credits")
        if cap is not None and spent_this_month_credits(db, flow.id) >= cap:
            run.status = "failed"
            run.waiting_for = "Monthly budget reached"
            run.ended_at = datetime.now(timezone.utc)
            _finish(db, run)
            return run

    # ── 5. Walk the graph ────────────────────────────────────────────────────
    _walk(db, run, flow, trigger_node["id"], nodes_by_id, out_edges, {"last_output": ""}, test, set())
    return run


def _graph(flow: Flow) -> tuple[list[dict], dict[str, dict], dict[str, list[dict]]]:
    nodes: list[dict[str, Any]] = flow.nodes if isinstance(flow.nodes, list) else []
    edges: list[dict[str, Any]] = flow.edges if isinstance(flow.edges, list) else []
    nodes_by_id: dict[str, dict] = {n["id"]: n for n in nodes if isinstance(n, dict) and "id" in n}
    out_edges: dict[str, list[dict]] = {}
    for edge in edges:
        src = edge.get("from") if isinstance(edge, dict) else None
        if src:
            out_edges.setdefault(src, []).append(edge)
    return nodes, nodes_by_id, out_edges


def _walk(
    db: Session,
    run: FlowRun,
    flow: Flow,
    start_id: str | None,
    nodes_by_id: dict[str, dict],
    out_edges: dict[str, list[dict]],
    context: dict[str, Any],
    test: bool,
    visited: set[str],
) -> None:
    """Walk from ``start_id`` until the end of the graph or an approval pause."""
    current_id: str | None = start_id
    max_steps = max(len(nodes_by_id) + 1, 1)
    limits = flow_limits(flow)
    if limits.get("max_steps"):
        max_steps = min(max_steps, limits["max_steps"])
    cost_cap = None if test else limits.get("cost_cap_credits")
    steps = len(run.steps or [])  # resumed runs keep counting

    while current_id is not None and steps < max_steps:
        if current_id in visited:
            break  # cycle guard
        visited.add(current_id)
        steps += 1

        node = nodes_by_id.get(current_id)
        if node is None:
            break  # dangling edge reference — treat as end

        started = time.monotonic()
        jobs_before = len(run.job_ids or [])
        context.pop("step_note", None)
        result = _dispatch_node(db, run, flow, node, out_edges, context, test)
        _log_step(run, node, context, test, result, started, jobs_before)

        if result is _PAUSE:
            db.flush()
            return  # approval pause — status already set to needs_you

        current_id = result  # type: ignore[assignment]

        if cost_cap is not None and current_id is not None and _run_cost(db, run) > cost_cap:
            run.status = "failed"
            run.waiting_for = "Max cost per run reached"
            run.ended_at = datetime.now(timezone.utc)
            break
    else:
        if current_id is not None and run.status == "running" and steps >= max_steps and limits.get("max_steps"):
            run.status = "failed"
            run.waiting_for = "Max steps per run reached"
            run.ended_at = datetime.now(timezone.utc)

    # ── 5. End of walk ───────────────────────────────────────────────────────
    # Only mark "done" if the walk didn't already set a terminal status
    # (e.g. "failed" from _handle_ai_step when no helper exists).
    if run.status == "running":
        run.status = "done"
        run.ended_at = datetime.now(timezone.utc)
    _finish(db, run)


# ---------------------------------------------------------------------------
# sweep/inbox-flows: step log, resume, cost/duration
# ---------------------------------------------------------------------------


def _log_step(
    run: FlowRun,
    node: dict[str, Any],
    context: dict[str, Any],
    test: bool,
    result: Any,
    started: float,
    jobs_before: int,
) -> None:
    kind = node.get("kind", "")
    entry: dict[str, Any] = {
        "node_id": node.get("id", ""),
        "kind": kind,
        "label": node.get("label") or node.get("title") or kind,
        "status": "done",
        "duration_ms": int((time.monotonic() - started) * 1000),
    }
    new_jobs = (run.job_ids or [])[jobs_before:]
    if kind == "ai_step":
        if run.status == "failed":
            entry["status"] = "failed"
            entry["note"] = run.waiting_for or "failed"
        else:
            entry["output"] = {"result": context.get("last_output", "")}
            if new_jobs:
                entry["job_id"] = new_jobs[-1]
    elif kind == "connector" and test:
        entry["status"] = "skipped"
        entry["note"] = "Skipped in test"
    elif kind == "condition":
        entry["note"] = context.get("step_note", "")
    elif kind == "approval":
        if result is _PAUSE:
            entry["status"] = "waiting"
            entry["note"] = node.get("sublabel") or "Waiting for your approval"
        elif test:
            entry["note"] = "Would wait for you"
    run.steps = list(run.steps or []) + [entry]


def _finish(db: Session, run: FlowRun) -> None:
    """Fill duration (seconds) + cost (sum of the run's jobs) once a run ends."""
    if run.ended_at and run.started_at:
        run.duration = max(0, int((run.ended_at - run.started_at).total_seconds()))
    if run.job_ids:
        from omilo.models.execution import Job

        jobs = db.query(Job).filter(Job.id.in_(list(run.job_ids))).all()
        run.cost_credits = sum(int(j.cost_credits or 0) for j in jobs)
    db.flush()


def resume_run(db: Session, flow: Flow, run: FlowRun, *, approved: bool) -> FlowRun:
    """Resume a run parked at an approval node (status=needs_you).

    approved=True  → the approval step is marked done and the walk continues
                     from the approval node's next edge.
    approved=False → the approval step is marked declined, the run ends as
                     ``declined`` and nothing after it runs.
    The linked decision InboxItem is resolved either way.
    """
    node_id = run.waiting_for
    steps = list(run.steps or [])
    for st in steps:
        if st.get("node_id") == node_id and st.get("status") == "waiting":
            st["status"] = "done" if approved else "declined"
            st["note"] = "You approved" if approved else "You declined"
    run.steps = steps

    for item in db.query(InboxItem).filter(InboxItem.meta == f"flow_run:{run.id}").all():
        item.status = "done"

    if not approved:
        run.status = "declined"
        run.waiting_for = None
        run.ended_at = datetime.now(timezone.utc)
        _finish(db, run)
        return run

    _nodes, nodes_by_id, out_edges = _graph(flow)
    last_output = ""
    for st in steps:
        out = st.get("output") or {}
        if isinstance(out, dict) and out.get("result") is not None:
            last_output = str(out["result"])
    visited = {str(st.get("node_id")) for st in steps}
    run.status = "running"
    run.waiting_for = None
    db.flush()
    _walk(db, run, flow, _first_next(out_edges, node_id or ""), nodes_by_id, out_edges,
          {"last_output": last_output}, False, visited)
    return run


def cancel_run(db: Session, run: FlowRun) -> FlowRun:
    """Cancel a running / waiting run; its decision InboxItem is resolved."""
    steps = list(run.steps or [])
    for st in steps:
        if st.get("status") == "waiting":
            st["status"] = "cancelled"
    run.steps = steps
    for item in db.query(InboxItem).filter(InboxItem.meta == f"flow_run:{run.id}").all():
        item.status = "done"
    run.status = "cancelled"
    run.waiting_for = None
    run.ended_at = datetime.now(timezone.utc)
    _finish(db, run)
    return run


# ---------------------------------------------------------------------------
# Node dispatcher
# ---------------------------------------------------------------------------


def _dispatch_node(
    db: Session,
    run: FlowRun,
    flow: Flow,
    node: dict[str, Any],
    out_edges: dict[str, list[dict]],
    context: dict[str, Any],
    test: bool,
) -> str | None | object:
    """Execute one node and return the id of the next node, None (end), or _PAUSE.

    Args:
        db:        Company-scoped session.
        run:       The current FlowRun (mutated in place for status/job_ids).
        flow:      The parent Flow (for company_id, helper lookup).
        node:      The node dict from flow.nodes.
        out_edges: Map of node_id → [edge, ...] for outgoing edges.
        context:   Mutable walk context (carries last_output from ai_step).
        test:      Whether this is a test-run (no real side effects).

    Returns:
        - A node id string (next node to walk)
        - None (end of graph — no outgoing edges or unresolvable)
        - _PAUSE (approval in live mode — stop the walk)
    """
    kind = node.get("kind", "")
    node_id = node.get("id", "")

    if kind == "trigger":
        return _first_next(out_edges, node_id)

    elif kind == "ai_step":
        return _handle_ai_step(db, run, flow, node, out_edges, context)

    elif kind == "connector":
        return _handle_connector(run, node, out_edges, test)

    elif kind == "condition":
        return _handle_condition(node, out_edges, context)

    elif kind == "approval":
        return _handle_approval(db, run, flow, node, out_edges, test)

    else:
        # Unknown kind — pass through to the next node
        return _first_next(out_edges, node_id)


# ---------------------------------------------------------------------------
# Node kind handlers
# ---------------------------------------------------------------------------


def _handle_ai_step(
    db: Session,
    run: FlowRun,
    flow: Flow,
    node: dict[str, Any],
    out_edges: dict[str, list[dict]],
    context: dict[str, Any],
) -> str | None:
    """Spawn a Job for this ai_step node via start_job; collect the job_id."""
    from omilo.loop.runner import start_job

    helper = _get_helper(db, flow.company_id)
    if helper is None:
        # No helper found — mark run failed and stop walk
        run.status = "failed"
        run.waiting_for = "no helper for ai_step"
        run.ended_at = datetime.now(timezone.utc)
        db.flush()
        return None

    brief = node.get("label") or node.get("config", {}).get("brief") or "flow step"
    job = start_job(
        db,
        company_id=flow.company_id,
        helper_id=helper.id,
        origin="flow",
        brief=brief,
    )

    # Reassign (not append) to trigger JSONB change detection
    run.job_ids = run.job_ids + [job.id]  # type: ignore[operator]
    db.flush()

    # Thread the job's result_text into context for condition evaluation
    context["last_output"] = job.result_text or ""

    return _first_next(out_edges, node.get("id", ""))


def _handle_connector(
    run: FlowRun,
    node: dict[str, Any],
    out_edges: dict[str, list[dict]],
    test: bool,
) -> str | None:
    """Execute (or simulate) a connector node.

    In test mode: log a skip note — do NOT execute any real external call.
    In live mode (P2): same fake no-op; real connector calls deferred to P3+.
    """
    node_id = node.get("id", "")
    connector_name = node.get("config", {}).get("name") or node.get("label") or "?"
    if test:
        # Record the skip note — append to trigger_summary suffix for visibility
        skip_note = f"would run connector {connector_name}"
        if run.trigger_summary:
            run.trigger_summary = run.trigger_summary + f" | {skip_note}"
        else:
            run.trigger_summary = skip_note
    # Live mode P2: same no-op (no real external call)
    return _first_next(out_edges, node_id)


def _handle_condition(
    node: dict[str, Any],
    out_edges: dict[str, list[dict]],
    context: dict[str, Any],
) -> str | None:
    """Evaluate condition and follow the Yes or No outgoing edge.

    Condition config: {"keyword": "<word>"}.
    Match: keyword (case-insensitive) present in context["last_output"].
    Matched → follow edge labeled "Yes"; no match → edge labeled "No".
    If neither edge exists, return None (end of graph).
    """
    node_id = node.get("id", "")
    keyword = node.get("config", {}).get("keyword", "ok")
    last_output = context.get("last_output", "")
    matched = keyword.lower() in last_output.lower()
    target_label = "Yes" if matched else "No"
    context["step_note"] = target_label

    candidates = out_edges.get(node_id, [])
    for edge in candidates:
        if edge.get("label") == target_label:
            return edge.get("to")

    # No matching edge — treat as end of graph
    return None


def _handle_approval(
    db: Session,
    run: FlowRun,
    flow: Flow,
    node: dict[str, Any],
    out_edges: dict[str, list[dict]],
    test: bool,
) -> str | None | object:
    """Handle an approval node.

    test=True:  Record a note in trigger_summary (shows "Would wait for you")
                and continue walking (do NOT park the run).
    test=False: Create a decision InboxItem, set FlowRun.status="needs_you",
                FlowRun.waiting_for=<node id>, and return _PAUSE.
    """
    node_id = node.get("id", "")
    node_label = node.get("label") or "Approval required"

    if test:
        # Simulate approval: note it, continue
        note = f"would wait for approval: {node_label}"
        if run.trigger_summary:
            run.trigger_summary = run.trigger_summary + f" | {note}"
        else:
            run.trigger_summary = note
        return _first_next(out_edges, node_id)

    # Live mode: park the run
    helper = _get_helper(db, flow.company_id)
    helper_name = getattr(helper, "name", "flow") if helper else "flow"
    helper_area = getattr(helper, "area", "ops") if helper else "ops"

    inbox_item = InboxItem(
        id=prefixed_id("inb"),
        company_id=flow.company_id,
        title=node_label,
        summary=f"Flow run {run.id} is waiting for approval at node {node_id}.",
        session_id="",
        channel_id="",
        kind="decision",
        status="pending",
        asker=helper_name,
        asker_area=helper_area,
        needs_you=True,
        proposals=[{"flow_id": flow.id, "flow_run_id": run.id, "node_id": node_id}],
        actions=[
            {"label": "Approve", "primary": True},
            {"label": "Reject"},
        ],
        meta=f"flow_run:{run.id}",
    )
    db.add(inbox_item)
    db.flush()

    run.status = "needs_you"
    run.waiting_for = node_id
    db.flush()

    return _PAUSE


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _first_next(out_edges: dict[str, list[dict]], node_id: str) -> str | None:
    """Return the ``to`` of the first outgoing edge from ``node_id``, or None."""
    edges = out_edges.get(node_id, [])
    if edges:
        return edges[0].get("to")
    return None


def _get_helper(db: Session, company_id: str):
    """Return the Chief helper for this company, or any helper, or None."""
    from omilo.models.agents import Helper

    helper = (
        db.query(Helper)
        .filter_by(company_id=company_id, is_chief=True)
        .first()
    )
    if helper is None:
        helper = db.query(Helper).filter_by(company_id=company_id).first()
    return helper


# ---------------------------------------------------------------------------
# sweep: flow budget & limits (Settings › Budget & limits)
# ---------------------------------------------------------------------------

def _int_or_none(v: Any) -> int | None:
    try:
        n = int(float(str(v).replace(".", "").replace(",", ""))) if isinstance(v, str) else int(v)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def flow_limits(flow: Flow) -> dict[str, int | None]:
    """Read the editor's Budget & limits into credits / step counts.

    New settings store Rupiah strings (``monthlyBudgetRp``, ``costCapRp``);
    flows saved earlier stored dollars (``monthlyBudget``, ``costCap``,
    1 credit = $0.001). Missing / zero values mean "no limit".
    """
    from omilo.billing.catalog import IDR_PER_CREDIT

    st = flow.settings if isinstance(flow.settings, dict) else {}

    def credits(rp_key: str, usd_key: str) -> int | None:
        rp = _int_or_none(st.get(rp_key))
        if rp is not None:
            return max(1, rp // IDR_PER_CREDIT)
        usd = st.get(usd_key)
        try:
            usd_f = float(usd) if usd is not None else 0.0
        except (TypeError, ValueError):
            return None
        return max(1, int(round(usd_f * 1000))) if usd_f > 0 else None

    max_steps = _int_or_none(st.get("maxSteps"))
    return {
        "monthly_budget_credits": credits("monthlyBudgetRp", "monthlyBudget"),
        "cost_cap_credits": credits("costCapRp", "costCap"),
        "max_steps": max_steps,
    }


def spent_this_month_credits(db: Session, flow_id: str) -> int:
    """Sum of finished runs' cost since the 1st of the current (UTC) month."""
    from sqlalchemy import func

    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    total = (
        db.query(func.coalesce(func.sum(FlowRun.cost_credits), 0))
        .filter(FlowRun.flow_id == flow_id, FlowRun.started_at >= start)
        .scalar()
    )
    return int(total or 0)


def _run_cost(db: Session, run: FlowRun) -> int:
    if not run.job_ids:
        return 0
    from omilo.models.execution import Job

    jobs = db.query(Job).filter(Job.id.in_(list(run.job_ids))).all()
    return sum(int(j.cost_credits or 0) for j in jobs)
