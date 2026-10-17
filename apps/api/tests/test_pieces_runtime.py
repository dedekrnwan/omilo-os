"""Declarative action runtime tests — pure, no DB.

Tests for action_tools, provider_hosts, and run_action in omilo_api.pieces.
Uses respx to stub httpx calls.
"""
from __future__ import annotations

import copy

import pytest
import respx

from omilo_api.pieces import action_tools, provider_hosts, run_action

# ---------------------------------------------------------------------------
# Test fixture manifest — Gmail connector with underscored action name so
# tests can reference it cleanly.  Note: uses send_email (underscore) to
# match the brief's test fixtures.
# ---------------------------------------------------------------------------
GMAIL_MANIFEST = {
    "id": "gmail",
    "label": "Gmail",
    "category": "email",
    "description": "Read and send email from the business inbox.",
    "auth": {
        "type": "oauth2",
        "provider": "google",
        "scopes": ["gmail.send", "gmail.readonly"],
    },
    "actions": [
        {
            "name": "send_email",
            "label": "Send an email",
            "approval": "ask",
            "http": {
                "method": "POST",
                "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                "auth": "bearer",
                "body": {"raw": "{{ base64(message) }}", "to": "{{ to }}"},
            },
            "inputs": [
                {"name": "to", "type": "string", "required": True},
                {"name": "subject", "type": "string"},
                {"name": "message", "type": "string", "required": True},
            ],
        }
    ],
}


def _with_action_url(manifest: dict, action_name: str, new_url: str) -> dict:
    """Return a deep copy of manifest with the given action's http.url replaced."""
    m = copy.deepcopy(manifest)
    for action in m["actions"]:
        if action["name"] == action_name:
            action["http"]["url"] = new_url
    return m


# ---------------------------------------------------------------------------
# action_tools
# ---------------------------------------------------------------------------

def test_action_tools_builds_inputschema_from_inputs():
    """action_tools should build inputSchema.required from inputs with required=True."""
    tools = action_tools(GMAIL_MANIFEST)
    t = next(t for t in tools if t["name"] == "send_email")
    assert t["inputSchema"]["required"] == ["to", "message"]


def test_action_tools_returns_mcp_tool_shape():
    """Each tool def should have name, description, and inputSchema."""
    tools = action_tools(GMAIL_MANIFEST)
    assert len(tools) == 1
    t = tools[0]
    assert t["name"] == "send_email"
    assert t["description"] == "Send an email"
    assert t["inputSchema"]["type"] == "object"
    assert "properties" in t["inputSchema"]


def test_action_tools_maps_input_types():
    """action_tools should map input types into inputSchema.properties."""
    tools = action_tools(GMAIL_MANIFEST)
    t = next(t for t in tools if t["name"] == "send_email")
    props = t["inputSchema"]["properties"]
    assert "to" in props
    assert "subject" in props
    assert "message" in props
    assert props["to"]["type"] == "string"


def test_action_tools_optional_inputs_not_in_required():
    """Inputs without required=True should not appear in inputSchema.required."""
    tools = action_tools(GMAIL_MANIFEST)
    t = next(t for t in tools if t["name"] == "send_email")
    assert "subject" not in t["inputSchema"]["required"]


def test_action_tools_no_inputs_gives_empty_required():
    """An action with no inputs should get an empty required list and properties."""
    manifest = copy.deepcopy(GMAIL_MANIFEST)
    del manifest["actions"][0]["inputs"]
    tools = action_tools(manifest)
    t = tools[0]
    assert t["inputSchema"]["required"] == []
    assert t["inputSchema"]["properties"] == {}


# ---------------------------------------------------------------------------
# provider_hosts
# ---------------------------------------------------------------------------

def test_provider_hosts_extracts_action_url_hosts():
    """provider_hosts should extract hostnames from each action's http.url."""
    hosts = provider_hosts(GMAIL_MANIFEST)
    assert "gmail.googleapis.com" in hosts


def test_provider_hosts_rejects_templated_hosts():
    """provider_hosts should ignore/reject actions whose http.url host is templated."""
    manifest = _with_action_url(GMAIL_MANIFEST, "send_email", "https://{{ host }}/path")
    hosts = provider_hosts(manifest)
    # The templated host must not be returned as an allowed host
    assert not any("{{" in h for h in hosts)


def test_provider_hosts_multiple_actions():
    """provider_hosts should collect hosts from all actions."""
    manifest = copy.deepcopy(GMAIL_MANIFEST)
    manifest["actions"].append({
        "name": "list-messages",
        "label": "List messages",
        "approval": "auto",
        "http": {
            "method": "GET",
            "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages",
            "auth": "bearer",
        },
    })
    hosts = provider_hosts(manifest)
    assert len(hosts) == 1  # same host deduped
    assert "gmail.googleapis.com" in hosts


# ---------------------------------------------------------------------------
# run_action
# ---------------------------------------------------------------------------

@respx.mock
def test_run_action_templates_body_and_injects_bearer():
    """run_action should template the body and inject Authorization: Bearer <token>."""
    route = respx.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    ).respond(200, json={"id": "x"})
    text, meta = run_action(
        GMAIL_MANIFEST,
        "send_email",
        {"to": "a@b.com", "message": "hi"},
        token="TOK",
    )
    assert route.calls.last.request.headers["authorization"] == "Bearer TOK"
    assert meta["status"] == 200
    assert meta["needs_reconnect"] is False


@respx.mock
def test_run_action_returns_summary_text():
    """run_action should return a non-empty summary string."""
    respx.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    ).respond(200, json={"id": "x"})
    text, meta = run_action(
        GMAIL_MANIFEST,
        "send_email",
        {"to": "a@b.com", "message": "hi"},
        token="TOK",
    )
    assert isinstance(text, str) and len(text) > 0


def test_run_action_rejects_off_provider_host():
    """run_action should raise ValueError when http.url host is off-provider (SSRF guard)."""
    tampered = _with_action_url(GMAIL_MANIFEST, "send_email", "https://evil.example.com/x")
    with pytest.raises(ValueError, match="(?i)host|ssrf|allow"):
        run_action(tampered, "send_email", {"to": "a@b.com", "message": "hi"}, token="TOK")


@respx.mock
def test_run_action_flags_needs_reconnect_on_401():
    """run_action should set needs_reconnect=True on a 401 response."""
    respx.post(url__regex=r"https://gmail\.googleapis\.com/.*").respond(401)
    _, meta = run_action(
        GMAIL_MANIFEST,
        "send_email",
        {"to": "a@b.com", "message": "hi"},
        token="TOK",
    )
    assert meta["needs_reconnect"] is True


@respx.mock
def test_run_action_flags_needs_reconnect_on_403():
    """run_action should set needs_reconnect=True on a 403 response."""
    respx.post(url__regex=r"https://gmail\.googleapis\.com/.*").respond(403)
    _, meta = run_action(
        GMAIL_MANIFEST,
        "send_email",
        {"to": "a@b.com", "message": "hi"},
        token="TOK",
    )
    assert meta["needs_reconnect"] is True


def test_run_action_raises_for_unknown_action():
    """run_action should raise ValueError for an action name not in the manifest."""
    with pytest.raises((ValueError, KeyError)):
        run_action(GMAIL_MANIFEST, "nonexistent_action", {}, token="TOK")


@respx.mock
def test_run_action_templates_variable_in_url():
    """run_action should template {{ var }} in the URL path (not the host)."""
    manifest = copy.deepcopy(GMAIL_MANIFEST)
    manifest["actions"][0]["http"]["url"] = (
        "https://gmail.googleapis.com/gmail/v1/users/{{ user_id }}/messages/send"
    )
    manifest["actions"][0]["inputs"] = [
        {"name": "user_id", "type": "string", "required": True},
        {"name": "message", "type": "string", "required": True},
    ]
    del manifest["actions"][0]["http"]["body"]

    route = respx.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    ).respond(200, json={"id": "y"})
    run_action(manifest, "send_email", {"user_id": "me", "message": "test"}, token="TOK")
    assert route.called


@respx.mock
def test_run_action_base64_helper_in_body():
    """run_action should resolve base64(var) helper in the body."""
    import base64 as _b64

    route = respx.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    ).respond(200, json={"id": "x"})
    run_action(
        GMAIL_MANIFEST,
        "send_email",
        {"to": "a@b.com", "message": "hello"},
        token="TOK",
    )
    sent = route.calls.last.request
    body = sent.content.decode()
    expected_b64 = _b64.b64encode(b"hello").decode()
    assert expected_b64 in body
