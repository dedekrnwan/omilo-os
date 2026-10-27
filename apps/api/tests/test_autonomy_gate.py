"""
P1-T3: Autonomy resolution + gate decision matrix — TDD test suite.

RED → implement → GREEN.

Covers:
  - effective_autonomy layering (§2 of business/autonomy.md)
  - decide() 9-cell decision matrix (§3.2) collapsed to gate verbs
  - SafetyLimit backstop at ALL dial positions (§6 invariant)
  - approves_on_behalf() — who may auto-approve on operator's behalf
  - breaches_safety() — SafetyLimit breach detection
"""
from __future__ import annotations

import pytest
from types import SimpleNamespace


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _limit(kind: str, value: int, block_or_warn: str = "block") -> SimpleNamespace:
    """Minimal duck-typed SafetyLimit (no DB required)."""
    return SimpleNamespace(kind=kind, value=value, block_or_warn=block_or_warn)


# ---------------------------------------------------------------------------
# 1. effective_autonomy — layering (§2)
# ---------------------------------------------------------------------------

class TestEffectiveAutonomy:
    """Table-driven tests from autonomy.md §2 worked resolutions."""

    def _call(self, workspace, goal, helper):
        from omilo.engine.autonomy import effective_autonomy
        return effective_autonomy(workspace, goal, helper)

    @pytest.mark.parametrize("workspace,goal,helper,expected", [
        # From spec §2 table:
        ("ask",    "yolo",  None,     "ask"),    # Goal can't exceed workspace
        ("yolo",   None,    "strict", "strict"), # Helper cap clamps hardest
        ("yolo",   "ask",   None,     "ask"),    # Goal tightens a loose workspace
        ("strict", "yolo",  "yolo",   "strict"), # Workspace is the floor
        ("ask",    None,    None,     "ask"),    # only workspace set → wins
        ("yolo",   "yolo",  "yolo",   "yolo"),   # all three agree at top
        # Extra from task brief:
        ("yolo",   "ask",   "strict", "strict"), # strictest of three
        ("ask",    "strict","yolo",   "strict"), # Goal tightens; cap irrelevant
    ])
    def test_layering(self, workspace, goal, helper, expected):
        assert self._call(workspace, goal, helper) == expected

    def test_workspace_always_participates(self):
        """workspace is never None — it is the always-set layer."""
        from omilo.engine.autonomy import effective_autonomy
        # workspace alone
        assert effective_autonomy("strict", None, None) == "strict"
        assert effective_autonomy("yolo", None, None) == "yolo"

    def test_none_layers_drop_out(self):
        """None layers neither raise nor lower the result."""
        from omilo.engine.autonomy import effective_autonomy
        # If only workspace is set, it wins outright regardless of value
        assert effective_autonomy("yolo", None, None) == "yolo"
        assert effective_autonomy("ask", None, None) == "ask"


# ---------------------------------------------------------------------------
# 2. decide() — 9-cell decision matrix (§3.2) collapsed to gate verbs
# ---------------------------------------------------------------------------

class TestDecideMatrix:
    """Full 9-cell (effective × risk) parametrized table.

    Gate verb mapping from §3 intro:
      act-silently / act-and-log  → "allowed"
      propose-to-chief / propose-to-operator → "needs_owner"
      refuse → "refused"
    """

    def _decide(self, effective, risk, safety=None, usage=None):
        from omilo.engine.autonomy import decide
        return decide(effective, risk, "message", safety or [], usage)

    @pytest.mark.parametrize("effective,risk,expected", [
        # strict column: every consequential action → needs_owner
        ("strict", "low",    "needs_owner"),
        ("strict", "medium", "needs_owner"),
        ("strict", "high",   "needs_owner"),
        # ask column: low→allowed, medium→needs_owner, high→needs_owner
        ("ask",    "low",    "allowed"),
        ("ask",    "medium", "needs_owner"),
        ("ask",    "high",   "needs_owner"),
        # yolo column: everything auto-approved → allowed (SafetyLimits are the only gate)
        ("yolo",   "low",    "allowed"),
        ("yolo",   "medium", "allowed"),
        ("yolo",   "high",   "allowed"),
    ])
    def test_matrix_cell(self, effective, risk, expected):
        assert self._decide(effective, risk) == expected


# ---------------------------------------------------------------------------
# 3. SafetyLimit backstop — must be "refused" at ALL dial positions
# ---------------------------------------------------------------------------

class TestSafetyLimitBackstop:
    """§6 invariant: block-mode SafetyLimit breach → refused at strict, ask, AND yolo."""

    def _decide(self, effective, risk, safety, usage, proposal_type="message"):
        from omilo.engine.autonomy import decide
        return decide(effective, risk, proposal_type, safety, usage)

    # --- messages_day scenario (worked example §7a) ---

    @pytest.mark.parametrize("effective", ["strict", "ask", "yolo"])
    def test_messages_day_breach_refused_at_every_dial(self, effective):
        """messages_day=50, usage=50 → refused at strict, ask, AND yolo."""
        safety = [_limit("messages_day", 50, "block")]
        usage  = {"messages_today": 50}
        result = self._decide(effective, "medium", safety, usage, "message")
        assert result == "refused", (
            f"Expected 'refused' at effective={effective!r}, got {result!r}"
        )

    def test_messages_day_warn_mode_does_not_block(self):
        """warn-mode limits do not produce 'refused'."""
        safety = [_limit("messages_day", 50, "warn")]
        usage  = {"messages_today": 50}
        # Under yolo with warn-mode, the action should still be allowed
        result = self._decide("yolo", "medium", safety, usage, "message")
        assert result == "allowed"

    def test_messages_day_under_limit_not_refused(self):
        """Usage below the cap → no breach."""
        safety = [_limit("messages_day", 50, "block")]
        usage  = {"messages_today": 49}
        result = self._decide("yolo", "medium", safety, usage, "message")
        assert result == "allowed"

    # --- boolean-style deploy limit ---

    @pytest.mark.parametrize("effective", ["strict", "ask", "yolo"])
    def test_deploy_block_refused_at_every_dial(self, effective):
        """A block-mode deploy limit (value=0) refuses deploy actions at all dials."""
        safety = [_limit("deploy", 0, "block")]
        usage  = {}
        result = self._decide(effective, "high", safety, usage, "deploy")
        assert result == "refused", (
            f"Expected 'refused' at effective={effective!r}, got {result!r}"
        )

    def test_deploy_block_does_not_affect_other_types(self):
        """A deploy block limit should not refuse non-deploy actions."""
        safety = [_limit("deploy", 0, "block")]
        usage  = {}
        result = self._decide("yolo", "high", safety, usage, "settings_change")
        assert result == "allowed"

    # --- spend_day scenario ---

    @pytest.mark.parametrize("effective", ["strict", "ask", "yolo"])
    def test_spend_day_breach_refused_at_every_dial(self, effective):
        """spend_day limit breach → refused at all dials."""
        safety = [_limit("spend_day", 1000, "block")]
        usage  = {"spend_today": 1000}
        result = self._decide(effective, "medium", safety, usage, "spend")
        assert result == "refused"

    def test_multiple_limits_any_breach_refuses(self):
        """If any block-mode limit is breached, result is refused."""
        safety = [
            _limit("messages_day", 100, "block"),
            _limit("spend_day", 500, "block"),
        ]
        usage = {"messages_today": 5, "spend_today": 500}  # spend breached
        result = self._decide("yolo", "medium", safety, usage, "spend")
        assert result == "refused"

    def test_no_safety_limits_no_breach(self):
        """Empty safety list → no breach."""
        from omilo.engine.autonomy import decide
        result = decide("yolo", "high", "deploy", [], {})
        assert result == "allowed"


# ---------------------------------------------------------------------------
# 4. approves_on_behalf() — who may auto-approve
# ---------------------------------------------------------------------------

class TestApprovesOnBehalf:
    """Per task spec §5 table:
      allowed cells → None
      ask+medium    → "chief"
      yolo+any      → "chief"
      strict+any    → "operator"
      ask+high      → "operator"
    """

    def _call(self, effective, risk):
        from omilo.engine.autonomy import approves_on_behalf
        return approves_on_behalf(effective, risk)

    # Already-allowed cells → None (no proposal needed)
    def test_ask_low_no_approval_needed(self):
        assert self._call("ask", "low") is None

    def test_yolo_low_no_approval_needed(self):
        assert self._call("yolo", "low") is None

    # ask + medium → Chief may approve
    def test_ask_medium_chief(self):
        assert self._call("ask", "medium") == "chief"

    # ask + high → must reach operator
    def test_ask_high_operator(self):
        assert self._call("ask", "high") == "operator"

    # strict + any → operator only (Chief never approves under strict)
    def test_strict_low_operator(self):
        assert self._call("strict", "low") == "operator"

    def test_strict_medium_operator(self):
        assert self._call("strict", "medium") == "operator"

    def test_strict_high_operator(self):
        assert self._call("strict", "high") == "operator"

    # yolo + any → Chief approves the full range
    @pytest.mark.parametrize("risk", ["low", "medium", "high"])
    def test_yolo_all_risks_chief(self, risk):
        result = self._call("yolo", risk)
        # low is already "allowed" (None), medium+high → "chief"
        # spec: yolo+any → "chief"; but low is already allowed so None
        if risk == "low":
            assert result is None
        else:
            assert result == "chief"


# ---------------------------------------------------------------------------
# 5. breaches_safety() — unit-level breach detection
# ---------------------------------------------------------------------------

class TestBreachesSafety:

    def _call(self, proposal_type, risk, safety, usage=None):
        from omilo.engine.autonomy import breaches_safety
        return breaches_safety(proposal_type, risk, safety, usage or {})

    def test_no_limits_no_breach(self):
        assert self._call("message", "medium", []) is False

    def test_messages_day_at_limit_is_breach(self):
        safety = [_limit("messages_day", 50, "block")]
        assert self._call("message", "medium", safety, {"messages_today": 50}) is True

    def test_messages_day_below_limit_no_breach(self):
        safety = [_limit("messages_day", 50, "block")]
        assert self._call("message", "medium", safety, {"messages_today": 49}) is False

    def test_messages_day_warn_mode_not_a_breach(self):
        safety = [_limit("messages_day", 50, "warn")]
        assert self._call("message", "medium", safety, {"messages_today": 50}) is False

    def test_deploy_boolean_block_breach(self):
        """deploy limit with value=0 → boolean block for deploy proposals."""
        safety = [_limit("deploy", 0, "block")]
        assert self._call("deploy", "high", safety, {}) is True

    def test_deploy_boolean_block_no_breach_for_other_type(self):
        safety = [_limit("deploy", 0, "block")]
        assert self._call("spend", "high", safety, {}) is False

    def test_spend_day_breach(self):
        safety = [_limit("spend_day", 500, "block")]
        assert self._call("spend", "medium", safety, {"spend_today": 500}) is True

    def test_spend_day_no_breach_below(self):
        safety = [_limit("spend_day", 500, "block")]
        assert self._call("spend", "medium", safety, {"spend_today": 499}) is False

    def test_external_write_boolean_block(self):
        """external_write with value=0 → blocks external_write proposals."""
        safety = [_limit("external_write", 0, "block")]
        assert self._call("external_write", "medium", safety, {}) is True

    def test_external_write_no_match_for_other_type(self):
        safety = [_limit("external_write", 0, "block")]
        assert self._call("message", "medium", safety, {}) is False

    def test_orm_model_duck_typing(self):
        """SafetyLimit objects from ORM model (duck-typed) should work too."""
        # Simulate an ORM-style object with the required attributes
        class OrmLimit:
            kind = "messages_day"
            value = 10
            block_or_warn = "block"

        from omilo.engine.autonomy import breaches_safety
        result = breaches_safety("message", "medium", [OrmLimit()], {"messages_today": 10})
        assert result is True
