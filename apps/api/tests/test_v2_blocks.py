"""TDD: v2 block producer — read-time mapping for task-scoped threads.

Tests that GET /api/threads/{id} derives v2 blocks for task-scoped threads:
  - An open Proposal on the task → an action_card block (no legacy proposal block left).
  - A PR/diff KbSource scoped to the task → a code block with a non-empty diff array.
  - Non-task threads are untouched.

Mirrors the direct-model-insert seeding pattern from test_team_board.py.

Run with:
    cd apps/api && uv run pytest tests/test_v2_blocks.py -v
"""
from __future__ import annotations

import datetime as dt

from omilo_api.db import session_scope
from omilo_api.models import (
    KbSource,
    Message,
    Proposal,
    ProposalRevision,
    Staff,
    Task,
    Thread,
)

# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

def _staff(suffix: str) -> Staff:
    return Staff(
        id=f"v2blk_staff_{suffix}",
        name=f"V2Blk Staff {suffix}",
        role="tester",
        is_chief=False,
        status="active",
    )


def _task(staff_id: str, **kw) -> Task:
    defaults = dict(
        origin="chat",
        brief="V2 block test task",
        status="running",
        cost_usd=0.0,
    )
    defaults.update(kw)
    return Task(staff_id=staff_id, **defaults)


def _thread(staff_id: str, **kw) -> Thread:
    defaults = dict(
        scope="task",
        title="V2 block test thread",
        awaiting_reply=False,
        updated_at=dt.datetime.now(dt.UTC),
    )
    defaults.update(kw)
    return Thread(staff_id=staff_id, **defaults)


def _proposal(staff_id: str, task_id: str, status: str = "pending", **kw) -> Proposal:
    defaults = dict(
        type="action",
        risk="medium",
        title="Deploy the feature",
        status=status,
    )
    defaults.update(kw)
    return Proposal(staff_id=staff_id, task_id=task_id, **defaults)


def _revision(proposal_id: str) -> ProposalRevision:
    return ProposalRevision(
        proposal_id=proposal_id,
        n=1,
        body_md="## Steps\n- Step 1\n- Step 2",
        author="v2blk_staff_p1",
        summary="Initial proposal",
    )


def _agent_message(thread_id: str, proposal_id: str) -> Message:
    """Simulate an agent message with a legacy proposal block."""
    text = "Deploy the feature"
    return Message(
        thread_id=thread_id,
        role="agent",
        author="v2blk_staff_p1",
        text=text,
        blocks=[
            {"type": "text", "text": text},
            {"type": "proposal", "proposal_id": proposal_id, "title": "Deploy the feature", "risk": "medium", "summary": ""},
        ],
        channel="web",
    )


# ---------------------------------------------------------------------------
# Test 1: open Proposal → action_card (and no legacy proposal block remains)
# ---------------------------------------------------------------------------

def test_open_proposal_becomes_action_card(owner):
    """A task-scoped thread with an open Proposal gets an action_card block.

    The action_card block must carry the proposal id so the onProposal callback
    in ActionCardBlock.tsx can hit /proposals/{id}/decide targeting the real row.
    The legacy 'proposal' block must NOT also be present (no double-render).
    """
    with session_scope() as db:
        s = _staff("p1")
        db.add(s)
        db.flush()

        task = _task(s.id)
        db.add(task)
        db.flush()
        task_id = task.id

        p = _proposal(s.id, task_id, status="pending")
        db.add(p)
        db.flush()
        proposal_id = p.id

        # ProposalRevision required (current_body needs at least one)
        rev = _revision(proposal_id)
        db.add(rev)

        th = _thread(s.id, scope="task", ref_id=task_id)
        db.add(th)
        db.flush()
        thread_id = th.id

        # Simulate the agent message that has the legacy proposal block
        msg = _agent_message(thread_id, proposal_id)
        db.add(msg)
        db.commit()

    resp = owner.get(f"/api/threads/{thread_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    blocks = [b for m in data.get("messages", []) for b in (m.get("blocks") or [])]

    # Must have at least one action_card block
    action_cards = [b for b in blocks if b.get("type") == "action_card"]
    assert action_cards, f"Expected action_card block, got block types: {[b.get('type') for b in blocks]}"

    # The action_card must carry the real proposal id for the decide callback
    ac = action_cards[0]
    assert ac.get("proposal_id") == proposal_id, (
        f"action_card.proposal_id={ac.get('proposal_id')!r}, want {proposal_id!r}"
    )

    # No legacy 'proposal' block must remain (no double-render)
    legacy = [b for b in blocks if b.get("type") == "proposal"]
    assert not legacy, f"Legacy 'proposal' blocks still present: {legacy}"


def test_changes_requested_proposal_also_becomes_action_card(owner):
    """Proposals with status='changes_requested' are also open → action_card."""
    with session_scope() as db:
        s = _staff("p2")
        db.add(s)
        db.flush()

        task = _task(s.id)
        db.add(task)
        db.flush()
        task_id = task.id

        p = _proposal(s.id, task_id, status="changes_requested")
        db.add(p)
        db.flush()
        proposal_id = p.id
        rev = _revision(proposal_id)
        db.add(rev)

        th = _thread(s.id, scope="task", ref_id=task_id)
        db.add(th)
        db.flush()
        thread_id = th.id

        msg = _agent_message(thread_id, proposal_id)
        db.add(msg)
        db.commit()

    resp = owner.get(f"/api/threads/{thread_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    blocks = [b for m in data.get("messages", []) for b in (m.get("blocks") or [])]

    action_cards = [b for b in blocks if b.get("type") == "action_card"]
    assert action_cards, "Expected action_card for changes_requested proposal"
    assert not any(b.get("type") == "proposal" for b in blocks), "No legacy proposal block"


def test_terminal_proposal_not_promoted(owner):
    """A terminal (approved) Proposal is NOT turned into an action_card."""
    with session_scope() as db:
        s = _staff("p3")
        db.add(s)
        db.flush()

        task = _task(s.id)
        db.add(task)
        db.flush()
        task_id = task.id

        p = _proposal(s.id, task_id, status="approved")
        db.add(p)
        db.flush()
        proposal_id = p.id
        rev = _revision(proposal_id)
        db.add(rev)

        th = _thread(s.id, scope="task", ref_id=task_id)
        db.add(th)
        db.flush()
        thread_id = th.id

        msg = _agent_message(thread_id, proposal_id)
        db.add(msg)
        db.commit()

    resp = owner.get(f"/api/threads/{thread_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    blocks = [b for m in data.get("messages", []) for b in (m.get("blocks") or [])]

    # Approved proposals do not become action_card — the legacy block stays as-is
    action_cards = [b for b in blocks if b.get("type") == "action_card"]
    assert not action_cards, "Approved proposal should NOT produce an action_card"


# ---------------------------------------------------------------------------
# Test 2: PR/diff artifact → code block
# ---------------------------------------------------------------------------

def test_pr_artifact_becomes_code_block(owner):
    """A KbSource with kind='pr' and a diff in meta produces a 'code' block."""
    with session_scope() as db:
        s = _staff("pr1")
        db.add(s)
        db.flush()

        task = _task(s.id)
        db.add(task)
        db.flush()
        task_id = task.id

        th = _thread(s.id, scope="task", ref_id=task_id)
        db.add(th)
        db.flush()
        thread_id = th.id

        # Agent message without any diff — just a markdown message
        msg = Message(
            thread_id=thread_id,
            role="agent",
            author=s.id,
            text="Here is the PR diff",
            blocks=[{"type": "text", "text": "Here is the PR diff"}],
            channel="web",
        )
        db.add(msg)

        # KbSource with kind='pr' scoped to the task, carrying a diff in meta
        kb = KbSource(
            kind="pr",
            ref=task_id,
            title="PR #42: Add feature",
            url="https://github.com/acme/repo/pull/42",
            meta={
                "diff": [
                    {"n": 1, "sign": " ", "text": "def hello():"},
                    {"n": 2, "sign": "-", "text": "    pass"},
                    {"n": 3, "sign": "+", "text": "    return 'world'"},
                ]
            },
        )
        db.add(kb)
        db.commit()

    resp = owner.get(f"/api/threads/{thread_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    blocks = [b for m in data.get("messages", []) for b in (m.get("blocks") or [])]
    code_blocks = [b for b in blocks if b.get("type") == "code"]
    assert code_blocks, f"Expected a 'code' block, got: {[b.get('type') for b in blocks]}"

    cb = code_blocks[0]
    diff = cb.get("diff")
    assert diff and len(diff) > 0, f"code block has empty diff: {cb}"

    # Verify DiffLine shape (n, sign, text) matches blocks.tsx's DiffLine type
    for line in diff:
        assert "n" in line, f"DiffLine missing 'n': {line}"
        assert "sign" in line, f"DiffLine missing 'sign': {line}"
        assert "text" in line, f"DiffLine missing 'text': {line}"
        assert line["sign"] in (" ", "+", "-"), f"DiffLine.sign invalid: {line['sign']!r}"


# ---------------------------------------------------------------------------
# Test 3: non-task threads are unchanged
# ---------------------------------------------------------------------------

def test_non_task_thread_not_modified(owner):
    """A staff-scoped thread with a proposal block is returned unchanged."""
    with session_scope() as db:
        s = _staff("nt1")
        db.add(s)
        db.flush()

        th = _thread(s.id, scope="staff", ref_id=None)
        db.add(th)
        db.flush()
        thread_id = th.id

        # A message with a legacy proposal block
        msg = Message(
            thread_id=thread_id,
            role="agent",
            author=s.id,
            text="Some proposal",
            blocks=[
                {"type": "text", "text": "Some proposal"},
                {"type": "proposal", "proposal_id": "fake_id", "title": "Old proposal", "risk": "low", "summary": ""},
            ],
            channel="web",
        )
        db.add(msg)
        db.commit()

    resp = owner.get(f"/api/threads/{thread_id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    blocks = [b for m in data.get("messages", []) for b in (m.get("blocks") or [])]

    # The legacy proposal block must still be there — non-task thread is untouched
    legacy = [b for b in blocks if b.get("type") == "proposal"]
    assert legacy, "Non-task thread must preserve the legacy proposal block unchanged"

    # No spurious action_card injection
    assert not any(b.get("type") == "action_card" for b in blocks), (
        "action_card must not be injected into non-task threads"
    )
