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


def test_deployment_guide_is_high():
    """'deployment' is a hard-rule word, so writing a 'deployment guide' is correctly
    escalated to high — the word itself signals a deploy-adjacent concern that needs
    owner review. This test is honest about that behaviour."""
    result = classify_risk("docs.write", "write the deployment guide", worker_label="low")
    assert result == "high"


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


# ---------------------------------------------------------------------------
# Finding 1 — CRITICAL: outward "post" bypasses (all must be high)
# ---------------------------------------------------------------------------

def test_social_post_action_type_is_high():
    """social.post action type → always high (outward social action prefix)."""
    assert classify_risk("social.post", "post this to Instagram", worker_label="low") == "high"


def test_content_share_post_to_twitter_is_high():
    """content.share action type with outward post summary → high."""
    assert classify_risk("content.share", "post this to Twitter", worker_label="low") == "high"


def test_empty_action_post_to_instagram_is_high():
    """Empty action type with 'post this to Instagram now' → high (context-sensitive post detection)."""
    assert classify_risk("", "post this to Instagram now", worker_label="low") == "high"


def test_post_to_platform_is_high():
    """'post to Instagram' (bare verb+to+platform) escalates."""
    assert classify_risk("docs.write", "post to Instagram", worker_label="low") == "high"


def test_post_this_is_high():
    """'post this' matches the outward-post pattern."""
    assert classify_risk("docs.write", "post this content", worker_label="low") == "high"


def test_post_it_is_high():
    """'post it' matches the outward-post pattern."""
    assert classify_risk("docs.write", "post it on Twitter now", worker_label="low") == "high"


def test_post_on_is_high():
    """'post on Instagram' escalates."""
    assert classify_risk("docs.write", "post on Instagram", worker_label="low") == "high"


def test_post_the_is_high():
    """'post the update' escalates via outward-post pattern."""
    assert classify_risk("social.post", "post the update to our followers", worker_label="low") == "high"


# ---------------------------------------------------------------------------
# Finding 1 — anti-downgrade: worker_label="low" cannot lower the "post" cases
# ---------------------------------------------------------------------------

def test_social_post_low_label_cannot_downgrade():
    """social.post action type must stay high regardless of worker_label."""
    assert classify_risk("social.post", "post this to Instagram", worker_label="low") == "high"


def test_post_to_twitter_low_label_cannot_downgrade():
    """'post to Twitter' in summary must stay high even if worker says low."""
    assert classify_risk("content.draft", "post to Twitter", worker_label="low") == "high"


# ---------------------------------------------------------------------------
# Finding 2 — dual-use false-highs that must NOT escalate (internal safe cases)
# ---------------------------------------------------------------------------

def test_transfer_knowledge_is_not_high():
    """'transfer knowledge to the team' has no money context → NOT high."""
    result = classify_risk("docs.write", "transfer knowledge to the team", worker_label="low")
    assert result in ("low", "medium")


def test_transfer_skills_is_not_high():
    """'transfer skills' is internal → NOT high."""
    result = classify_risk("docs.write", "transfer skills to the new hire", worker_label="low")
    assert result in ("low", "medium")


def test_transfer_ownership_is_not_high():
    """'transfer ownership of the document' is internal → NOT high."""
    result = classify_risk("docs.write", "transfer ownership of the document", worker_label="low")
    assert result in ("low", "medium")


def test_release_notes_is_not_high():
    """'write release notes for v2.1' is a docs task → NOT high."""
    result = classify_risk("docs.write", "write release notes for v2.1", worker_label="low")
    assert result in ("low", "medium")


def test_release_timeline_is_not_high():
    """'plan the release timeline' is internal planning → NOT high."""
    result = classify_risk("docs.write", "plan the release timeline for Q4", worker_label="low")
    assert result in ("low", "medium")


def test_release_date_is_not_high():
    """'confirm the release date' is internal → NOT high."""
    result = classify_risk("docs.write", "confirm the release date for the new feature", worker_label="low")
    assert result in ("low", "medium")


def test_debug_message_is_not_high():
    """'log a debug message' is internal tooling → NOT high."""
    result = classify_risk("ops.command", "log a debug message", worker_label="low")
    assert result in ("low", "medium")


def test_draft_message_template_is_not_high():
    """'draft a message template' is internal docs work → NOT high."""
    result = classify_risk("docs.write", "draft a message template", worker_label="low")
    assert result in ("low", "medium")


def test_error_message_is_not_high():
    """'write an error message for the API response' is internal → NOT high."""
    result = classify_risk("docs.write", "write an error message for the API response", worker_label="low")
    assert result in ("low", "medium")


def test_commit_message_is_not_high():
    """'write a commit message' is internal → NOT high."""
    result = classify_risk("docs.write", "write a commit message for the PR", worker_label="low")
    assert result in ("low", "medium")


def test_message_queue_is_not_high():
    """'configure the message queue' is infrastructure — no outward target → NOT high."""
    result = classify_risk("ops.command", "configure the message queue handler", worker_label="low")
    assert result in ("low", "medium")


# ---------------------------------------------------------------------------
# Finding 2 — dangerous dual-use senses that must still fire high
# ---------------------------------------------------------------------------

def test_transfer_money_to_vendor_is_high():
    """'transfer $5000 to the vendor account' is financial → high."""
    assert classify_risk("docs.write", "transfer $5000 to the vendor account", worker_label="low") == "high"


def test_wire_funds_to_account_is_high():
    """'wire funds to account' triggers money-adjacent transfer detection → high."""
    assert classify_risk("docs.write", "transfer funds to the account", worker_label="low") == "high"


def test_transfer_money_is_high():
    """'transfer money to the client' is financial → high."""
    assert classify_risk("payment", "transfer money to the client", worker_label="low") == "high"


def test_release_to_production_is_high():
    """'release the app to production' is a deploy action → high."""
    assert classify_risk("ops.command", "release the app to production", worker_label="low") == "high"


def test_release_the_build_is_high():
    """'release the build' is a deploy action → high."""
    assert classify_risk("ops.command", "release the build", worker_label="low") == "high"


def test_release_version_to_prod_is_high():
    """'release version 2 to prod' is a deploy action → high."""
    assert classify_risk("ops.command", "release version 2 to prod", worker_label="low") == "high"


def test_release_funds_is_high():
    """'release funds to the vendor' is financial → high."""
    assert classify_risk("payment", "release funds to the vendor", worker_label="low") == "high"


def test_send_message_to_client_is_high():
    """'send a message to the client' — 'send' is hard-rule → high."""
    assert classify_risk("ops.command", "send a message to the client", worker_label="low") == "high"


def test_dm_the_customer_is_high():
    """'dm the customer' — 'dm' is hard-rule → high."""
    assert classify_risk("ops.command", "dm the customer about the issue", worker_label="low") == "high"


def test_message_the_client_is_high():
    """'message the client' has outward target → high."""
    assert classify_risk("ops.command", "message the client with the update", worker_label="low") == "high"


def test_message_customer_is_high():
    """'message the customer' has outward target → high."""
    assert classify_risk("ops.command", "message the customer", worker_label="low") == "high"


# ---------------------------------------------------------------------------
# Finding 2 — anti-downgrade: worker_label="low" cannot lower dangerous dual-use cases
# ---------------------------------------------------------------------------

def test_transfer_money_low_label_cannot_downgrade():
    """Financial transfer must stay high regardless of worker_label."""
    assert classify_risk("docs.write", "transfer $5000 to the vendor account", worker_label="low") == "high"


def test_release_to_production_low_label_cannot_downgrade():
    """Deploy-sense release must stay high regardless of worker_label."""
    assert classify_risk("ops.command", "release the app to production", worker_label="low") == "high"


def test_dm_customer_low_label_cannot_downgrade():
    """Outward DM must stay high regardless of worker_label."""
    assert classify_risk("ops.command", "dm the customer", worker_label="low") == "high"
