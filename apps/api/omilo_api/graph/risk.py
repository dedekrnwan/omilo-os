"""Structural risk classifier.

The worker's self-reported label is a HINT, never the authority. Hard-rule categories
always escalate to "high" regardless of what the worker claims. This module is the
single source of truth for those categories — reused by Task 4 (delegation gate) and
future tasks.

Usage
-----
    from omilo_api.graph.risk import classify_risk, HARD_RULE_PATTERNS

    level = classify_risk(action_type, summary, worker_label=proposal.risk)
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Severity ordering
# ---------------------------------------------------------------------------

_LEVELS = ("low", "medium", "high")
_LEVEL_RANK: dict[str, int] = {level: i for i, level in enumerate(_LEVELS)}


def _max_level(*levels: str) -> str:
    """Return the highest severity among the given levels."""
    return max(levels, key=lambda lvl: _LEVEL_RANK.get(lvl, -1))


# ---------------------------------------------------------------------------
# Hard-rule patterns — ONE shared constant for the whole package
#
# Design constraints:
#   - Match case-insensitively.
#   - Use word-boundary anchors (\b) to avoid substring false positives:
#       "report"     must NOT match via "port"
#       "ambassador" must NOT match via any word inside it
#       "expenditure" must NOT match via "spend" (different word)
#   - "deploy" / "deployment" ARE hard-rule words because deploying to any environment
#     (even staging) is a production-adjacent, irreversible side effect that requires
#     owner approval.
#   - "spend" matches "spend" and "spending" (same root) but NOT "expenditure" or
#     "independent" — the \b anchor handles this correctly.
#   - "send" matches "send" and "sending" but NOT "ambassador" or "recommend".
#   - "tweet" and "dm" are included as common outward-action verbs.
#   - "invoice" and "refund" are money-adjacent.
#
# Each entry is compiled into a word-boundary regex for efficient matching.
# ---------------------------------------------------------------------------

# Flat set of hard-rule keyword stems (matched with \b on each side).
HARD_RULE_PATTERNS: frozenset[str] = frozenset({
    # --- outward / send ---
    "send",
    "sending",
    "email",
    "message",
    "dm",
    "tweet",
    "publish",
    # --- spend / money ---
    "pay",
    "paying",
    "charge",
    "purchase",
    "transfer",
    "invoice",
    "refund",
    "spend",
    "spending",
    # --- merge ---
    "merge",
    # --- deploy / release ---
    "deploy",
    "deploying",
    "deployment",
    "release",
    "releasing",
    # --- production ---
    "production",
})

# Action-type prefix patterns — if action_type starts with or equals any of these,
# it is a hard-rule category. Checked against the full action_type string, not just
# individual words, because action types use dot-notation (e.g. "content.publish").
_HARD_RULE_ACTION_PREFIXES: tuple[str, ...] = (
    "content.publish",
    "outreach.send",
    "payment",
    "money.spend",
    "code.merge",
    "deploy",
    "ops.deploy",
    "release",
)

# Pre-compiled word-boundary patterns for each keyword to avoid repeated compilation.
_COMPILED_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b" + re.escape(kw) + r"\b", re.IGNORECASE)
    for kw in HARD_RULE_PATTERNS
]

# Note: "post" (noun — blog post, postmortem) is intentionally NOT in the keyword set.
# "publish" covers the outward-action case; bare "post" produces too many false positives
# in internal content descriptions ("draft a blog post", "post-mortem review").


# ---------------------------------------------------------------------------
# Internal: hard-rule detection
# ---------------------------------------------------------------------------

def _is_hard_rule(action_type: str, summary: str) -> bool:
    """Return True if the action type or summary triggers a hard-rule category."""
    action_lower = action_type.lower()

    # 1. Exact / prefix match on the structured action type (most reliable signal).
    for prefix in _HARD_RULE_ACTION_PREFIXES:
        if action_lower == prefix or action_lower.startswith(prefix + ".") or action_lower.startswith(prefix):
            return True

    # 2. Keyword scan on the summary using word-boundary patterns.
    for pattern in _COMPILED_PATTERNS:
        if pattern.search(summary):
            return True

    # 3. Also keyword-scan the action_type string itself (e.g. "outreach.send",
    #    "custom.deploy.prod") to catch novel dotted types not in the prefix list.
    for pattern in _COMPILED_PATTERNS:
        if pattern.search(action_type):
            return True

    return False


# ---------------------------------------------------------------------------
# Internal: structural read — what the classifier itself thinks
# ---------------------------------------------------------------------------

# Keywords in the summary or action type that suggest medium complexity
# (multi-step internal changes, ambiguous scope).
_MEDIUM_ACTION_PREFIXES: tuple[str, ...] = (
    "ops.",
    "code.",
    "staff.",
    "connector.",
    "skill.",
    "kpi.",
    "knowledge.write",
    "db.",
    "pricing.",
)

_MEDIUM_SUMMARY_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b" + re.escape(kw) + r"\b", re.IGNORECASE)
    for kw in (
        "migrate",
        "migration",
        "schema",
        "refactor",
        "restructure",
        "overhaul",
        "bulk",
        "batch",
        "all records",
        "all users",
    )
]


def _structural_read(action_type: str, summary: str) -> str:
    """Return the classifier's own risk estimate ('low' or 'medium') for non-hard-rule actions."""
    action_lower = action_type.lower()

    # Check for medium-risk action type prefixes.
    for prefix in _MEDIUM_ACTION_PREFIXES:
        if action_lower.startswith(prefix) or action_lower == prefix.rstrip("."):
            return "medium"

    # Check for medium-risk summary keywords.
    for pattern in _MEDIUM_SUMMARY_PATTERNS:
        if pattern.search(summary):
            return "medium"

    # Default for clearly internal actions (drafts, reads, planning, file edits).
    return "low"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def classify_risk(
    action_type: str,
    summary: str,
    worker_label: str | None = None,
) -> str:
    """Return "low" | "medium" | "high".

    The worker's self-reported label (worker_label) is a HINT, never the authority:

    - Hard-rule categories always return "high" regardless of worker_label.  These are
      actions that send externally, spend money, merge code, deploy/release software,
      or touch production.

    - For all other actions, the final level is the MAX of:
        (a) the classifier's own structural read (based on action_type and summary), and
        (b) a *valid* worker_label ("low" | "medium" | "high").

      This means a worker may UPGRADE the risk level (e.g. label something "high" when
      the structural read is "low") but may NEVER DOWNGRADE below the structural read.

    An invalid or None worker_label is silently ignored.

    Parameters
    ----------
    action_type:
        The structured action identifier, e.g. "content.publish", "docs.write",
        "payment.charge".  Used for prefix matching against hard-rule categories.
    summary:
        A natural-language description of the proposed action.  Scanned for hard-rule
        keywords and structural signals.
    worker_label:
        The worker's self-reported risk level, or None.  Ignored if not one of
        "low", "medium", "high".

    Returns
    -------
    str
        One of "low", "medium", "high".
    """
    # Rule 1: hard-rule categories always escalate, label is irrelevant.
    if _is_hard_rule(action_type, summary):
        return "high"

    # Rule 2: structural read + optional worker upgrade (max, never downgrade).
    structural = _structural_read(action_type, summary)

    if worker_label in _LEVEL_RANK:
        return _max_level(structural, worker_label)

    return structural
