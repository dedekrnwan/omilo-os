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
#   - "transfer", "message", "release" are context-sensitive (see _CONTEXT_SENSITIVE_PATTERNS).
#
# Each entry is compiled into a word-boundary regex for efficient matching.
# ---------------------------------------------------------------------------

# Flat set of hard-rule keyword stems (matched with \b on each side).
# NOTE: "transfer", "message", "release" are intentionally excluded here;
# they are handled via context-sensitive patterns below to avoid false positives
# on internal usages ("transfer knowledge", "release notes", "log a debug message").
HARD_RULE_PATTERNS: frozenset[str] = frozenset({
    # --- outward / send ---
    "send",
    "sending",
    "email",
    "dm",
    "tweet",
    "publish",
    # --- spend / money ---
    "pay",
    "paying",
    "charge",
    "purchase",
    "invoice",
    "refund",
    "spend",
    "spending",
    # --- merge ---
    "merge",
    # --- deploy ---
    "deploy",
    "deploying",
    "deployment",
    # --- production ---
    "production",
})

# Action-type prefix patterns — if action_type starts with or equals any of these,
# it is a hard-rule category. Checked against the full action_type string, not just
# individual words, because action types use dot-notation (e.g. "content.publish").
_HARD_RULE_ACTION_PREFIXES: tuple[str, ...] = (
    "content.publish",
    "content.share",
    "social.",
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

# ---------------------------------------------------------------------------
# Context-sensitive patterns
#
# These words are "dual-use": they can mean something benign in internal contexts
# or something dangerous in outward/financial/deploy contexts. We require nearby
# context tokens to confirm the dangerous sense.
# ---------------------------------------------------------------------------

# "post" as an outward action: matches "post to", "post on", "post this", "post it",
# "post the" — within a short window. Does NOT match "blog post", "job post",
# "post-mortem", "postmortem" (those are noun forms).
# Pattern: \bpost\b followed within ~3 words by (to|on|this|it|the) OR preceded by
# "post to"/"post on"/"post this"/"post it".
_POST_OUTWARD_PATTERN: re.Pattern[str] = re.compile(
    r"\bpost(?:\s+\w+){0,2}\s+(?:to|on)\b"           # "post to", "post this to", "post it on"
    r"|\bpost\s+(?:this|it|the)\b"                     # "post this", "post it", "post the"
    r"|\bpost(?:ing)?\s+(?:to|on)\b",                  # "posting to", "posting on"
    re.IGNORECASE,
)

# "transfer" in a money/account context:
# Requires a nearby money/account token within the same sentence fragment.
_TRANSFER_MONEY_TOKENS: re.Pattern[str] = re.compile(
    r"\$\d"                         # dollar amount
    r"|\b\d+\s*(?:usd|eur|gbp|idr|k|million)\b"  # numeric + currency
    r"|\bfunds?\b"
    r"|\bmoney\b"
    r"|\baccount\b"
    r"|\bwire\b"
    r"|\bbalance\b"
    r"|\bpayment\b",
    re.IGNORECASE,
)
_TRANSFER_VERB_PATTERN: re.Pattern[str] = re.compile(r"\btransfer\b", re.IGNORECASE)

# "message" in an outward-action context: must have an outward target or platform word.
_MESSAGE_OUTWARD_PATTERN: re.Pattern[str] = re.compile(
    # "send a message to X" — "send" already catches this, but "message" alone with target:
    r"\bmessage\s+(?:the\s+)?(?:client|customer|user|subscriber|lead|team|member|vendor|partner)\b"
    r"|\bmessage\s+@\w+"                              # "message @username"
    r"|\b(?:whatsapp|slack|telegram|sms|text)\s+message\b"  # platform + message
    r"|\bsend\s+(?:a\s+)?message\b",                  # "send a message" (belt-and-suspenders)
    re.IGNORECASE,
)
# Explicitly safe "message" patterns — these do NOT escalate even if the above misses them.
_MESSAGE_SAFE_PATTERN: re.Pattern[str] = re.compile(
    r"\b(?:log|debug|error|commit|queue|template|format|draft|system|status)\s+message\b"
    r"|\bmessage\s+(?:template|queue|format|log|schema|type|handler|broker|bus)\b",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Outward-verb × platform/target generalisation
#
# An OUTWARD VERB co-occurring with a SOCIAL/PUBLIC PLATFORM-OR-TARGET in the
# same summary string signals an external communication action and must be "high"
# regardless of worker_label.
#
# Design notes:
#   - Only match whole words (\b anchors).  "sharing" ≠ "haring"; "posted" is
#     covered via _OUTWARD_VERB_INFLECTIONS below.
#   - "x" as a platform is ambiguous; we omit it and rely on "twitter" instead.
#   - "message" is listed here as an outward verb but the existing safe-pattern
#     check (_MESSAGE_SAFE_PATTERN) is still preserved by applying it separately.
#     To keep this simple, the verb+target rule fires on "message" only; the
#     standalone "message" without a target still goes through the existing
#     _MESSAGE_OUTWARD_PATTERN path.
#   - "tweet"/"dm"/"broadcast"/"publish" already escalate via HARD_RULE_PATTERNS
#     or the standalone-verb list below; they are also listed here for clarity.
# ---------------------------------------------------------------------------

_OUTWARD_VERBS: frozenset[str] = frozenset({
    # base forms
    "post", "share", "publish", "tweet", "broadcast", "announce",
    "dm", "message", "send", "upload", "reply", "comment",
    # common inflections (past/present-participle/3rd-person)
    "posts", "posting", "posted",
    "shares", "sharing", "shared",
    "publishes", "publishing", "published",
    "tweets", "tweeting", "tweeted",
    "broadcasts", "broadcasting", "broadcasted",
    "announces", "announcing", "announced",
    "messages", "messaging", "messaged",
    "sends", "sending", "sent",
    "uploads", "uploading", "uploaded",
    "replies", "replying", "replied",
    "comments", "commenting", "commented",
    "dms", "dmed",
})

_OUTWARD_TARGETS: frozenset[str] = frozenset({
    # social platforms
    "instagram", "twitter", "linkedin", "facebook", "tiktok",
    "youtube", "threads", "reddit", "whatsapp", "telegram",
    # generic social
    "social media", "social",
    # public-facing concepts
    "publicly", "public", "the public",
    # publishing channels
    "blog", "newsletter",
    # audience descriptors
    "audience", "subscribers", "followers",
    # external stakeholders
    "the client", "the customer", "the customers",
    "client", "customer", "customers",
    "clients",
})

# Pre-compiled word-boundary patterns for outward verbs.
_OUTWARD_VERB_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b" + re.escape(v) + r"\b", re.IGNORECASE)
    for v in _OUTWARD_VERBS
]

# Pre-compiled patterns for outward targets (multi-word targets first so they
# match before their constituent words).
_OUTWARD_TARGET_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b" + re.escape(t) + r"\b", re.IGNORECASE)
    for t in sorted(_OUTWARD_TARGETS, key=len, reverse=True)  # longest first
]

# Standalone verbs that are ALWAYS outward, even without an explicit platform
# token (e.g. "tweet about the launch" is inherently public).
_STANDALONE_OUTWARD_VERB_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b" + re.escape(v) + r"\b", re.IGNORECASE)
    for v in (
        "tweet", "tweets", "tweeting", "tweeted",
        "broadcast", "broadcasts", "broadcasting", "broadcasted",
        # "publish"/"published" already in HARD_RULE_PATTERNS
        # "dm"/"dms" already in HARD_RULE_PATTERNS
    )
]


def _is_outward_verb_plus_target(summary: str) -> bool:
    """Return True when the summary pairs an outward verb with an outward target."""
    has_verb = any(p.search(summary) for p in _OUTWARD_VERB_PATTERNS)
    if not has_verb:
        return False
    has_target = any(p.search(summary) for p in _OUTWARD_TARGET_PATTERNS)
    return has_target


def _is_standalone_outward_verb(summary: str) -> bool:
    """Return True for verbs that are inherently outward even without a target."""
    return any(p.search(summary) for p in _STANDALONE_OUTWARD_VERB_PATTERNS)


# "release" in deploy/money context only:
_RELEASE_DANGEROUS_PATTERN: re.Pattern[str] = re.compile(
    r"\breleas(?:e|ing)\s+(?:to\s+)?(?:production|prod|staging|live|app|build|version|the\s+build|the\s+update|the\s+app|the\s+version)\b"
    r"|\breleas(?:e|ing)\s+(?:the\s+)?(?:build|update|app|version|software|binary|artifact)\b"
    r"|\breleas(?:e|ing)\s+(?:funds?|payment)\b",
    re.IGNORECASE,
)
# Safe "release" patterns — docs/planning, never code/money:
_RELEASE_SAFE_PATTERN: re.Pattern[str] = re.compile(
    r"\brelease\s+(?:notes?|timeline|date|cadence|plan|schedule|process|strategy|candidate)\b"
    r"|\brelease\s+notes?\b",
    re.IGNORECASE,
)


def _is_context_sensitive_hard_rule(summary: str) -> bool:
    """Return True if a context-sensitive dual-use word fires in its dangerous sense."""
    # --- Outward verb × platform/target generalisation ---
    # Must come before more specific checks so the broad rule fires first.
    # Note: "message" is in _OUTWARD_VERBS; we exclude it here when the summary
    # matches a known safe pattern to preserve dual-use precision.
    if _is_outward_verb_plus_target(summary):
        # Carve out: "log a debug message", "draft a message template", etc.
        # Those are caught by _MESSAGE_SAFE_PATTERN and their summaries will not
        # contain an outward TARGET (blog/social/customer/etc.), so in practice
        # the target check already guards them. Belt-and-suspenders: also apply
        # the safe-message check here.
        if not _MESSAGE_SAFE_PATTERN.search(summary):
            return True

    # --- Standalone always-outward verbs (tweet, broadcast) ---
    if _is_standalone_outward_verb(summary):
        return True

    # --- "post" as outward action ---
    if _POST_OUTWARD_PATTERN.search(summary):
        return True

    # --- "transfer" with money/account context ---
    if _TRANSFER_VERB_PATTERN.search(summary) and _TRANSFER_MONEY_TOKENS.search(summary):
        return True

    # --- "message" with outward target (safe patterns take precedence) ---
    if _MESSAGE_OUTWARD_PATTERN.search(summary) and not _MESSAGE_SAFE_PATTERN.search(summary):
        return True

    # --- "release" in deploy/money sense (safe patterns take precedence) ---
    if _RELEASE_DANGEROUS_PATTERN.search(summary) and not _RELEASE_SAFE_PATTERN.search(summary):
        return True

    return False


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

    # 3. Context-sensitive dual-use word detection on the summary.
    if _is_context_sensitive_hard_rule(summary):
        return True

    # 4. Also keyword-scan the action_type string itself (e.g. "outreach.send",
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
