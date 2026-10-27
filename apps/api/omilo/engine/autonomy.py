"""
Autonomy resolution and gate decision logic.

Pure functions — no DB, no IO. All inputs are passed in; functions are
deterministic and fully testable in isolation.

Canonical specification: docs/business/autonomy.md §2 (layering), §3.2 (matrix),
§4 (approve on behalf), §6 (SafetyLimits backstop).
"""
from __future__ import annotations

from typing import Literal

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Strict ordering: strict(0) < ask(1) < yolo(2).
#: min() over ORDER values = the strictest (least autonomous) dial position.
ORDER: dict[str, int] = {"strict": 0, "ask": 1, "yolo": 2}

# Invert ORDER for efficient lookup: index → key
_ORDER_INV: dict[int, str] = {v: k for k, v in ORDER.items()}

GateDecision = Literal["allowed", "needs_owner", "refused"]

# ---------------------------------------------------------------------------
# Safety limit kind → usage-dict key mapping
# Counted limits: compare usage[key] >= value → breach.
# Boolean limits: the action's proposal_type matches → breach (value=0 means blocked).
# ---------------------------------------------------------------------------

#: Maps SafetyLimit.kind → the key to look up in the usage dict.
_COUNTED_KIND_TO_USAGE_KEY: dict[str, str] = {
    "messages_day": "messages_today",
    "spend_day":    "spend_today",
    "spend_month":  "spend_month",
}

#: Boolean/typed limits: the SafetyLimit.kind matches a proposal_type directly.
_BOOLEAN_KINDS: frozenset[str] = frozenset({"deploy", "external_write"})


# ---------------------------------------------------------------------------
# effective_autonomy — §2 layering rule
# ---------------------------------------------------------------------------

def effective_autonomy(
    workspace: str,
    goal_override: str | None,
    helper_cap: str | None,
) -> str:
    """Return the effective autonomy — the MIN (strictest) over all SET layers.

    Args:
        workspace:      Workspace-level autonomy dial (always set; never None).
        goal_override:  Per-Goal override; None = not set (drops out of min).
        helper_cap:     Per-Helper cap; None = not set (drops out of min).

    Returns:
        One of "strict" | "ask" | "yolo" — the strictest of the participating layers.

    Spec: docs/business/autonomy.md §2.
    """
    layers = [workspace]
    if goal_override is not None:
        layers.append(goal_override)
    if helper_cap is not None:
        layers.append(helper_cap)

    # min over ORDER values = the most restrictive position
    min_index = min(ORDER[layer] for layer in layers)
    return _ORDER_INV[min_index]


# ---------------------------------------------------------------------------
# breaches_safety — §6 SafetyLimit breach detection
# ---------------------------------------------------------------------------

def breaches_safety(
    proposal_type: str,
    risk: str,  # noqa: ARG001 — accepted for symmetry, reserved for future use
    safety: list,
    usage: dict | None = None,
) -> bool:
    """Return True if any block-mode SafetyLimit is breached by this action.

    Args:
        proposal_type:  The type string of the action (e.g. "message", "deploy").
        risk:           Risk level of the action (accepted for API symmetry).
        safety:         List of SafetyLimit-like objects with .kind, .value,
                        .block_or_warn (duck-typed; ORM or SimpleNamespace both work).
        usage:          Usage counters dict (e.g. {"messages_today": 42}).
                        None is treated as empty.

    Returns:
        True if a block-mode limit would be breached; False otherwise.

    Spec: docs/business/autonomy.md §6.
    """
    if not safety:
        return False

    usage = usage or {}

    for limit in safety:
        # Only block-mode limits cause a breach
        if limit.block_or_warn != "block":
            continue

        kind = limit.kind
        value = limit.value

        # --- Counted limits (messages_day, spend_day, spend_month) ---
        if kind in _COUNTED_KIND_TO_USAGE_KEY:
            usage_key = _COUNTED_KIND_TO_USAGE_KEY[kind]
            # The limit applies to actions of the matching proposal_type
            matched_type = _kind_matches_proposal_type(kind, proposal_type)
            if matched_type:
                current = usage.get(usage_key, 0)
                if current >= value:
                    return True

        # --- Boolean limits (deploy, external_write) ---
        elif kind in _BOOLEAN_KINDS:
            # A zero-value block limit of this kind means the action type is blocked
            if kind == proposal_type and value == 0:
                return True

    return False


def _kind_matches_proposal_type(kind: str, proposal_type: str) -> bool:
    """Map a SafetyLimit.kind to the proposal_type(s) it governs.

    Mapping (per task spec):
        messages_day  → message (external)
        spend_day     → spend
        spend_month   → spend
        deploy        → deploy
        external_write → external_write
    """
    mapping: dict[str, str] = {
        "messages_day":  "message",
        "spend_day":     "spend",
        "spend_month":   "spend",
        "deploy":        "deploy",
        "external_write": "external_write",
    }
    return mapping.get(kind) == proposal_type


# ---------------------------------------------------------------------------
# decide — §3.2 decision matrix
# ---------------------------------------------------------------------------

def decide(
    effective: str,
    risk: str,
    proposal_type: str,
    safety: list,
    usage: dict | None = None,
) -> GateDecision:
    """Apply the autonomy decision matrix to a pending action.

    SafetyLimit backstop is evaluated FIRST: if a block-mode limit is
    breached, returns "refused" regardless of effective autonomy (even yolo).

    Decision matrix (§3.2, collapsed to gate verbs):
        risk=low:    strict→needs_owner  ask→allowed      yolo→allowed
        risk=medium: strict→needs_owner  ask→needs_owner  yolo→allowed
        risk=high:   strict→needs_owner  ask→needs_owner  yolo→allowed

    Under yolo, high-risk is auto-approved by the Chief (act-and-log) —
    bounded ONLY by SafetyLimits. This is the "locked decision" from the spec.

    Args:
        effective:      Resolved autonomy dial ("strict" | "ask" | "yolo").
        risk:           Action risk level ("low" | "medium" | "high").
        proposal_type:  Action type string (e.g. "message", "deploy").
        safety:         List of SafetyLimit-like objects (duck-typed).
        usage:          Usage counters dict. None = empty.

    Returns:
        GateDecision: "allowed" | "needs_owner" | "refused"

    Spec: docs/business/autonomy.md §3.2, §4, §6.
    """
    # --- SafetyLimit backstop: evaluated before anything else ---
    if breaches_safety(proposal_type, risk, safety, usage):
        return "refused"

    # --- Decision matrix ---
    # strict: every consequential action → needs_owner (Chief never approves)
    if effective == "strict":
        return "needs_owner"

    # ask: low → allowed (act-and-log); medium|high → needs_owner (chief for medium, operator for high)
    if effective == "ask":
        if risk == "low":
            return "allowed"
        return "needs_owner"  # medium and high

    # yolo: all risks → allowed (Chief auto-approves the full range within SafetyLimits)
    if effective == "yolo":
        return "allowed"

    # Should never reach here for a well-formed effective value
    raise ValueError(f"Unknown effective autonomy: {effective!r}")  # pragma: no cover


# ---------------------------------------------------------------------------
# approves_on_behalf — §4 Chief approval mandate
# ---------------------------------------------------------------------------

def approves_on_behalf(effective: str, risk: str) -> str | None:
    """Return who may auto-approve a proposal on the operator's behalf.

    Returns:
        "chief"    — the Chief may auto-approve this (effective, risk) combination.
        "operator" — the proposal must go to the human operator; Chief cannot self-authorize.
        None       — no proposal is needed (action is already "allowed"/"silent").

    Decision table (§4, collapsed from the matrix):
        strict + any   → "operator" (Chief never approves under strict)
        ask + low      → None       (already allowed — act-and-log, no proposal)
        ask + medium   → "chief"    (propose-to-chief; Chief approves on operator's behalf)
        ask + high     → "operator" (always reaches the human)
        yolo + low     → None       (already allowed — act-silently, no proposal)
        yolo + medium  → "chief"    (Chief auto-approves)
        yolo + high    → "chief"    (Chief auto-approves even high-risk under yolo)

    Spec: docs/business/autonomy.md §4.
    """
    if effective == "strict":
        # Under strict, every action is propose-to-operator; Chief cannot approve anything
        return "operator"

    if effective == "ask":
        if risk == "low":
            # act-and-log → already allowed, no proposal raised
            return None
        if risk == "medium":
            # propose-to-chief → Chief approves on operator's behalf
            return "chief"
        if risk == "high":
            # propose-to-operator → must reach the human
            return "operator"

    if effective == "yolo":
        if risk == "low":
            # act-silently → already allowed, no proposal raised
            return None
        # medium and high → Chief auto-approves the full range under yolo
        return "chief"

    raise ValueError(f"Unknown effective autonomy: {effective!r}")  # pragma: no cover
