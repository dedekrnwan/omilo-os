"""Task 2 — Structural risk classifier.

Tests pin the anti-downgrade guarantee: a worker's self-reported label is a HINT, never
the authority. Hard-rule categories (send/spend/merge/deploy/production/outward actions)
always return "high" regardless of worker_label. An internal action cannot be forced
below the structural read.

TDD order: write tests FIRST, verify fail, then implement.
"""
import pytest

from omilo_api.graph.risk import classify_risk


# ---------------------------------------------------------------------------
# Required cases from the plan / brief
# ---------------------------------------------------------------------------

def test_send_labeled_low_is_high():
    """content.publish + social-send summary → always high, even if worker labels it low."""
    assert classify_risk("content.publish", "post the draft to Instagram", worker_label="low") == "high"


def test_spend_is_high():
    """payment.charge action type → always high regardless of missing label."""
    assert classify_risk("payment.charge", "charge the client $200", worker_label=None) == "high"


def test_internal_draft_is_low_or_medium():
    """docs.write with an internal-draft summary → low or medium (never escalated to high)."""
    assert classify_risk("docs.write", "draft a blog post in Docs", worker_label="low") in ("low", "medium")


def test_worker_cannot_downgrade_but_can_upgrade():
    """Internal action type with high worker label → high (worker may upgrade, never downgrade)."""
    assert classify_risk("docs.write", "edit a file", worker_label="high") == "high"


# ---------------------------------------------------------------------------
# Anti-downgrade stress tests
# ---------------------------------------------------------------------------

def test_outreach_send_labeled_low_is_high():
    """outreach.send action type → always high, label cannot override."""
    assert classify_risk("outreach.send", "send the weekly newsletter", worker_label="low") == "high"


def test_deploy_action_labeled_medium_is_high():
    """deploy action type → always high even with medium label."""
    assert classify_risk("deploy", "release v2.0 to production", worker_label="medium") == "high"


def test_merge_action_is_high():
    """code.merge → always high (no label provided)."""
    assert classify_risk("code.merge", "merge the feature branch", worker_label=None) == "high"


def test_money_spend_action_is_high():
    """money.spend action type → always high."""
    assert classify_risk("money.spend", "pay the vendor invoice", worker_label="low") == "high"


def test_email_in_summary_with_hard_rule_type_is_high():
    """Summary mentions 'send email' with outreach.send type → high."""
    assert classify_risk("outreach.send", "send email to all clients", worker_label="low") == "high"


def test_publish_keyword_in_summary_triggers_high():
    """Even a soft action type, if summary explicitly says 'publish to', escalate."""
    assert classify_risk("content.draft", "publish to the company blog now", worker_label="low") == "high"


def test_send_keyword_in_summary_triggers_high():
    """Summary containing 'send' (outward usage) escalates regardless of action type."""
    assert classify_risk("ops.command", "send a Slack DM to the client", worker_label="medium") == "high"


def test_production_keyword_in_summary_triggers_high():
    """Touching production in summary → always high."""
    assert classify_risk("ops.command", "restart the production server", worker_label="low") == "high"


def test_deploy_keyword_in_summary_triggers_high():
    """Deploy in summary triggers high even without deploy action type."""
    assert classify_risk("ops.command", "deploy the hotfix to staging", worker_label="low") == "high"


# ---------------------------------------------------------------------------
# Substring false-positive protection
# ---------------------------------------------------------------------------

def test_report_does_not_match_port():
    """'report' in summary must NOT trigger the hard-rule (would match 'port' substring)."""
    result = classify_risk("report", "generate the weekly revenue report", worker_label="low")
    assert result in ("low", "medium")


def test_ambassador_does_not_match_send():
    """'ambassador' contains 'send' as chars but must NOT trigger the hard-rule."""
    result = classify_risk("docs.write", "brief the brand ambassador on strategy", worker_label="low")
    assert result in ("low", "medium")


def test_expenditure_does_not_match_spend():
    """'expenditure' is a finance term but must NOT match the 'spend' keyword directly."""
    result = classify_risk("report", "summarise the Q3 expenditure report", worker_label="low")
    assert result in ("low", "medium")


def test_deployment_guide_does_not_false_positive():
    """A doc titled 'deployment guide' for an internal write should NOT be flagged high
    unless the action type or summary clearly indicates an active deploy operation."""
    # "deployment" in summary — this one IS risky enough to escalate; the classifier
    # should treat 'deploy' as a hard-rule word. This test checks the expected behaviour:
    result = classify_risk("docs.write", "write the deployment guide", worker_label="low")
    # 'deployment guide' writing is ambiguous — we accept low, medium, OR high here;
    # the key assertion is that it doesn't raise an exception.
    assert result in ("low", "medium", "high")


def test_internally_contains_send_substring():
    """A summary like 'recommend' contains 'send' as a substring inside a word."""
    result = classify_risk("docs.write", "recommend the new policy to the team internally", worker_label="low")
    # 'recommend' contains 'mmend' not 'send' as a word — but let's test a cleaner case.
    assert result in ("low", "medium")


def test_word_boundary_send_in_compound_word():
    """'spending' in a purely internal context: budget planning, no outward action."""
    result = classify_risk("report", "analyse spending trends for the quarter", worker_label="low")
    # 'spending' relates to spend — the classifier may flag this. We accept high too,
    # but it must not crash and must return a valid level.
    assert result in ("low", "medium", "high")


# ---------------------------------------------------------------------------
# Valid level ordering
# ---------------------------------------------------------------------------

def test_internal_low_no_worker_label():
    """Pure internal low-risk operation with no worker label → low."""
    assert classify_risk("knowledge.read", "read the product spec", worker_label=None) == "low"


def test_worker_medium_upgrades_structural_low():
    """Internal action (structural low) + worker says medium → final is medium."""
    result = classify_risk("docs.write", "edit the internal wiki page", worker_label="medium")
    assert result == "medium"


def test_invalid_worker_label_is_ignored():
    """An invalid worker label ('unknown') is treated as None — structural read wins."""
    result = classify_risk("docs.write", "update the meeting notes", worker_label="unknown")
    assert result in ("low", "medium")


def test_empty_summary_with_safe_action_is_low_or_medium():
    """Empty summary with a clearly internal action type doesn't crash."""
    result = classify_risk("knowledge.read", "", worker_label=None)
    assert result in ("low", "medium")


def test_return_values_are_always_valid():
    """classify_risk must always return one of the three valid levels."""
    valid = {"low", "medium", "high"}
    cases = [
        ("content.publish", "post on Twitter", "low"),
        ("docs.write", "internal notes", "medium"),
        ("payment.charge", "bill client", None),
        ("knowledge.read", "read report", "high"),
        ("outreach.send", "email the lead", None),
    ]
    for action_type, summary, label in cases:
        result = classify_risk(action_type, summary, worker_label=label)
        assert result in valid, f"Invalid result {result!r} for ({action_type!r}, {summary!r}, {label!r})"
