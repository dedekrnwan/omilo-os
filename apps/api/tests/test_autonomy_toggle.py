"""Task 2: Autonomy toggle — /system + overview.

POST /system {autonomy: "auto"|"strict"} writes strict_mode + autonomy_mode coherently.
GET  /overview returns autonomy: "auto"|"strict".
"""
from omilo_api import services as S
from omilo_api.db import session_scope


def _S_get(key):
    with session_scope() as db:
        return S.get_setting(db, key)


def _S_set(key, value):
    with session_scope() as db:
        S.set_setting(db, key, value)
        db.commit()


def test_set_auto_sets_both_keys(owner):
    r = owner.post("/api/system", json={"autonomy": "auto"})
    assert r.status_code == 200, r.text
    assert _S_get("strict_mode") is False
    assert _S_get("autonomy_mode") == "permissive"
    assert owner.get("/api/overview").json()["autonomy"] == "auto"


def test_set_strict_sets_both_keys(owner):
    r = owner.post("/api/system", json={"autonomy": "strict"})
    assert r.status_code == 200, r.text
    assert _S_get("strict_mode") is True
    assert _S_get("autonomy_mode") == "strict"
    assert owner.get("/api/overview").json()["autonomy"] == "strict"


def test_overview_autonomy_derives_from_autonomy_mode(owner):
    """Overview autonomy follows autonomy_mode even when strict_mode diverges."""
    # Force a divergent state: autonomy_mode=permissive but strict_mode=True
    _S_set("autonomy_mode", "permissive")
    _S_set("strict_mode", True)

    ov = owner.get("/api/overview").json()
    # Must follow autonomy_mode ("permissive" → "auto"), NOT strict_mode (True → would be "strict")
    assert ov["autonomy"] == "auto", (
        f"Expected 'auto' (from autonomy_mode=permissive) but got {ov['autonomy']!r}; "
        "overview must derive from autonomy_mode, not strict_mode"
    )

    # Also verify the other direction: autonomy_mode=strict, strict_mode=False
    _S_set("autonomy_mode", "strict")
    _S_set("strict_mode", False)
    ov2 = owner.get("/api/overview").json()
    assert ov2["autonomy"] == "strict", (
        f"Expected 'strict' (from autonomy_mode=strict) but got {ov2['autonomy']!r}"
    )


def test_invalid_autonomy_value_rejected(owner):
    r = owner.post("/api/system", json={"autonomy": "banana"})
    assert r.status_code == 422


def test_onboarding_finish_strict_mode_keeps_autonomy_mode_coherent(owner):
    """Onboarding finish with ask_all (strict=True) must also set autonomy_mode='strict'."""
    ANSWERS = {
        "company_name": "Coherence Test Co",
        "industry": "Software",
        "goals": "test",
        "languages": [],
        "tones": [],
        "tools": [],
        "team_style": "small",
        "approval_mode": "ask_all",
    }
    r = owner.post("/api/onboarding/finish", json={
        "answers": ANSWERS,
        "roles": [],
        "approval_mode": "ask_all",
        "engine": {"type": "fake"},
    })
    assert r.status_code == 200, r.text
    assert _S_get("strict_mode") is True
    assert _S_get("autonomy_mode") == "strict"
    assert owner.get("/api/overview").json()["autonomy"] == "strict"


def test_onboarding_finish_balanced_mode_keeps_autonomy_mode_coherent(owner):
    """Onboarding finish with balanced (strict=False) must also set autonomy_mode='permissive'."""
    ANSWERS = {
        "company_name": "Balanced Test Co",
        "industry": "Software",
        "goals": "test",
        "languages": [],
        "tones": [],
        "tools": [],
        "team_style": "small",
        "approval_mode": "balanced",
    }
    r = owner.post("/api/onboarding/finish", json={
        "answers": ANSWERS,
        "roles": [],
        "approval_mode": "balanced",
        "engine": {"type": "fake"},
    })
    assert r.status_code == 200, r.text
    assert _S_get("strict_mode") is False
    assert _S_get("autonomy_mode") == "permissive"
    assert owner.get("/api/overview").json()["autonomy"] == "auto"
