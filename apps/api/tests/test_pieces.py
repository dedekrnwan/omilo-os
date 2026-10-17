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


def test_auth_type_must_be_oauth2():
    """Auth type must be exactly 'oauth2'."""
    bad = {
        **GMAIL_MANIFEST,
        "auth": {**GMAIL_MANIFEST["auth"], "type": "apikey"},
    }
    assert any("oauth2" in e.lower() or "type" in e.lower() for e in validate_manifest(bad))


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
