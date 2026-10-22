"""Connector pieces: manifest schema and validation."""
import pytest

from omilo_api.pieces import validate_manifest

# Module-level fixture: a valid Gmail connector manifest
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
            "name": "send-email",
            "label": "Send an email",
            "approval": "ask",
            "http": {
                "method": "POST",
                "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                "auth": "bearer",
                "body": {"raw": "{{ base64(message) }}"},
            },
            "inputs": [
                {"name": "to", "type": "string", "required": True},
                {"name": "subject", "type": "string"},
                {"name": "message", "type": "string", "required": True},
            ],
        }
    ],
}


def test_valid_manifest_has_no_errors():
    """A valid manifest should return an empty error list."""
    assert validate_manifest(GMAIL_MANIFEST) == []


def test_missing_id_and_bad_action_approval_reported():
    """Missing id and invalid approval value should both be reported."""
    bad = {
        **GMAIL_MANIFEST,
        "id": "",
        "actions": [
            {**GMAIL_MANIFEST["actions"][0], "approval": "sometimes"}
        ],
    }
    errs = validate_manifest(bad)
    assert any("id" in e for e in errs) and any("approval" in e for e in errs)


def test_action_url_must_be_absolute_https():
    """Action URL must be absolute HTTPS, not relative."""
    bad = {
        **GMAIL_MANIFEST,
        "actions": [
            {
                **GMAIL_MANIFEST["actions"][0],
                "http": {
                    "method": "POST",
                    "url": "/relative",
                    "auth": "bearer",
                },
            }
        ],
    }
    assert any("url" in e for e in validate_manifest(bad))


def test_missing_required_top_level_fields():
    """Missing required top-level fields should be reported."""
    for field in ["id", "label", "category", "description", "auth", "actions"]:
        bad = {**GMAIL_MANIFEST}
        del bad[field]
        errs = validate_manifest(bad)
        assert any(field in e.lower() for e in errs), f"Field {field} not reported"


def test_invalid_id_slug_format():
    """ID must match slug pattern: start with lowercase alphanumeric, allow hyphens, max 41 chars."""
    test_cases = [
        ("", False),  # empty
        ("Gmail", False),  # uppercase
        ("-invalid", False),  # starts with hyphen
        ("valid-slug-123", True),  # valid
        ("a", True),  # single char valid
        ("a" * 41, True),  # exactly 41 chars valid
        ("a" * 42, False),  # 42 chars invalid
        ("has_underscore", False),  # underscores not allowed
    ]
    for id_val, should_be_valid in test_cases:
        manifest = {**GMAIL_MANIFEST, "id": id_val}
        errs = validate_manifest(manifest)
        if should_be_valid:
            assert not any("id" in e for e in errs), f"ID {id_val} should be valid but got errors: {errs}"
        else:
            assert any("id" in e for e in errs), f"ID {id_val} should be invalid"


def test_auth_type_must_be_oauth2_or_apikey():
    """Auth type must be 'oauth2' or 'apikey'; unknown types are rejected."""
    bad = {
        **GMAIL_MANIFEST,
        "auth": {**GMAIL_MANIFEST["auth"], "type": "saml"},
    }
    assert any("oauth2" in e.lower() or "apikey" in e.lower() or "type" in e.lower() for e in validate_manifest(bad))


def test_auth_provider_required_and_non_empty():
    """Auth provider must be present and non-empty."""
    bad = {
        **GMAIL_MANIFEST,
        "auth": {**GMAIL_MANIFEST["auth"], "provider": ""},
    }
    assert any("provider" in e for e in validate_manifest(bad))

    bad2 = {**GMAIL_MANIFEST, "auth": {**GMAIL_MANIFEST["auth"]}}
    del bad2["auth"]["provider"]
    assert any("provider" in e for e in validate_manifest(bad2))


def test_auth_scopes_must_be_non_empty_list():
    """Auth scopes must be a list with at least one element."""
    bad = {
        **GMAIL_MANIFEST,
        "auth": {**GMAIL_MANIFEST["auth"], "scopes": []},
    }
    assert any("scope" in e.lower() for e in validate_manifest(bad))

    bad2 = {
        **GMAIL_MANIFEST,
        "auth": {**GMAIL_MANIFEST["auth"], "scopes": None},
    }
    assert any("scope" in e.lower() for e in validate_manifest(bad2))


def test_actions_must_be_non_empty_list():
    """Actions must be a non-empty list."""
    bad = {**GMAIL_MANIFEST, "actions": []}
    assert any("action" in e.lower() for e in validate_manifest(bad))


def test_action_name_must_match_slug():
    """Action name must match slug pattern."""
    bad = {
        **GMAIL_MANIFEST,
        "actions": [
            {**GMAIL_MANIFEST["actions"][0], "name": "Send Email"}  # uppercase
        ],
    }
    assert any("name" in e.lower() for e in validate_manifest(bad))


def test_action_approval_must_be_auto_or_ask():
    """Action approval must be exactly 'auto' or 'ask'."""
    for invalid_val in ["sometimes", "manual", "", None]:
        bad = {
            **GMAIL_MANIFEST,
            "actions": [
                {**GMAIL_MANIFEST["actions"][0], "approval": invalid_val}
            ],
        }
        assert any("approval" in e for e in validate_manifest(bad))


def test_http_method_must_be_valid_verb():
    """HTTP method must be one of GET, POST, PUT, PATCH, DELETE."""
    valid_methods = ["GET", "POST", "PUT", "PATCH", "DELETE"]
    for method in valid_methods:
        good = {
            **GMAIL_MANIFEST,
            "actions": [
                {
                    **GMAIL_MANIFEST["actions"][0],
                    "http": {**GMAIL_MANIFEST["actions"][0]["http"], "method": method},
                }
            ],
        }
        errs = validate_manifest(good)
        assert not any("method" in e for e in errs), f"Method {method} should be valid"

    bad = {
        **GMAIL_MANIFEST,
        "actions": [
            {
                **GMAIL_MANIFEST["actions"][0],
                "http": {**GMAIL_MANIFEST["actions"][0]["http"], "method": "TRACE"},
            }
        ],
    }
    assert any("method" in e for e in validate_manifest(bad))


def test_http_url_must_be_https():
    """HTTP URL must start with https://"""
    bad_http = {
        **GMAIL_MANIFEST,
        "actions": [
            {
                **GMAIL_MANIFEST["actions"][0],
                "http": {
                    **GMAIL_MANIFEST["actions"][0]["http"],
                    "url": "http://example.com/api",
                },
            }
        ],
    }
    assert any("https" in e.lower() or "url" in e for e in validate_manifest(bad_http))


def test_http_auth_must_be_bearer():
    """HTTP auth must be exactly 'bearer'."""
    bad = {
        **GMAIL_MANIFEST,
        "actions": [
            {
                **GMAIL_MANIFEST["actions"][0],
                "http": {
                    **GMAIL_MANIFEST["actions"][0]["http"],
                    "auth": "basic",
                },
            }
        ],
    }
    assert any("bearer" in e.lower() or "auth" in e for e in validate_manifest(bad))


def test_action_label_required_and_non_empty():
    """Action label must be present and non-empty."""
    bad = {
        **GMAIL_MANIFEST,
        "actions": [{**GMAIL_MANIFEST["actions"][0], "label": ""}],
    }
    assert any("label" in e for e in validate_manifest(bad))


def test_action_inputs_valid_schema():
    """Action inputs must be a list of well-formed input objects."""
    # Valid: optional inputs field or non-empty list
    good = {
        **GMAIL_MANIFEST,
        "actions": [
            {
                **GMAIL_MANIFEST["actions"][0],
                "inputs": [
                    {"name": "param1", "type": "string"},
                    {"name": "param2", "type": "integer", "required": True},
                ],
            }
        ],
    }
    assert validate_manifest(good) == []

    # Invalid: input missing 'name'
    bad = {
        **GMAIL_MANIFEST,
        "actions": [
            {
                **GMAIL_MANIFEST["actions"][0],
                "inputs": [{"type": "string"}],
            }
        ],
    }
    assert any("input" in e.lower() or "name" in e for e in validate_manifest(bad))

    # Invalid: input missing 'type'
    bad2 = {
        **GMAIL_MANIFEST,
        "actions": [
            {
                **GMAIL_MANIFEST["actions"][0],
                "inputs": [{"name": "param"}],
            }
        ],
    }
    assert any("input" in e.lower() or "type" in e for e in validate_manifest(bad2))


def test_label_and_category_non_empty():
    """Label and category must be non-empty strings."""
    bad = {
        **GMAIL_MANIFEST,
        "label": "",
    }
    assert any("label" in e for e in validate_manifest(bad))

    bad2 = {
        **GMAIL_MANIFEST,
        "category": "",
    }
    assert any("category" in e for e in validate_manifest(bad2))


def test_auth_scopes_elements_must_be_non_empty_strings():
    """Each element in auth.scopes must be a non-empty string."""
    # Invalid: scopes with non-string element
    bad_int = {
        **GMAIL_MANIFEST,
        "auth": {**GMAIL_MANIFEST["auth"], "scopes": ["valid.scope", 1, "another.scope"]},
    }
    assert any("scope" in e.lower() for e in validate_manifest(bad_int)), \
        "Should reject scopes with integer element"

    # Invalid: scopes with bool element
    bad_bool = {
        **GMAIL_MANIFEST,
        "auth": {**GMAIL_MANIFEST["auth"], "scopes": [True, "valid.scope"]},
    }
    assert any("scope" in e.lower() for e in validate_manifest(bad_bool)), \
        "Should reject scopes with boolean element"

    # Invalid: scopes with None element
    bad_none = {
        **GMAIL_MANIFEST,
        "auth": {**GMAIL_MANIFEST["auth"], "scopes": ["valid.scope", None]},
    }
    assert any("scope" in e.lower() for e in validate_manifest(bad_none)), \
        "Should reject scopes with None element"

    # Invalid: scopes with empty string element
    bad_empty = {
        **GMAIL_MANIFEST,
        "auth": {**GMAIL_MANIFEST["auth"], "scopes": ["valid.scope", ""]},
    }
    assert any("scope" in e.lower() for e in validate_manifest(bad_empty)), \
        "Should reject scopes with empty string element"

    # Valid: all strings
    good = {
        **GMAIL_MANIFEST,
        "auth": {**GMAIL_MANIFEST["auth"], "scopes": ["gmail.send", "gmail.readonly", "another.scope"]},
    }
    assert not any("scope" in e.lower() for e in validate_manifest(good)), \
        "Should accept all non-empty string scopes"


@pytest.mark.parametrize("bad_input", [None, [], "string", 42, True, {"not": "at_top_level"}])
def test_validate_manifest_non_dict_input_returns_errors_not_raises(bad_input):
    """validate_manifest must not raise on non-dict input; must return error list."""
    result = validate_manifest(bad_input)
    assert isinstance(result, list), f"Should return a list for input {bad_input!r}"
    assert len(result) > 0, f"Should return non-empty error list for input {bad_input!r}"
    # Should not raise an exception


# ---------------------------------------------------------------------------
# Task 1: runtime field validation
# ---------------------------------------------------------------------------

def test_runtime_absent_defaults_valid():
    # GMAIL_MANIFEST has no 'runtime' — must stay valid (back-compat).
    assert validate_manifest(GMAIL_MANIFEST) == []


def test_runtime_engine_is_valid():
    m = {**GMAIL_MANIFEST, "runtime": "engine"}
    assert validate_manifest(m) == []


def test_runtime_invalid_value_reported():
    m = {**GMAIL_MANIFEST, "runtime": "grpc"}
    assert any("runtime" in e for e in validate_manifest(m))


def test_runtime_non_string_reported():
    m = {**GMAIL_MANIFEST, "runtime": ["engine"]}
    assert any("runtime" in e for e in validate_manifest(m))


# ---------------------------------------------------------------------------
# Task 2: triggers field validation
# ---------------------------------------------------------------------------

_VALID_TRIGGER = {
    "name": "message-received",
    "event": "message.received",
    "mapping": {"text": "{{ messages[0].text.body }}"},
}


def test_triggers_absent_is_valid():
    assert validate_manifest(GMAIL_MANIFEST) == []


def test_valid_triggers_accepted():
    m = {**GMAIL_MANIFEST, "triggers": [_VALID_TRIGGER]}
    assert validate_manifest(m) == []


def test_triggers_must_be_list():
    m = {**GMAIL_MANIFEST, "triggers": {"name": "x"}}
    assert any("triggers" in e for e in validate_manifest(m))


def test_trigger_element_must_be_dict():
    m = {**GMAIL_MANIFEST, "triggers": ["message.received"]}
    assert any("triggers" in e.lower() for e in validate_manifest(m))


def test_trigger_missing_event_reported():
    t = {k: v for k, v in _VALID_TRIGGER.items() if k != "event"}
    m = {**GMAIL_MANIFEST, "triggers": [t]}
    assert any("event" in e for e in validate_manifest(m))


def test_trigger_bad_name_reported():
    m = {**GMAIL_MANIFEST, "triggers": [{**_VALID_TRIGGER, "name": "Bad Name"}]}
    assert any("name" in e for e in validate_manifest(m))


def test_trigger_mapping_must_be_dict_if_present():
    m = {**GMAIL_MANIFEST, "triggers": [{**_VALID_TRIGGER, "mapping": "nope"}]}
    assert any("mapping" in e for e in validate_manifest(m))


# ---------------------------------------------------------------------------
# Task 1 (catalog v2): type: mcp manifest validation + MCP host allowlist
# ---------------------------------------------------------------------------

_MCP_MANIFEST = {
    "id": "repliz", "type": "mcp", "label": "Repliz", "category": "Social",
    "description": "Post and reply across social platforms via Repliz.",
    "mcp": {
        "url": "https://mcp.repliz.com/mcp",
        "auth": {
            "scheme": "header",
            "fields": [{"name": "access_key", "label": "Access Key", "secret": True},
                       {"name": "secret_key", "label": "Secret Key", "secret": True}],
            "attach": {"X-Repliz-Access-Key": "{{ access_key }}", "X-Repliz-Secret-Key": "{{ secret_key }}"},
        },
    },
}


def test_type_absent_defaults_piece_still_valid():
    assert validate_manifest(GMAIL_MANIFEST) == []  # no type => piece, unchanged


def test_valid_mcp_manifest_accepted(monkeypatch):
    monkeypatch.setattr("omilo_api.pieces.MCP_HOSTS", {"mcp.repliz.com"})
    assert validate_manifest(_MCP_MANIFEST) == []


def test_mcp_rejected_when_host_not_allowed(monkeypatch):
    monkeypatch.setattr("omilo_api.pieces.MCP_HOSTS", set())
    assert any("host" in e.lower() for e in validate_manifest(_MCP_MANIFEST))


def test_mcp_requires_https_url(monkeypatch):
    monkeypatch.setattr("omilo_api.pieces.MCP_HOSTS", {"mcp.repliz.com"})
    m = {**_MCP_MANIFEST, "mcp": {**_MCP_MANIFEST["mcp"], "url": "http://mcp.repliz.com/mcp"}}
    assert any("url" in e.lower() or "https" in e.lower() for e in validate_manifest(m))


def test_mcp_requires_scheme_fields_attach(monkeypatch):
    monkeypatch.setattr("omilo_api.pieces.MCP_HOSTS", {"mcp.repliz.com"})
    m = {**_MCP_MANIFEST, "mcp": {"url": "https://mcp.repliz.com/mcp", "auth": {"scheme": "nope", "fields": [], "attach": {}}}}
    errs = validate_manifest(m)
    assert any("scheme" in e for e in errs) and any("fields" in e for e in errs) and any("attach" in e for e in errs)


def test_bad_type_value_reported():
    assert any("type" in e for e in validate_manifest({**GMAIL_MANIFEST, "type": "grpc"}))


def test_mcp_does_not_require_actions_or_scopes(monkeypatch):
    monkeypatch.setattr("omilo_api.pieces.MCP_HOSTS", {"mcp.repliz.com"})
    # _MCP_MANIFEST has no actions/auth.scopes -- must still be valid
    assert validate_manifest(_MCP_MANIFEST) == []


# ---------------------------------------------------------------------------
# Task 1 (catalog v2 Track B): auth.type: apikey validation
# ---------------------------------------------------------------------------

_APIKEY_MANIFEST = {
    "id": "acme", "label": "Acme", "category": "Ops",
    "description": "Acme REST API.",
    "auth": {"type": "apikey", "scheme": "header", "provider": "stripe",
             "fields": [{"name": "api_key", "label": "API Key", "secret": True}],
             "attach": {"X-Api-Key": "{{ api_key }}"}},
    "actions": [{"name": "ping", "label": "Ping", "approval": "auto",
                 "http": {"method": "GET", "url": "https://api.stripe.com/ping"}}],
}


def test_oauth2_still_valid():
    assert validate_manifest(GMAIL_MANIFEST) == []


def test_valid_apikey_manifest_accepted():
    assert validate_manifest(_APIKEY_MANIFEST) == []


def test_apikey_bad_scheme_reported():
    m = {**_APIKEY_MANIFEST, "auth": {**_APIKEY_MANIFEST["auth"], "scheme": "nope"}}
    assert any("scheme" in e for e in validate_manifest(m))


def test_apikey_requires_fields_and_attach():
    m = {**_APIKEY_MANIFEST, "auth": {"type": "apikey", "scheme": "header", "fields": [], "attach": {}}}
    errs = validate_manifest(m)
    assert any("fields" in e for e in errs) and any("attach" in e for e in errs)


def test_apikey_action_without_http_auth_is_valid():
    # the ping action has no http.auth — must be fine for apikey
    assert validate_manifest(_APIKEY_MANIFEST) == []


def test_oauth2_action_still_requires_bearer():
    bad = {**GMAIL_MANIFEST, "actions": [{**GMAIL_MANIFEST["actions"][0], "http": {**GMAIL_MANIFEST["actions"][0]["http"], "auth": "none"}}]}
    assert any("auth" in e for e in validate_manifest(bad))


def test_apikey_requires_provider():
    """An apikey manifest without auth.provider must fail validation with a 'provider' error."""
    no_provider = {
        **_APIKEY_MANIFEST,
        "auth": {k: v for k, v in _APIKEY_MANIFEST["auth"].items() if k != "provider"},
    }
    errs = validate_manifest(no_provider)
    assert any("provider" in e for e in errs), f"Expected 'provider' error, got: {errs}"
