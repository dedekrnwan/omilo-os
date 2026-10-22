"""Task 4 — the CoS delegation gate inside the LangGraph brain.

The gate sits after the worker node. It re-derives risk structurally from the
worker's ``pending_action`` (never trusting the worker's self-label) and then:

- low / medium: files a ``Proposal`` and auto-approves it AS THE CHIEF OF STAFF via
  the existing ``services.decide_proposal`` (so audit + lesson + execution-task
  spawning are reused), then lets the graph finish normally;
- high: files a PENDING ``Proposal`` and suspends the graph with a LangGraph
  ``interrupt`` (checkpointed, thread_id = task_id), executing nothing — the run
  ends in a WAITING state that ``GraphEngine.run_task`` reports.

These tests drive the real DB through the ``owner`` fixture (the "small" team
preset hires the ``chief-of-staff`` CoS). The underlying ("exec") engine is stubbed
so the worker node produces a controllable ``pending_action`` without a live MCP
server or LLM. We scope every assertion to ids WE create (a throwaway worker staff)
so a shared ``omilo_test`` database never bleeds state between tests.
"""
import uuid

from sqlalchemy import select

from omilo_api.db import session_scope
from omilo_api.engines import Engine, EngineResult, TaskContext, get_engine
from omilo_api.graph import engine as graph_engine_mod
from omilo_api.graph.delegation import cos_id
from omilo_api.models import AuditEvent, Proposal, Setting, Staff, Task

# ---------------------------------------------------------------------------
# Stub underlying engine — stands in for exec_engine={"type":"fake"}.
# The graph's worker node delegates to it; we only need text back.
# ---------------------------------------------------------------------------

class _StubEngine(Engine):
    type = "stub"

    def __init__(self, text: str = "did the work"):
        self._text = text
        self.calls = 0

    async def run_task(self, ctx: TaskContext) -> EngineResult:
        self.calls += 1
        return EngineResult(text=self._text)

    async def chat(self, ctx) -> EngineResult:  # pragma: no cover - unused
        return EngineResult(text="chat")


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _make_worker_staff() -> str:
    """Create a throwaway, non-chief worker staff and return its id."""
    sid = "gate-worker-" + uuid.uuid4().hex[:8]
    with session_scope() as db:
        db.add(Staff(id=sid, name="Gate Worker", role="marketing", engine={"type": "fake"}))
        db.commit()
    return sid


def _make_task(staff_id: str, brief: str = "do a thing") -> str:
    """Create a task for the staff and return its id."""
    from omilo_api import services as S

    with session_scope() as db:
        t = S.create_task(db, staff_id, "task", brief, created_by="owner")
        return t.id


def _ctx(staff_id: str, task_id: str, pending_action: dict | None) -> TaskContext:
    """A TaskContext routed through the graph engine, with the worker node's
    pending_action injected via engine_config (test seam; Task 6 fills it from
    the real engine output)."""
    engine_config = {"type": "graph", "exec_engine": {"type": "stub"}}
    if pending_action is not None:
        engine_config["pending_action"] = pending_action
    return TaskContext(
        staff_id=staff_id, staff_name="Gate Worker", job="marketing", is_chief=False,
        task_id=task_id, origin="task", brief="do a thing", founder_note="",
        checkpoint=None, proposal=None,
        mcp_url="http://127.0.0.1:0/mcp", mcp_token="unused-in-stub",
        engine_config=engine_config, emit=lambda *a, **k: None,
    )


def _proposals_for(task_id: str) -> list[Proposal]:
    with session_scope() as db:
        return list(db.scalars(select(Proposal).where(Proposal.task_id == task_id)))


def _audit_for_proposal(proposal_id: str) -> list[AuditEvent]:
    with session_scope() as db:
        return list(db.scalars(select(AuditEvent).where(AuditEvent.ref == proposal_id)))


def _cos_id() -> str:
    with session_scope() as db:
        return cos_id(db)


# ---------------------------------------------------------------------------
# Test 1: low/medium internal action → auto-approved by the CoS, run completes
# ---------------------------------------------------------------------------

async def test_gate_auto_approves_low_medium(owner, monkeypatch):
    stub = _StubEngine(text="drafted the doc")
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)

    worker_id = _make_worker_staff()
    task_id = _make_task(worker_id)
    cid = _cos_id()
    assert cid, "the small-team preset should have hired a Chief of Staff"

    # An INTERNAL low/medium action: docs.write is a known-internal type, and the
    # summary is genuinely internal (no outward verb for the classifier to catch).
    pending = {"action_type": "docs.write", "summary": "draft an internal strategy note",
               "risk": "low", "title": "Draft strategy note", "body": "a draft"}

    eng = get_engine({"type": "graph", "exec_engine": {"type": "stub"}})
    res = await eng.run_task(_ctx(worker_id, task_id, pending))

    # The run completed normally (not waiting on the owner).
    assert res.error == ""
    assert "waiting" not in (res.text or "").lower()

    # Exactly one Proposal for this task, decided approved by the CoS.
    props = _proposals_for(task_id)
    assert len(props) == 1, f"expected one proposal, got {props}"
    p = props[0]
    assert p.status in ("approved", "done"), f"proposal not auto-approved: {p.status}"
    assert p.decided_by == cid, f"decided_by should be the CoS, got {p.decided_by!r}"
    assert p.risk in ("low", "medium")

    # An audit event records the CoS as the approving actor.
    events = _audit_for_proposal(p.id)
    assert any(e.actor == cid and e.action.startswith("proposal.approve") for e in events), \
        f"no CoS-actor approval audit event for {p.id}: {[(e.actor, e.action) for e in events]}"


# ---------------------------------------------------------------------------
# Test 2: high-risk outward action (even self-labeled low) → escalate, suspend
# ---------------------------------------------------------------------------

async def test_gate_escalates_high_risk(owner, monkeypatch):
    stub = _StubEngine(text="ready to send")
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)

    worker_id = _make_worker_staff()
    # High-risk escalates only when NOT in Auto/YOLO. Put the company in Strict and
    # make this worker guided so the gate escalates instead of auto-approving.
    with session_scope() as db:
        db.add(Setting(key="autonomy_mode", value="strict"))
        db.get(Staff, worker_id).autonomy = "guided"
        db.commit()
    task_id = _make_task(worker_id)

    # An OUTWARD action a worker tried to self-label "low" to dodge escalation.
    pending = {"action_type": "payment.charge", "summary": "charge the client $200",
               "risk": "low", "title": "Charge the client", "body": "charge $200"}

    eng = get_engine({"type": "graph", "exec_engine": {"type": "stub"}})
    res = await eng.run_task(_ctx(worker_id, task_id, pending))

    # The run ends WAITING for the owner — executing nothing.
    assert "waiting" in (res.text or "").lower(), f"expected a waiting result, got {res.text!r}"

    # A Proposal was filed but left PENDING (NOT decided by anyone).
    props = _proposals_for(task_id)
    assert len(props) == 1, f"expected one proposal, got {props}"
    p = props[0]
    assert p.status == "pending", f"high-risk proposal must stay pending, got {p.status}"
    assert p.risk == "high", f"risk must be re-derived to high, got {p.risk}"
    assert p.decided_by == "", "a suspended proposal must not be decided"

    # No execution task was spawned (the only task is the original one).
    with session_scope() as db:
        tasks = list(db.scalars(select(Task).where(Task.staff_id == worker_id)))
        exec_tasks = [t for t in tasks if t.origin == "execution"]
    assert exec_tasks == [], f"no execution task should run before approval, got {exec_tasks}"


# ---------------------------------------------------------------------------
# Test 3: the auto-approval actor is the CoS, not the worker
# ---------------------------------------------------------------------------

async def test_gate_uses_cos_not_worker_as_approver(owner, monkeypatch):
    stub = _StubEngine(text="drafted")
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)

    worker_id = _make_worker_staff()
    task_id = _make_task(worker_id)
    cid = _cos_id()
    assert cid and cid != worker_id

    pending = {"action_type": "docs.write", "summary": "draft an internal note",
               "risk": "low", "title": "Internal note", "body": "note"}

    eng = get_engine({"type": "graph", "exec_engine": {"type": "stub"}})
    await eng.run_task(_ctx(worker_id, task_id, pending))

    props = _proposals_for(task_id)
    assert len(props) == 1
    p = props[0]
    assert p.decided_by == cid, f"approver must be the CoS {cid}, got {p.decided_by!r}"
    assert p.decided_by != worker_id, "the worker must not approve its own proposal"

    events = _audit_for_proposal(p.id)
    approvals = [e for e in events if e.action.startswith("proposal.approve")]
    assert approvals, "expected a proposal.approve audit event"
    assert all(e.actor == cid for e in approvals), \
        f"approval audit actor must be the CoS, got {[e.actor for e in approvals]}"


# ---------------------------------------------------------------------------
# Test 4: a pure internal task (no pending_action) finishes with no proposal
# ---------------------------------------------------------------------------

async def test_gate_no_pending_action_finishes_without_proposal(owner, monkeypatch):
    stub = _StubEngine(text="internal work done")
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)

    worker_id = _make_worker_staff()
    task_id = _make_task(worker_id)

    eng = get_engine({"type": "graph", "exec_engine": {"type": "stub"}})
    res = await eng.run_task(_ctx(worker_id, task_id, pending_action=None))

    assert res.error == ""
    assert "waiting" not in (res.text or "").lower()
    assert _proposals_for(task_id) == [], "a pure internal task must not file a proposal"


# ---------------------------------------------------------------------------
# Test 5: with NO Chief of Staff, a low/medium action escalates to the owner
#         (it must NOT be auto-approved by the worker itself)
# ---------------------------------------------------------------------------

async def test_gate_no_cos_escalates_instead_of_self_approve(owner, monkeypatch):
    from omilo_api.graph import delegation as delegation_mod

    stub = _StubEngine(text="drafted")
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)
    # No delegation authority: cos_id returns None (company without a chief).
    monkeypatch.setattr(delegation_mod, "cos_id", lambda db: None)

    worker_id = _make_worker_staff()
    task_id = _make_task(worker_id)

    # A low/medium INTERNAL action that WOULD be auto-approved if a CoS existed.
    pending = {"action_type": "docs.write", "summary": "draft an internal note",
               "risk": "low", "title": "Internal note", "body": "note"}

    eng = get_engine({"type": "graph", "exec_engine": {"type": "stub"}})
    res = await eng.run_task(_ctx(worker_id, task_id, pending))

    # With no CoS, it escalates to the owner rather than self-approving.
    assert "waiting" in (res.text or "").lower(), f"expected a waiting result, got {res.text!r}"
    props = _proposals_for(task_id)
    assert len(props) == 1 and props[0].status == "pending", \
        f"with no CoS the proposal must stay pending (escalated), got {props}"
    assert props[0].decided_by == "", "a worker must never approve its own proposal when no CoS exists"
    with session_scope() as db:
        exec_tasks = [t for t in db.scalars(select(Task).where(Task.staff_id == worker_id)) if t.origin == "execution"]
    assert exec_tasks == [], "nothing should execute without owner approval when no CoS exists"
