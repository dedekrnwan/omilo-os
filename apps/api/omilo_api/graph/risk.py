"""Escalation router for the Chief-of-Staff (CoS) vs. owner-approval decision.

What this function IS
---------------------
``classify_risk`` routes an action to the right approval path: a "low"/"medium"
result means the CoS can auto-handle it; a "high" result means it needs explicit
owner approval. That is the ENTIRE job of this function. It is a router, not a gate.

What this function is NOT
-------------------------
It is NOT the sole safety net, and it does not need to parse free-text prose
perfectly. Outward / dangerous actions are already constrained by two independent
layers that do not depend on this function at all:

1. The execution engine hard-blocks world-changing shell commands (rm, sudo,
   git push, npm/pnpm/yarn publish, docker push, kubectl, terraform apply,
   vercel/netlify/fly deploy, gh pr merge, gh release, ssh, scp, ...) regardless
   of what this classifier returns — see ``SHELL_DENY`` in
   ``omilo_api/engines/claude_code.py``.
2. Every outward side-effect is routed through a structured, typed capability
   (``request_action`` / ``propose`` with a specific ``action_type``). A worker
   CANNOT perform an outward action without invoking an outward-TYPED capability.
   The free-text ``summary`` is cosmetic — a worker could word it anything — so it
   is NOT a reliable signal.

The final semantic judgment lives in the CoS reasoning call (a later task).

Signal model (architecture)
---------------------------
Risk is the MAX (low < medium < high) of three signals:

1. ``action_type`` — AUTHORITATIVE and complete over the known taxonomy. This is
   the reliable signal because a worker must invoke an outward-typed capability to
   cause an outward effect. See ``HIGH_RISK_ACTION_PATTERNS``.
2. ``worker_label`` — a valid label may only UPGRADE the result, never downgrade.
3. ``summary`` — BEST-EFFORT secondary hint only. It can UPGRADE to "high" when the
   outward-verb+target / hard-keyword heuristic matches, but it is explicitly NOT
   exhaustive. Its misses are backstopped by ``action_type`` + the execution layer +
   the CoS call. We do not chase synonym coverage here.

Exports
-------
``HIGH_RISK_ACTION_PATTERNS`` and ``HARD_RULE_PATTERNS`` (the outward/free-text
constants) are exported for reuse by the Task 4 delegation gate.

Usage
-----
    from omilo_api.graph.risk import classify_risk, HIGH_RISK_ACTION_PATTERNS

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


# ===========================================================================
# SIGNAL 1 — action_type (AUTHORITATIVE)
# ===========================================================================
#
# The reliable signal. A worker cannot perform an outward/irreversible-external
# effect without invoking a capability whose action_type denotes that category.
# This set is intended to be COMPLETE over the taxonomy of outward/spend/deploy/
# merge/production action types — not best-effort.
#
# Matching rule (see _action_type_is_high): an action_type is HIGH if, after
# lower-casing, it EQUALS, STARTS WITH, or CONTAINS (as a dotted/word segment)
# any pattern below. Dotted action types (e.g. "content.publish", "social.post",
# "ops.deploy.prod") and bare verbs (e.g. "publish", "deploy") are both covered.
# ---------------------------------------------------------------------------
HIGH_RISK_ACTION_PATTERNS: frozenset[str] = frozenset({
    # --- outward side-effect routing (structured escalation capability) ---
    "request_action",
    # --- publish / broadcast / social ---
    "publish",
    "post",
    "share",
    "social",
    "broadcast",
    "content.publish",   # explicit existing taxonomy prefixes (kept for clarity)
    "content.share",
    "social.",
    # --- outward messaging ---
    "send",
    "message",
    "email",
    "sms",
    "dm",
    "outreach",
    # --- deploy / release / merge (irreversible-external to prod) ---
    "deploy",
    "release",
    "merge",
    "production",
    # --- spend / money movement ---
    "pay",
    "payment",
    "charge",
    "purchase",
    "refund",
    "transfer",
    "spend",
})

# Pre-compiled: match a pattern as a whole dotted/word segment inside the
# action_type. We split the action_type on "." and non-word chars and also do a
# substring check for prefix-style patterns (those ending in ".").
_HIGH_ACTION_WORD_PATTERNS: tuple[tuple[str, re.Pattern[str] | None], ...] = tuple(
    (
        p,
        # Prefix-style patterns (ending in ".") are handled via startswith, no regex.
        None if p.endswith(".") else re.compile(r"\b" + re.escape(p) + r"\b", re.IGNORECASE),
    )
    for p in HIGH_RISK_ACTION_PATTERNS
)


def _action_type_is_high(action_type: str) -> bool:
    """Return True if the structured action_type denotes an outward/spend/deploy/
    merge/production category. AUTHORITATIVE signal — complete over the taxonomy."""
    if not action_type:
        return False
    a = action_type.lower()
    for pattern, word_re in _HIGH_ACTION_WORD_PATTERNS:
        if pattern.endswith("."):
            # Prefix form like "social." — match "social.post", "social.dm", etc.
            if a == pattern.rstrip(".") or a.startswith(pattern):
                return True
            continue
        # Equality / dotted-prefix fast paths.
        if a == pattern or a.startswith(pattern + ".") or a.endswith("." + pattern):
            return True
        # Segment / word-boundary match: covers "ops.deploy.prod", "custom.publish",
        # "payment_charge", "requestAction"-style spellings via \b.
        if f".{pattern}." in f".{a}." or (word_re is not None and word_re.search(a)):
            return True
    return False


# ===========================================================================
# SIGNAL 1b — internal action_type mapping (low vs. medium)
# ===========================================================================
#
# Internal action types that are NOT outward/spend/deploy. They change the
# company's OWN state only, so the CoS can auto-handle them.
#
#   LOW     — reads, drafts, planning, reporting, task bookkeeping, questions,
#             checkpoints. No state change that's hard to reverse internally.
#   MEDIUM  — multi-step / ambiguous internal config changes: staff lifecycle,
#             access grants, settings. These mutate the company's own
#             configuration (but are not outward or spend), so they warrant a
#             slightly higher internal bar than a plain doc write.
# ---------------------------------------------------------------------------

# LOW internal types (equality or dotted-prefix match).
_LOW_ACTION_PATTERNS: tuple[str, ...] = (
    "docs.write",
    "knowledge.write",
    "knowledge.read",
    "kpi.write",
    "report.write",
    "report",          # report.* family → low
    "task.create",
    "task",            # task.* family → low
    "question",        # question.* family → low
    "checkpoint",
)

# MEDIUM internal types — internal config/lifecycle mutations (own company state).
_MEDIUM_ACTION_PATTERNS: tuple[str, ...] = (
    "staff.update",
    "staff.create",
    "staff.retire",
    "staff.delegate",
    "staff",           # other staff.* → medium
    "access.grant",
    "access",          # access.* → medium
    "setting.set",
    "setting",         # setting.* → medium
    "settings",
    # Legacy medium-complexity prefixes retained from the prior structural read.
    "ops.",
    "code.",
    "connector.",
    "skill.",
    "kpi.",
    "db.",
    "pricing.",
)


def _action_matches(action_type: str, patterns: tuple[str, ...]) -> bool:
    """True if action_type equals a pattern, is a dotted child of it, or (for
    prefix patterns ending in '.') starts with it."""
    a = action_type.lower()
    for p in patterns:
        if p.endswith("."):
            if a == p.rstrip(".") or a.startswith(p):
                return True
        elif a == p or a.startswith(p + "."):
            return True
    return False


def _action_type_internal_level(action_type: str) -> str | None:
    """Return 'low'/'medium' for a known internal action_type, or None if the
    action_type is unknown/empty (defer to summary heuristic)."""
    if not action_type:
        return None
    if _action_matches(action_type, _LOW_ACTION_PATTERNS):
        return "low"
    if _action_matches(action_type, _MEDIUM_ACTION_PATTERNS):
        return "medium"
    return None


# ===========================================================================
# SIGNAL 3 — free-text summary (BEST-EFFORT upgrade only)
# ===========================================================================
#
# This is the secondary net. It can UPGRADE to "high" when it matches, but it is
# explicitly NOT exhaustive and its misses are acceptable because action_type +
# the execution layer + the CoS call backstop it. We keep the heuristic that was
# already built; we do NOT try to chase synonym coverage.
#
# ``HARD_RULE_PATTERNS`` and the outward verb/target sets remain exported for the
# Task 4 gate.
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

# Pre-compiled word-boundary patterns for each keyword to avoid repeated compilation.
_COMPILED_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b" + re.escape(kw) + r"\b", re.IGNORECASE)
    for kw in HARD_RULE_PATTERNS
]

# ---------------------------------------------------------------------------
# Context-sensitive patterns (dual-use words)
# ---------------------------------------------------------------------------

# "post" as an outward action: "post to/on", "post this/it/the", "posting to/on".
_POST_OUTWARD_PATTERN: re.Pattern[str] = re.compile(
    r"\bpost(?:\s+\w+){0,2}\s+(?:to|on)\b"
    r"|\bpost\s+(?:this|it|the)\b"
    r"|\bpost(?:ing)?\s+(?:to|on)\b",
    re.IGNORECASE,
)

# "transfer" in a money/account context.
_TRANSFER_MONEY_TOKENS: re.Pattern[str] = re.compile(
    r"\$\d"
    r"|\b\d+\s*(?:usd|eur|gbp|idr|k|million)\b"
    r"|\bfunds?\b"
    r"|\bmoney\b"
    r"|\baccount\b"
    r"|\bwire\b"
    r"|\bbalance\b"
    r"|\bpayment\b",
    re.IGNORECASE,
)
_TRANSFER_VERB_PATTERN: re.Pattern[str] = re.compile(r"\btransfer\b", re.IGNORECASE)

# "message" in an outward-action context.
_MESSAGE_OUTWARD_PATTERN: re.Pattern[str] = re.compile(
    r"\bmessage\s+(?:the\s+)?(?:client|customer|user|subscriber|lead|team|member|vendor|partner)\b"
    r"|\bmessage\s+@\w+"
    r"|\b(?:whatsapp|slack|telegram|sms|text)\s+message\b"
    r"|\bsend\s+(?:a\s+)?message\b",
    re.IGNORECASE,
)
# Explicitly safe "message" patterns — these do NOT escalate.
_MESSAGE_SAFE_PATTERN: re.Pattern[str] = re.compile(
    r"\b(?:log|debug|error|commit|queue|template|format|draft|system|status)\s+message\b"
    r"|\bmessage\s+(?:template|queue|format|log|schema|type|handler|broker|bus)\b",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Outward-verb × platform/target generalisation (best-effort).
# ---------------------------------------------------------------------------

_OUTWARD_VERBS: frozenset[str] = frozenset({
    "post", "share", "publish", "tweet", "broadcast", "announce",
    "dm", "message", "send", "upload", "reply", "comment",
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
    "instagram", "twitter", "linkedin", "facebook", "tiktok",
    "youtube", "threads", "reddit", "whatsapp", "telegram",
    "social media", "social",
    "publicly", "public", "the public",
    "blog", "newsletter",
    "audience", "subscribers", "followers",
    "the client", "the customer", "the customers",
    "client", "customer", "customers",
    "clients",
})

_OUTWARD_VERB_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b" + re.escape(v) + r"\b", re.IGNORECASE)
    for v in _OUTWARD_VERBS
]

_OUTWARD_TARGET_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b" + re.escape(t) + r"\b", re.IGNORECASE)
    for t in sorted(_OUTWARD_TARGETS, key=len, reverse=True)
]

_STANDALONE_OUTWARD_VERB_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\b" + re.escape(v) + r"\b", re.IGNORECASE)
    for v in (
        "tweet", "tweets", "tweeting", "tweeted",
        "broadcast", "broadcasts", "broadcasting", "broadcasted",
    )
]


def _is_outward_verb_plus_target(summary: str) -> bool:
    """Return True when the summary pairs an outward verb with an outward target."""
    has_verb = any(p.search(summary) for p in _OUTWARD_VERB_PATTERNS)
    if not has_verb:
        return False
    return any(p.search(summary) for p in _OUTWARD_TARGET_PATTERNS)


def _is_standalone_outward_verb(summary: str) -> bool:
    """Return True for verbs that are inherently outward even without a target."""
    return any(p.search(summary) for p in _STANDALONE_OUTWARD_VERB_PATTERNS)


# "release" in deploy/money context only.
_RELEASE_DANGEROUS_PATTERN: re.Pattern[str] = re.compile(
    r"\breleas(?:e|ing)\s+(?:to\s+)?(?:production|prod|staging|live|app|build|version|the\s+build|the\s+update|the\s+app|the\s+version)\b"
    r"|\breleas(?:e|ing)\s+(?:the\s+)?(?:build|update|app|version|software|binary|artifact)\b"
    r"|\breleas(?:e|ing)\s+(?:funds?|payment)\b",
    re.IGNORECASE,
)
_RELEASE_SAFE_PATTERN: re.Pattern[str] = re.compile(
    r"\brelease\s+(?:notes?|timeline|date|cadence|plan|schedule|process|strategy|candidate)\b"
    r"|\brelease\s+notes?\b",
    re.IGNORECASE,
)


def _is_context_sensitive_hard_rule(summary: str) -> bool:
    """Return True if a context-sensitive dual-use word fires in its dangerous sense."""
    if _is_outward_verb_plus_target(summary):
        if not _MESSAGE_SAFE_PATTERN.search(summary):
            return True

    if _is_standalone_outward_verb(summary):
        return True

    if _POST_OUTWARD_PATTERN.search(summary):
        return True

    if _TRANSFER_VERB_PATTERN.search(summary) and _TRANSFER_MONEY_TOKENS.search(summary):
        return True

    if _MESSAGE_OUTWARD_PATTERN.search(summary) and not _MESSAGE_SAFE_PATTERN.search(summary):
        return True

    if _RELEASE_DANGEROUS_PATTERN.search(summary) and not _RELEASE_SAFE_PATTERN.search(summary):
        return True

    return False


def _summary_suggests_high(summary: str) -> bool:
    """BEST-EFFORT: return True if the free-text summary looks like an outward /
    spend / deploy action. NOT exhaustive — misses are acceptable and backstopped
    by action_type + the execution layer + the CoS call."""
    if not summary:
        return False
    for pattern in _COMPILED_PATTERNS:
        if pattern.search(summary):
            return True
    return _is_context_sensitive_hard_rule(summary)


# ---------------------------------------------------------------------------
# Medium-signal summary keywords (multi-step internal work).
# ---------------------------------------------------------------------------

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


def _summary_suggests_medium(summary: str) -> bool:
    """Return True if the summary hints at multi-step/ambiguous internal work."""
    return any(p.search(summary) for p in _MEDIUM_SUMMARY_PATTERNS)


# ===========================================================================
# Public API
# ===========================================================================

def classify_risk(
    action_type: str,
    summary: str,
    worker_label: str | None = None,
) -> str:
    """Route an action to CoS auto-handle ("low"/"medium") vs. owner approval ("high").

    Risk is the MAX (low < medium < high) of three signals:

    1. ``action_type`` — AUTHORITATIVE. If it denotes an outward/spend/deploy/merge/
       production category (see ``HIGH_RISK_ACTION_PATTERNS``) the result is "high"
       regardless of ``summary`` or ``worker_label``. Known internal types map to
       "low" or "medium". Unknown/empty action_type defers to the summary heuristic.
    2. ``worker_label`` — a valid "low"/"medium"/"high" may only UPGRADE the result,
       never downgrade. Invalid / None is ignored.
    3. ``summary`` — BEST-EFFORT secondary hint. It may UPGRADE to "high" when the
       outward heuristic matches, but it is NOT exhaustive. Its misses are acceptable
       because action_type + the execution-layer denials + the CoS call backstop it.

    This function is a ROUTER, not the sole enforcement — the hard guarantees live in
    ``omilo_api/engines/claude_code.py`` (SHELL_DENY), ``request_action`` routing, and
    the CoS reasoning call.

    Returns
    -------
    str
        One of "low", "medium", "high".
    """
    # --- Signal 1: action_type (authoritative). ---
    if _action_type_is_high(action_type):
        return "high"

    internal = _action_type_internal_level(action_type)

    # --- Signal 3: best-effort free-text can UPGRADE to high. ---
    if _summary_suggests_high(summary):
        structural = "high"
    elif internal is not None:
        # Known internal type: start from its mapping, let summary bump low→medium.
        structural = internal
        if structural == "low" and _summary_suggests_medium(summary):
            structural = "medium"
    else:
        # Unknown/empty action_type → do NOT assume low; derive from summary.
        structural = "medium" if _summary_suggests_medium(summary) else "low"

    # --- Signal 2: worker_label may only upgrade (max), never downgrade. ---
    if worker_label in _LEVEL_RANK:
        return _max_level(structural, worker_label)

    return structural
