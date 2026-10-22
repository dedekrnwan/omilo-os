"""Task 1 — gated_execute gate + policy action types.

Tests the new ``services.gated_execute`` function and the new ``policy.ALWAYS_ASK``
constant plus DEFAULTS additions (staff.create, staff.retire, staff.grant,
folder.grant, workflow.change).

We drive ``services.gated_execute`` directly, using throwaway Staff rows per test
to avoid cross-test state bleed.  Settings are set and cleared around each test that
needs them.
"""
import uuid

from omilo_api import policy
from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.models import Staff

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_staff(*, permissions: dict | None = None) -> str:
    sid = f"gate-worker-{uuid.uuid4().hex[:8]}"
    with session_scope() as db:
        db.add(Staff(id=sid, name="Gate Worker", role="marketing",
                     engine={"type": "fake"}, permissions=permissions or {}))
        db.commit()
    return sid


def _gated(staff_id: str, action: str, do, *, task_id: str | None = None, summary: str = "") -> dict:
    with session_scope() as db:
        st = db.get(Staff, staff_id)
        return S.gated_execute(db, st, action, do=do, task_id=task_id, summary=summary)


def _set(key: str, value) -> None:
    with session_scope() as db:
        S.set_setting(db, key, value)


def _clear(*keys: str) -> None:
    with session_scope() as db:
        from omilo_api.models import Setting
        for k in keys:
            s = db.get(Setting, k)
            if s is not None:
                db.delete(s)
        db.commit()


# ---------------------------------------------------------------------------
# 1. OFF-level action is refused even in Auto mode
# ---------------------------------------------------------------------------

def test_off_action_refused_even_in_auto():
    """``deploy`` defaults to OFF → refused regardless of autonomy mode."""
    ran = []
    sid = _make_staff()

    # Ensure permissive (Auto) mode
    _set("strict_mode", False)
    _set("autonomy_mode", "permissive")
    try:
        r = _gated(sid, "deploy", do=lambda: ran.append(True) or {"ok": True})
        assert r["decision"] == "refused", f"expected refused, got {r}"
        assert not ran, "do() must not be called for OFF action"
    finally:
        _clear("strict_mode", "autonomy_mode")


# ---------------------------------------------------------------------------
# 2. ASK-level action in Strict mode → proposal, not executed
# ---------------------------------------------------------------------------

def test_ask_in_strict_files_proposal_not_executed():
    """``staff.create`` (ASK) in strict mode → needs_approval, do() not called."""
    ran = []
    sid = _make_staff()

    _set("strict_mode", True)
    _set("autonomy_mode", "strict")
    try:
        r = _gated(sid, "staff.create", do=lambda: ran.append(True) or {"id": "stf_x"})
        assert r["decision"] == "needs_approval", f"expected needs_approval, got {r}"
        assert "proposal_id" in r and r["proposal_id"], "must include proposal_id"
        assert not ran, "do() must not be called in strict mode"
    finally:
        _clear("strict_mode", "autonomy_mode")


# ---------------------------------------------------------------------------
# 3. ASK-level action in Auto mode → executes inline
# ---------------------------------------------------------------------------

def test_ask_in_auto_executes_inline():
    """``staff.create`` (ASK) in permissive/Auto mode → done, returns do()'s result."""
    sid = _make_staff()

    _set("strict_mode", False)
    _set("autonomy_mode", "permissive")
    try:
        r = _gated(sid, "staff.create", do=lambda: {"id": "stf_x"})
        assert r["decision"] == "done", f"expected done, got {r}"
        assert r["result"] == {"id": "stf_x"}, f"unexpected result: {r.get('result')}"
    finally:
        _clear("strict_mode", "autonomy_mode")


# ---------------------------------------------------------------------------
# 4. ALWAYS_ASK action → proposal even in Auto mode
# ---------------------------------------------------------------------------

def test_always_ask_action_files_proposal_even_in_auto():
    """An action in policy.ALWAYS_ASK must not auto-run even in Auto mode."""
    ran = []
    sid = _make_staff()

    _set("strict_mode", False)
    _set("autonomy_mode", "permissive")
    try:
        r = _gated(sid, "ai.key", do=lambda: ran.append(True) or {"ok": True})
        assert r["decision"] == "needs_approval", f"expected needs_approval for ALWAYS_ASK, got {r}"
        assert not ran, "do() must not be called for ALWAYS_ASK action"
    finally:
        _clear("strict_mode", "autonomy_mode")


# ---------------------------------------------------------------------------
# 5. Auto mode executes even with no Chief of Staff
# ---------------------------------------------------------------------------

def test_auto_executes_with_no_chief_of_staff():
    """Auto mode executes inline even if no CoS is in the DB (no _cos_rule dependency)."""
    sid = _make_staff()

    _set("strict_mode", False)
    _set("autonomy_mode", "permissive")
    try:
        r = _gated(sid, "staff.create", do=lambda: {"ok": True})
        assert r["decision"] == "done", f"expected done, got {r}"
    finally:
        _clear("strict_mode", "autonomy_mode")


# ---------------------------------------------------------------------------
# 6. DO_AND_TELL action → always executes inline
# ---------------------------------------------------------------------------

def test_do_and_tell_executes_inline():
    """``workflow.change`` defaults to DO_AND_TELL → decision==done regardless of mode."""
    sid = _make_staff()

    # DO_AND_TELL must run in both strict and auto
    _set("strict_mode", True)
    _set("autonomy_mode", "strict")
    try:
        r = _gated(sid, "workflow.change", do=lambda: {"ok": True})
        assert r["decision"] == "done", f"expected done for DO_AND_TELL, got {r}"
    finally:
        _clear("strict_mode", "autonomy_mode")


# ---------------------------------------------------------------------------
# 7. ALWAYS_ASK is defense-in-depth: AUTO permission grant is overridden
# ---------------------------------------------------------------------------

def test_always_ask_overrides_auto_permission_grant():
    """ALWAYS_ASK is defense-in-depth: even if staff.permissions grants 'ai.key'
    at AUTO level and the system is in Auto (permissive) mode, gated_execute must
    still return needs_approval and must NOT call do()."""
    ran = []
    sid = _make_staff(permissions={"actions": {"ai.key": policy.AUTO}})

    _set("strict_mode", False)
    _set("autonomy_mode", "permissive")
    try:
        r = _gated(sid, "ai.key", do=lambda: ran.append(True) or {"ok": True})
        assert r["decision"] == "needs_approval", (
            f"ALWAYS_ASK action must not auto-run even with AUTO permission, got {r}"
        )
        assert not ran, "do() must never be called for an ALWAYS_ASK action"
    finally:
        _clear("strict_mode", "autonomy_mode")


# ---------------------------------------------------------------------------
# 9. Policy DEFAULTS contain the new keys with correct levels
# ---------------------------------------------------------------------------

def test_policy_defaults_new_keys():
    """Verify the five new DEFAULTS keys are present with correct values."""
    assert policy.DEFAULTS.get("staff.create") == policy.ASK
    assert policy.DEFAULTS.get("staff.retire") == policy.ASK
    assert policy.DEFAULTS.get("staff.grant") == policy.ASK
    assert policy.DEFAULTS.get("folder.grant") == policy.ASK
    assert policy.DEFAULTS.get("workflow.change") == policy.DO_AND_TELL


# ---------------------------------------------------------------------------
# 10. ALWAYS_ASK constant is a frozenset with expected members
# ---------------------------------------------------------------------------

def test_always_ask_is_frozenset_with_expected_members():
    """policy.ALWAYS_ASK is a frozenset containing the credential/auth/infra actions."""
    assert isinstance(policy.ALWAYS_ASK, frozenset)
    expected = {"ai.key", "harness.account", "staff.token_rotate", "founder.auth", "company.delete"}
    assert policy.ALWAYS_ASK == expected
