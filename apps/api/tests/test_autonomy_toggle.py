"""Task 2: Autonomy toggle — /system + overview.

POST /system {autonomy: "auto"|"strict"} writes strict_mode + autonomy_mode coherently.
GET  /overview returns autonomy: "auto"|"strict".
"""
from omilo_api import services as S
from omilo_api.db import session_scope


def _S_get(key):
    with session_scope() as db:
        return S.get_setting(db, key)


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
    """Overview autonomy field is derived from autonomy_mode, not strict_mode."""
    # Set to auto first so we have a known baseline
    owner.post("/api/system", json={"autonomy": "auto"})
    ov = owner.get("/api/overview").json()
    assert ov["autonomy"] == "auto"
    assert "autonomy" in ov

    # Toggle to strict
    owner.post("/api/system", json={"autonomy": "strict"})
    ov2 = owner.get("/api/overview").json()
    assert ov2["autonomy"] == "strict"


def test_invalid_autonomy_value_rejected(owner):
    r = owner.post("/api/system", json={"autonomy": "banana"})
    assert r.status_code == 422
