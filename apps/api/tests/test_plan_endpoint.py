"""Test the GET /api/plan endpoint."""
import pytest


@pytest.mark.asyncio
async def test_get_plan_returns_goals_with_work(owner):
    """Test that GET /api/plan returns the plan tree with goals and work nodes."""
    from conftest import wait_for

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
