"""Talent library (The Agency): sync, search, hire; hired specialists sleep until they have work."""
import os
from pathlib import Path

from omilo_api import services as S
from omilo_api import talent as T
from omilo_api.db import session_scope

FIXTURE = Path(__file__).parent / "fixtures" / "agency"


def test_library_search_and_hire(owner):
    os.environ["OMILO_TALENT_SOURCE"] = str(FIXTURE)
    try:
        assert T.syncer.run_now()["state"] == "done"
    finally:
        os.environ.pop("OMILO_TALENT_SOURCE", None)

    lib = owner.get("/api/talent").json()
    assert lib["source"]["count"] == 2 and lib["source"]["license"] == "MIT"
    assert {d["key"] for d in lib["divisions"]} == {"marketing", "engineering"}
    assert [a["slug"] for a in owner.get("/api/talent", params={"q": "posts"}).json()["agents"]] == ["marketing-content-creator"]
    assert [a["slug"] for a in owner.get("/api/talent", params={"division": "engineering"}).json()["agents"]] == ["engineering-frontend-developer"]
    one = owner.get("/api/talent/marketing-content-creator").json()
    assert one["emoji"] == "✍️" and "Core Mission" in one["body"]
    assert owner.get("/api/talent/nope").status_code == 404

    st = owner.post("/api/talent/marketing-content-creator/hire", json={}).json()
    assert st["id"] == "marketing-content-creator" and st["role"] == "agency:marketing-content-creator"
    assert st["job"].startswith("You are Content Creator") and "Core Mission" in st["job"] and "ask for approval" in st["job"]
    assert st["permissions"]["actions"] == {"content.draft": 2, "outreach.draft": 2}
    assert st["has_mcp_token"]
    again = owner.post("/api/talent/marketing-content-creator/hire", json={"name": "Second writer"}).json()
    assert again["id"] == "marketing-content-creator-2" and again["name"] == "Second writer"
    hired = {a["slug"]: a["hired_as"] for a in owner.get("/api/talent").json()["agents"]}
    assert hired["marketing-content-creator"] in ("marketing-content-creator", "marketing-content-creator-2")

    # the hired specialist can work right away (practice engine here)
    t = owner.post("/api/tasks", json={"staff_id": st["id"], "brief": "Draft one post"}).json()
    from conftest import wait_for
    done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['id']}").json())["status"] in ("done", "failed") and x)
    assert done["status"] == "done"


def test_sleeping_helpers(owner):
    with session_scope() as db:
        awake = S.awake_staff(db)
        assert "chief-of-staff" in awake  # always on
        quiet = [st.id for st in db.scalars(__import__("sqlalchemy").select(S.Staff)) if st.id not in awake]
        assert quiet, "some helpers sleep"
        S.create_task(db, quiet[0], "manual", "wake up", "test")
        assert quiet[0] in S.awake_staff(db)
