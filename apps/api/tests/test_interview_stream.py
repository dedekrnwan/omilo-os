"""Tests for the streaming interview endpoint and related new capabilities.

Tests here run in isolation (no shared server state with main suite).
Run with: .venv/bin/pytest -q tests/test_interview_stream.py
"""
from __future__ import annotations

import base64
import json

import httpx
import pytest


# ------------------------------------------------------------------ fixtures
@pytest.fixture
def co(base_url, owner):
    """A fresh company that isn't onboarded yet."""
    new = owner.post("/api/companies", json={"name": "Test Stream Co"}).json()
    owner.cookies.clear()
    c = httpx.Client(base_url=base_url, timeout=30, headers={**owner.headers, "X-Omilo-Company": new["id"]})
    yield c
    c.close()


def _parse_sse(raw: str) -> list[dict]:
    """Parse raw SSE text into a list of {"event": ..., "data": ...} dicts."""
    events = []
    current: dict = {}
    for line in raw.splitlines():
        if line.startswith("event:"):
            current["event"] = line[6:].strip()
        elif line.startswith("data:"):
            current["data"] = json.loads(line[5:].strip())
        elif line == "" and current:
            events.append(current)
            current = {}
    if current:
        events.append(current)
    return events


# ------------------------------------------------------------------ streaming endpoint: fake provider
def test_stream_endpoint_fake_emits_text_then_done(co):
    """fake provider: stream emits at least one text event then a done event with merged answers."""
    # Ensure fake provider (default for a fresh company)
    ai = co.get("/api/onboarding").json()["ai"]
    assert ai["provider"] == "fake"

    r = co.post("/api/onboarding/interview/stream", json={"message": ""}, headers={"Accept": "text/event-stream"})
    assert r.status_code == 200
    assert "text/event-stream" in r.headers.get("content-type", "")

    events = _parse_sse(r.text)
    event_names = [e["event"] for e in events]

    assert "text" in event_names, f"expected 'text' event, got: {event_names}"
    assert "done" in event_names, f"expected 'done' event, got: {event_names}"
    # done must be last
    assert events[-1]["event"] == "done"

    done_data = events[-1]["data"]
    # done event must have the full state shape
    assert "history" in done_data
    assert "topic" in done_data
    assert "answers" in done_data
    assert "coverage" in done_data
    assert "ai" in done_data


def test_stream_endpoint_advances_topic(co):
    """After several scripted turns through the stream endpoint, topic and answers update."""
    # first turn (greeting)
    r = co.post("/api/onboarding/interview/stream", json={"message": ""})
    assert r.status_code == 200
    done0 = _parse_sse(r.text)[-1]["data"]
    assert done0["topic"] is not None

    # answer the first scripted question
    first_field = done0["history"][-1].get("field")
    if first_field == "one_liner":
        answer = "Home-made sambal sold online to busy families in Jakarta"
    else:
        answer = "Test Company"

    r2 = co.post("/api/onboarding/interview/stream", json={"message": answer})
    assert r2.status_code == 200
    events2 = _parse_sse(r2.text)
    assert any(e["event"] == "done" for e in events2)
    done2 = next(e["data"] for e in events2 if e["event"] == "done")
    # answers must be persisted — history grows
    assert len(done2["history"]) > len(done0["history"])


# ------------------------------------------------------------------ file text injection
def test_file_ids_text_gets_injected(co, tmp_path):
    """Uploading a text file and passing its id in file_ids works without error."""
    # Upload a small text file via the /api/files endpoint
    content = b"Daftar menu:\n- Sambal Bawang Rp 45.000\n- Sambal Ijo Rp 50.000"
    b64 = base64.b64encode(content).decode()
    r = co.post("/api/files", json={"name": "menu.txt", "data": b64})
    assert r.status_code == 200, r.text
    fid = r.json()["id"]
    assert fid.startswith("fil_")

    # The stream endpoint should accept file_ids without error
    r2 = co.post("/api/onboarding/interview/stream",
                 json={"message": "Here is our menu", "file_ids": [fid]})
    assert r2.status_code == 200
    events = _parse_sse(r2.text)
    # Should have at least a done event
    assert any(e["event"] == "done" for e in events)


def test_stream_with_file_ids_emits_tool_event(co, tmp_path):
    """Passing file_ids to the stream endpoint emits a tool event for the file."""
    content = b"Our business: we sell sambal online."
    b64 = base64.b64encode(content).decode()
    r = co.post("/api/files", json={"name": "brief.txt", "data": b64})
    assert r.status_code == 200
    fid = r.json()["id"]

    r2 = co.post("/api/onboarding/interview/stream",
                 json={"message": "Here is our brief", "file_ids": [fid]})
    assert r2.status_code == 200
    events = _parse_sse(r2.text)
    tool_labels = [e["data"]["label"] for e in events if e["event"] == "tool"]
    # Should have a "Reading brief.txt…" tool event
    assert any("brief.txt" in lbl for lbl in tool_labels), f"tool labels: {tool_labels}"


def test_stream_with_website_emits_tool_event(co, monkeypatch):
    """Passing a website URL emits a tool event with the URL."""
    # Monkeypatch _read_site to avoid real HTTP
    import omilo_api.interview as I

    async def fake_read(url):
        return f"(fake site content for {url})"

    monkeypatch.setattr(I, "_read_site", fake_read)

    r = co.post("/api/onboarding/interview/stream",
                json={"message": "Check my site", "website": "https://example.com"})
    assert r.status_code == 200
    events = _parse_sse(r.text)
    tool_labels = [e["data"]["label"] for e in events if e["event"] == "tool"]
    assert any("example.com" in lbl for lbl in tool_labels), f"tool labels: {tool_labels}"


# ------------------------------------------------------------------ ai_config local provider
def test_ai_config_local_not_fake(tmp_path, monkeypatch):
    """ai_config('local') should not return fake if CLI is present and logged in."""
    import omilo_api.harness as H
    import omilo_api.interview as I

    # Simulate: CLI found and logged in
    monkeypatch.setattr(H, "find_cli", lambda: "/usr/local/bin/claude")
    monkeypatch.setattr(H, "local_login_status", lambda cli=None: {"installed": True, "logged_in": True})

    class FakeDB:
        pass

    import omilo_api.services as S_mod

    monkeypatch.setattr(S_mod, "get_setting", lambda db, key, default=None: {"onboarding_ai": {"provider": "local"}}.get(key, default))

    cfg = I.ai_config(FakeDB())
    assert cfg["provider"] == "local", f"expected 'local', got {cfg['provider']}"
    assert cfg["provider"] != "fake"


def test_ai_config_local_falls_back_to_fake_when_not_logged_in(tmp_path, monkeypatch):
    """ai_config('local') falls back to fake if not logged in."""
    import omilo_api.harness as H
    import omilo_api.interview as I
    import omilo_api.services as S_mod

    monkeypatch.setattr(H, "find_cli", lambda: "/usr/local/bin/claude")
    monkeypatch.setattr(H, "local_login_status", lambda cli=None: {"installed": True, "logged_in": False})
    monkeypatch.setattr(S_mod, "get_setting", lambda db, key, default=None: {"onboarding_ai": {"provider": "local"}}.get(key, default))

    class FakeDB:
        pass

    cfg = I.ai_config(FakeDB())
    assert cfg["provider"] == "fake"


# ------------------------------------------------------------------ extract_file_text
def test_extract_file_text_plain(base_url):
    """Plain text files are returned verbatim (uses the main company context)."""
    from omilo_api.capabilities import extract_file_text, save_bytes

    raw = b"Hello, this is a test document."
    meta = save_bytes("test.txt", raw)
    name, text = extract_file_text(meta["id"])
    assert name == "test.txt"
    assert "Hello" in text


def test_extract_file_text_unknown(base_url):
    """Unknown binary files return a note rather than raising."""
    from omilo_api.capabilities import extract_file_text, save_bytes

    raw = b"\x00\x01\x02\x03binary garbage"
    meta = save_bytes("widget.bin", raw)
    name, text = extract_file_text(meta["id"])
    assert name == "widget.bin"
    assert "text not extractable" in text or "couldn't read" in text or "extractable" in text


def test_extract_file_text_missing(base_url):
    """Missing file ids return an error note."""
    from omilo_api.capabilities import extract_file_text

    name, text = extract_file_text("fil_" + "0" * 16)
    assert "not found" in text


# ------------------------------------------------------------------ non-stream endpoint still works
def test_non_stream_endpoint_unchanged(co):
    """The existing /onboarding/interview endpoint is unbroken."""
    r = co.post("/api/onboarding/interview", json={"message": ""})
    assert r.status_code == 200
    data = r.json()
    assert "history" in data and "topic" in data and "answers" in data and "coverage" in data


def test_non_stream_accepts_file_ids(co):
    """The non-stream endpoint also accepts file_ids without error."""
    content = b"Business summary goes here."
    b64 = base64.b64encode(content).decode()
    r = co.post("/api/files", json={"name": "summary.txt", "data": b64})
    fid = r.json()["id"]

    r2 = co.post("/api/onboarding/interview", json={"message": "Here is our summary", "file_ids": [fid]})
    assert r2.status_code == 200
