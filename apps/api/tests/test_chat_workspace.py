"""sweep/chat — persisted sidebar, folders, sharing, results, Chief DM, nudges.

Covers:
  - PATCH /sessions/{id}: rename, move folder (and null), per-user pin, archive,
    goal link, model; archived chats leave the normal list and show under
    ?archived=1; restore brings them back.
  - DELETE /sessions/{id} soft-deletes (404 afterwards); DELETE /sessions/archived.
  - POST /sessions with folder_id / model / kind=chief_private; private threads are
    owner-only and excluded from normal lists; messages to them reach Chief.
  - Folders: create / patch (look + instructions) / delete (chats → no folder),
    live counts, files, shares.
  - PATCH /channels/{id} look.
  - GET /sessions/{id}/results derived from jobs.
  - GET /chief/nudges + dismiss/snooze.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from tests.utils import run_alembic


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    yield


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _sign_up(client, name="WS Tester"):
    email = f"cws_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up", json={"email": email, "name": name, "password": "testP4ss!"}
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me = (await client.get("/v1/me", headers=_auth(token))).json()
    return token, me["company"]["id"], me["user"]["id"]


def _seed_chief(company_id: str) -> str:
    from omilo.db import SessionLocal
    from omilo.models.agents import Helper
    from omilo.models.base import prefixed_id

    with SessionLocal() as s:
        with s.begin():
            h = Helper(
                id=prefixed_id("hlp"),
                company_id=company_id,
                name="Chief",
                area="brand",
                is_chief=True,
                engine={"type": "fake"},
                autonomy_cap=None,
                permissions=[],
                status="active",
                channel_ids=[],
            )
            s.add(h)
            s.flush()
            return h.id


def _add_member(company_id: str, name: str = "Rina Ayu") -> str:
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.tenancy import Member, User

    with SessionLocal() as s:
        with s.begin():
            u = User(id=prefixed_id("usr"), email=f"m_{uuid.uuid4().hex[:8]}@test.example", name=name)
            s.add(u)
            s.flush()
            s.add(Member(id=prefixed_id("mem"), company_id=company_id, user_id=u.id, role="member"))
            return u.id


@pytest.fixture()
async def ws(async_client):
    token, company_id, user_id = await _sign_up(async_client)
    _seed_chief(company_id)
    ch = await async_client.post("/v1/channels", json={"name": "Engineering"}, headers=_auth(token))
    assert ch.status_code == 201, ch.text
    return {"token": token, "company_id": company_id, "user_id": user_id, "channel_id": ch.json()["id"]}


async def _new_session(client, token, **body):
    r = await client.post("/v1/sessions", json=body, headers=_auth(token))
    assert r.status_code == 201, r.text
    return r.json()


# ── Sessions ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_patch_session_rename_pin_model_goal(async_client, ws):
    c, t = async_client, ws["token"]
    s = await _new_session(c, t, channel_id=ws["channel_id"], title="Old", model="opus-5-5")
    assert s["model"] == "opus-5-5"
    assert "pinned" not in s

    goal = await c.post(
        "/v1/goals",
        json={"channel_id": ws["channel_id"], "title": "Ship passkeys", "target": "80%"},
        headers=_auth(t),
    )
    assert goal.status_code == 200, goal.text
    goal_id = goal.json()["goal"]["id"]

    r = await c.patch(
        f"/v1/sessions/{s['id']}",
        json={"title": "New title", "pinned": True, "goal_id": goal_id, "model": "haiku-5-5"},
        headers=_auth(t),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["title"] == "New title"
    assert data["pinned"] is True
    assert data["goalId"] == goal_id
    assert data["goal"] == "Ship passkeys"
    assert data["model"] == "haiku-5-5"

    # Clear goal with explicit null; unpin
    r = await c.patch(f"/v1/sessions/{s['id']}", json={"goal_id": None, "pinned": False}, headers=_auth(t))
    assert r.status_code == 200
    assert "goalId" not in r.json() and "goal" not in r.json() and "pinned" not in r.json()

    # Blank title rejected
    r = await c.patch(f"/v1/sessions/{s['id']}", json={"title": "  "}, headers=_auth(t))
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_pins_are_per_user(async_client, ws):
    c, t = async_client, ws["token"]
    s = await _new_session(c, t, channel_id=ws["channel_id"])
    await c.patch(f"/v1/sessions/{s['id']}", json={"pinned": True}, headers=_auth(t))

    from omilo.db import SessionLocal
    from omilo.models.chat import ChatSession

    with SessionLocal() as db:
        row = db.get(ChatSession, s["id"])
        assert row.pinned_by == [ws["user_id"]]

    from omilo.api.chat_workspace import session_out

    with SessionLocal() as db:
        row = db.get(ChatSession, s["id"])
        assert session_out(row, "someone-else").get("pinned") is None
        assert session_out(row, ws["user_id"])["pinned"] is True


@pytest.mark.asyncio
async def test_archive_restore_and_delete(async_client, ws):
    c, t = async_client, ws["token"]
    a = await _new_session(c, t, channel_id=ws["channel_id"], title="A")
    b = await _new_session(c, t, channel_id=ws["channel_id"], title="B")

    r = await c.patch(f"/v1/sessions/{a['id']}", json={"archived": True}, headers=_auth(t))
    assert r.status_code == 200 and r.json()["archivedAt"]

    active = [x["id"] for x in (await c.get("/v1/sessions", headers=_auth(t))).json()]
    assert a["id"] not in active and b["id"] in active
    by_channel = [x["id"] for x in (await c.get(f"/v1/channels/{ws['channel_id']}/sessions", headers=_auth(t))).json()]
    assert a["id"] not in by_channel
    archived = [x["id"] for x in (await c.get("/v1/sessions?archived=1", headers=_auth(t))).json()]
    assert archived == [a["id"]]

    # Restore
    await c.patch(f"/v1/sessions/{a['id']}", json={"archived": False}, headers=_auth(t))
    assert (await c.get("/v1/sessions?archived=1", headers=_auth(t))).json() == []

    # Delete is a real (soft) delete, distinct from archive
    r = await c.delete(f"/v1/sessions/{b['id']}", headers=_auth(t))
    assert r.status_code == 204
    assert (await c.get(f"/v1/sessions/{b['id']}", headers=_auth(t))).status_code == 404
    assert b["id"] not in [x["id"] for x in (await c.get("/v1/sessions", headers=_auth(t))).json()]
    assert (await c.patch(f"/v1/sessions/{b['id']}", json={"title": "x"}, headers=_auth(t))).status_code == 404

    # Bulk delete archived
    await c.patch(f"/v1/sessions/{a['id']}", json={"archived": True}, headers=_auth(t))
    r = await c.delete(f"/v1/sessions/archived?channel_id={ws['channel_id']}", headers=_auth(t))
    assert r.status_code == 200 and r.json() == {"deleted": 1}
    assert (await c.get("/v1/sessions?archived=1", headers=_auth(t))).json() == []


@pytest.mark.asyncio
async def test_sessions_are_tenant_scoped(async_client, ws):
    c = async_client
    s = await _new_session(c, ws["token"], channel_id=ws["channel_id"])
    other_token, _, _ = await _sign_up(c, name="Other co")
    assert (await c.patch(f"/v1/sessions/{s['id']}", json={"title": "x"}, headers=_auth(other_token))).status_code == 404
    assert (await c.delete(f"/v1/sessions/{s['id']}", headers=_auth(other_token))).status_code == 404


# ── Folders ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_folder_crud_counts_and_new_chat_in_folder(async_client, ws):
    c, t = async_client, ws["token"]
    r = await c.post(
        "/v1/folders",
        json={"channel_id": ws["channel_id"], "name": "Q4 Launch", "icon": "rocket", "color": "#F97316"},
        headers=_auth(t),
    )
    assert r.status_code == 201, r.text
    f = r.json()
    assert f["name"] == "Q4 Launch" and f["icon"] == "rocket" and f["color"] == "#F97316" and f["count"] == 0

    # New chat directly in the folder inherits the folder's area
    s = await _new_session(c, t, folder_id=f["id"], title="Launch comms")
    assert s["folderId"] == f["id"] and s["channelId"] == ws["channel_id"]
    s2 = await _new_session(c, t, channel_id=ws["channel_id"])
    r = await c.patch(f"/v1/sessions/{s2['id']}", json={"folder_id": f["id"]}, headers=_auth(t))
    assert r.json()["folderId"] == f["id"]

    folders = (await c.get(f"/v1/channels/{ws['channel_id']}/folders", headers=_auth(t))).json()
    assert [x["count"] for x in folders if x["id"] == f["id"]] == [2]

    r = await c.patch(
        f"/v1/folders/{f['id']}",
        json={"name": "Q4", "instructions": "Keep answers short.", "color": None},
        headers=_auth(t),
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Q4" and r.json()["instructions"] == "Keep answers short."
    assert "color" not in r.json()
    got = (await c.get(f"/v1/folders/{f['id']}", headers=_auth(t))).json()
    assert got["instructions"] == "Keep answers short."

    # Remove from folder (explicit null)
    r = await c.patch(f"/v1/sessions/{s2['id']}", json={"folder_id": None}, headers=_auth(t))
    assert "folderId" not in r.json()

    # Delete folder → its chats move to "no folder"
    assert (await c.delete(f"/v1/folders/{f['id']}", headers=_auth(t))).status_code == 204
    after = (await c.get(f"/v1/sessions/{s['id']}", headers=_auth(t))).json()
    assert "folderId" not in after
    assert (await c.get(f"/v1/folders/{f['id']}", headers=_auth(t))).status_code == 404


@pytest.mark.asyncio
async def test_folder_files_and_shares(async_client, ws):
    c, t = async_client, ws["token"]
    f = (await c.post("/v1/folders", json={"channel_id": ws["channel_id"], "name": "Docs"}, headers=_auth(t))).json()
    r = await c.post(
        f"/v1/folders/{f['id']}/files",
        json={"name": "plan.md", "size": 12, "mime": "text/markdown", "text": "# Plan"},
        headers=_auth(t),
    )
    assert r.status_code == 201, r.text
    fid = r.json()["id"]
    assert r.json()["hasText"] is True
    files = (await c.get(f"/v1/folders/{f['id']}/files", headers=_auth(t))).json()
    assert [x["name"] for x in files] == ["plan.md"]
    assert (await c.delete(f"/v1/folders/{f['id']}/files/{fid}", headers=_auth(t))).status_code == 204
    assert (await c.get(f"/v1/folders/{f['id']}/files", headers=_auth(t))).json() == []

    rina = _add_member(ws["company_id"])
    r = await c.put(
        f"/v1/folders/{f['id']}/shares",
        json={"members": [{"user_id": rina, "permission": "can_view"}]},
        headers=_auth(t),
    )
    assert r.status_code == 200, r.text
    assert r.json()["members"] == [
        {"userId": rina, "name": "Rina Ayu", "email": r.json()["members"][0]["email"], "permission": "can_view"}
    ]
    bad = await c.put(
        f"/v1/folders/{f['id']}/shares", json={"members": [{"user_id": "usr_nope"}]}, headers=_auth(t)
    )
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_session_shares(async_client, ws):
    c, t = async_client, ws["token"]
    s = await _new_session(c, t, channel_id=ws["channel_id"])
    r = await c.get(f"/v1/sessions/{s['id']}/shares", headers=_auth(t))
    assert r.status_code == 200
    assert r.json()["members"][0]["permission"] == "owner"
    assert r.json()["generalAccess"] == "restricted"
    rina = _add_member(ws["company_id"])
    r = await c.put(
        f"/v1/sessions/{s['id']}/shares",
        json={"members": [{"user_id": rina, "permission": "can_talk"}], "general_access": "company"},
        headers=_auth(t),
    )
    assert r.status_code == 200, r.text
    perms = {m["userId"]: m["permission"] for m in r.json()["members"]}
    assert perms == {ws["user_id"]: "owner", rina: "can_talk"}
    assert r.json()["generalAccess"] == "company"


# ── Areas ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_patch_channel_look(async_client, ws):
    c, t = async_client, ws["token"]
    r = await c.patch(
        f"/v1/channels/{ws['channel_id']}", json={"icon": "rocket", "color": "#14B8A6"}, headers=_auth(t)
    )
    assert r.status_code == 200, r.text
    assert r.json()["icon"] == "rocket" and r.json()["color"] == "#14B8A6"
    listed = [x for x in (await c.get("/v1/channels", headers=_auth(t))).json() if x["id"] == ws["channel_id"]]
    assert listed[0]["color"] == "#14B8A6"
    r = await c.patch(f"/v1/channels/{ws['channel_id']}", json={"icon": None, "color": None}, headers=_auth(t))
    assert r.json().get("color") is None and r.json().get("icon") is None


# ── Chief private threads ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_chief_private_threads(async_client, ws):
    c, t = async_client, ws["token"]
    s = await _new_session(c, t, kind="chief_private", title="Am I spreading thin?", channel_id=ws["channel_id"])
    assert s["kind"] == "chief_private"
    assert "channelId" not in s  # private threads live outside areas

    assert s["id"] not in [x["id"] for x in (await c.get("/v1/sessions", headers=_auth(t))).json()]
    mine = (await c.get("/v1/sessions?kind=chief_private", headers=_auth(t))).json()
    assert [x["id"] for x in mine] == [s["id"]]

    r = await c.post(f"/v1/sessions/{s['id']}/messages", json={"content": "Hello Chief"}, headers=_auth(t))
    assert r.status_code == 200, r.text
    msgs = (await c.get(f"/v1/sessions/{s['id']}/messages", headers=_auth(t))).json()
    assert len(msgs) == 2
    assert msgs[1]["author"]["name"] == "Chief"

    # Another member of the same company can't see it.
    from omilo.auth.tokens import make_access_token

    rina = _add_member(ws["company_id"])
    other, _ = make_access_token(rina, ws["company_id"], "member")
    assert (await c.get(f"/v1/sessions/{s['id']}", headers=_auth(other))).status_code == 404
    assert (await c.get(f"/v1/sessions/{s['id']}/messages", headers=_auth(other))).status_code == 404
    assert (await c.get("/v1/sessions?kind=chief_private", headers=_auth(other))).json() == []

    bad = await c.post("/v1/sessions", json={"kind": "nope"}, headers=_auth(t))
    assert bad.status_code == 422


# ── Results ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_session_results_from_jobs(async_client, ws):
    c, t = async_client, ws["token"]
    s = await _new_session(c, t, channel_id=ws["channel_id"])
    empty = (await c.get(f"/v1/sessions/{s['id']}/results", headers=_auth(t))).json()
    assert empty["steps"] == [] and empty["outputs"] == [] and empty["activity"] == []

    await c.post(f"/v1/sessions/{s['id']}/messages", json={"content": "Draft the plan"}, headers=_auth(t))
    res = (await c.get(f"/v1/sessions/{s['id']}/results", headers=_auth(t))).json()
    assert len(res["steps"]) == 1
    step = res["steps"][0]
    assert step["label"] == "Draft the plan"
    assert step["helper"] == "Chief"
    assert step["status"] in ("done", "waiting", "failed")
    # Each step carries its own token counts (the context meter reads the latest).
    assert "tokensIn" in step and "tokensOut" in step
    assert isinstance(step["tokensIn"], int) and isinstance(step["tokensOut"], int)
    assert set(res["usage"]) == {"tokensIn", "tokensOut", "costCredits"}


# ── Nudges ───────────────────────────────────────────────────────────────────


def _seed_inbox(company_id: str, *, needs_you: bool, title: str) -> str:
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.inbox import InboxItem

    with SessionLocal() as s:
        with s.begin():
            it = InboxItem(
                id=prefixed_id("inb"),
                company_id=company_id,
                title=title,
                summary="",
                session_id="ses_x",
                channel_id="chn_x",
                kind="decision",
                status="pending",
                asker="Builder",
                asker_area="dev",
                needs_you=needs_you,
            )
            s.add(it)
            return it.id


@pytest.mark.asyncio
async def test_chief_nudges_and_dismiss(async_client, ws):
    c, t = async_client, ws["token"]
    item = _seed_inbox(ws["company_id"], needs_you=True, title="Approve deploy")
    _seed_inbox(ws["company_id"], needs_you=False, title="FYI")
    nudges = (await c.get("/v1/chief/nudges", headers=_auth(t))).json()
    assert [n["inboxItemId"] for n in nudges] == [item]
    assert "Approve deploy" in nudges[0]["body"]

    nid = nudges[0]["id"]
    future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    r = await c.post(f"/v1/chief/nudges/{nid}/dismiss", json={"snooze_until": future}, headers=_auth(t))
    assert r.status_code == 204
    assert (await c.get("/v1/chief/nudges", headers=_auth(t))).json() == []

    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    await c.post(f"/v1/chief/nudges/{nid}/dismiss", json={"snooze_until": past}, headers=_auth(t))
    assert len((await c.get("/v1/chief/nudges", headers=_auth(t))).json()) == 1

    await c.post(f"/v1/chief/nudges/{nid}/dismiss", json={}, headers=_auth(t))
    assert (await c.get("/v1/chief/nudges", headers=_auth(t))).json() == []


@pytest.mark.asyncio
async def test_create_channel_with_color_and_helpers(async_client):
    c = async_client
    token, company_id, _ = await _sign_up(c, name="Area maker")
    chief = _seed_chief(company_id)
    from omilo.db import SessionLocal
    from omilo.models.agents import Helper
    from omilo.models.base import prefixed_id

    with SessionLocal() as s:
        with s.begin():
            dev = Helper(
                id=prefixed_id("hlp"), company_id=company_id, name="Dev", area="dev", is_chief=False,
                engine={"type": "fake"}, autonomy_cap=None, permissions=[], status="active", channel_ids=[],
            )
            s.add(dev)
            dev_id = dev.id
    r = await c.post(
        "/v1/channels",
        json={"name": "Support", "accent": "general", "color": "#EC4899", "helper_ids": [dev_id, chief]},
        headers=_auth(token),
    )
    assert r.status_code == 201, r.text
    ch_id = r.json()["id"]
    listed = [x for x in (await c.get("/v1/channels", headers=_auth(token))).json() if x["id"] == ch_id][0]
    assert listed["color"] == "#EC4899"
    assert listed["agentCount"] == 1
    with SessionLocal() as s:
        assert ch_id in s.get(Helper, dev_id).channel_ids
        assert ch_id not in (s.get(Helper, chief).channel_ids or [])
