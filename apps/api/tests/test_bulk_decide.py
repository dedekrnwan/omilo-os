"""Tests for POST /api/inbox/bulk — bulk approve/deny with high-risk confirm gate.

Task 4 of 2026-10-18-approvals-in-chat-and-multi-engine-harness.
"""
from sqlalchemy import select

from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.models import InboxItem, Proposal, Staff

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BULK_STAFF_ID = "chief-of-staff"  # use chief, not support — avoids polluting support's lesson memory


def _create_proposal(risk: str, title: str | None = None) -> tuple[str, str]:
    """Create a Proposal + its InboxItem directly via services. Returns (proposal_id, inbox_item_id)."""
    with session_scope() as db:
        st = db.scalar(select(Staff).where(Staff.id == _BULK_STAFF_ID))
        p = S.create_proposal(
            db, st, task_id=None,
            title=title or f"Bulk test proposal ({risk} risk)",
            type_="content.publish",
            risk=risk,
            body=f"A {risk}-risk proposal for bulk decide tests.",
            actor="owner",  # actor=owner bypasses the open-proposal cap
        )
        # Find the inbox item
        item = db.scalar(select(InboxItem).where(InboxItem.kind == "proposal", InboxItem.ref_id == p.id))
        return p.id, item.id


def _create_access_item() -> str:
    """Create an access_request InboxItem via services. Returns inbox_item_id."""
    with session_scope() as db:
        st = db.scalar(select(Staff).where(Staff.id == _BULK_STAFF_ID))
        item = S.request_access(
            db, st, task_id=None, thread_id=None,
            kind="folder",
            target={"path": "/tmp/bulk-test-access", "access": "read"},
            reason="bulk decide access test",
        )
        return item.id


def _get_proposal_status(proposal_id: str) -> str:
    with session_scope() as db:
        p = db.get(Proposal, proposal_id)
        return p.status


def _get_inbox_status(item_id: str) -> str:
    with session_scope() as db:
        i = db.get(InboxItem, item_id)
        return i.status


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_bulk_approve_low_medium(owner):
    """Two low/medium proposals → both approved; Proposal.status == 'approved'; inbox items closed."""
    pid_low, iid_low = _create_proposal("low", "Low risk bulk test")
    pid_med, iid_med = _create_proposal("medium", "Medium risk bulk test")

    r = owner.post("/api/inbox/bulk", json={
        "ids": [iid_low, iid_med],
        "decision": "approve",
        "note": "",
        "confirm_high_risk": False,
    })
    assert r.status_code == 200, r.text
    data = r.json()

    # Both should be approved — assert on our specific IDs only
    assert iid_low in data["approved"], f"low-risk item not approved: {data}"
    assert iid_med in data["approved"], f"medium-risk item not approved: {data}"
    assert data["denied"] == []
    assert data["needs_confirm"] == []

    # Proposal statuses
    assert _get_proposal_status(pid_low) == "approved", "low-risk proposal not approved"
    assert _get_proposal_status(pid_med) == "approved", "medium-risk proposal not approved"

    # Inbox items closed
    assert _get_inbox_status(iid_low) == "done", "low-risk inbox item still open"
    assert _get_inbox_status(iid_med) == "done", "medium-risk inbox item still open"


def test_bulk_deny_requires_note(owner):
    """decision='deny', note='' → HTTP 400, nothing decided."""
    pid, iid = _create_proposal("low", "Deny note check")

    r = owner.post("/api/inbox/bulk", json={
        "ids": [iid],
        "decision": "deny",
        "note": "",
        "confirm_high_risk": False,
    })
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    # Proposal must remain pending
    assert _get_proposal_status(pid) == "pending", "proposal was decided despite missing note"
    assert _get_inbox_status(iid) == "open", "inbox item was closed despite 400"


def test_bulk_high_risk_needs_confirm(owner):
    """High-risk proposal with confirm_high_risk=False → needs_confirm lists it, approved=[];
    then confirm_high_risk=True → it is approved."""
    pid_high, iid_high = _create_proposal("high", "High risk bulk test")
    pid_low, iid_low = _create_proposal("low", "Low alongside high")

    # --- Pass 1: gate blocks high-risk ---
    r1 = owner.post("/api/inbox/bulk", json={
        "ids": [iid_high, iid_low],
        "decision": "approve",
        "note": "",
        "confirm_high_risk": False,
    })
    assert r1.status_code == 200, r1.text
    data1 = r1.json()

    assert data1["approved"] == [], f"nothing should be approved in gate pass: {data1}"
    assert data1["denied"] == []
    nc_ids = [nc["id"] for nc in data1["needs_confirm"]]
    assert iid_high in nc_ids, f"high-risk item should be in needs_confirm: {data1}"

    # Nothing decided yet
    assert _get_proposal_status(pid_high) == "pending"
    assert _get_proposal_status(pid_low) == "pending"

    # --- Pass 2: confirm_high_risk=True → both approved ---
    r2 = owner.post("/api/inbox/bulk", json={
        "ids": [iid_high, iid_low],
        "decision": "approve",
        "note": "",
        "confirm_high_risk": True,
    })
    assert r2.status_code == 200, r2.text
    data2 = r2.json()

    assert iid_high in data2["approved"], f"high-risk not approved after confirm: {data2}"
    assert iid_low in data2["approved"], f"low-risk not approved after confirm: {data2}"
    assert data2["needs_confirm"] == []

    assert _get_proposal_status(pid_high) == "approved"
    assert _get_proposal_status(pid_low) == "approved"


def test_bulk_skips_ineligible_and_decided(owner):
    """A question-kind id and an already-decided proposal id → both in skipped;
    a valid pending proposal in the same call is still approved."""
    # Create a question inbox item (ineligible kind)
    with session_scope() as db:
        st = db.scalar(select(Staff).where(Staff.id == _BULK_STAFF_ID))
        t = S.create_task(db, _BULK_STAFF_ID, "manual", "context task for question", created_by="owner")
        q_item = S.ask_founder(db, st, t.id, "What should I prioritize?", False)
        question_iid = q_item.id

    # Create a proposal and decide it immediately (so it's already-done)
    pid_done, iid_done = _create_proposal("low", "Pre-decided proposal")
    with session_scope() as db:
        p_done = db.get(Proposal, pid_done)
        S.decide_proposal(db, p_done, "approve", "", by="owner")

    # Create a valid pending proposal
    pid_valid, iid_valid = _create_proposal("low", "Valid pending proposal")

    r = owner.post("/api/inbox/bulk", json={
        "ids": [question_iid, iid_done, iid_valid],
        "decision": "approve",
        "note": "",
        "confirm_high_risk": False,
    })
    assert r.status_code == 200, r.text
    data = r.json()

    skipped_ids = [s["id"] for s in data["skipped"]]
    assert question_iid in skipped_ids, f"question item not in skipped: {data}"
    assert iid_done in skipped_ids, f"already-decided item not in skipped: {data}"
    assert iid_valid in data["approved"], f"valid pending proposal not approved: {data}"
    assert _get_proposal_status(pid_valid) == "approved"
