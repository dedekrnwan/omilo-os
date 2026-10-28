"""Tests for GET /v1/members — P13 control-panel members endpoint.

Tests:
1. A company with N members → GET /v1/members returns N items with correct
   name, email, role.
2. Tenant isolation — company B's member cannot see company A's members.
"""
from __future__ import annotations

import uuid

import pytest

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Company, Member


# ---------------------------------------------------------------------------
# Helpers (shared with other integration tests)
# ---------------------------------------------------------------------------

async def _sign_up(client, email=None, name="Test User", password="testP4ss!"):
    email = email or f"mem_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Test 1: company with N members → returns N records with correct fields
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_members_returns_all_with_correct_fields(async_client):
    """Sign up a user (owner), seed a second member — GET /v1/members returns 2."""
    from omilo.models.tenancy import User

    # Sign up owner
    email_owner = f"owner_{uuid.uuid4().hex[:8]}@test.example"
    body = await _sign_up(async_client, email=email_owner, name="Owner User")
    token = body["session"]["access"]

    # Resolve company_id
    me = (await async_client.get("/v1/me", headers=_auth(token))).json()
    company_id = me["company"]["id"]

    # Seed a second user + member via privileged session
    email_member = f"member2_{uuid.uuid4().hex[:8]}@test.example"
    with SessionLocal() as session:
        with session.begin():
            user2 = User(
                id=prefixed_id("usr"),
                email=email_member,
                name="Second Member",
                password_hash=None,
            )
            session.add(user2)
            session.flush()
            mem2 = Member(
                id=prefixed_id("mem"),
                company_id=company_id,
                user_id=user2.id,
                role="member",
            )
            session.add(mem2)

    # GET /v1/members
    resp = await async_client.get("/v1/members", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    members = resp.json()

    assert isinstance(members, list)
    assert len(members) == 2, f"Expected 2 members, got {len(members)}: {members}"

    # Collect by email for easy lookup
    by_email = {m["email"]: m for m in members}

    assert email_owner in by_email
    assert email_member in by_email

    owner_row = by_email[email_owner]
    assert owner_row["name"] == "Owner User"
    assert owner_row["role"] == "owner"
    assert "id" in owner_row
    assert "user_id" in owner_row

    member_row = by_email[email_member]
    assert member_row["name"] == "Second Member"
    assert member_row["role"] == "member"


# ---------------------------------------------------------------------------
# Test 2: tenant isolation — company B cannot see company A's members
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_members_tenant_isolated(async_client):
    """User B's GET /v1/members only sees their own company's members."""
    email_a = f"mem_a_{uuid.uuid4().hex[:8]}@test.example"
    email_b = f"mem_b_{uuid.uuid4().hex[:8]}@test.example"

    body_a = await _sign_up(async_client, email=email_a, name="User A")
    body_b = await _sign_up(async_client, email=email_b, name="User B")

    token_a = body_a["session"]["access"]
    token_b = body_b["session"]["access"]

    # GET /v1/members as user B — should only include user B
    resp_b = await async_client.get("/v1/members", headers=_auth(token_b))
    assert resp_b.status_code == 200, resp_b.text
    members_b = resp_b.json()

    emails_b = {m["email"] for m in members_b}
    assert email_b in emails_b, f"B's own email not in result: {emails_b}"
    assert email_a not in emails_b, f"A's email leaked into B's members: {emails_b}"

    # GET /v1/members as user A — should only include user A
    resp_a = await async_client.get("/v1/members", headers=_auth(token_a))
    assert resp_a.status_code == 200, resp_a.text
    members_a = resp_a.json()

    emails_a = {m["email"] for m in members_a}
    assert email_a in emails_a, f"A's own email not in result: {emails_a}"
    assert email_b not in emails_a, f"B's email leaked into A's members: {emails_a}"


# ---------------------------------------------------------------------------
# Test 3: unauthenticated request → 401
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_members_requires_auth(async_client):
    """GET /v1/members without a Bearer token → 401."""
    resp = await async_client.get("/v1/members")
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
