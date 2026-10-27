"""TDD — Task 6: Internal-event + connector-poll flow triggers.

Tests:
1. connector_poll flow: poll_connector_flows fires when fake source has new items;
   poll_cursor advances; calling again immediately → NO new FlowRun.
2. internal_event flow (spec.event="goal.updated"): fire_internal fires it;
   a non-matching event does NOT fire it.
3. schedule flow: scheduler_tick (after due) → fires once; second tick same now → no re-fire.
4. A DRAFT flow does NOT fire for any trigger.
5. No infinite loop: fire_internal("flow.finished") does not recurse.
6. Tenancy: only the flow's company fires (company-scoped session).

RED → implement → GREEN.
"""
from __future__ import annotations

import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import text

_API_DIR = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Schema guard
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=_API_DIR,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# DB session helpers (same pattern as test_flow_engine.py)
# ---------------------------------------------------------------------------

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.flows import Flow, FlowRun
from omilo.models.tenancy import Company


class _SuperuserSession:
    def __enter__(self):
        self._sess = SessionLocal()
        self._txn = self._sess.begin()
        return self._sess

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self._txn.rollback()
        else:
            self._txn.commit()
        self._sess.close()


def _superuser_session():
    return _SuperuserSession()


class _TenantSession:
    def __init__(self, company_id: str):
        self._company_id = company_id

    def __enter__(self):
        self._sess = SessionLocal()
        self._txn = self._sess.begin()
        self._sess.execute(text("SET LOCAL ROLE omilo_app"))
        set_company(self._sess, self._company_id)
        return self._sess

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self._txn.rollback()
        else:
            self._txn.commit()
        self._sess.close()


def _tenant_session(company_id: str):
    return _TenantSession(company_id)


# ---------------------------------------------------------------------------
# Data factories
# ---------------------------------------------------------------------------


def _make_company(db) -> Company:
    cmp = Company(
        id=prefixed_id("cmp"),
        name=f"TrigCo-{uuid.uuid4().hex[:6]}",
        color="#abcdef",
        autonomy_default="ask",
    )
    db.add(cmp)
    db.flush()
    return cmp


def _make_helper(db, *, company_id: str) -> Helper:
    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name="Chief",
        area="ops",
        is_chief=True,
        engine={"type": "fake"},
        autonomy_cap=None,
        permissions=[],
        status="active",
        channel_ids=[],
    )
    db.add(helper)
    db.flush()
    return helper


def _make_flow(
    db,
    company_id: str,
    *,
    trigger_kind: str,
    trigger_spec: dict,
    poll_cursor: dict | None = None,
    status: str = "published",
    enabled: bool = True,
) -> Flow:
    """Create a minimal single-node flow (just a trigger node)."""
    nodes = [{"id": "n_trigger", "kind": "trigger", "label": "Start"}]
    edges: list = []
    flow = Flow(
        id=prefixed_id("flw"),
        company_id=company_id,
        title=f"Trigger-{trigger_kind}-{uuid.uuid4().hex[:4]}",
        enabled=enabled,
        channel_ids=[],
        areas=[],
        trigger={"kind": trigger_kind, "spec": trigger_spec},
        poll_cursor=poll_cursor,
        nodes=nodes,
        edges=edges,
        version=1,
        status=status,
        created_by="operator",
        proposed_from_pattern=False,
    )
    db.add(flow)
    db.flush()
    return flow


# ---------------------------------------------------------------------------
# Module-scoped fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def company_a():
    """Company A + Chief helper."""
    with _superuser_session() as su:
        cmp = _make_company(su)
        company_id = cmp.id

    with _tenant_session(company_id) as db:
        _make_helper(db, company_id=company_id)

    return company_id


@pytest.fixture(scope="module")
def company_b():
    """Company B (for tenancy isolation test)."""
    with _superuser_session() as su:
        cmp = _make_company(su)
        company_id = cmp.id

    with _tenant_session(company_id) as db:
        _make_helper(db, company_id=company_id)

    return company_id


# ---------------------------------------------------------------------------
# Test 1 — connector_poll: fires on new items, advances cursor, no re-fire
# ---------------------------------------------------------------------------


class TestConnectorPoll:
    def test_poll_fires_when_new_items(self, company_a):
        """poll_connector_flows fires a FlowRun when the fake source has new items."""
        from omilo.flows.triggers import poll_connector_flows

        company_id = company_a
        now = datetime.now(timezone.utc)
        # cursor older than threshold → fake source will return new items
        old_cursor = {"last_id": "item_0", "at": (now - timedelta(hours=2)).isoformat()}

        with _tenant_session(company_id) as db:
            flow = _make_flow(
                db,
                company_id,
                trigger_kind="connector_poll",
                trigger_spec={"connector": "crm", "poll_every": "15m"},
                poll_cursor=old_cursor,
            )
            flow_id = flow.id

        with _tenant_session(company_id) as db:
            count = poll_connector_flows(db, now)

        assert count >= 1, "Expected at least one flow to fire"

        # Verify FlowRun was created
        with _tenant_session(company_id) as db:
            run = (
                db.query(FlowRun).filter_by(flow_id=flow_id).first()
            )
        assert run is not None, "FlowRun should have been created"
        assert run.started_by == "crm poll"

    def test_poll_advances_cursor(self, company_a):
        """poll_cursor advances after a poll fires."""
        from omilo.flows.triggers import poll_connector_flows

        company_id = company_a
        now = datetime.now(timezone.utc)
        old_cursor = {"last_id": "item_0", "at": (now - timedelta(hours=3)).isoformat()}

        with _tenant_session(company_id) as db:
            flow = _make_flow(
                db,
                company_id,
                trigger_kind="connector_poll",
                trigger_spec={"connector": "crm", "poll_every": "15m"},
                poll_cursor=old_cursor,
            )
            flow_id = flow.id

        with _tenant_session(company_id) as db:
            poll_connector_flows(db, now)

        # Cursor must have advanced (last_id changed from item_0)
        with _tenant_session(company_id) as db:
            updated_flow = db.get(Flow, flow_id)
        assert updated_flow.poll_cursor is not None
        assert updated_flow.poll_cursor.get("last_id") != "item_0", (
            "poll_cursor.last_id should have advanced"
        )

    def test_poll_no_refire_when_nothing_new(self, company_a):
        """Calling poll_connector_flows again with an up-to-date cursor does NOT fire."""
        from omilo.flows.triggers import poll_connector_flows

        company_id = company_a
        now = datetime.now(timezone.utc)
        # cursor with very recent 'at' → fake source returns nothing new
        fresh_cursor = {"last_id": "item_99", "at": now.isoformat()}

        with _tenant_session(company_id) as db:
            flow = _make_flow(
                db,
                company_id,
                trigger_kind="connector_poll",
                trigger_spec={"connector": "crm", "poll_every": "15m"},
                poll_cursor=fresh_cursor,
            )
            flow_id = flow.id

        with _tenant_session(company_id) as db:
            count = poll_connector_flows(db, now)

        # At least this flow should not fire (count for this flow = 0);
        # total count may include other flows from other tests but this
        # specific flow should not have a run.
        with _tenant_session(company_id) as db:
            run = db.query(FlowRun).filter_by(flow_id=flow_id).first()
        assert run is None, "No FlowRun should be created when cursor is fresh"


# ---------------------------------------------------------------------------
# Test 2 — internal_event: fires on matching event, not on non-matching
# ---------------------------------------------------------------------------


class TestInternalEvent:
    def test_fire_internal_matching_event(self, company_a):
        """fire_internal fires flows subscribed to matching event type."""
        from omilo.flows.triggers import fire_internal

        company_id = company_a

        with _tenant_session(company_id) as db:
            flow = _make_flow(
                db,
                company_id,
                trigger_kind="internal_event",
                trigger_spec={"event": "goal.updated"},
            )
            flow_id = flow.id

        with _tenant_session(company_id) as db:
            count = fire_internal(db, "goal.updated", "goal_x")

        assert count >= 1, "Expected at least one flow to fire for goal.updated"

        with _tenant_session(company_id) as db:
            run = db.query(FlowRun).filter_by(flow_id=flow_id).first()
        assert run is not None, "FlowRun should have been created"
        assert "goal.updated" in run.trigger_summary

    def test_fire_internal_non_matching_event(self, company_a):
        """fire_internal does NOT fire flows subscribed to a different event."""
        from omilo.flows.triggers import fire_internal

        company_id = company_a

        with _tenant_session(company_id) as db:
            flow = _make_flow(
                db,
                company_id,
                trigger_kind="internal_event",
                trigger_spec={"event": "goal.updated"},
            )
            flow_id = flow.id

        with _tenant_session(company_id) as db:
            # Fire a DIFFERENT event that this flow is NOT subscribed to
            fire_internal(db, "routine.done", "routine_x")

        with _tenant_session(company_id) as db:
            run = db.query(FlowRun).filter_by(flow_id=flow_id).first()
        assert run is None, "FlowRun should NOT be created for non-matching event"


# ---------------------------------------------------------------------------
# Test 3 — schedule: fires once per window, no re-fire same window
# ---------------------------------------------------------------------------


class TestScheduleTrigger:
    def test_schedule_fires_once_per_window(self, company_a):
        """scheduler_tick fires a scheduled flow that is due and sets poll_cursor."""
        from omilo.scheduler.tick import scheduler_tick

        company_id = company_a
        now = datetime.now(timezone.utc)
        # Cursor that is in the past → flow is due
        past_next = (now - timedelta(minutes=5)).isoformat()

        with _tenant_session(company_id) as db:
            flow = _make_flow(
                db,
                company_id,
                trigger_kind="schedule",
                trigger_spec={"cron": "* * * * *"},  # every minute
                poll_cursor={"next_at": past_next},
            )
            flow_id = flow.id

        with _tenant_session(company_id) as db:
            count = scheduler_tick(db, now)

        assert count >= 1  # at least our flow fired (also includes any routines)

        with _tenant_session(company_id) as db:
            run = db.query(FlowRun).filter_by(flow_id=flow_id).first()
        assert run is not None, "FlowRun should have been created"

    def test_schedule_no_refire_same_window(self, company_a):
        """scheduler_tick with same `now` does NOT re-fire the flow."""
        from omilo.scheduler.tick import scheduler_tick

        company_id = company_a
        now = datetime.now(timezone.utc)
        past_next = (now - timedelta(minutes=5)).isoformat()

        with _tenant_session(company_id) as db:
            flow = _make_flow(
                db,
                company_id,
                trigger_kind="schedule",
                trigger_spec={"cron": "* * * * *"},
                poll_cursor={"next_at": past_next},
            )
            flow_id = flow.id

        # First tick fires it
        with _tenant_session(company_id) as db:
            scheduler_tick(db, now)

        # Second tick with same `now` must NOT fire it again
        with _tenant_session(company_id) as db:
            runs_before = db.query(FlowRun).filter_by(flow_id=flow_id).count()

        with _tenant_session(company_id) as db:
            scheduler_tick(db, now)

        with _tenant_session(company_id) as db:
            runs_after = db.query(FlowRun).filter_by(flow_id=flow_id).count()

        assert runs_after == runs_before, (
            "No additional FlowRun should be created on second tick with same now"
        )


# ---------------------------------------------------------------------------
# Test 4 — Draft flow never fires
# ---------------------------------------------------------------------------


class TestDraftNeverFires:
    def test_draft_poll_flow_does_not_fire(self, company_a):
        """A draft connector_poll flow is NOT fired by poll_connector_flows."""
        from omilo.flows.triggers import poll_connector_flows

        company_id = company_a
        now = datetime.now(timezone.utc)
        old_cursor = {"last_id": "item_0", "at": (now - timedelta(hours=2)).isoformat()}

        with _tenant_session(company_id) as db:
            flow = _make_flow(
                db,
                company_id,
                trigger_kind="connector_poll",
                trigger_spec={"connector": "crm", "poll_every": "15m"},
                poll_cursor=old_cursor,
                status="draft",  # draft!
            )
            flow_id = flow.id

        with _tenant_session(company_id) as db:
            poll_connector_flows(db, now)

        with _tenant_session(company_id) as db:
            run = db.query(FlowRun).filter_by(flow_id=flow_id).first()
        assert run is None, "Draft flow should NOT fire"

    def test_draft_internal_event_flow_does_not_fire(self, company_a):
        """A draft internal_event flow is NOT fired by fire_internal."""
        from omilo.flows.triggers import fire_internal

        company_id = company_a

        with _tenant_session(company_id) as db:
            flow = _make_flow(
                db,
                company_id,
                trigger_kind="internal_event",
                trigger_spec={"event": "routine.done"},
                status="draft",  # draft!
            )
            flow_id = flow.id

        with _tenant_session(company_id) as db:
            fire_internal(db, "routine.done", "rtn_x")

        with _tenant_session(company_id) as db:
            run = db.query(FlowRun).filter_by(flow_id=flow_id).first()
        assert run is None, "Draft flow should NOT fire for internal event"

    def test_draft_schedule_flow_does_not_fire(self, company_a):
        """A draft schedule flow is NOT fired by scheduler_tick."""
        from omilo.scheduler.tick import scheduler_tick

        company_id = company_a
        now = datetime.now(timezone.utc)
        past_next = (now - timedelta(minutes=5)).isoformat()

        with _tenant_session(company_id) as db:
            flow = _make_flow(
                db,
                company_id,
                trigger_kind="schedule",
                trigger_spec={"cron": "* * * * *"},
                poll_cursor={"next_at": past_next},
                status="draft",  # draft!
            )
            flow_id = flow.id

        with _tenant_session(company_id) as db:
            scheduler_tick(db, now)

        with _tenant_session(company_id) as db:
            run = db.query(FlowRun).filter_by(flow_id=flow_id).first()
        assert run is None, "Draft schedule flow should NOT fire"


# ---------------------------------------------------------------------------
# Test 5 — No infinite loop for flow.finished
# ---------------------------------------------------------------------------


class TestNoInfiniteLoop:
    def test_flow_finished_does_not_recurse(self, company_a):
        """fire_internal('flow.finished') fires matching flows but does not loop."""
        from omilo.flows.triggers import fire_internal

        company_id = company_a

        with _tenant_session(company_id) as db:
            flow = _make_flow(
                db,
                company_id,
                trigger_kind="internal_event",
                trigger_spec={"event": "flow.finished"},
            )
            flow_id = flow.id

        # This should not raise, hang, or create more than one run
        with _tenant_session(company_id) as db:
            count = fire_internal(db, "flow.finished", flow_id)

        assert count >= 1, "flow.finished should fire the subscribed flow once"

        with _tenant_session(company_id) as db:
            runs = db.query(FlowRun).filter_by(flow_id=flow_id).all()

        # Should be exactly 1 run (no infinite recursion)
        assert len(runs) == 1, (
            f"Expected exactly 1 FlowRun (no infinite loop), got {len(runs)}"
        )


# ---------------------------------------------------------------------------
# Test 6 — Tenancy isolation
# ---------------------------------------------------------------------------


class TestTenancyIsolation:
    def test_poll_only_fires_own_company_flows(self, company_a, company_b):
        """poll_connector_flows with company A's session does NOT fire company B's flows."""
        from omilo.flows.triggers import poll_connector_flows

        company_id_a = company_a
        company_id_b = company_b
        now = datetime.now(timezone.utc)
        old_cursor = {"last_id": "item_0", "at": (now - timedelta(hours=2)).isoformat()}

        # Create a poll flow for company B
        with _tenant_session(company_id_b) as db:
            flow_b = _make_flow(
                db,
                company_id_b,
                trigger_kind="connector_poll",
                trigger_spec={"connector": "crm", "poll_every": "15m"},
                poll_cursor=old_cursor,
            )
            flow_b_id = flow_b.id

        # Run poll_connector_flows scoped to company A
        with _tenant_session(company_id_a) as db:
            poll_connector_flows(db, now)

        # Company B's flow should NOT have a run
        with _tenant_session(company_id_b) as db:
            run_b = db.query(FlowRun).filter_by(flow_id=flow_b_id).first()
        assert run_b is None, "Company A's tick should not fire Company B's flows"

    def test_fire_internal_only_fires_own_company_flows(self, company_a, company_b):
        """fire_internal scoped to company A does NOT fire company B's flows."""
        from omilo.flows.triggers import fire_internal

        company_id_a = company_a
        company_id_b = company_b

        with _tenant_session(company_id_b) as db:
            flow_b = _make_flow(
                db,
                company_id_b,
                trigger_kind="internal_event",
                trigger_spec={"event": "goal.updated"},
            )
            flow_b_id = flow_b.id

        # Fire event scoped to company A
        with _tenant_session(company_id_a) as db:
            fire_internal(db, "goal.updated", "goal_x")

        # Company B's flow should not have a run
        with _tenant_session(company_id_b) as db:
            run_b = db.query(FlowRun).filter_by(flow_id=flow_b_id).first()
        assert run_b is None, "Company A fire_internal should not fire Company B's flows"
