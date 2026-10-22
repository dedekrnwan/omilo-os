"""Test the GET /api/plan endpoint."""
import pytest

from omilo_api.db import session_scope
from omilo_api.models import Shift, Staff


@pytest.mark.asyncio
async def test_get_plan_returns_goals_with_work(owner):
    """Test that GET /api/plan returns the plan tree with goals and work nodes."""

    # Seed: one active Goal, one Staff, one Task linked to the goal via TaskGoal
    gid = owner.post("/api/goals", json={"title": "Launch", "target": "Ship the product", "due": "2026-12-31"}).json()["id"]

    # Create a task linked to the goal
    task_response = owner.post("/api/tasks", json={"staff_id": "sales", "brief": "Deploy to production", "goal_id": gid})
    assert task_response.status_code == 200
    task_id = task_response.json()["id"]

    # Make the request to GET /api/plan
    r = owner.get("/api/plan")
    assert r.status_code == 200

    body = r.json()
    assert "goals" in body
    assert "unlinked" in body

    # Find the goal we created
    g = next((x for x in body["goals"] if x["title"] == "Launch"), None)
    assert g is not None, "Goal should be in the response"

    # Check progress and work
    assert g["progress"]["total"] >= 1
    assert any(n["id"] == task_id for n in g["work"]), f"Task {task_id} should be in goal's work nodes"


def test_plan_shifts_include_cron(owner):
    """GET /api/plan shifts[] entries include a 'cron' key (may be None or a cron string)."""
    # Seed a Shift directly so we always have at least one in shifts[]
    with session_scope() as db:
        staff_rows = list(db.scalars(__import__("sqlalchemy").select(Staff).limit(1)))
        assert staff_rows, "Need at least one Staff row for the shift"
        shift = Shift(
            staff_id=staff_rows[0].id,
            name="Daily digest",
            cron="0 9 * * *",
            brief="Send the daily summary",
            enabled=True,
        )
        db.add(shift)
        db.commit()
        shift_id = shift.id

    r = owner.get("/api/plan")
    assert r.status_code == 200
    body = r.json()
    assert "shifts" in body, "'shifts' key must be in /api/plan response"
    assert isinstance(body["shifts"], list)

    # Find our shift
    our_shift = next((s for s in body["shifts"] if s.get("id") == shift_id), None)
    assert our_shift is not None, f"Shift {shift_id} not found in plan shifts: {body['shifts']}"

    # Must have a 'cron' key
    assert "cron" in our_shift, f"Shift entry missing 'cron' key: {our_shift}"
    assert our_shift["cron"] == "0 9 * * *"
