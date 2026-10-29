"""TDD — Task 1.5: member role change + remove (PATCH/DELETE /v1/members/{id}).

Tests:
1. Admin changes a member's role → 200 + persisted.
2. Non-admin (member) → 403.
3. Removing the last owner → 400.
4. Remove a non-owner member → 204 + gone from list.
5. Demoting the last owner → 400.
6. Cross-tenant member id → 404.
"""
from __future__ import annotations

import uuid

import pytest

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Member, User
from tests.utils import run_alembic


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


async def _sign_up(client, *, name="MW Tester", password="testP4ss!"):
    email = f"mw_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    return token, me.json()["user"]["id"], me.json()["company"]["id"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_member(company_id: str, *, role="member", name="Seeded") -> str:
    """Create a fresh User + Member in company_id. Returns member_id."""
    with SessionLocal() as session:
        with session.begin():
            user = User(
                id=prefixed_id("usr"),
                email=f"mw_seed_{uuid.uuid4().hex[:8]}@test.example",
                name=name,
                password_hash=None,
            )
            session.add(user)
            session.flush()
            member = Member(
                id=prefixed_id("mem"),
                company_id=company_id,
                user_id=user.id,
                role=role,
            )
            session.add(member)
            session.flush()
            return member.id


def _member_id_for_user(company_id: str, user_id: str) -> str:
    with SessionLocal() as session:
        m = (
            session.query(Member)
            .filter(Member.company_id == company_id, Member.user_id == user_id)
            .first()
        )
        return m.id


@pytest.mark.asyncio
async def test_admin_changes_member_role(async_client):
    """Owner changes a seeded member's role member → admin."""
    owner_token, _, company_id = await _sign_up(async_client, name="Owner")
    member_id = _seed_member(company_id, role="member")

    resp = await async_client.patch(
        f"/v1/members/{member_id}",
        json={"role": "admin"},
        headers=_auth(owner_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "admin"

    # Verify via list.
    lst = await async_client.get("/v1/members", headers=_auth(owner_token))
    by_id = {m["id"]: m for m in lst.json()}
    assert by_id[member_id]["role"] == "admin"


@pytest.mark.asyncio
async def test_non_admin_role_change_403(async_client):
    """A 'member' cannot change roles → 403."""
    owner_token, _, company_id = await _sign_up(async_client, name="Owner2")

    # Sign up a second user and seed them as a plain member.
    member_token, member_user_id, _ = await _sign_up(async_client, name="PlainMember")
    with SessionLocal() as session:
        with session.begin():
            session.add(
                Member(
                    id=prefixed_id("mem"),
                    company_id=company_id,
                    user_id=member_user_id,
                    role="member",
                )
            )

    target_id = _seed_member(company_id, role="member")

    resp = await async_client.patch(
        f"/v1/members/{target_id}",
        json={"role": "admin"},
        headers={
            "Authorization": f"Bearer {member_token}",
            "X-Company-Id": company_id,
        },
    )
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_demote_last_owner_400(async_client):
    """Demoting the only owner → 400."""
    owner_token, owner_user_id, company_id = await _sign_up(async_client, name="SoloOwner")
    owner_member_id = _member_id_for_user(company_id, owner_user_id)

    resp = await async_client.patch(
        f"/v1/members/{owner_member_id}",
        json={"role": "admin"},
        headers=_auth(owner_token),
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_remove_last_owner_400(async_client):
    """Removing the only owner → 400."""
    owner_token, owner_user_id, company_id = await _sign_up(async_client, name="SoloOwner2")
    owner_member_id = _member_id_for_user(company_id, owner_user_id)

    resp = await async_client.delete(
        f"/v1/members/{owner_member_id}", headers=_auth(owner_token)
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_remove_member_204_and_gone(async_client):
    """Owner removes a non-owner member → 204 + gone from list."""
    owner_token, _, company_id = await _sign_up(async_client, name="Owner3")
    member_id = _seed_member(company_id, role="member")

    resp = await async_client.delete(
        f"/v1/members/{member_id}", headers=_auth(owner_token)
    )
    assert resp.status_code == 204, resp.text

    lst = await async_client.get("/v1/members", headers=_auth(owner_token))
    ids = {m["id"] for m in lst.json()}
    assert member_id not in ids


@pytest.mark.asyncio
async def test_cross_tenant_member_404(async_client):
    """Owner A cannot touch a member in company B → 404."""
    owner_a, _, _ = await _sign_up(async_client, name="OwnerA")
    _, _, company_b = await _sign_up(async_client, name="OwnerB")
    b_member = _seed_member(company_b, role="member")

    resp = await async_client.patch(
        f"/v1/members/{b_member}", json={"role": "admin"}, headers=_auth(owner_a)
    )
    assert resp.status_code == 404, resp.text

    del_resp = await async_client.delete(
        f"/v1/members/{b_member}", headers=_auth(owner_a)
    )
    assert del_resp.status_code == 404, del_resp.text
