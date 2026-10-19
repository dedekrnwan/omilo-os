"""Task 7 — the REAL CoS action gate at the MCP ``request_action`` / ``propose`` seam.

Context
-------
The real engine (Claude Code) escalates outward actions by calling the MCP tool
``request_action`` mid-run. The gateway maps that to the policy: ``refused`` / ``ask``
(→ a Proposal filed to the owner) / ``allowed``. Before this task, an ASK-level action
by a ``brain="graph"`` staff filed a Proposal straight to the OWNER — the CoS never saw
it (the graph node-gate only fires for engines that surface a ``pending_action``, which
the real engine never produces).

This wire lets the Chief of Staff rule synchronously on that ASK-level Proposal for a
graph-brain staff:

- low / medium risk → the CoS auto-approves (via the existing ``decide_proposal`` path,
  audited as the CoS), and ``request_action`` returns ``allowed`` so the agent proceeds;
- high risk → escalates to the owner (Proposal stays PENDING, undecided);
- no CoS / the CoS acting on its own action → escalates to the owner (never self-approve).

A ``brain="single_engine"`` staff is left byte-for-byte unchanged: ASK → PENDING Proposal
for the owner.

We drive ``services.request_action`` directly with a staff we create per test (fresh
worker each time) so the shared ``omilo_test`` database never bleeds state (approving a
proposal writes a lesson, which could leak across tests).
"""
import uuid

from sqlalchemy import select

from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.graph.delegation import cos_id
from omilo_api.models import AuditEvent, Proposal, Staff, Task


# ---------------------------------------------------------------------------
# Helpers — a throwaway worker per test, scoped to ids we create.
# ---------------------------------------------------------------------------

def _make_worker(brain: str) -> str:
    sid = f"cos-worker-{brain}-" + uuid.uuid4().hex[:8]
    with session_scope() as db:
        db.add(Staff(id=sid, name="CoS Worker", role="marketing", engine={"type": "fake"}, brain=brain))
        db.commit()
    return sid


def _make_task(staff_id: str) -> str:
    with session_scope() as db:
        t = S.create_task(db, staff_id, "task", "do a thing", created_by="owner")
        return t.id


def _cos_id() -> str:
    with session_scope() as db:
        return cos_id(db)


def _request_action(staff_id: str, task_id: str, action: str, summary: str, details: str) -> dict:
    with session_scope() as db:
        st = db.get(Staff, staff_id)
        return S.request_action(db, st, task_id, action, summary, details)


def _proposals_for(task_id: str) -> list[Proposal]:
    with session_scope() as db:
        return list(db.scalars(select(Proposal).where(Proposal.task_id == task_id)))


def _audit_for(ref: str) -> list[AuditEvent]:
    with session_scope() as db:
        return list(db.scalars(select(AuditEvent).where(AuditEvent.ref == ref)))


# ---------------------------------------------------------------------------
# Test 1: a graph staff's ASK-level low/medium action → auto-approved by the CoS
# ---------------------------------------------------------------------------

def test_graph_staff_low_action_auto_approved_by_cos(owner):
    cid = _cos_id()
    assert cid, "the small-team preset should have hired a Chief of Staff"

    worker_id = _make_worker("graph")
    task_id = _make_task(worker_id)

    # knowledge.write is ASK-level (policy) and MEDIUM risk (classify_risk) — the
    # exact seam: filed as a proposal, then the CoS rules low/medium.
    res = _request_action(worker_id, task_id, "knowledge.write",
                          "draft an internal strategy note", "a draft")

    assert res["decision"] == "allowed", f"expected the CoS to auto-approve, got {res}"
    assert res.get("level") == "cos"

    props = _proposals_for(task_id)
    assert len(props) == 1, f"expected exactly one proposal, got {props}"
    p = props[0]
    assert p.status in ("approved", "done"), f"proposal not auto-approved: {p.status}"
    assert p.decided_by == cid, f"decided_by should be the CoS, got {p.decided_by!r}"
    assert p.risk in ("low", "medium")

    events = _audit_for(p.id)
    assert any(e.actor == cid and e.action.startswith("proposal.approve") for e in events), \
        f"no CoS-actor approval audit for {p.id}: {[(e.actor, e.action) for e in events]}"


# ---------------------------------------------------------------------------
# Test 2: a graph staff's ASK-level HIGH-risk action → escalate to owner
# ---------------------------------------------------------------------------

def test_graph_staff_high_action_escalates_to_owner(owner):
    worker_id = _make_worker("graph")
    task_id = _make_task(worker_id)

    # content.publish is ASK-level (policy) and HIGH risk (classify_risk) — the CoS
    # must NOT auto-approve; it stays pending for the owner.
    res = _request_action(worker_id, task_id, "content.publish",
                          "publish the blog post now", "the post body")

    assert res["decision"] == "needs_approval", f"high-risk must escalate, got {res}"

    props = _proposals_for(task_id)
    assert len(props) == 1, f"expected exactly one proposal, got {props}"
    p = props[0]
    assert p.status == "pending", f"high-risk proposal must stay pending, got {p.status}"
    assert p.decided_by == "", f"a high-risk proposal must not be decided, got {p.decided_by!r}"

    # No execution task spawned before the owner decides.
    with session_scope() as db:
        exec_tasks = [t for t in db.scalars(select(Task).where(Task.staff_id == worker_id))
                      if t.origin == "execution"]
    assert exec_tasks == [], f"no execution task before approval, got {exec_tasks}"


# ---------------------------------------------------------------------------
# Test 3: graph staff but NO CoS → escalate to owner (never self-approve)
# ---------------------------------------------------------------------------

def test_no_cos_escalates(owner, monkeypatch):
    from omilo_api.graph import delegation as delegation_mod

    # No delegation authority.
    monkeypatch.setattr(delegation_mod, "cos_id", lambda db: None)

    worker_id = _make_worker("graph")
    task_id = _make_task(worker_id)

    res = _request_action(worker_id, task_id, "knowledge.write",
                          "draft an internal note", "note")

    assert res["decision"] == "needs_approval", f"with no CoS it must escalate, got {res}"
    props = _proposals_for(task_id)
    assert len(props) == 1 and props[0].status == "pending", \
        f"with no CoS the proposal must stay pending, got {props}"
    assert props[0].decided_by == "", "a worker must never self-approve when no CoS exists"


# ---------------------------------------------------------------------------
# Test 4: single_engine staff → unchanged (needs_approval, pending for owner)
# ---------------------------------------------------------------------------

def test_single_engine_unchanged(owner):
    worker_id = _make_worker("single_engine")
    task_id = _make_task(worker_id)

    res = _request_action(worker_id, task_id, "knowledge.write",
                          "draft an internal note", "note")

    # Exactly as today: filed for the owner, never auto-approved by the CoS.
    assert res["decision"] == "needs_approval", f"single_engine must be unchanged, got {res}"
    assert res.get("level") == "ask"
    assert "proposal_id" in res
    props = _proposals_for(task_id)
    assert len(props) == 1 and props[0].status == "pending", \
        f"single_engine proposal must stay pending, got {props}"
    assert props[0].decided_by == "", "single_engine proposal must not be auto-decided"


# ---------------------------------------------------------------------------
# Test 5: the CoS itself doing an ASK action → escalate (never approve its own)
# ---------------------------------------------------------------------------

def test_cos_cannot_auto_approve_own_action(owner):
    cid = _cos_id()
    assert cid

    # Make the Chief of Staff a graph-brain staff so the wire would engage if it
    # didn't guard against self-approval.
    with session_scope() as db:
        chief = db.get(Staff, cid)
        chief.brain = "graph"
        db.commit()

    task_id = _make_task(cid)
    res = _request_action(cid, task_id, "knowledge.write",
                          "draft an internal note", "note")

    assert res["decision"] == "needs_approval", f"the CoS must not approve its own action, got {res}"
    props = _proposals_for(task_id)
    assert len(props) == 1 and props[0].status == "pending", \
        f"the CoS's own proposal must stay pending, got {props}"
    assert props[0].decided_by == "", "the CoS must not auto-approve its own proposal"
