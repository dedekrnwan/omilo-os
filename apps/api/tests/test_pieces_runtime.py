"""Declarative action runtime tests — pure, no DB.

Tests for action_tools, provider_hosts, and run_action in omilo_api.pieces.
Uses respx to stub httpx calls.
"""
from __future__ import annotations

import copy

import httpx
import pytest
import respx

import base64 as _stdlib_base64

from omilo_api.pieces import _apply_auth, _render_str, action_tools, provider_hosts, run_action

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
    """provider_hosts returns the registry apex domains for the manifest's provider.

    After the registry fix, provider_hosts returns hardcoded apex domains (e.g.
    'googleapis.com') rather than the per-action hostnames from the manifest.
    gmail.googleapis.com passes _check_host because it is a subdomain of googleapis.com.
    """
    hosts = provider_hosts(GMAIL_MANIFEST)
    # Registry domains for 'google' provider must include googleapis.com
    assert "googleapis.com" in hosts


def test_provider_hosts_rejects_templated_hosts():
    """provider_hosts should ignore/reject actions whose http.url host is templated."""
    manifest = _with_action_url(GMAIL_MANIFEST, "send_email", "https://{{ host }}/path")
    hosts = provider_hosts(manifest)
    # The templated host must not be returned as an allowed host
    assert not any("{{" in h for h in hosts)


def test_provider_hosts_multiple_actions():
    """provider_hosts returns registry domains regardless of how many actions are in the manifest.

    After the registry fix, provider_hosts is manifest-action-count-independent — it
    returns the hardcoded PROVIDER_DOMAINS set for the declared provider. Adding more
    actions with the same host does not change the result.
    """
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
    # google registry has googleapis.com and google.com
    assert "googleapis.com" in hosts
    assert len(hosts) >= 1


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
    """run_action should raise exactly ValueError for an action name not in the manifest."""
    with pytest.raises(ValueError):
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


# ---------------------------------------------------------------------------
# Security finding fixes (Task 3 security review)
# ---------------------------------------------------------------------------

# Finding 1: SSRF bypass — hardcoded registry replaces manifest-derived allowlist
# ---------------------------------------------------------------------------

def test_ssrf_google_evil_com_rejected():
    """SSRF: https://google.evil.com/exfil must be REJECTED for provider 'google'.

    This test FAILS against the old substring-in-hostname heuristic (which admits
    google.evil.com because 'google' IS a substring of 'google.evil.com') and PASSES
    after the hardcoded registry fix (domain-suffix check rejects it).
    """
    tampered = _with_action_url(GMAIL_MANIFEST, "send_email", "https://google.evil.com/exfil")
    with pytest.raises(ValueError):
        run_action(tampered, "send_email", {"to": "a@b.com", "message": "hi"}, token="TOK")


def test_ssrf_googleapis_com_evil_com_rejected():
    """SSRF: https://googleapis.com.evil.com/... must be REJECTED for provider 'google'.

    A purely suffix-based check without the leading dot guard would wrongly admit
    googleapis.com.evil.com (ends with 'com' which contains 'googleapis.com'?).
    Our dotted-suffix check (host == d OR host.endswith('.' + d)) must reject this.
    """
    tampered = _with_action_url(
        GMAIL_MANIFEST, "send_email", "https://googleapis.com.evil.com/steal"
    )
    with pytest.raises(ValueError):
        run_action(tampered, "send_email", {"to": "a@b.com", "message": "hi"}, token="TOK")


@respx.mock
def test_ssrf_legitimate_subdomain_of_registry_allowed():
    """SSRF positive: a real subdomain of a registry domain must be ALLOWED.

    gmail.googleapis.com ends with '.googleapis.com', which is in the google registry,
    so it must pass through without raising ValueError.
    """
    route = respx.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    ).respond(200, json={"id": "x"})
    text, meta = run_action(
        GMAIL_MANIFEST,
        "send_email",
        {"to": "a@b.com", "message": "hi"},
        token="TOK",
    )
    assert meta["status"] == 200
    assert route.called


def test_ssrf_check_host_rejects_unknown_provider():
    """provider_hosts must return empty set for an unregistered provider → everything blocked."""
    manifest = copy.deepcopy(GMAIL_MANIFEST)
    manifest["auth"]["provider"] = "unknown_provider_xyz"
    tampered = _with_action_url(manifest, "send_email", "https://api.unknown_provider_xyz.com/x")
    with pytest.raises(ValueError):
        run_action(tampered, "send_email", {"to": "a@b.com", "message": "hi"}, token="TOK")


# Finding 3: Transport error handling — httpx.RequestError must not escape
# ---------------------------------------------------------------------------

@respx.mock
def test_run_action_transport_error_returns_structured_result():
    """run_action must catch httpx.RequestError and return structured (text, meta) instead of raising."""
    respx.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    ).mock(side_effect=httpx.ConnectError("boom"))
    text, meta = run_action(
        GMAIL_MANIFEST,
        "send_email",
        {"to": "a@b.com", "message": "hi"},
        token="TOK",
    )
    assert "send_email" in text
    assert meta["status"] is None
    assert meta["needs_reconnect"] is False


# Finding 4: _render_obj body guard + ValueError for unknown action
# ---------------------------------------------------------------------------

def test_render_obj_non_dict_body_raises():
    """run_action must raise ValueError when the rendered body is not a dict."""
    manifest = copy.deepcopy(GMAIL_MANIFEST)
    # Set body to a plain string (not a dict) — should raise ValueError, not pass type:ignore
    manifest["actions"][0]["http"]["body"] = "plain string body"
    with pytest.raises(ValueError, match="(?i)body|dict"):
        run_action(manifest, "send_email", {"to": "a@b.com", "message": "hi"}, token="TOK")


def test_run_action_raises_value_error_for_unknown_action():
    """run_action must raise exactly ValueError (not KeyError) for an unknown action name."""
    with pytest.raises(ValueError):
        run_action(GMAIL_MANIFEST, "nonexistent_action", {}, token="TOK")


# ---------------------------------------------------------------------------
# Task 2: basic() template helper + _apply_auth injection helper
# ---------------------------------------------------------------------------

def base64_of(s: str) -> str:
    """Test helper: standard base64 encoding of a string (UTF-8)."""
    return _stdlib_base64.b64encode(s.encode()).decode()


# Canonical apikey manifest fixture (header scheme)
_APIKEY_MANIFEST: dict = {
    "id": "acme-api",
    "label": "Acme API",
    "category": "productivity",
    "description": "Acme REST API connector.",
    "auth": {
        "type": "apikey",
        "scheme": "header",
        "fields": [{"name": "api_key", "label": "API Key"}],
        "attach": {"X-Api-Key": "{{ api_key }}"},
    },
    "actions": [
        {
            "name": "list-items",
            "label": "List items",
            "approval": "auto",
            "http": {
                "method": "GET",
                "url": "https://api.acme.example/v1/items",
            },
        }
    ],
}


def test_basic_template_helper():
    """basic(u, p) renders to base64('<u>:<p>')."""
    assert _render_str("{{ basic(u, p) }}", {"u": "a", "p": "b"}) == base64_of("a:b")


def test_basic_template_helper_missing_first_arg_raises():
    """basic(u, p) raises KeyError if the first argument variable is missing."""
    with pytest.raises(KeyError):
        _render_str("{{ basic(u, p) }}", {"p": "b"})  # u missing


def test_basic_template_helper_missing_second_arg_raises():
    """basic(u, p) raises KeyError if the second argument variable is missing."""
    with pytest.raises(KeyError):
        _render_str("{{ basic(u, p) }}", {"u": "a"})  # p missing


def test_basic_template_helper_in_longer_string():
    """basic() helper works when embedded in a longer template string."""
    result = _render_str("Basic {{ basic(u, p) }}", {"u": "alice", "p": "secret"})
    assert result == "Basic " + base64_of("alice:secret")


def test_apply_auth_header_scheme():
    """_apply_auth with scheme='header' puts rendered pairs in headers, query is empty."""
    h, q = _apply_auth(_APIKEY_MANIFEST, {"api_key": "K"})
    assert h == {"X-Api-Key": "K"}
    assert q == {}


def test_apply_auth_query_scheme():
    """_apply_auth with scheme='query' puts rendered pairs in query, headers is empty."""
    m = {
        **_APIKEY_MANIFEST,
        "auth": {
            "type": "apikey",
            "scheme": "query",
            "fields": [{"name": "token", "label": "Token"}],
            "attach": {"access_token": "{{ token }}"},
        },
    }
    h, q = _apply_auth(m, {"token": "K"})
    assert q == {"access_token": "K"}
    assert h == {}


def test_apply_auth_basic_scheme():
    """_apply_auth with scheme='basic' puts Basic header (via basic() helper) in headers."""
    m = {
        **_APIKEY_MANIFEST,
        "auth": {
            "type": "apikey",
            "scheme": "basic",
            "fields": [
                {"name": "u", "label": "Username"},
                {"name": "p", "label": "Password"},
            ],
            "attach": {"Authorization": "Basic {{ basic(u, p) }}"},
        },
    }
    h, _ = _apply_auth(m, {"u": "a", "p": "b"})
    assert h["Authorization"] == "Basic " + base64_of("a:b")


def test_apply_auth_oauth2_returns_empty():
    """_apply_auth returns ({}, {}) for oauth2 manifests — oauth2 is handled in run_action."""
    assert _apply_auth(GMAIL_MANIFEST, {}) == ({}, {})


# ---------------------------------------------------------------------------
# Task 3: run_action apikey auth injection
# ---------------------------------------------------------------------------

# Apikey manifest with query scheme — uses stripe provider so SSRF check passes.
_APIKEY_QUERY_MANIFEST: dict = {
    "id": "stripe-api",
    "label": "Stripe API",
    "category": "payments",
    "description": "Stripe REST API connector.",
    "auth": {
        "type": "apikey",
        "scheme": "query",
        "provider": "stripe",
        "fields": [{"name": "token", "label": "API Token"}],
        "attach": {"access_token": "{{ token }}"},
    },
    "actions": [
        {
            "name": "ping",
            "label": "Ping",
            "approval": "auto",
            "http": {
                "method": "GET",
                "url": "https://api.stripe.com/v1/ping",
            },
        }
    ],
}

# Apikey manifest with header scheme — acme-api has no provider so we add one
# that satisfies the SSRF registry. Use stripe for simplicity.
_APIKEY_HEADER_MANIFEST: dict = {
    **_APIKEY_MANIFEST,
    "auth": {
        **_APIKEY_MANIFEST["auth"],
        "provider": "stripe",
    },
    "actions": [
        {
            "name": "ping",
            "label": "Ping",
            "approval": "auto",
            "http": {
                "method": "GET",
                "url": "https://api.stripe.com/v1/ping",
            },
        }
    ],
}


@respx.mock
def test_run_action_oauth2_unchanged():
    """run_action with oauth2 manifest must inject Authorization: Bearer <token> unchanged."""
    route = respx.post(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    ).respond(200, json={"id": "x"})
    _, meta = run_action(
        GMAIL_MANIFEST,
        "send_email",
        {"to": "a@b.com", "message": "hi"},
        "TOK",
    )
    req = route.calls.last.request
    assert req.headers["authorization"] == "Bearer TOK"
    assert meta["status"] == 200


@respx.mock
def test_run_action_apikey_header():
    """run_action with apikey+header scheme must inject X-Api-Key and no Authorization header."""
    route = respx.get("https://api.stripe.com/v1/ping").respond(200, json={})
    _, meta = run_action(
        _APIKEY_HEADER_MANIFEST,
        "ping",
        {},
        creds={"api_key": "K"},
    )
    req = route.calls.last.request
    assert req.headers["x-api-key"] == "K"
    assert "authorization" not in req.headers
    assert meta["status"] == 200


@respx.mock
def test_run_action_apikey_query_passes_ssrf():
    """run_action with apikey+query scheme must embed access_token in URL; host unchanged."""
    route = respx.get(url__regex=r"https://api\.stripe\.com/v1/ping.*").respond(200, json={})
    _, meta = run_action(
        _APIKEY_QUERY_MANIFEST,
        "ping",
        {},
        creds={"token": "K"},
    )
    req = route.calls.last.request
    assert "access_token=K" in str(req.url)
    assert req.url.host == "api.stripe.com"
    assert meta["status"] == 200
