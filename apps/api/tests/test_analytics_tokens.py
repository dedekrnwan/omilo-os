"""Analytics count AI usage in tokens (Job.tokens_in + tokens_out), per company and helper."""
from __future__ import annotations

import uuid

import pytest

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id


async def _sign_up(client) -> tuple[str, str]:
    email = f"tok_{uuid.uuid4().hex[:8]}@test.example"
    r = await client.post("/v1/auth/sign-up", json={"email": email, "name": "Tok", "password": "testP4ss!"})
    assert r.status_code == 201, r.text
    token = r.json()["session"]["access"]
    me = await client.get("/v1/me", headers=_auth(token))
    return token, me.json()["company"]["id"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_helper(company_id: str, name: str) -> str:
    from omilo.models.agents import Helper

    with SessionLocal() as s, s.begin():
        h = Helper(id=prefixed_id("hlp"), company_id=company_id, name=name, area="ops", role="Worker",
                   job_description="", is_chief=False, engine={"type": "fake"}, autonomy_cap=None,
                   permissions=[], status="active", channel_ids=[])
        s.add(h)
        return h.id


def _seed_jobs(company_id: str, helper_id: str, tokens: list[tuple[int, int]]) -> None:
    from omilo.models.execution import Job

    with SessionLocal() as s, s.begin():
        for t_in, t_out in tokens:
            s.add(Job(id=prefixed_id("job"), company_id=company_id, helper_id=helper_id, origin="chat",
                      brief="work", status="done", tokens_in=t_in, tokens_out=t_out, attempts=1, checkpoint={}))


def _stats(resp) -> dict:
    return {s["label"]: s for s in resp.json()["stats"]}


@pytest.mark.asyncio
async def test_overview_tokens_and_per_job(async_client):
    token, cid = await _sign_up(async_client)
    h = _seed_helper(cid, "A")
    _seed_jobs(cid, h, [(1000, 500), (2000, 1000)])
    stats = _stats(await async_client.get("/v1/analytics/overview", headers=_auth(token)))
    assert stats["Tokens"]["value"] == 4500
    assert stats["Tokens per job"]["value"] == 2250
    assert "Spend" not in stats  # credits are not a customer-facing unit


@pytest.mark.asyncio
async def test_helpers_tokens_and_budget(async_client):
    token, cid = await _sign_up(async_client)
    a, b = _seed_helper(cid, "A"), _seed_helper(cid, "B")
    _seed_jobs(cid, a, [(400, 100)])
    _seed_jobs(cid, b, [(100, 50)])
    await async_client.patch(f"/v1/helpers/{a}", json={"budget_tokens_month": 1000}, headers=_auth(token))
    rows = {r["helperId"]: r for r in (await async_client.get("/v1/analytics/helpers", headers=_auth(token))).json()}
    assert rows[a]["tokens"] == 500 and rows[b]["tokens"] == 150
    assert rows[a]["budget"] == {"spent": 500, "limit": 1000} and rows[a]["budgetReached"] is False
    assert rows[b]["budget"] is None


@pytest.mark.asyncio
async def test_tokens_are_company_scoped(async_client):
    ta, ca = await _sign_up(async_client)
    tb, cb = await _sign_up(async_client)
    _seed_jobs(ca, _seed_helper(ca, "A"), [(5000, 0)])
    _seed_jobs(cb, _seed_helper(cb, "B"), [(10, 0)])
    assert _stats(await async_client.get("/v1/analytics/overview", headers=_auth(ta)))["Tokens"]["value"] == 5000
    assert _stats(await async_client.get("/v1/analytics/overview", headers=_auth(tb)))["Tokens"]["value"] == 10


@pytest.mark.asyncio
async def test_tokens_by_channel(async_client):
    token, cid = await _sign_up(async_client)
    _seed_jobs(cid, _seed_helper(cid, "A"), [(700, 300)])
    data = (await async_client.get("/v1/analytics/spend-by-channel", headers=_auth(token))).json()
    assert data["total"] == 1000 and sum(sum(s["values"]) for s in data["series"]) == 1000
