"""Task 5 — resume a SUSPENDED graph run when the owner decides the escalated proposal.

A high-risk action escalates: the gate files a PENDING ``Proposal`` and suspends the
graph with a LangGraph ``interrupt`` (checkpointed, thread_id = task_id). This test
drives the owner's later decision and asserts the graph resumes from its checkpoint
and runs to completion — correctly, with no double execution.

- approve → the graph resumes, the gate's ``interrupt`` returns the decision, the run
  reaches ``done``, the task ends ``done``, and exactly ONE completion path runs (the
  graph owns completion; ``decide_proposal`` must NOT also spawn an execution task).
- reject → the graph resumes to a clean stop: nothing executes, the task is not left
  waiting, and the owner's note is recorded as a lesson.
- a non-graph (``single_engine``) proposal decided ``approve`` still spawns the normal
  execution task — the old path is byte-for-byte unchanged (regression).

These tests use the real DB through the ``owner`` fixture (the "small" preset hires a
Chief of Staff). The underlying ("exec") engine is stubbed so the worker node produces
a controllable ``pending_action`` without a live MCP server. We scope every assertion
to ids WE create so the shared ``omilo_test`` DB never bleeds state between tests, and
we drive the resume deterministically (await the hook) rather than sleeping.
"""
import uuid

from sqlalchemy import select

from omilo_api import memory
from omilo_api import services as S
from omilo_api import worker as worker_mod
from omilo_api.db import session_scope
from omilo_api.engines import Engine, EngineResult, TaskContext
from omilo_api.graph import engine as graph_engine_mod
from omilo_api.models import Proposal, Staff, Task


# ---------------------------------------------------------------------------
# Stub underlying engine — stands in for exec_engine={"type":"fake"}.
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
# Helpers
# ---------------------------------------------------------------------------

def _make_graph_staff() -> str:
    """A throwaway, non-chief worker staff on the graph brain."""
    sid = "resume-worker-" + uuid.uuid4().hex[:8]
    with session_scope() as db:
        db.add(Staff(id=sid, name="Resume Worker", role="marketing",
                     engine={"type": "fake"}, brain="graph"))
        db.commit()
    return sid


def _make_single_engine_staff() -> str:
    """A throwaway, non-chief worker staff on the default single engine brain."""
    sid = "single-worker-" + uuid.uuid4().hex[:8]
    with session_scope() as db:
        db.add(Staff(id=sid, name="Single Worker", role="marketing",
                     engine={"type": "fake"}, brain="single_engine"))
        db.commit()
    return sid


def _make_task(staff_id: str, brief: str = "do a risky thing") -> str:
    with session_scope() as db:
        t = S.create_task(db, staff_id, "task", brief, created_by="owner")
        return t.id


def _ctx(staff_id: str, task_id: str, pending_action: dict) -> TaskContext:
    engine_config = {"type": "graph", "exec_engine": {"type": "stub"},
                     "pending_action": pending_action}
    return TaskContext(
        staff_id=staff_id, staff_name="Resume Worker", job="marketing", is_chief=False,
        task_id=task_id, origin="task", brief="do a risky thing", founder_note="",
        checkpoint=None, proposal=None,
        mcp_url="http://127.0.0.1:0/mcp", mcp_token="unused-in-stub",
        engine_config=engine_config, emit=lambda *a, **k: None,
    )


# The outward/high-risk action a worker proposes that MUST escalate to the owner.
_HIGH_RISK = {"action_type": "payment.charge", "summary": "charge the client $200",
              "risk": "low", "title": "Charge the client", "body": "charge $200"}


async def _suspend_high_risk(worker_id: str, task_id: str, monkeypatch, text="ready to send"):
    """Run the graph to its high-risk suspend; return the PENDING proposal id."""
    stub = _StubEngine(text=text)
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)
    eng = graph_engine_mod.GraphEngine()
    res = await eng.run_task(_ctx(worker_id, task_id, _HIGH_RISK))
    assert "waiting" in (res.text or "").lower(), f"expected a waiting result, got {res.text!r}"
    with session_scope() as db:
        props = list(db.scalars(select(Proposal).where(Proposal.task_id == task_id)))
    assert len(props) == 1 and props[0].status == "pending", f"setup: {props}"
    return props[0].id


def _exec_tasks(staff_id: str) -> list[Task]:
    with session_scope() as db:
        return [t for t in db.scalars(select(Task).where(Task.staff_id == staff_id))
                if t.origin == "execution"]


def _task_status(task_id: str) -> str:
    with session_scope() as db:
        return db.get(Task, task_id).status


def _lessons_text(staff_id: str) -> str:
    return memory.lessons(staff_id)


# ---------------------------------------------------------------------------
# Test 1: approve → resume → task done, exactly one completion path.
# ---------------------------------------------------------------------------

async def test_resume_on_approve_completes(owner, monkeypatch):
    worker_id = _make_graph_staff()
    task_id = _make_task(worker_id)
    pid = await _suspend_high_risk(worker_id, task_id, monkeypatch)

    # The exec engine stub for the RESUME invocation (fresh worker-node re-entry would
    # re-run work, but on resume the gate returns before any further worker call; still,
    # keep get_engine patched so no live engine is reached).
    stub = _StubEngine(text="ready to send")
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)

    # The owner approves. decide_proposal must detect graph-origin, SKIP the normal
    # execution-task spawn, record audit+lesson, and signal a resume.
    with session_scope() as db:
        p = db.get(Proposal, pid)
        S.decide_proposal(db, p, "approve", "go ahead", by="owner")

    # No normal execution task was spawned for a graph-origin proposal (invariant #1).
    assert _exec_tasks(worker_id) == [], "graph-origin approve must NOT spawn an execution task"

    # Drive the resume hook deterministically (what decide_proposal enqueues).
    res = await worker_mod.resume_graph_run(task_id, "approve", "go ahead")
    assert res.error == "", f"resume errored: {res.error!r}"

    # The graph resumed to completion and the task ends done.
    assert _task_status(task_id) == "done", f"task should be done, got {_task_status(task_id)}"

    # Still exactly one proposal, now approved/done — and still no execution task
    # (the graph owns completion; nothing double-executed).
    with session_scope() as db:
        props = list(db.scalars(select(Proposal).where(Proposal.task_id == task_id)))
    assert len(props) == 1
    assert props[0].status in ("approved", "done")
    assert _exec_tasks(worker_id) == [], "no execution task should ever run for a graph-origin resume"


# ---------------------------------------------------------------------------
# Test 2: reject → resume → clean stop, nothing executes, note is a lesson.
# ---------------------------------------------------------------------------

async def test_resume_on_reject_clean_stop(owner, monkeypatch):
    worker_id = _make_graph_staff()
    task_id = _make_task(worker_id)
    pid = await _suspend_high_risk(worker_id, task_id, monkeypatch)

    stub = _StubEngine(text="ready to send")
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)

    note = "Do not charge clients without a signed SOW."
    with session_scope() as db:
        p = db.get(Proposal, pid)
        S.decide_proposal(db, p, "reject", note, by="owner")

    # Reject never spawns an execution task on any path.
    assert _exec_tasks(worker_id) == [], "reject must not spawn an execution task"

    res = await worker_mod.resume_graph_run(task_id, "reject", note)
    assert res.error == "", f"resume errored: {res.error!r}"

    # Clean stop: nothing executed, task not left waiting (ends done), proposal rejected.
    assert _exec_tasks(worker_id) == [], "nothing should execute after a reject"
    assert _task_status(task_id) == "done", f"task must not be left waiting, got {_task_status(task_id)}"
    with session_scope() as db:
        props = list(db.scalars(select(Proposal).where(Proposal.task_id == task_id)))
    assert len(props) == 1 and props[0].status == "rejected"

    # The owner's note became a lesson (via the existing decide_proposal path).
    # add_lesson collapses whitespace, so compare on the collapsed note.
    collapsed = " ".join(note.split())
    assert collapsed.lower() in _lessons_text(worker_id).lower(), \
        f"the reject note should be recorded as a lesson, got:\n{_lessons_text(worker_id)}"


# ---------------------------------------------------------------------------
# Test 3: a non-graph proposal still spawns the normal execution task (regression).
# ---------------------------------------------------------------------------

async def test_non_graph_proposal_unchanged(owner):
    worker_id = _make_single_engine_staff()
    task_id = _make_task(worker_id, brief="a normal proposal")

    with session_scope() as db:
        st = db.get(Staff, worker_id)
        p = S.create_proposal(db, st, task_id, "A normal action", "other", "medium",
                              "do the normal thing", actor=f"staff:{worker_id}")
        S.decide_proposal(db, p, "approve", "", by="owner")

    # The old path is unchanged: approving a single_engine proposal spawns one
    # execution task, and the proposal carries its execution_task_id.
    exec_tasks = _exec_tasks(worker_id)
    assert len(exec_tasks) == 1, f"single_engine approve must spawn exactly one execution task, got {exec_tasks}"
    with session_scope() as db:
        p2 = db.get(Proposal, p.id)
        assert p2.status == "approved"
        assert p2.execution_task_id == exec_tasks[0].id
