"""Tests for local AI-harness detection.

The probe reads PATH + home-dir config files, so these drive it through a
temp HOME and a stubbed ``shutil.which`` rather than the real machine.
"""
import uuid

import pytest

import omilo.harness.detect as detect_mod
from omilo.harness.detect import detect_harnesses


async def _signup(async_client):
    email = f"hn_{uuid.uuid4().hex[:8]}@test.example"
    resp = await async_client.post(
        "/v1/auth/sign-up", json={"email": email, "name": "HN", "password": "hunter2!XY"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["session"]["access"]


def test_detect_returns_all_six_harnesses(monkeypatch, tmp_path):
    # No CLIs on PATH, empty HOME → all not installed.
    monkeypatch.setattr(detect_mod.shutil, "which", lambda _n: None)
    monkeypatch.setenv("HOME", str(tmp_path))

    out = detect_harnesses()
    ids = {h["id"] for h in out}
    assert ids == {"claude-code", "opencode", "codex", "copilot", "gemini-cli", "cursor"}
    assert all(h["installed"] is False and h["signed_in"] is False for h in out)


def test_detect_binary_on_path_marks_installed(monkeypatch, tmp_path):
    monkeypatch.setattr(
        detect_mod.shutil, "which", lambda n: "/usr/local/bin/claude" if n == "claude" else None
    )
    monkeypatch.setenv("HOME", str(tmp_path))

    out = {h["id"]: h for h in detect_harnesses()}
    assert out["claude-code"]["installed"] is True
    assert out["claude-code"]["signed_in"] is False  # no credentials file
    assert out["claude-code"]["detail"] == "/usr/local/bin/claude"


def test_detect_credentials_file_marks_signed_in(monkeypatch, tmp_path):
    # claude on PATH + ~/.claude/.credentials.json present → signed in.
    monkeypatch.setattr(
        detect_mod.shutil, "which", lambda n: "/usr/local/bin/claude" if n == "claude" else None
    )
    monkeypatch.setenv("HOME", str(tmp_path))
    cred_dir = tmp_path / ".claude"
    cred_dir.mkdir()
    (cred_dir / ".credentials.json").write_text("{}")

    out = {h["id"]: h for h in detect_harnesses()}
    assert out["claude-code"]["installed"] is True
    assert out["claude-code"]["signed_in"] is True


def test_detect_never_raises(monkeypatch):
    # A probe that blows up must degrade to not-installed, not propagate.
    def boom(_n):
        raise RuntimeError("nope")

    monkeypatch.setattr(detect_mod.shutil, "which", boom)
    out = detect_harnesses()
    assert len(out) == 6
    assert all(h["installed"] is False for h in out)


@pytest.mark.asyncio
async def test_detect_endpoint_requires_auth(async_client):
    resp = await async_client.get("/v1/ai-accounts/detect")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_detect_endpoint_returns_harnesses(async_client):
    token = await _signup(async_client)
    resp = await async_client.get(
        "/v1/ai-accounts/detect", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "harnesses" in body
    ids = {h["id"] for h in body["harnesses"]}
    assert ids == {"claude-code", "opencode", "codex", "copilot", "gemini-cli", "cursor"}
    for h in body["harnesses"]:
        assert set(h) == {"id", "name", "installed", "signed_in", "detail"}
