"""sweep/docs — doc detail/links/graph, delete, versions, knowledge sources,
lessons review, /v1/ask and the handbook (files, versions, suggestions).
"""
from __future__ import annotations

import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from omilo.db import SessionLocal, set_company
from omilo.main import create_app

_API_DIR = Path(__file__).parent.parent


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=_API_DIR, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    yield


@pytest.fixture(scope="module")
def app():
    return create_app()


@pytest_asyncio.fixture(scope="module")
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _sign_up(client) -> tuple[dict, str]:
    email = f"docs_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Docs User", "password": "DocsP4ss!docsP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    h = {"Authorization": f"Bearer {token}"}
    me = (await client.get("/v1/me", headers=h)).json()
    return h, me["company"]["id"]


def _tenant(company_id: str):
    class _S:
        def __enter__(self):
            self.s = SessionLocal()
            self.t = self.s.begin()
            self.s.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(self.s, company_id)
            return self.s

        def __exit__(self, et, e, tb):
            (self.t.rollback if et else self.t.commit)()
            self.s.close()

    return _S()


# ── Docs ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_doc_get_patch_links_versions_delete(client):
    h, _ = await _sign_up(client)
    a = (await client.post("/v1/memory", json={"title": "Launch checklist", "content": "Steps."}, headers=h)).json()
    assert a["title"] == "Launch checklist" and a["kind"] == "doc" and a["version"] == 1
    b = (
        await client.post(
            "/v1/memory",
            json={"title": "Passkey rollout", "content": "## Wave 1\nSee [[Launch checklist]] and [[Missing doc]].", "area": "engineering"},
            headers=h,
        )
    ).json()
    assert b["area"] == "engineering"

    detail = (await client.get(f"/v1/memory/{b['id']}", headers=h)).json()
    assert [l["title"] for l in detail["links"]] == ["Launch checklist"]
    assert detail["unresolved"] == ["Missing doc"]
    back = (await client.get(f"/v1/memory/{a['id']}", headers=h)).json()
    assert [x["id"] for x in back["backlinks"]] == [b["id"]]

    # Rename + pin + content edit bumps version and records history
    r = await client.patch(f"/v1/memory/{a['id']}", json={"title": "Launch list", "pinned": True}, headers=h)
    assert r.status_code == 200 and r.json()["title"] == "Launch list" and r.json()["pinned"] is True
    r = await client.patch(f"/v1/memory/{a['id']}", json={"content": "Steps v2."}, headers=h)
    assert r.json()["version"] == 3
    versions = (await client.get(f"/v1/memory/{a['id']}/versions", headers=h)).json()
    assert [v["version"] for v in versions] == [3, 2, 1]

    # Graph: nodes + wikilink edge; hidden docs drop out
    g = (await client.get("/v1/memory/graph", headers=h)).json()
    ids = {n["id"] for n in g["nodes"]}
    assert {a["id"], b["id"]} <= ids
    await client.patch(f"/v1/memory/{a['id']}", json={"title": "Launch checklist"}, headers=h)
    g = (await client.get("/v1/memory/graph", headers=h)).json()
    assert {"from": b["id"], "to": a["id"]} in g["edges"]
    await client.patch(f"/v1/memory/{a['id']}", json={"hidden": True}, headers=h)
    g = (await client.get("/v1/memory/graph", headers=h)).json()
    assert a["id"] not in {n["id"] for n in g["nodes"]}

    # Delete
    assert (await client.delete(f"/v1/memory/{a['id']}", headers=h)).status_code == 204
    assert (await client.get(f"/v1/memory/{a['id']}", headers=h)).status_code == 404


@pytest.mark.asyncio
async def test_doc_goal_link(client):
    h, _ = await _sign_up(client)
    channels = (await client.get("/v1/channels", headers=h)).json()
    if not channels:
        pytest.skip("no channel to hang a goal on")
    goal = await client.post(
        "/v1/goals", json={"title": "Passwordless login", "channel_id": channels[0]["id"], "target": "Q4"}, headers=h
    )
    if goal.status_code >= 300:
        pytest.skip(f"goal create unavailable: {goal.text}")
    d = (await client.post("/v1/memory", json={"title": "Plan", "content": "For [[Passwordless login]]."}, headers=h)).json()
    detail = (await client.get(f"/v1/memory/{d['id']}", headers=h)).json()
    assert [g["title"] for g in detail["goals"]] == ["Passwordless login"]


@pytest.mark.asyncio
async def test_docs_are_company_scoped(client):
    h1, _ = await _sign_up(client)
    h2, _ = await _sign_up(client)
    d = (await client.post("/v1/memory", json={"title": "Secret", "content": "x"}, headers=h1)).json()
    assert (await client.get(f"/v1/memory/{d['id']}", headers=h2)).status_code == 404
    assert (await client.delete(f"/v1/memory/{d['id']}", headers=h2)).status_code == 404


# ── Knowledge sources + ask ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sources_list_delete_and_ask(client):
    h, _ = await _sign_up(client)
    r = await client.post(
        "/v1/knowledge/sources",
        json={"kind": "upload", "ref": "upload:prices.md", "title": "prices.md", "body": "Hall rental costs 250k. Deposit is 200k."},
        headers=h,
    )
    assert r.status_code == 200 and r.json()["chunks"] >= 1
    await client.post("/v1/memory", json={"title": "Doc", "content": "Not a source"}, headers=h)
    sources = (await client.get("/v1/knowledge/sources", headers=h)).json()
    assert [s["title"] for s in sources] == ["prices.md"]
    assert sources[0]["chunks"] >= 1 and sources[0]["created_at"]

    ans = (await client.post("/v1/ask", json={"q": "hall rental deposit"}, headers=h)).json()
    assert ans["citations"] and ans["citations"][0]["title"] == "prices.md"
    assert "[1]" in ans["answer"]
    assert ans["memory_searched"] is False

    assert (await client.delete(f"/v1/knowledge/sources/{sources[0]['id']}", headers=h)).status_code == 204
    assert (await client.get("/v1/knowledge/sources", headers=h)).json() == []
    empty = (await client.post("/v1/ask", json={"q": "hall rental deposit"}, headers=h)).json()
    assert empty["citations"] == [] or all(c["title"] != "prices.md" for c in empty["citations"])


@pytest.mark.asyncio
async def test_ask_respects_knowledge_toggle(client):
    h, cmp = await _sign_up(client)
    les = (await client.post("/v1/lessons", json={"text": "Zebra deploys never on Fridays"}, headers=h)).json()
    assert les["status"] == "active"
    off = (await client.post("/v1/ask", json={"q": "zebra deploys fridays"}, headers=h)).json()
    assert all(c["kind"] != "lesson" for c in off["citations"])
    r = await client.patch("/v1/company/settings", json={"knowledge": {"enabled": True}}, headers=h)
    assert r.status_code == 200, r.text
    on = (await client.post("/v1/ask", json={"q": "zebra deploys fridays"}, headers=h)).json()
    assert on["memory_searched"] is True
    assert any(c["kind"] == "lesson" for c in on["citations"])


# ── Lessons ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_lessons_review_confirm_rename_forget(client):
    h, cmp = await _sign_up(client)
    from omilo.memory.store import add_lesson
    from omilo.models.agents import Helper
    from omilo.models.base import prefixed_id

    with SessionLocal() as s, s.begin():
        hid = prefixed_id("hlp")
        s.add(Helper(id=hid, company_id=cmp, name="Dev", area="dev", is_chief=False, engine={"type": "fake"},
                     autonomy_cap=None, permissions=[], status="active", channel_ids=[]))
    with _tenant(cmp) as db:
        add_lesson(db, hid, "Run migrations once", source="Postmortem #482")

    review = (await client.get("/v1/lessons?status=review", headers=h)).json()
    assert [l["text"] for l in review] == ["Run migrations once"]
    lid = review[0]["id"]
    assert review[0]["helper_id"] == hid

    r = await client.patch(f"/v1/lessons/{lid}", json={"text": "Run migrations exactly once"}, headers=h)
    assert r.json()["text"] == "Run migrations exactly once"
    mem = (await client.get(f"/v1/memory?helper_id={hid}", headers=h)).json()
    assert "Run migrations exactly once" in mem[0]["content"]

    assert (await client.post(f"/v1/lessons/{lid}/confirm", headers=h)).json()["status"] == "active"
    assert (await client.get("/v1/lessons?status=review", headers=h)).json() == []

    assert (await client.post(f"/v1/lessons/{lid}/forget", headers=h)).json() == {"ok": True}
    assert (await client.get("/v1/lessons", headers=h)).json() == []
    mem = (await client.get(f"/v1/memory?helper_id={hid}", headers=h)).json()
    assert "migrations" not in mem[0]["content"]


# ── Handbook ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_handbook_seed_edit_versions_suggestions(client):
    h, _ = await _sign_up(client)
    hb = (await client.get("/v1/handbook", headers=h)).json()
    names = [f["name"] for f in hb["files"]]
    assert "BRIEF.md" in names and "POLICIES.md" in names
    assert hb["open_suggestions"] == 0
    assert all("Sahabat" not in f["description"] for f in hb["files"])
    # Seeding is idempotent
    assert len((await client.get("/v1/handbook", headers=h)).json()["files"]) == len(names)

    pol = (await client.get("/v1/handbook/policies", headers=h)).json()
    assert pol["name"] == "POLICIES.md" and pol["version"] == 1

    r = await client.put("/v1/handbook/POLICIES.md", json={"content": pol["content"] + "\n- Late fee waived for 65+.\n"}, headers=h)
    assert r.status_code == 200 and r.json()["version"] == 2
    assert [v["version"] for v in r.json()["versions"]][:2] == [2, 1]

    # New file
    r = await client.put("/v1/handbook/ROADMAP.md", json={"content": "Next up.", "title": "Roadmap", "visibility": "members"}, headers=h)
    assert r.json()["visibility"] == "members" and r.json()["version"] == 1

    # Suggestion → accept applies proposed content
    s = (
        await client.post(
            "/v1/handbook/suggestions",
            json={"file": "FAQ.md", "text": "Add parking hours", "proposed_content": "Parking: 7–22."},
            headers=h,
        )
    ).json()
    assert s["status"] == "open" and s["author"] == "Docs User"
    assert (await client.get("/v1/handbook", headers=h)).json()["open_suggestions"] == 1
    listed = (await client.get("/v1/handbook/suggestions?file=FAQ.md", headers=h)).json()
    assert [x["id"] for x in listed] == [s["id"]]
    acc = (await client.post(f"/v1/handbook/suggestions/{s['id']}/accept", headers=h)).json()
    assert acc["status"] == "accepted"
    faq = (await client.get("/v1/handbook/FAQ.md", headers=h)).json()
    assert faq["content"] == "Parking: 7–22." and faq["versions"][0]["note"] == "Accepted from Docs User"
    assert (await client.post(f"/v1/handbook/suggestions/{s['id']}/dismiss", headers=h)).status_code == 409

    s2 = (await client.post("/v1/handbook/suggestions", json={"file": "VOICE.md", "text": "Less formal"}, headers=h)).json()
    assert (await client.post(f"/v1/handbook/suggestions/{s2['id']}/dismiss", headers=h)).json()["status"] == "dismissed"
    assert (await client.get("/v1/handbook/NOPE.md", headers=h)).status_code == 404
