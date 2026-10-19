"""Task 5 — resume a SUSPENDED graph run through the REAL worker path.

The earlier version of this test called ``GraphEngine().run_task()`` directly, which
left the task ``running`` and HID the production bug: in the real flow the worker's
``_finish`` sees no error on an interrupt and would mark the task ``done``, so
``services._graph_origin_task`` (which keyed off queued/running) never fired — the owner's
decision then double-executed (spawning a normal execution task) and orphaned the
checkpoint. The fix is a durable ``"waiting"`` task state the real worker writes on an
interrupt; detection keys off ``status == "waiting"`` + ``brain == "graph"``.

So these tests drive suspension through ``Worker.run_task`` → ``_finish`` (NOT a direct
engine call), assert the task actually lands in ``"waiting"``, then decide and resume:

- approve → the real worker suspends (task ``waiting``, proposal pending); the owner
  approves; ``decide_proposal`` detects graph-origin, does NOT spawn an execution task,
  and signals a resume; the resume completes the run and the task ends ``done``. The
  underlying work stub ran EXACTLY ONCE (the suspend pass) — nothing double-executed.
- reject → real worker suspends; the owner rejects with a note; resume stops cleanly, the
  task is terminal (not left ``waiting``), nothing executes, and the note becomes a lesson.
- a ``waiting`` task is never re-dispatched by ``dispatch_tasks``.
- a non-graph (``single_engine``) proposal decided ``approve`` still spawns the normal
  execution task (regression — the old path is unchanged).

We scope every assertion to ids WE create so the shared ``omilo_test`` DB never bleeds
state between tests, stub the underlying ("exec") engine so no live MCP/LLM is reached,
and drive resume deterministically (await the hook once) — no sleeps, no leaked tasks.
"""
import asyncio
import uuid

import pytest
from sqlalchemy import select

from omilo_api import memory
from omilo_api import services as S
from omilo_api import worker as worker_mod
from omilo_api.db import session_scope
from omilo_api.engines import Engine, EngineResult, TaskContext
from omilo_api.graph import engine as graph_engine_mod
from omilo_api.models import Proposal, Staff, Task
from omilo_api.worker import Worker


@pytest.fixture(autouse=True)
def _isolate_resume_state(owner):
    """Isolate the worker-controlled surface these tests drive BY HAND.

    The ``owner`` fixture boots the API with an EMBEDDED worker (``embedded_worker`` defaults
    True) running in a background thread. Its ``dispatch_tasks`` loop would otherwise pick up
    our queued graph task and run the real GraphEngine (NOT our stub) concurrently with our
    manual ``Worker().run_task`` — a race that double-executes the worker node. We PAUSE the
    company so the embedded worker's dispatch loop skips our tasks (``dispatch_tasks`` returns
    early when paused); we drive the worker deterministically ourselves. We also clear the
    module-global resume guard/queue so no resume state bleeds between tests."""
    with session_scope() as db:
        S.set_setting(db, "paused", True, actor="test")
    worker_mod._resuming.clear()
    worker_mod._resume_queue.clear()
    yield
    worker_mod._resuming.clear()
    worker_mod._resume_queue.clear()
    with session_scope() as db:
        S.set_setting(db, "paused", False, actor="test")


# ---------------------------------------------------------------------------
# Stub underlying engine — stands in for exec_engine={"type":"stub"}.
# The graph's worker node delegates to it; we count calls to prove the real work
# runs EXACTLY ONCE (on the suspend pass) and never again on resume.
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

# The high-risk action a worker proposes that MUST escalate to the owner. The worker
# self-labels it "low" to dodge escalation; the gate re-derives risk from action_type
# and escalates anyway. Injected via the staff's engine config (the Task 6 seam) so it
# flows through the REAL worker → GraphEngine → gate path, not a hand-built ctx.
_HIGH_RISK = {"action_type": "payment.charge", "summary": "charge the client $200",
              "risk": "low", "title": "Charge the client", "body": "charge $200"}


def _make_graph_staff(pending_action: dict | None = _HIGH_RISK) -> str:
    """A throwaway, non-chief worker on the graph brain, whose engine config carries the
    pending_action the worker node will surface to the gate (the Task 6 test seam)."""
    sid = "resume-worker-" + uuid.uuid4().hex[:8]
    engine = {"type": "graph", "exec_engine": {"type": "stub"}}
    if pending_action is not None:
        engine["pending_action"] = pending_action
    with session_scope() as db:
        db.add(Staff(id=sid, name="Resume Worker", role="marketing",
                     engine=engine, brain="graph"))
        db.commit()
    return sid


def _make_single_engine_staff() -> str:
    """A throwaway, non-chief worker on the default single_engine brain."""
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


def _exec_tasks(staff_id: str) -> list[Task]:
    with session_scope() as db:
        return [t for t in db.scalars(select(Task).where(Task.staff_id == staff_id))
                if t.origin == "execution"]


def _task_status(task_id: str) -> str:
    with session_scope() as db:
        return db.get(Task, task_id).status


def _proposals(task_id: str) -> list[Proposal]:
    with session_scope() as db:
        return list(db.scalars(select(Proposal).where(Proposal.task_id == task_id)))


def _lessons_text(staff_id: str) -> str:
    return memory.lessons(staff_id)


async def _suspend_via_real_worker(stub: _StubEngine, task_id: str) -> None:
    """Run the high-risk task through the REAL worker path (run_task → _finish) so the
    task actually lands in the durable ``"waiting"`` state. The underlying engine inside
    the graph is the counting stub."""
    w = Worker()
    await w.run_task(task_id)
    # No worker asyncio.Tasks were created here (run_task is awaited inline), so nothing
    # can leak from the suspend phase.
    assert not w.running, "run_task must not leave background tasks"
    assert _task_status(task_id) == "waiting", \
        f"real worker must park a suspended task in 'waiting', got {_task_status(task_id)!r}"
    props = _proposals(task_id)
    assert len(props) == 1 and props[0].status == "pending", f"setup: {props}"
    assert stub.calls == 1, f"the work stub should run once on the suspend pass, got {stub.calls}"


# ---------------------------------------------------------------------------
# Test 1: approve → real worker suspends → resume → task done, exactly one work run.
# ---------------------------------------------------------------------------

async def test_resume_on_approve_completes(owner, monkeypatch):
    worker_id = _make_graph_staff()
    task_id = _make_task(worker_id)

    stub = _StubEngine(text="ready to send")
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)

    # Drive resume through exactly ONE path: record that decide_proposal SIGNALLED a resume,
    # but don't let it spawn a detached task (which would race the awaited hook below and
    # could outlive the test's event loop). We await the hook ourselves, deterministically.
    signalled: list[tuple] = []
    monkeypatch.setattr(worker_mod, "request_resume",
                        lambda tid, dec, note: signalled.append((tid, dec, note)))

    # (a) The REAL worker runs the high-risk task and parks it in "waiting".
    await _suspend_via_real_worker(stub, task_id)
    pid = _proposals(task_id)[0].id

    # (b)/(c) The owner approves. decide_proposal must detect graph-origin (waiting +
    # brain=graph), SKIP the normal execution-task spawn, record audit+lesson, and signal
    # a resume.
    with session_scope() as db:
        p = db.get(Proposal, pid)
        S.decide_proposal(db, p, "approve", "go ahead", by="owner")

    # decide_proposal signalled exactly one resume for our task (graph-origin detection fired).
    assert signalled == [(task_id, "approve", "go ahead")], \
        f"decide_proposal must signal a resume for the graph task, got {signalled}"

    # No normal execution task was spawned for a graph-origin proposal (invariant).
    assert _exec_tasks(worker_id) == [], "graph-origin approve must NOT spawn an execution task"

    # Drive the resume hook deterministically through ONE awaited path (no detached task).
    res = await worker_mod.resume_graph_run(task_id, *signalled[0][1:])
    assert res.error == "", f"resume errored: {res.error!r}"

    # The graph resumed to completion and the task ends done (left "waiting").
    assert _task_status(task_id) == "done", f"task should be done, got {_task_status(task_id)}"

    # Exactly one proposal, now approved/done — still no execution task, and the work
    # stub never ran a SECOND time (no double execution on resume).
    props = _proposals(task_id)
    assert len(props) == 1 and props[0].status in ("approved", "done")
    assert _exec_tasks(worker_id) == [], "no execution task should ever run for a graph-origin resume"
    assert stub.calls == 1, f"the work stub must run EXACTLY once, got {stub.calls}"

    # (d) No leaked resume tasks: no detached task was ever created (request_resume stubbed),
    # and the dedup guard is released.
    await asyncio.sleep(0)
    assert task_id not in worker_mod._resuming, "resume dedup guard must be released"
    assert not [t for t in asyncio.all_tasks() if t is not asyncio.current_task()], \
        "no background resume task should be left pending"
    assert _task_status(task_id) == "done"


# ---------------------------------------------------------------------------
# Test 2: reject → real worker suspends → resume → clean stop, nothing executes.
# ---------------------------------------------------------------------------

async def test_resume_on_reject_clean_stop(owner, monkeypatch):
    worker_id = _make_graph_staff()
    task_id = _make_task(worker_id)

    stub = _StubEngine(text="ready to send")
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)

    signalled: list[tuple] = []
    monkeypatch.setattr(worker_mod, "request_resume",
                        lambda tid, dec, note: signalled.append((tid, dec, note)))

    await _suspend_via_real_worker(stub, task_id)
    pid = _proposals(task_id)[0].id

    note = "Do not charge clients without a signed SOW."
    with session_scope() as db:
        p = db.get(Proposal, pid)
        S.decide_proposal(db, p, "reject", note, by="owner")

    # Reject never spawns an execution task on any path, and decide_proposal signalled a resume.
    assert _exec_tasks(worker_id) == [], "reject must not spawn an execution task"
    assert signalled == [(task_id, "reject", note)], f"reject must signal a resume, got {signalled}"

    res = await worker_mod.resume_graph_run(task_id, "reject", note)
    assert res.error == "", f"resume errored: {res.error!r}"

    # Clean stop: nothing executed (stub still at one call), task not left waiting, proposal rejected.
    assert _exec_tasks(worker_id) == [], "nothing should execute after a reject"
    assert stub.calls == 1, f"nothing should run again after a reject, got {stub.calls}"
    assert _task_status(task_id) == "done", f"task must not be left waiting, got {_task_status(task_id)}"
    props = _proposals(task_id)
    assert len(props) == 1 and props[0].status == "rejected"

    # The owner's note became a lesson (via the existing decide_proposal path).
    collapsed = " ".join(note.split())
    assert collapsed.lower() in _lessons_text(worker_id).lower(), \
        f"the reject note should be recorded as a lesson, got:\n{_lessons_text(worker_id)}"

    await asyncio.sleep(0)
    assert task_id not in worker_mod._resuming, "resume dedup guard must be released"
    assert not [t for t in asyncio.all_tasks() if t is not asyncio.current_task()], \
        "no background resume task should be left pending"


# ---------------------------------------------------------------------------
# Test 3: a waiting task is not re-dispatched by dispatch_tasks.
# ---------------------------------------------------------------------------

async def test_suspended_task_not_redispatched(owner, monkeypatch):
    worker_id = _make_graph_staff()
    task_id = _make_task(worker_id)

    stub = _StubEngine(text="ready to send")
    monkeypatch.setattr(graph_engine_mod, "get_engine", lambda cfg: stub)

    await _suspend_via_real_worker(stub, task_id)
    assert _task_status(task_id) == "waiting"

    # UNPAUSE for this assertion so we prove the WAITING status (not the pause) is what keeps
    # the task out of dispatch. dispatch_tasks only selects status == "queued"; a waiting task
    # must NOT be re-started. (The autouse fixture re-pauses on teardown.)
    with session_scope() as db:
        S.set_setting(db, "paused", False, actor="test")
    w = Worker()
    w.dispatch_tasks()
    assert task_id not in w.running, "a waiting task must never be re-dispatched"
    assert _task_status(task_id) == "waiting", "dispatch must not change a waiting task"
    assert stub.calls == 1, f"the work must not run again on dispatch, got {stub.calls}"


# ---------------------------------------------------------------------------
# Test 4: a non-graph proposal still spawns the normal execution task (regression).
# ---------------------------------------------------------------------------

async def test_non_graph_proposal_unchanged(owner):
    worker_id = _make_single_engine_staff()
    task_id = _make_task(worker_id, brief="a normal proposal")

    with session_scope() as db:
        st = db.get(Staff, worker_id)
        p = S.create_proposal(db, st, task_id, "A normal action", "other", "medium",
                              "do the normal thing", actor=f"staff:{worker_id}")
        S.decide_proposal(db, p, "approve", "", by="owner")

    # The old path is unchanged: approving a single_engine proposal spawns exactly one
    # execution task, and the proposal carries its execution_task_id.
    exec_tasks = _exec_tasks(worker_id)
    assert len(exec_tasks) == 1, f"single_engine approve must spawn one execution task, got {exec_tasks}"
    with session_scope() as db:
        p2 = db.get(Proposal, p.id)
        assert p2.status == "approved"
        assert p2.execution_task_id == exec_tasks[0].id
