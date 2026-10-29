"""Cloud plans priced per company by storage: what counts, and the upload pause."""
from __future__ import annotations

import uuid

import pytest

from omilo.billing import storage


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _sign_up(client) -> str:
    email = f"stor_{uuid.uuid4().hex[:8]}@test.example"
    r = await client.post("/v1/auth/sign-up", json={"email": email, "name": "Storage", "password": "testP4ss!"})
    assert r.status_code == 201, r.text
    return r.json()["session"]["access"]


@pytest.mark.asyncio
async def test_storage_counts_docs_files_knowledge_not_chats(async_client):
    token = await _sign_up(async_client)
    st = (await async_client.get("/v1/data/storage", headers=_auth(token))).json()
    counted = {s["key"] for s in st["segments"] if s["counted"]}
    assert counted == {"docs", "files", "knowledge"}
    before = st["used_bytes"]
    r = await async_client.post("/v1/memory", json={"title": "Price list", "content": "x" * 5000}, headers=_auth(token))
    assert r.status_code in (200, 201), r.text
    after = (await async_client.get("/v1/data/storage", headers=_auth(token))).json()["used_bytes"]
    assert after > before


@pytest.mark.asyncio
async def test_uploads_pause_when_storage_is_full(async_client, monkeypatch):
    token = await _sign_up(async_client)
    monkeypatch.setattr(storage, "limit_bytes", lambda session, company: 1000)
    r = await async_client.post("/v1/memory", json={"title": "Big", "content": "x" * 5000}, headers=_auth(token))
    assert r.status_code == 413
    assert "storage is full" in r.json()["detail"].lower() and "upgrade" in r.json()["detail"].lower()
    sk = await async_client.post("/v1/skills", json={"helper_id": "hlp_x", "name": "big", "body_md": "y" * 5000},
                                 headers=_auth(token))
    assert sk.status_code == 413


@pytest.mark.asyncio
async def test_unlimited_people_on_cloud_plans(async_client):
    token = await _sign_up(async_client)
    seats = (await async_client.get("/v1/billing/seats", headers=_auth(token))).json()
    assert seats["unlimited"] is True and seats["can_add"] is False


def test_limit_follows_plan(monkeypatch):
    from omilo.billing.catalog import seed_plans
    from omilo.db import SessionLocal

    seed_plans(None)
    monkeypatch.setattr("omilo.control.factory.is_local_mode", lambda: False)

    class C:
        id = "cmp_x"
        plan_id = "plan_starter"

    with SessionLocal() as db:
        assert storage.limit_bytes(db, C()) == 5 * storage.GB
        C.plan_id = "plan_business"
        assert storage.limit_bytes(db, C()) == 250 * storage.GB
        C.plan_id = "plan_self_hosted"
        assert storage.limit_bytes(db, C()) is None
    monkeypatch.setattr("omilo.control.factory.is_local_mode", lambda: True)
    with SessionLocal() as db:
        assert storage.limit_bytes(db, C()) is None
