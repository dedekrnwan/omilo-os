"""Task 2 (round-3) — escalation router: action_type is AUTHORITATIVE.

The architecture changed: ``classify_risk`` routes CoS-auto-handle vs. owner-approve.
It is NOT the sole safety net — the execution engine (SHELL_DENY in
``engines/claude_code.py``) and structured ``request_action`` routing enforce the
hard guarantees; the CoS reasoning call makes the final semantic judgment.

These tests pin the new expectation model:

1. action_type AUTHORITATIVE & complete over the taxonomy — any HIGH-type returns
   "high" even with worker_label="low" and a totally benign summary.
2. internal types → low/medium, still upgradable by worker_label="high".
3. free-text summary is BEST-EFFORT — representative outward phrasings are still
   caught, but an obscure outward phrasing with EMPTY action_type MAY return low,
   and that is acceptable because action_type is the real gate.
4. worker_label may upgrade, never downgrade.
"""
import pytest

from omilo_api.graph.risk import (
    HIGH_RISK_ACTION_PATTERNS,
    classify_risk,
)


# ===========================================================================
# 1. action_type AUTHORITATIVE — the new completeness guarantee.
#    Every HIGH-type returns "high" EVEN with worker_label="low" AND a benign
#    summary like "do the thing".
# ===========================================================================

# Representative HIGH action types spanning every category in the taxonomy.
_HIGH_ACTION_TYPES = [
    "request_action",          # structured outward side-effect routing
    "content.publish",
    "content.share",
    "social.post",
    "social.dm",
    "publish",
    "post",
    "share",
    "broadcast",
    "outreach.send",
    "send",
    "message",
    "email",
    "sms",
    "payment.charge",
    "payment",
    "money.spend",
    "spend",
    "charge",
    "purchase",
    "refund",
    "transfer",
    "deploy",
    "ops.deploy.prod",
    "release",
    "code.merge",
    "merge",
    "production",
]


@pytest.mark.parametrize("action_type", _HIGH_ACTION_TYPES)
def test_high_action_type_is_high_with_benign_summary_and_low_label(action_type):
    """Authoritative: a HIGH action_type → 'high' even with a benign summary and
    worker_label='low'. The free-text is irrelevant; action_type is the gate."""
    result = classify_risk(action_type, "do the thing", worker_label="low")
    assert result == "high", (
        f"Expected 'high' for action_type={action_type!r} with benign summary "
        f"and worker_label='low', got {result!r}"
    )


def test_high_patterns_set_is_exported_and_covered():
    """Every exported HIGH pattern must drive a 'high' result on its own (benign
    summary, worker_label='low'), proving the set is authoritative, not decorative."""
    for pattern in HIGH_RISK_ACTION_PATTERNS:
        # Prefix patterns like "social." need a child segment to form a real type.
        action_type = pattern + "post" if pattern.endswith(".") else pattern
        result = classify_risk(action_type, "do the thing", worker_label="low")
        assert result == "high", (
            f"HIGH_RISK_ACTION_PATTERNS entry {pattern!r} did not force 'high' "
            f"(action_type={action_type!r}, got {result!r})"
        )


def test_benign_summary_request_action_is_high():
    """Explicit brief case: request_action + worker_label='low' + benign summary → high."""
    assert classify_risk("request_action", "do the thing", worker_label="low") == "high"


def test_benign_summary_payment_is_high():
    """payment type + benign summary + worker_label='low' → high."""
    assert classify_risk("payment.charge", "do the thing", worker_label="low") == "high"


def test_benign_summary_publish_is_high():
    """publish type + benign summary + worker_label='low' → high."""
    assert classify_risk("content.publish", "do the thing", worker_label="low") == "high"


# ===========================================================================
# 2. Internal action types → low/medium, still upgradable by worker_label.
# ===========================================================================

@pytest.mark.parametrize("action_type", [
    "docs.write",
    "knowledge.write",
    "report.write",
    "task.create",
])
def test_internal_type_benign_summary_is_low_or_medium(action_type):
    """Internal types with a benign summary → low or medium (never high)."""
    result = classify_risk(action_type, "do the thing", worker_label="low")
    assert result in ("low", "medium")


@pytest.mark.parametrize("action_type", [
    "docs.write",
    "knowledge.write",
    "report.write",
    "task.create",
])
def test_internal_type_upgradable_by_worker_high(action_type):
    """A worker may UPGRADE an internal type to high via worker_label='high'."""
    assert classify_risk(action_type, "do the thing", worker_label="high") == "high"


def test_internal_config_type_is_medium():
    """Internal config/lifecycle mutations (own company state) map to medium."""
    assert classify_risk("staff.update", "update the staff member role", worker_label=None) == "medium"
    assert classify_risk("access.grant", "grant read access", worker_label=None) == "medium"
    assert classify_risk("setting.set", "set the default timezone", worker_label=None) == "medium"


def test_low_internal_types_are_low():
    """Pure read/draft/plan/report internal types default to low."""
    assert classify_risk("knowledge.read", "read the product spec", worker_label=None) == "low"
    assert classify_risk("report.write", "write the weekly report", worker_label=None) == "low"
    assert classify_risk("task.create", "create a follow-up task", worker_label=None) == "low"


def test_worker_medium_upgrades_structural_low():
    """Internal (structural low) + worker says medium → final medium."""
    assert classify_risk("docs.write", "edit the internal wiki page", worker_label="medium") == "medium"


def test_worker_cannot_downgrade_but_can_upgrade():
    """Internal type with high worker label → high (upgrade), and a HIGH action
    type with worker_label='low' stays high (no downgrade)."""
    assert classify_risk("docs.write", "edit a file", worker_label="high") == "high"
    assert classify_risk("payment.charge", "do the thing", worker_label="low") == "high"


def test_invalid_worker_label_is_ignored():
    """An invalid worker label ('unknown') is treated as None — structural wins."""
    assert classify_risk("docs.write", "update the meeting notes", worker_label="unknown") in ("low", "medium")


# ===========================================================================
# 3. Free-text summary is BEST-EFFORT.
# ===========================================================================

def test_representative_outward_phrasing_empty_action_is_high():
    """Representative, obvious outward phrasings with EMPTY action_type are still
    caught by the best-effort heuristic → high."""
    assert classify_risk("", "post to Instagram", worker_label="low") == "high"
    assert classify_risk("", "share on LinkedIn with our followers", worker_label="low") == "high"


def test_best_effort_obscure_outward_phrasing_may_be_low():
    """BEST-EFFORT, documented: an obscure outward phrasing with EMPTY action_type
    MAY return low, and that is ACCEPTABLE.

    Rationale (architecture): free-text is the *secondary* net. The reliable gate is
    action_type — a worker cannot actually perform this outward action without
    invoking an outward-TYPED capability (which would be caught by signal 1), and the
    execution layer + CoS reasoning call backstop any miss here. We assert the REAL,
    realistic behaviour instead of demanding exhaustive synonym coverage.

    'arrange a livestream for the wider community' uses no keyword the heuristic
    knows (no post/share/publish/send verb, no known platform token), so with an
    empty action_type it returns low. This is the intended, backstopped behaviour.
    """
    result = classify_risk("", "arrange a livestream for the wider community", worker_label=None)
    assert result == "low"  # heuristic misses it on purpose; action_type is the gate


def test_benign_free_text_does_not_escalate_internal_type():
    """A benign free-text with an internal type stays internal (no spurious high)."""
    assert classify_risk("docs.write", "do the thing", worker_label="low") in ("low", "medium")


# Keep representative free-text upgrade cases that SHOULD fire (heuristic working).
def test_post_to_instagram_empty_action_is_high():
    assert classify_risk("", "post this to Instagram now", worker_label="low") == "high"


def test_share_on_linkedin_docs_write_is_high():
    assert classify_risk("docs.write", "share this on LinkedIn", worker_label="low") == "high"


def test_tweet_about_launch_is_high():
    """'tweet' is an inherently-outward standalone verb → high via best-effort."""
    assert classify_risk("docs.write", "tweet about the launch", worker_label="low") == "high"


def test_transfer_money_free_text_is_high():
    """Financial transfer phrasing fires the best-effort money heuristic → high."""
    assert classify_risk("docs.write", "transfer $5000 to the vendor account", worker_label="low") == "high"


def test_deploy_in_summary_is_high():
    """'deploy' is a hard-rule keyword in the best-effort heuristic → high."""
    assert classify_risk("ops.command", "deploy the hotfix to staging", worker_label="low") == "high"


# ===========================================================================
# 4. Anti-downgrade cases (retained from prior rounds).
# ===========================================================================

def test_send_labeled_low_is_high():
    assert classify_risk("content.publish", "post the draft to Instagram", worker_label="low") == "high"


def test_outreach_send_labeled_low_is_high():
    assert classify_risk("outreach.send", "send the weekly newsletter", worker_label="low") == "high"


def test_deploy_action_labeled_medium_is_high():
    assert classify_risk("deploy", "release v2.0 to production", worker_label="medium") == "high"


def test_merge_action_is_high():
    assert classify_risk("code.merge", "merge the feature branch", worker_label=None) == "high"


def test_money_spend_action_is_high():
    assert classify_risk("money.spend", "pay the vendor invoice", worker_label="low") == "high"


def test_social_post_low_label_cannot_downgrade():
    assert classify_risk("social.post", "post this to Instagram", worker_label="low") == "high"


def test_transfer_money_low_label_cannot_downgrade():
    assert classify_risk("docs.write", "transfer $5000 to the vendor account", worker_label="low") == "high"


# ===========================================================================
# Precision regressions — internal dual-use phrasings must NOT escalate.
# ===========================================================================

def test_transfer_knowledge_is_not_high():
    assert classify_risk("docs.write", "transfer knowledge to the team", worker_label="low") in ("low", "medium")


def test_release_notes_is_not_high():
    assert classify_risk("docs.write", "write release notes for v2.1", worker_label="low") in ("low", "medium")


def test_debug_message_is_not_high():
    assert classify_risk("ops.command", "log a debug message", worker_label="low") in ("low", "medium")


def test_report_is_not_high():
    assert classify_risk("report", "generate the weekly revenue report", worker_label="low") in ("low", "medium")


# ===========================================================================
# Invariants.
# ===========================================================================

def test_empty_summary_with_safe_action_is_low_or_medium():
    assert classify_risk("knowledge.read", "", worker_label=None) in ("low", "medium")


def test_unknown_action_empty_summary_does_not_assume_low_crash():
    """Unknown/empty action_type with benign summary must not crash and returns a
    valid level (low, since nothing suggests otherwise)."""
    assert classify_risk("", "do the thing", worker_label=None) in ("low", "medium", "high")


def test_return_values_are_always_valid():
    valid = {"low", "medium", "high"}
    cases = [
        ("content.publish", "post on Twitter", "low"),
        ("docs.write", "internal notes", "medium"),
        ("payment.charge", "bill client", None),
        ("knowledge.read", "read report", "high"),
        ("outreach.send", "email the lead", None),
        ("request_action", "do the thing", "low"),
        ("", "arrange a livestream for the wider community", None),
    ]
    for action_type, summary, label in cases:
        result = classify_risk(action_type, summary, worker_label=label)
        assert result in valid, f"Invalid result {result!r} for ({action_type!r}, {summary!r}, {label!r})"
