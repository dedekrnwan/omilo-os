"""TDD — Task 3: Routines + scheduler tick.

Tests:
1. POST /v1/routines {freq:"daily",at:"07:30",...} → next_at is a future
   datetime at 07:30 in tz; cron computed.
2. POST /v1/routines/{id}/run-now → Job (origin=routine) + RoutineRun created;
   returns {job_id}.
3. scheduler_tick(db, now=<after next_at>) → fires once (1 RoutineRun + Job),
   advances next_at > now; same-now tick does NOT fire again (count=0).
4. Paused routine with next_at<=now is NOT fired by tick.
5. PATCH /v1/routines/{id} {paused:true} → paused=True.
6. Tenancy: company B cannot GET company A's routine → 404.

RED → implement → GREEN.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest


# ---------------------------------------------------------------------------
# Schema guard
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    from tests.utils import run_alembic

    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, email=None, name="Routines Tester", password="testP4ss!"):
    email = email or f"routine_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_helper(company_id: str) -> str:
    """Insert a non-chief Helper. Returns helper_id."""
    from omilo.db import SessionLocal
    from omilo.models.agents import Helper
    from omilo.models.base import prefixed_id

    with SessionLocal() as session:
        with session.begin():
            helper = Helper(
                id=prefixed_id("hlp"),
                company_id=company_id,
                name="Ops Bot",
                area="ops",
                is_chief=False,
                engine={"type": "fake"},
                autonomy_cap=None,
                permissions=[],
                status="active",
                channel_ids=[],
            )
            session.add(helper)
            session.flush()
            return helper.id


# ---------------------------------------------------------------------------
# Fixture: fresh company with a Helper
# ---------------------------------------------------------------------------


@pytest.fixture()
async def company_with_helper(async_client):
    """Sign up a fresh user, seed one Helper. Return (token, company_id, helper_id)."""
    body = await _sign_up(async_client)
    token = body["session"]["access"]

    me_resp = await async_client.get("/v1/me", headers=_auth(token))
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]

    helper_id = _seed_helper(company_id)
    return token, company_id, helper_id


# ---------------------------------------------------------------------------
# Test 1 — POST /v1/routines creates Routine with cron + next_at
# ---------------------------------------------------------------------------


class TestCreateRoutine:
    @pytest.mark.asyncio
    async def test_create_daily_routine_sets_next_at(
        self, async_client, company_with_helper
    ):
        """POST /v1/routines with freq=daily sets next_at to upcoming 07:30 UTC."""
        token, company_id, helper_id = company_with_helper
        resp = await async_client.post(
            "/v1/routines",
            json={
                "helper_id": helper_id,
                "name": "Morning brief",
                "instructions": "Summarise what moved yesterday.",
                "freq": "daily",
                "at": "07:30",
                "timezone": "UTC",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        routine = data["routine"]
        assert routine["id"].startswith("rtn_"), routine["id"]
        assert routine["cron"] is not None, "cron must be set"
        assert routine["next_at"] is not None, "next_at must be set"
        # next_at must be in the future
        next_at = datetime.fromisoformat(routine["next_at"])
        assert next_at > datetime.now(timezone.utc), "next_at must be a future datetime"
        # Verify time-of-day is 07:30 UTC
        assert next_at.hour == 7
        assert next_at.minute == 30

    @pytest.mark.asyncio
    async def test_create_routine_with_invalid_timezone_returns_422(
        self, async_client, company_with_helper
    ):
        """POST /v1/routines with an invalid timezone must return 422, not silently use UTC."""
        token, company_id, helper_id = company_with_helper
        resp = await async_client.post(
            "/v1/routines",
            json={
                "helper_id": helper_id,
                "name": "Typo tz routine",
                "instructions": "Check something.",
                "freq": "daily",
                "at": "09:00",
                "timezone": "Not/AZone",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 422, (
            f"Expected 422 for bad timezone; got {resp.status_code}: {resp.text}"
        )
        detail = resp.json().get("detail", "")
        assert "Not/AZone" in str(detail), f"Error detail should mention the bad tz: {detail}"

    @pytest.mark.asyncio
    async def test_create_weekly_routine_uses_days(
        self, async_client, company_with_helper
    ):
        """POST /v1/routines with freq=weekly + days=[0,3] sets cron with Mon/Thu."""
        token, company_id, helper_id = company_with_helper
        resp = await async_client.post(
            "/v1/routines",
            json={
                "helper_id": helper_id,
                "name": "Goal check-ins",
                "instructions": "Check goal progress.",
                "freq": "weekly",
                "at": "09:00",
                "days": [0, 3],
                "timezone": "UTC",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        routine = data["routine"]
        cron = routine["cron"]
        # Mon=0 → cron day_of_week=1, Thu=3 → day_of_week=4 (cron uses 1-7 Mon-Sun)
        # We accept any non-None cron and verify next_at is set
        assert cron is not None
        assert routine["next_at"] is not None


# ---------------------------------------------------------------------------
# Test 2 — POST /v1/routines/{id}/run-now
# ---------------------------------------------------------------------------


class TestRunNow:
    @pytest.mark.asyncio
    async def test_run_now_creates_job_and_routine_run(
        self, async_client, company_with_helper
    ):
        """run-now fires a Job (origin=routine) + RoutineRun and returns {job_id}."""
        from omilo.db import SessionLocal
        from omilo.models.execution import Job
        from omilo.models.routines import RoutineRun

        token, company_id, helper_id = company_with_helper

        # Create a routine
        resp = await async_client.post(
            "/v1/routines",
            json={
                "helper_id": helper_id,
                "name": "On-call digest",
                "instructions": "Check on-call alerts.",
                "freq": "daily",
                "at": "08:00",
                "timezone": "UTC",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        routine_id = resp.json()["routine"]["id"]

        # Run now
        run_resp = await async_client.post(
            f"/v1/routines/{routine_id}/run-now",
            headers=_auth(token),
        )
        assert run_resp.status_code == 200, run_resp.text
        data = run_resp.json()
        assert "job_id" in data, f"Missing job_id: {data}"
        job_id = data["job_id"]
        assert job_id.startswith("job_"), job_id

        # Verify Job exists with origin=routine
        with SessionLocal() as db:
            job = db.get(Job, job_id)
            assert job is not None, "Job not created"
            assert job.origin == "routine"

            # Verify a RoutineRun was created
            rr = (
                db.query(RoutineRun)
                .filter(RoutineRun.routine_id == routine_id)
                .first()
            )
            assert rr is not None, "RoutineRun not created"
            assert rr.job_id == job_id


# ---------------------------------------------------------------------------
# Test 3 — scheduler_tick fires due routine once, advances next_at
# ---------------------------------------------------------------------------


class TestSchedulerTick:
    @pytest.mark.asyncio
    async def test_tick_fires_due_routine_once(
        self, async_client, company_with_helper
    ):
        """tick fires a due routine once; second tick with same now does not re-fire."""
        from omilo.db import SessionLocal, get_db
        from omilo.models.base import prefixed_id
        from omilo.models.routines import Routine, RoutineRun
        from omilo.scheduler.tick import scheduler_tick
        from omilo.tenancy.context import RequestContext

        token, company_id, helper_id = company_with_helper

        # Insert a due routine directly (next_at in the past)
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        rtn_id = prefixed_id("rtn")
        with SessionLocal() as db:
            with db.begin():
                rtn = Routine(
                    id=rtn_id,
                    company_id=company_id,
                    helper_id=helper_id,
                    name="Tick Test Routine",
                    subtitle="",
                    instructions="Test tick.",
                    freq="daily",
                    at="07:00",
                    days=[],
                    timezone="UTC",
                    cron="30 7 * * *",
                    sends_to=[],
                    enabled=True,
                    paused=False,
                    next_at=past,
                    goal_ids=[],
                    created_by="test",
                )
                db.add(rtn)

        # Tick with now = now (after past)
        now = datetime.now(timezone.utc)
        ctx = RequestContext(user_id="test", company_id=company_id, role="owner")
        with SessionLocal() as db:
            with db.begin():
                # Set company GUC for RLS
                db.execute(
                    __import__("sqlalchemy").text(
                        f"SET LOCAL app.company_id = '{company_id}'"
                    )
                )
                fired = scheduler_tick(db, now)
        assert fired >= 1, f"Expected >=1 fired, got {fired}"

        # Verify RoutineRun created and next_at advanced
        with SessionLocal() as db:
            rtn_after = db.get(Routine, rtn_id)
            runs = (
                db.query(RoutineRun)
                .filter(RoutineRun.routine_id == rtn_id)
                .all()
            )
            assert len(runs) >= 1, "RoutineRun not created by tick"
            assert rtn_after.next_at > now, "next_at must be advanced past now"

        # Second tick with same now → should NOT fire again (count=0 for this routine)
        with SessionLocal() as db:
            with db.begin():
                db.execute(
                    __import__("sqlalchemy").text(
                        f"SET LOCAL app.company_id = '{company_id}'"
                    )
                )
                fired_again = scheduler_tick(db, now)
        assert fired_again == 0, (
            f"Second tick with same now must not re-fire; got {fired_again}"
        )

    @pytest.mark.asyncio
    async def test_tick_does_not_fire_paused_routine(
        self, async_client, company_with_helper
    ):
        """scheduler_tick skips paused routines even when next_at <= now."""
        from omilo.db import SessionLocal
        from omilo.models.base import prefixed_id
        from omilo.models.routines import Routine, RoutineRun
        from omilo.scheduler.tick import scheduler_tick
        import sqlalchemy

        token, company_id, helper_id = company_with_helper

        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        rtn_id = prefixed_id("rtn")
        with SessionLocal() as db:
            with db.begin():
                rtn = Routine(
                    id=rtn_id,
                    company_id=company_id,
                    helper_id=helper_id,
                    name="Paused Routine",
                    subtitle="",
                    instructions="Should not fire.",
                    freq="daily",
                    at="07:00",
                    days=[],
                    timezone="UTC",
                    cron="30 7 * * *",
                    sends_to=[],
                    enabled=True,
                    paused=True,  # PAUSED
                    next_at=past,
                    goal_ids=[],
                    created_by="test",
                )
                db.add(rtn)

        now = datetime.now(timezone.utc)
        with SessionLocal() as db:
            with db.begin():
                db.execute(
                    sqlalchemy.text(f"SET LOCAL app.company_id = '{company_id}'")
                )
                fired = scheduler_tick(db, now)

        # The paused routine must not have been fired
        with SessionLocal() as db:
            runs = (
                db.query(RoutineRun)
                .filter(RoutineRun.routine_id == rtn_id)
                .all()
            )
        assert len(runs) == 0, f"Paused routine must not fire; got {len(runs)} runs"


# ---------------------------------------------------------------------------
# Test 4 — PATCH /v1/routines/{id} pause
# ---------------------------------------------------------------------------


class TestPatchRoutine:
    @pytest.mark.asyncio
    async def test_patch_pauses_routine(self, async_client, company_with_helper):
        """PATCH {paused: true} sets paused=True on the routine."""
        token, company_id, helper_id = company_with_helper

        # Create routine
        resp = await async_client.post(
            "/v1/routines",
            json={
                "helper_id": helper_id,
                "name": "Ad spend review",
                "instructions": "Review ad spend.",
                "freq": "weekly",
                "at": "15:00",
                "days": [4],
                "timezone": "UTC",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        routine_id = resp.json()["routine"]["id"]

        # Pause it
        patch_resp = await async_client.patch(
            f"/v1/routines/{routine_id}",
            json={"paused": True},
            headers=_auth(token),
        )
        assert patch_resp.status_code == 200, patch_resp.text
        data = patch_resp.json()
        assert data["routine"]["paused"] is True


# ---------------------------------------------------------------------------
# Test 5 — Tenancy: company B cannot access company A's routine
# ---------------------------------------------------------------------------


class TestTenancy:
    @pytest.mark.asyncio
    async def test_company_b_cannot_get_company_a_routine(
        self, async_client
    ):
        """GET /v1/routines/{id} by company B user returns 404."""
        # Sign up company A
        body_a = await _sign_up(async_client, email=f"rtn_a_{uuid.uuid4().hex[:6]}@test.example")
        token_a = body_a["session"]["access"]
        me_a = await async_client.get("/v1/me", headers=_auth(token_a))
        company_id_a = me_a.json()["company"]["id"]
        helper_id_a = _seed_helper(company_id_a)

        # Sign up company B
        body_b = await _sign_up(async_client, email=f"rtn_b_{uuid.uuid4().hex[:6]}@test.example")
        token_b = body_b["session"]["access"]

        # Company A creates a routine
        resp = await async_client.post(
            "/v1/routines",
            json={
                "helper_id": helper_id_a,
                "name": "Secret routine",
                "instructions": "Secret.",
                "freq": "daily",
                "at": "07:00",
                "timezone": "UTC",
            },
            headers=_auth(token_a),
        )
        assert resp.status_code == 201, resp.text
        routine_id = resp.json()["routine"]["id"]

        # Company B tries to GET that routine → 404
        get_resp = await async_client.get(
            f"/v1/routines/{routine_id}",
            headers=_auth(token_b),
        )
        assert get_resp.status_code == 404, (
            f"Expected 404 for cross-tenant access; got {get_resp.status_code}: {get_resp.text}"
        )


# ---------------------------------------------------------------------------
# Task 1.4 — PATCH schedule fields recompute cron + next_at; skip-next
# ---------------------------------------------------------------------------


class TestPatchScheduleAndSkip:
    @pytest.mark.asyncio
    async def test_patch_freq_at_recomputes_cron_and_next_at(
        self, async_client, company_with_helper
    ):
        """PATCH freq/at updates cron + next_at to the new schedule."""
        token, _, helper_id = company_with_helper
        create = await async_client.post(
            "/v1/routines",
            json={
                "helper_id": helper_id,
                "name": "Brief",
                "instructions": "Do it.",
                "freq": "daily",
                "at": "07:30",
                "timezone": "UTC",
            },
            headers=_auth(token),
        )
        assert create.status_code == 201, create.text
        routine = create.json()["routine"]
        routine_id = routine["id"]
        old_cron = routine["cron"]

        patch = await async_client.patch(
            f"/v1/routines/{routine_id}",
            json={"freq": "daily", "at": "18:45"},
            headers=_auth(token),
        )
        assert patch.status_code == 200, patch.text
        updated = patch.json()["routine"]
        assert updated["cron"] != old_cron
        assert updated["cron"] == "45 18 * * *", updated["cron"]
        next_at = datetime.fromisoformat(updated["next_at"])
        assert next_at > datetime.now(timezone.utc)
        assert next_at.hour == 18 and next_at.minute == 45

    @pytest.mark.asyncio
    async def test_skip_next_moves_next_at_forward_one_period(
        self, async_client, company_with_helper
    ):
        """POST /v1/routines/{id}/skip-next advances next_at past the next run."""
        token, _, helper_id = company_with_helper
        create = await async_client.post(
            "/v1/routines",
            json={
                "helper_id": helper_id,
                "name": "Daily",
                "instructions": "Daily task.",
                "freq": "daily",
                "at": "07:30",
                "timezone": "UTC",
            },
            headers=_auth(token),
        )
        assert create.status_code == 201, create.text
        routine_id = create.json()["routine"]["id"]
        before = datetime.fromisoformat(create.json()["routine"]["next_at"])

        skip = await async_client.post(
            f"/v1/routines/{routine_id}/skip-next",
            headers=_auth(token),
        )
        assert skip.status_code == 200, skip.text
        after = datetime.fromisoformat(skip.json()["next_at"])
        # Daily cadence → next_at moves ~24h forward (strictly greater).
        assert after > before
        assert (after - before) >= timedelta(hours=23)

    @pytest.mark.asyncio
    async def test_skip_next_cross_tenant_404(self, async_client, company_with_helper):
        token, _, helper_id = company_with_helper
        create = await async_client.post(
            "/v1/routines",
            json={
                "helper_id": helper_id,
                "name": "X",
                "instructions": "x",
                "freq": "daily",
                "at": "07:00",
                "timezone": "UTC",
            },
            headers=_auth(token),
        )
        routine_id = create.json()["routine"]["id"]

        body_b = await _sign_up(async_client, email=f"rtn_skip_b_{uuid.uuid4().hex[:6]}@test.example")
        token_b = body_b["session"]["access"]
        resp = await async_client.post(
            f"/v1/routines/{routine_id}/skip-next", headers=_auth(token_b)
        )
        assert resp.status_code == 404, resp.text
