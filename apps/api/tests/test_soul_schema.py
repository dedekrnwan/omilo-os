"""Task 1 — Soul schema: brain / autonomy / voice columns + staff_relation table."""
from sqlalchemy import inspect

from omilo_api.db import engine, session_scope
from omilo_api.models import Staff, StaffRelation

# ---------------------------------------------------------------------------
# test_new_staff_has_soul_defaults
# ---------------------------------------------------------------------------

def test_new_staff_has_soul_defaults(owner):
    """Any seeded Staff row carries the three soul-column ORM defaults.

    (The migration path — columns added to a pre-existing table — is proved separately by
    test_staff_columns_exist_on_table.)
    """
    with session_scope() as db:
        st = db.query(Staff).first()
    assert st is not None, "No Staff row found — team not seeded?"
    assert st.brain == "single_engine", f"brain={st.brain!r}"
    assert st.autonomy == "standard", f"autonomy={st.autonomy!r}"
    assert st.voice == "", f"voice={st.voice!r}"


# ---------------------------------------------------------------------------
# test_staff_columns_exist_on_table
# ---------------------------------------------------------------------------

def test_staff_columns_exist_on_table(owner):
    """The live staff table has brain, autonomy, voice — proving _add_columns ran."""
    eng = engine()
    insp = inspect(eng)
    col_names = {c["name"] for c in insp.get_columns("staff")}
    for col in ("brain", "autonomy", "voice"):
        assert col in col_names, f"column '{col}' missing from staff table; got {col_names}"


# ---------------------------------------------------------------------------
# test_staff_relation_crud
# ---------------------------------------------------------------------------

def test_staff_relation_crud(owner):
    """Insert two StaffRelation rows, commit, read back, assert round-trip."""
    with session_scope() as db:
        # Grab two real staff ids from the seeded team
        staff_rows = db.query(Staff).limit(2).all()
    assert len(staff_rows) >= 2, "Need at least 2 Staff rows; team preset 'small' should have them"
    a_id, b_id = staff_rows[0].id, staff_rows[1].id

    try:
        # Insert
        with session_scope() as db:
            db.add(StaffRelation(from_staff=a_id, to_staff=b_id, kind="delegates_to"))
            db.add(StaffRelation(from_staff=b_id, to_staff=a_id, kind="reviews"))

        # Read back
        with session_scope() as db:
            rows = (
                db.query(StaffRelation)
                .filter(
                    StaffRelation.from_staff.in_([a_id, b_id]),
                    StaffRelation.to_staff.in_([a_id, b_id]),
                )
                .all()
            )

        kinds = {r.kind for r in rows}
        assert "delegates_to" in kinds, f"delegates_to not found; rows={rows}"
        assert "reviews" in kinds, f"reviews not found; rows={rows}"

        pairs = {(r.from_staff, r.to_staff, r.kind) for r in rows}
        assert (a_id, b_id, "delegates_to") in pairs
        assert (b_id, a_id, "reviews") in pairs
    finally:
        # Always clean up, even if an assertion fails, so repeated runs on the shared
        # omilo_test DB don't hit primary-key conflicts.
        with session_scope() as db:
            db.query(StaffRelation).filter(
                StaffRelation.from_staff.in_([a_id, b_id]),
                StaffRelation.to_staff.in_([a_id, b_id]),
            ).delete(synchronize_session=False)
