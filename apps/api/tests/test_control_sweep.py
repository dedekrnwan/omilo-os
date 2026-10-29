"""sweep/control — control-panel backend.

Covers the endpoints the control panel needed built:
  billing   — GET /billing/packs, canonical pack topup, plan aliases, seats
  invites   — channels list (was a 422), seat gating, list / revoke / resend
  members   — channel access + last_seen_at
  channels  — /channels/manage, archive (hidden from GET /channels), mute, delete
  audit     — events written by mutations, filters, CSV export
  data      — storage breakdown, JSON zip export + download
  me        — per-user preferences, avatar, sessions (revoked token → 401)
  company   — GET /company timezone + logo upload
  skills    — PATCH status (turn off / on; drafts must publish)
  connectors — reauth; MCP servers (remote probe + from OpenAPI)
  ai accounts — pause/rename
  runtime   — company safety gate + AI engine routing/budgets (pure)
"""
from __future__ import annotations

import io
import uuid
import zipfile
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Member, User
from tests.utils import run_alembic

PNG_1PX = (
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8"
    "z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, result.stderr
    from omilo.billing.catalog import seed_plans

    seed_plans()
    yield


async def _sign_up(client, name="Ctl Tester"):
    email = f"ctl_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up", json={"email": email, "name": name, "password": "testP4ss!"}
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me = (await client.get("/v1/me", headers=_auth(token))).json()
    return token, me["user"]["id"], me["company"]["id"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_member(company_id: str, role: str = "member", name: str = "Seeded") -> str:
    with SessionLocal() as s:
        with s.begin():
            u = User(id=prefixed_id("usr"), email=f"seed_{uuid.uuid4().hex[:8]}@test.example", name=name)
            s.add(u)
            s.flush()
            m = Member(id=prefixed_id("mem"), company_id=company_id, user_id=u.id, role=role)
            s.add(m)
            return m.id


# ── billing ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_packs_and_canonical_topup(async_client):
    token, _, _ = await _sign_up(async_client)
    packs = (await async_client.get("/v1/billing/packs", headers=_auth(token))).json()
    assert [(p["id"], p["credits"], p["amount_idr"]) for p in packs] == [
        ("2000", 2000, 100000),
        ("5000", 5000, 238000),
        ("20000", 20000, 800000),
    ]
    before = (await async_client.get("/v1/usage", headers=_auth(token))).json()["balance"]
    r = await async_client.post("/v1/billing/topup", json={"pack": "5000"}, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["balance"] == before + 5000
    bad = await async_client.post("/v1/billing/topup", json={"pack": "999"}, headers=_auth(token))
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_change_plan_alias_and_seats(async_client):
    token, _, _ = await _sign_up(async_client)
    r = await async_client.post(
        "/v1/billing/change-plan", json={"plan_id": "business", "interval": "monthly"}, headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    assert r.json()["plan"]["id"] == "plan_business"
    seats = (await async_client.get("/v1/billing/seats", headers=_auth(token))).json()
    assert seats["plan_id"] == "plan_business"
    assert seats["total"] == 20 and seats["used"] == 1 and seats["max"] is None
    add = await async_client.post("/v1/billing/seats", json={"count": 2}, headers=_auth(token))
    assert add.status_code == 200, add.text
    assert add.json()["seats"] == 22
    # Downgrade carries no extra seats onto Starter and refuses when over its max.
    r2 = await async_client.post("/v1/billing/change-plan", json={"plan_id": "plan_starter"}, headers=_auth(token))
    assert r2.status_code == 200, r2.text
    assert r2.json()["subscription"]["seats"] == 2


@pytest.fixture
def no_email():
    with patch("omilo.auth.router.emails.send_invite") as sent:
        yield sent


@pytest.mark.asyncio
async def test_invites_seat_gating_list_revoke_resend(async_client, no_email):
    token, _, company_id = await _sign_up(async_client)
    # Lazy trial → Team (5 seats). Owner + 4 seeded members fill it.
    sub = (await async_client.get("/v1/billing/subscription", headers=_auth(token))).json()
    assert sub["plan"]["id"] == "plan_team"
    for _ in range(4):
        _seed_member(company_id)
    channels = (await async_client.get("/v1/channels", headers=_auth(token))).json()
    general = channels[0]["id"]

    full = await async_client.post(
        "/v1/auth/invites", json={"email": "x@test.example", "role": "member", "channels": [general]},
        headers=_auth(token),
    )
    assert full.status_code == 409, full.text
    viewer = await async_client.post(
        "/v1/auth/invites", json={"email": "v@test.example", "role": "viewer", "channels": [general]},
        headers=_auth(token),
    )
    assert viewer.status_code == 201, viewer.text  # list[str] channels no longer 422
    assert viewer.json()["channel_ids"] == [general]

    # Trial seats can't be bought; switch to a paid Team plan, then add one.
    await async_client.post("/v1/billing/change-plan", json={"plan_id": "team"}, headers=_auth(token))
    add = await async_client.post("/v1/billing/seats", json={"count": 1}, headers=_auth(token))
    assert add.status_code == 200, add.text
    ok = await async_client.post(
        "/v1/auth/invites", json={"email": "m@test.example", "role": "member"}, headers=_auth(token)
    )
    assert ok.status_code == 201, ok.text

    listed = (await async_client.get("/v1/auth/invites", headers=_auth(token))).json()
    assert {i["email"] for i in listed} == {"v@test.example", "m@test.example"}
    inv_id = next(i["id"] for i in listed if i["email"] == "m@test.example")
    no_email.reset_mock()
    resent = await async_client.post(f"/v1/auth/invites/{inv_id}/resend", headers=_auth(token))
    assert resent.status_code == 200 and no_email.called
    rv = await async_client.delete(f"/v1/auth/invites/{inv_id}", headers=_auth(token))
    assert rv.status_code == 204
    listed = (await async_client.get("/v1/auth/invites", headers=_auth(token))).json()
    assert [i["email"] for i in listed] == ["v@test.example"]


# ── members ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_member_channels_and_last_seen(async_client):
    token, user_id, company_id = await _sign_up(async_client)
    ch = await async_client.post("/v1/channels", json={"name": "Engineering"}, headers=_auth(token))
    eng = ch.json()["id"]
    mid = _seed_member(company_id, name="Bayu")
    r = await async_client.patch(f"/v1/members/{mid}", json={"channels": [eng]}, headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["channel_names"] == ["Engineering"]
    members = (await async_client.get("/v1/members", headers=_auth(token))).json()
    me = next(m for m in members if m["user_id"] == user_id)
    assert me["channels"] is None and me["last_seen_at"] is not None
    r = await async_client.patch(f"/v1/members/{mid}", json={"all_channels": True}, headers=_auth(token))
    assert r.json()["channels"] is None
    bad = await async_client.patch(f"/v1/members/{mid}", json={"channels": ["chn_nope"]}, headers=_auth(token))
    assert bad.status_code == 422


# ── channels ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_channels_manage_archive_mute_delete(async_client):
    token, _, _ = await _sign_up(async_client)
    mk = await async_client.post("/v1/channels", json={"name": "Marketing"}, headers=_auth(token))
    cid = mk.json()["id"]
    rows = (await async_client.get("/v1/channels/manage", headers=_auth(token))).json()
    default = next(r for r in rows if r["is_default"])
    assert default["helper_count"] >= 1  # the Chief works in the default channel
    arch = await async_client.patch(f"/v1/channels/{cid}", json={"archived": True, "muted": True}, headers=_auth(token))
    assert arch.status_code == 200 and arch.json()["archived"] and arch.json()["muted"]
    visible = (await async_client.get("/v1/channels", headers=_auth(token))).json()
    assert cid not in {c["id"] for c in visible}
    no = await async_client.patch(f"/v1/channels/{default['id']}", json={"archived": True}, headers=_auth(token))
    assert no.status_code == 400
    assert (await async_client.delete(f"/v1/channels/{cid}", headers=_auth(token))).status_code == 204
    assert (await async_client.delete(f"/v1/channels/{default['id']}", headers=_auth(token))).status_code == 400


# ── audit ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_audit_log_written_filtered_and_csv(async_client):
    token, _, _ = await _sign_up(async_client, name="Dewi Auditor")
    await async_client.post("/v1/channels", json={"name": "Ops"}, headers=_auth(token))
    await async_client.patch("/v1/company/settings", json={"safety": {"noDelete": True}}, headers=_auth(token))
    allev = (await async_client.get("/v1/audit", headers=_auth(token))).json()["events"]
    assert {e["type"] for e in allev} >= {"channels", "settings"}
    assert all(e["actor_name"] == "Dewi Auditor" for e in allev)
    only = (await async_client.get("/v1/audit?type=settings", headers=_auth(token))).json()["events"]
    assert only and all(e["type"] == "settings" for e in only)
    assert "Safety & limits" in only[0]["target"]
    page = (await async_client.get("/v1/audit?limit=1", headers=_auth(token))).json()
    assert len(page["events"]) == 1 and page["next_cursor"]
    nxt = (await async_client.get(f"/v1/audit?limit=1&cursor={page['next_cursor']}", headers=_auth(token))).json()
    assert nxt["events"][0]["id"] != page["events"][0]["id"]
    csv = await async_client.get("/v1/audit.csv", headers=_auth(token))
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    assert csv.text.splitlines()[0].startswith("time,actor")


# ── data ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_storage_and_export(async_client):
    token, _, _ = await _sign_up(async_client)
    st = (await async_client.get("/v1/data/storage", headers=_auth(token))).json()
    assert {s["key"] for s in st["segments"]} >= {"chats", "docs", "run_logs", "knowledge"}
    assert st["used_bytes"] >= 0
    ex = await async_client.post("/v1/data/exports", headers=_auth(token))
    assert ex.status_code == 201, ex.text
    body = ex.json()
    assert body["status"] == "ready" and body["size_bytes"] > 0
    assert body["summary"]["channel"] >= 1
    lst = (await async_client.get("/v1/data/exports", headers=_auth(token))).json()
    assert lst[0]["id"] == body["id"]
    dl = await async_client.get(f"/v1/data/exports/{body['id']}/download", headers=_auth(token))
    assert dl.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(dl.content)).namelist()
    assert "manifest.json" in names and "channel.json" in names
    other, _, _ = await _sign_up(async_client)
    assert (await async_client.get(f"/v1/data/exports/{body['id']}/download", headers=_auth(other))).status_code == 404


# ── me ───────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_preferences_are_per_user(async_client):
    token, _, company_id = await _sign_up(async_client)
    r = await async_client.patch(
        "/v1/me/preferences",
        json={"nickname": "Mas Dede", "notifications": {"quietHours": {"from": "21:00", "to": "08:00"}}},
        headers=_auth(token),
    )
    assert r.status_code == 200
    r = await async_client.patch("/v1/me/preferences", json={"language": "English"}, headers=_auth(token))
    assert r.json() == {
        "nickname": "Mas Dede",
        "language": "English",
        "notifications": {"quietHours": {"from": "21:00", "to": "08:00"}},
    }
    # A plain member can save their own preferences (not admin-only).
    other, _, _ = await _sign_up(async_client)
    assert (await async_client.get("/v1/me/preferences", headers=_auth(other))).json() == {}
    settings = (await async_client.get("/v1/company/settings", headers=_auth(token))).json()
    assert "nickname" not in str(settings)


@pytest.mark.asyncio
async def test_account_avatar_and_sessions(async_client):
    token, _, _ = await _sign_up(async_client, name="Session Sam")
    acc = (await async_client.get("/v1/me/account", headers=_auth(token))).json()
    assert acc["name"] == "Session Sam" and acc["two_factor_enabled"] is False
    assert acc["google_linked"] is False
    av = await async_client.post("/v1/me/avatar", json={"data_url": PNG_1PX}, headers=_auth(token))
    assert av.status_code == 200 and av.json()["avatar_url"].startswith("data:image/png")
    bad = await async_client.post("/v1/me/avatar", json={"data_url": "data:text/plain;base64,aGk="}, headers=_auth(token))
    assert bad.status_code == 422

    # Second device: sign in again.
    email = acc["email"]
    second = (await async_client.post(
        "/v1/auth/sign-in", json={"email": email, "password": "testP4ss!"},
        headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1"},
    )).json()["session"]["access"]
    sessions = (await async_client.get("/v1/me/sessions", headers=_auth(token))).json()
    assert len(sessions) >= 2
    assert sum(1 for s in sessions if s["current"]) == 1
    phone = next(s for s in sessions if "iPhone" in s["label"])
    assert phone["kind"] == "mobile"
    rv = await async_client.delete(f"/v1/me/sessions/{phone['id']}", headers=_auth(token))
    assert rv.status_code == 204
    assert (await async_client.get("/v1/me", headers=_auth(second))).status_code == 401
    assert (await async_client.get("/v1/me", headers=_auth(token))).status_code == 200


# ── company ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_company_detail_and_logo(async_client):
    token, _, _ = await _sign_up(async_client)
    await async_client.patch("/v1/company", json={"timezone": "Asia/Jakarta"}, headers=_auth(token))
    c = (await async_client.get("/v1/company", headers=_auth(token))).json()
    assert c["timezone"] == "Asia/Jakarta" and c["logo_url"] is None
    up = await async_client.post("/v1/company/logo", json={"data_url": PNG_1PX}, headers=_auth(token))
    assert up.status_code == 200, up.text
    assert (await async_client.get("/v1/company", headers=_auth(token))).json()["logo_url"].startswith("data:image/png")


# ── skills ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_skill_status_patch(async_client):
    token, _, _ = await _sign_up(async_client)
    helpers = (await async_client.get("/v1/helpers", headers=_auth(token))).json()
    hid = helpers[0]["id"]
    sk = (await async_client.post(
        "/v1/skills", json={"helper_id": hid, "name": "Refund policy", "body_md": "1. Check order"},
        headers=_auth(token),
    )).json()
    no = await async_client.patch(f"/v1/skills/{sk['id']}", json={"status": "active"}, headers=_auth(token))
    assert no.status_code == 409
    with SessionLocal() as s:
        with s.begin():
            from omilo.models.skills import Skill

            s.get(Skill, sk["id"]).status = "active"
    off = await async_client.patch(f"/v1/skills/{sk['id']}", json={"status": "disabled"}, headers=_auth(token))
    assert off.status_code == 200 and off.json()["status"] == "disabled"
    on = await async_client.patch(f"/v1/skills/{sk['id']}", json={"status": "active", "name": "Refunds"}, headers=_auth(token))
    assert on.json()["status"] == "active" and on.json()["name"] == "Refunds"


# ── connectors + MCP servers ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_connector_reauth(async_client):
    token, _, company_id = await _sign_up(async_client)
    from omilo.models.connectors import Connector

    cid = prefixed_id("con")
    with SessionLocal() as s:
        with s.begin():
            s.add(Connector(
                id=cid, company_id=company_id, source="marketplace", piece_id=None, slug="x",
                label="Slack", kind="piece", status="connected", enabled=True, approval="ask",
                args={}, secrets_enc={}, scopes=[],
            ))
    r = await async_client.post(f"/v1/connectors/{cid}/reauth", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "needs_auth"
    assert r.json()["auth"]["fields"] == ["api_key"]
    lst = (await async_client.get("/v1/connectors", headers=_auth(token))).json()
    assert lst[0]["auth"]["type"] == "api_key"


OPENAPI = {
    "openapi": "3.0.0",
    "servers": [{"url": "https://api.example.test"}],
    "paths": {
        "/residents": {"get": {"operationId": "find_resident", "summary": "Look up a resident"}},
        "/passes": {"post": {"operationId": "create_visitor_pass", "summary": "New guest QR pass"}},
        "/residents/{id}": {"delete": {"operationId": "delete_resident"}},
    },
}


@pytest.mark.asyncio
async def test_mcp_servers_remote_and_openapi(async_client):
    token, _, _ = await _sign_up(async_client)
    fake_tools = [{"name": "get_order", "description": "Read", "level": "read"}]
    with patch("omilo.api.mcp_servers.probe_remote", return_value=fake_tools):
        r = await async_client.post(
            "/v1/mcp-servers",
            json={"name": "shop-db", "url": "https://mcp.example.test/mcp", "token": "secret-token-123"},
            headers=_auth(token),
        )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "connected" and r.json()["tools"] == fake_tools
    assert r.json()["token_hint"] == "secr…-123"
    with patch("omilo.api.mcp_servers.probe_remote", side_effect=ValueError("HTTP 404")):
        err = await async_client.post(
            "/v1/mcp-servers", json={"name": "broken", "url": "https://nope.example.test"}, headers=_auth(token)
        )
    assert err.json()["status"] == "error" and "404" in err.json()["error"]

    o = await async_client.post(
        "/v1/mcp-servers/from-openapi", json={"name": "warga", "spec": OPENAPI}, headers=_auth(token)
    )
    assert o.status_code == 201, o.text
    levels = {t["name"]: t["level"] for t in o.json()["tools"]}
    assert levels == {"find_resident": "read", "create_visitor_pass": "ask", "delete_resident": "blocked"}
    assert o.json()["url"] == "https://api.example.test"
    bad = await async_client.post("/v1/mcp-servers/from-openapi", json={"name": "x", "spec": "not: [openapi"}, headers=_auth(token))
    assert bad.status_code == 422
    lst = (await async_client.get("/v1/mcp-servers", headers=_auth(token))).json()
    assert len(lst) == 3
    assert (await async_client.delete(f"/v1/mcp-servers/{o.json()['id']}", headers=_auth(token))).status_code == 204


@pytest.mark.asyncio
async def test_ai_account_pause_rename(async_client):
    token, _, _ = await _sign_up(async_client)
    acc = (await async_client.post(
        "/v1/ai-accounts", json={"harness": "claude-code", "name": "Main"}, headers=_auth(token)
    )).json()
    r = await async_client.patch(f"/v1/ai-accounts/{acc['id']}", json={"status": "paused", "name": "Backup"}, headers=_auth(token))
    assert r.json()["status"] == "paused" and r.json()["name"] == "Backup"
    chk = (await async_client.post("/v1/ai-accounts/check", headers=_auth(token))).json()
    assert next(a for a in chk if a["id"] == acc["id"])["status"] == "paused"


# ── runtime: safety + routing (pure) ─────────────────────────────────────────


def test_company_safety_adjusts_verdicts():
    from omilo.engine.company_safety import adjust_verdict

    safety = {
        "postPublicly": True, "messageCustomers": False, "deployProd": True, "noDelete": True,
        "autoApproveUnderIdr": 200_000, "dailySpendCapIdr": 2_000_000,
    }
    a = lambda v, t, **kw: adjust_verdict(v, effective=kw.pop("eff", "yolo"), proposal_type=t, safety=safety, **kw)[0]  # noqa: E731
    assert a("allowed", "social_post") == "needs_owner"
    assert a("allowed", "message") == "allowed"  # messageCustomers off
    assert a("allowed", "deploy") == "needs_owner"
    assert a("allowed", "delete_record") == "needs_owner"
    assert a("needs_owner", "spend", arguments={"amount_idr": 150_000}, eff="ask") == "allowed"
    assert a("needs_owner", "spend", arguments={"amount_idr": 250_000}, eff="ask") == "needs_owner"
    assert a("needs_owner", "spend", arguments={"amount_idr": 150_000}, eff="strict") == "needs_owner"
    assert a("allowed", "spend", arguments={"amount_idr": 150_000}, spend_today_idr=1_900_000) == "needs_owner"
    assert a("allowed", "skill_publish") == "allowed"  # internal review flow untouched
    # Never-saved settings change nothing.
    assert adjust_verdict("allowed", effective="yolo", proposal_type="deploy", safety={})[0] == "allowed"


def test_role_model_and_budgets():
    from omilo.engine.routing import role_model

    company = SimpleNamespace(id="c", settings={"aiEngine": {"roles": {"chief": {"model": "Opus 5.5"}, "agents": {"model": "Sonnet 5.5"}}}})
    assert role_model(company, SimpleNamespace(is_chief=True)) == "Opus 5.5"
    assert role_model(company, SimpleNamespace(is_chief=False)) == "Sonnet 5.5"
    assert role_model(SimpleNamespace(settings={}), SimpleNamespace(is_chief=True)) is None
