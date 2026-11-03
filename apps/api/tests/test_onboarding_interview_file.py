"""Backend: accept & persist a file attachment on an onboarding interview turn.

Tests:
  - A file-only turn (no message, no website) is persisted and the owner history
    entry carries `📎 <name>` text + `attachment.name`.
  - A base64 payload over 10 MB is rejected with an SSE error event.

Uses the practice/fake provider so these tests run without any AI configured.
"""
from __future__ import annotations

import base64
import json
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from omilo.main import create_app


# ── helpers ──────────────────────────────────────────────────────────────────

def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _parse_sse(raw: str) -> list[dict]:
    """Return a list of {event, data} dicts from a text/event-stream body."""
    out = []
    for frame in raw.split("\n\n"):
        ev, data = "", ""
        for line in frame.splitlines():
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data += line[5:].strip()
        if ev or data:
            try:
                out.append({"event": ev, "data": json.loads(data) if data else None})
            except ValueError:
                out.append({"event": ev, "data": data})
    return out


async def _collect_sse(client, url: str, body: dict, token: str) -> list[dict]:
    r = await client.post(url, json=body, headers=_h(token))
    assert r.status_code == 200, r.text
    return _parse_sse(r.text)


def _last_done(events: list[dict]) -> dict:
    """Return the data payload of the last 'done' SSE event."""
    for ev in reversed(events):
        if ev["event"] == "done":
            return ev["data"]
    raise AssertionError(f"No 'done' event found in: {events}")


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def async_client():
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client


@pytest_asyncio.fixture
async def owner_token(async_client):
    """Create a fresh workspace and return an owner bearer token."""
    r = await async_client.post("/v1/auth/sign-up", json={
        "email": f"file-test-{uuid.uuid4().hex[:10]}@test.example",
        "name": "Test Owner",
        "password": "testP4ss!",
    })
    assert r.status_code == 201, r.text
    return r.json()["session"]["access"]


# ── tests ─────────────────────────────────────────────────────────────────────

async def test_interview_stream_persists_file_attachment(async_client, owner_token):
    """A file-only turn persists a 📎 owner entry with attachment.name."""
    tiny = base64.b64encode(b"hello").decode()
    events = await _collect_sse(
        async_client,
        "/v1/onboarding/interview/stream",
        {"file": {"name": "deck.pdf", "mime": "application/pdf", "data": tiny}},
        owner_token,
    )
    done = _last_done(events)
    owner = [h for h in done["history"] if h["role"] == "owner"][-1]
    assert owner["text"].startswith("📎")
    assert owner["attachment"]["name"] == "deck.pdf"


async def test_interview_stream_rejects_oversize_file(async_client, owner_token):
    """A file whose decoded size exceeds 10 MB yields an SSE error event."""
    big = base64.b64encode(b"x" * (10 * 1024 * 1024 + 1)).decode()
    events = await _collect_sse(
        async_client,
        "/v1/onboarding/interview/stream",
        {"file": {"name": "big.pdf", "mime": "application/pdf", "data": big}},
        owner_token,
    )
    assert any(e["event"] == "error" for e in events)
