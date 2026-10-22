"""The action gate at the MCP ``request_action`` seam, under Auto/YOLO.

The real engine (Claude Code) escalates side-effect actions by calling the MCP tool
``request_action`` mid-run. The gateway maps that to the autonomy policy:

- Company in **Auto** (permissive, the default): every action runs without asking —
  ``allowed`` (level ``auto``), no Proposal filed — EXCEPT the self-destruct floor
  (``policy.ALWAYS_ASK``: credentials/auth/company-deletion), which is filed PENDING
  for the owner.
- Company in **Strict**: ASK-level actions are filed PENDING for the owner.
- ``OFF`` actions are always refused.

We drive ``services.request_action`` directly with a staff we create per test (fresh
worker each time) so the shared ``omilo_test`` database never bleeds state.
"""
import uuid

from sqlalchemy import select

from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.graph.delegation import cos_id
from omilo_api.models import AuditEvent, Proposal, Setting, Staff, Task

# ---------------------------------------------------------------------------
# Helpers — a throwaway worker per test, scoped to ids we create.
# ---------------------------------------------------------------------------

def _make_worker(brain: str = "single_engine", autonomy: str = "standard") -> str:
    sid = f"cos-worker-{brain}-" + uuid.uuid4().hex[:8]
    with session_scope() as db:
        db.add(Staff(id=sid, name="CoS Worker", role="marketing", engine={"type": "fake"},
                     brain=brain, autonomy=autonomy))
        db.commit()
    return sid


def _make_task(staff_id: str) -> str:
    with session_scope() as db:
        t = S.create_task(db, staff_id, "task", "do a thing", created_by="owner")
        return t.id


def _cos_id() -> str:
    with session_scope() as db:
        return cos_id(db)


def _set_strict():
    with session_scope() as db:
        db.add(Setting(key="autonomy_mode", value="strict"))
        db.commit()


def _request_action(staff_id: str, task_id: str, action: str, summary: str, details: str) -> dict:
    with session_scope() as db:
        st = db.get(Staff, staff_id)
        return S.request_action(db, st, task_id, action, summary, details)


def _proposals_for(task_id: str) -> list[Proposal]:
    with session_scope() as db:
        return list(db.scalars(select(Proposal).where(Proposal.task_id == task_id)))


# ---------------------------------------------------------------------------
# Auto/YOLO (default): non-floor actions run without asking — any risk, any brain.
# ---------------------------------------------------------------------------

def test_auto_allows_low_action(owner):
    task_id = _make_task(wid := _make_worker("graph"))
    res = _request_action(wid, task_id, "knowledge.write", "draft an internal note", "a draft")
    assert res["decision"] == "allowed", res
    assert res.get("level") == "auto"
    assert _proposals_for(task_id) == [], "Auto must not file a proposal for a non-floor action"


def test_auto_allows_high_risk_action(owner):
    """content.publish is HIGH risk — in Auto it still runs without asking."""
    task_id = _make_task(wid := _make_worker("graph"))
    res = _request_action(wid, task_id, "content.publish", "publish the blog post now", "the post body")
    assert res["decision"] == "allowed", f"Auto must allow high-risk work, got {res}"
    assert _proposals_for(task_id) == []


def test_auto_allows_spend(owner):
    """Spend is auto-approved in Auto (the user chose 'everything except self-destruct')."""
    task_id = _make_task(wid := _make_worker())
    res = _request_action(wid, task_id, "money.spend", "pay the $20 invoice", "invoice #12")
    assert res["decision"] == "allowed", res


def test_auto_allows_single_engine(owner):
    task_id = _make_task(wid := _make_worker("single_engine"))
    res = _request_action(wid, task_id, "knowledge.write", "draft an internal note", "note")
    assert res["decision"] == "allowed", res


def test_auto_allows_without_cos(owner, monkeypatch):
    """Auto doesn't route through the CoS, so it allows even with no delegation authority."""
    from omilo_api.graph import delegation as delegation_mod
    monkeypatch.setattr(delegation_mod, "cos_id", lambda db: None)
    task_id = _make_task(wid := _make_worker("graph"))
    res = _request_action(wid, task_id, "knowledge.write", "draft a note", "note")
    assert res["decision"] == "allowed", res


def test_auto_allows_cos_own_action(owner):
    """In Auto the Chief of Staff's own actions run without asking too."""
    cid = _cos_id()
    assert cid
    task_id = _make_task(cid)
    res = _request_action(cid, task_id, "knowledge.write", "draft a note", "note")
    assert res["decision"] == "allowed", res


# ---------------------------------------------------------------------------
# The self-destruct floor and OFF are never auto-run, even in Auto.
# ---------------------------------------------------------------------------

def test_floor_action_escalates_even_in_auto(owner):
    """A self-destruct-floor action (ALWAYS_ASK) is filed for the owner even in Auto."""
    task_id = _make_task(wid := _make_worker())
    res = _request_action(wid, task_id, "ai.key", "rotate the Anthropic key", "new key")
    assert res["decision"] == "needs_approval", f"the floor must always reach the owner, got {res}"
    props = _proposals_for(task_id)
    assert len(props) == 1 and props[0].status == "pending", props
    assert props[0].decided_by == "", "a floor proposal must not be auto-decided"


# ---------------------------------------------------------------------------
# Strict company: ASK-level actions are filed for the owner.
# ---------------------------------------------------------------------------

def test_strict_company_escalates(owner):
    _set_strict()
    # guided worker → strict under a strict company.
    task_id = _make_task(wid := _make_worker(autonomy="guided"))
    res = _request_action(wid, task_id, "knowledge.write", "draft a note", "note")
    assert res["decision"] == "needs_approval", f"Strict must file for the owner, got {res}"
    props = _proposals_for(task_id)
    assert len(props) == 1 and props[0].status == "pending", props
