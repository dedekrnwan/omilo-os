"""TDD — Task 1.2: Goal update + delete (PATCH/DELETE /v1/goals/{id}).

Tests:
1. PATCH title/status persists + round-trips via GET.
2. DELETE removes the goal → GET re-fetch 404.
3. Cross-tenant PATCH/DELETE → 404.
"""
from __future__ import annotations

import uuid

import pytest

from tests.utils import run_alembic


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


async def _sign_up(client, *, email=None, name="GoalsW Tester", password="testP4ss!"):
    email = email or f"goalsw_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_chief(company_id: str) -> None:
    from omilo.db import SessionLocal
    from omilo.models.agents import Helper
    from omilo.models.base import prefixed_id

    with SessionLocal() as session:
        with session.begin():
            session.add(
                Helper(
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
            )


def _seed_channel(company_id: str) -> str:
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.workspace import Channel

    with SessionLocal() as session:
        with session.begin():
            channel = Channel(
                id=prefixed_id("chn"),
                company_id=company_id,
                name="Eng",
                accent="dev",
                is_default=True,
                agent_count=1,
                chat_count=0,
                open_items=0,
            )
            session.add(channel)
            session.flush()
            return channel.id


@pytest.fixture()
async def company_a(async_client):
    body = await _sign_up(async_client)
    token = body["session"]["access"]
    me = await async_client.get("/v1/me", headers=_auth(token))
    company_id = me.json()["company"]["id"]
    _seed_chief(company_id)
    channel_id = _seed_channel(company_id)
    return token, company_id, channel_id


async def _create_goal(client, token, channel_id, title="Ship", target="Ship to prod"):
    resp = await client.post(
        "/v1/goals",
        json={"channel_id": channel_id, "title": title, "target": target},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["goal"]["id"]


@pytest.mark.asyncio
async def test_patch_goal_persists(async_client, company_a):
    token, _, channel_id = company_a
    goal_id = await _create_goal(async_client, token, channel_id)

    resp = await async_client.patch(
        f"/v1/goals/{goal_id}",
        json={"title": "New title", "status": "at_risk"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    goal = resp.json()["goal"]
    assert goal["title"] == "New title"
    assert goal["status"] == "at_risk"
    assert goal["statusSetBy"] == "user"

    # Round-trip via GET detail.
    get_resp = await async_client.get(f"/v1/goals/{goal_id}", headers=_auth(token))
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["goal"]["title"] == "New title"
    assert get_resp.json()["goal"]["status"] == "at_risk"


@pytest.mark.asyncio
async def test_delete_goal_removes(async_client, company_a):
    token, _, channel_id = company_a
    goal_id = await _create_goal(async_client, token, channel_id)

    resp = await async_client.delete(f"/v1/goals/{goal_id}", headers=_auth(token))
    assert resp.status_code == 204, resp.text

    get_resp = await async_client.get(f"/v1/goals/{goal_id}", headers=_auth(token))
    assert get_resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_delete_goal_cross_tenant_404(async_client, company_a):
    token_a, _, channel_id = company_a
    goal_id = await _create_goal(async_client, token_a, channel_id)

    # Company B
    body_b = await _sign_up(async_client, name="GoalsW B")
    token_b = body_b["session"]["access"]

    patch_resp = await async_client.patch(
        f"/v1/goals/{goal_id}", json={"title": "hack"}, headers=_auth(token_b)
    )
    assert patch_resp.status_code == 404

    del_resp = await async_client.delete(f"/v1/goals/{goal_id}", headers=_auth(token_b))
    assert del_resp.status_code == 404
