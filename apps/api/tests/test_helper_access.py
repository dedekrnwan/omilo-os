"""Per-helper access (Team → helper → Access): folders, terminal commands, connectors and skills per helper, on top
of the company defaults; access grants from chat go to the helper that asked; the company-wide monthly budget."""
from omilo_api.engines.claude_code import plan


def _resolve(staff_id, thread_id=None):
    from omilo_api import capabilities as C
    from omilo_api.db import session_scope
    from omilo_api.models import Staff

    with session_scope() as db:
        st = db.get(Staff, staff_id)
        return C.resolve(db, thread_id=thread_id, staff=st)


def _paths(r):
    return {f["path"]: f for f in r.folders}


def test_folders_per_helper(owner, tmp_path):
    shared = tmp_path / "shared"
    code = tmp_path / "code"
    shared.mkdir()
    code.mkdir()
    a = owner.post("/api/folders", json={"path": str(shared), "access": "read", "default_on": True}).json()
    b = owner.post("/api/folders", json={"path": str(code), "access": "write", "commands": False}).json()
    try:
        # company defaults: everyone reads the shared folder, nobody gets the code folder
        v = owner.get("/api/staff/support/access").json()
        row = {f["id"]: f for f in v["folders"]}
        assert row[a["id"]]["effective"] == {"access": "read", "commands": False} and row[a["id"]]["own"] is None
        assert row[b["id"]]["effective"]["access"] == "none"

        # Support: no shared folder, the code folder with commands (more than the company default allows)
        v = owner.put("/api/staff/support/access", json={"folders": {a["id"]: {"access": "none"},
                                                                      b["id"]: {"access": "write", "commands": True}}}).json()
        row = {f["id"]: f for f in v["folders"]}
        assert row[b["id"]]["effective"] == {"access": "write", "commands": True}
        r = _resolve("support")
        assert str(shared) not in _paths(r) and _paths(r)[str(code)]["commands"] is True
        servers, tools, extra = plan({"_mcp_url": "http://x/mcp", "_mcp_token": "t"}, r)
        assert "Bash" in tools and str(code) in extra and str(shared) not in extra
        assert "Team → Support → Access" in r.note() and "request_access" in r.note()

        # other helpers keep the company defaults
        m = _resolve("marketing")
        assert str(shared) in _paths(m) and str(code) not in _paths(m)

        # a chat that picks the shared folder still doesn't give it to Support ('no access' wins)
        th = owner.post("/api/threads", json={"scope": "master", "staff_id": "support"}).json()
        owner.put(f"/api/threads/{th['id']}/tools", json={"folders": [a["id"]]})
        assert str(shared) not in _paths(_resolve("support", th["id"]))

        # commands only come with editing
        v = owner.put("/api/staff/support/access", json={"folders": {b["id"]: {"access": "read", "commands": True}}}).json()
        assert {f["id"]: f for f in v["folders"]}[b["id"]]["effective"] == {"access": "read", "commands": False}

        # back to the company default
        v = owner.put("/api/staff/support/access", json={"folders": {a["id"]: None, b["id"]: None}}).json()
        assert all(f["own"] is None for f in v["folders"] if f["id"] in (a["id"], b["id"]))
        back = _paths(_resolve("support"))
        assert str(shared) in back and str(code) not in back

        # bad input
        assert owner.put("/api/staff/support/access", json={"folders": {a["id"]: {"access": "admin"}}}).status_code == 400
        assert owner.put("/api/staff/support/access", json={"folders": {"fld_nope": {"access": "read"}}}).status_code == 404
        assert owner.get("/api/staff/nobody/access").status_code == 404
    finally:
        owner.delete(f"/api/folders/{a['id']}")
        owner.delete(f"/api/folders/{b['id']}")


def test_skills_and_connectors_per_helper(owner):
    owner.post("/api/skills", json={"slug": "house-style", "name": "House style", "description": "How we write", "body": "Short."})
    owner.post("/api/connectors", json={"id": "crm-x", "label": "CRM", "url": "http://127.0.0.1:9/mcp", "approval": "ask"})
    try:
        assert "house-style" not in {s["slug"] for s in _resolve("support").skills}  # skills are off by default
        assert "crm-x" in {c["id"] for c in _resolve("support").connectors}  # connectors are on by default
        owner.put("/api/staff/support/access", json={"skills": {"house-style": True}, "connectors": {"crm-x": False}})
        r = _resolve("support")
        assert "house-style" in {s["slug"] for s in r.skills} and "crm-x" not in {c["id"] for c in r.connectors}
        other = _resolve("marketing")
        assert "house-style" not in {s["slug"] for s in other.skills} and "crm-x" in {c["id"] for c in other.connectors}
        v = owner.get("/api/staff/support/access").json()
        assert next(s for s in v["skills"] if s["id"] == "house-style")["own"] is True
        owner.put("/api/staff/support/access", json={"skills": {"house-style": None}, "connectors": {"crm-x": None}})
        assert "crm-x" in {c["id"] for c in _resolve("support").connectors}
    finally:
        owner.delete("/api/skills/house-style")
        owner.delete("/api/connectors/crm-x")


def test_always_allow_goes_to_the_helper_that_asked(owner, tmp_path):
    from sqlalchemy import select

    from omilo_api import services
    from omilo_api.db import session_scope
    from omilo_api.models import Folder, Staff

    p = tmp_path / "asked"
    p.mkdir()
    with session_scope() as db:
        st = db.get(Staff, "support")
        item = services.request_access(db, st, None, None, "folder", {"path": str(p), "access": "write", "commands": True}, "build it")
        services.apply_grant(db, item, scope="always", thread_id=None)
    with session_scope() as db:
        row = db.scalar(select(Folder).where(Folder.path == str(p)))
        fid = row.id
        assert row.default_on is False, "an 'always' grant is for that helper, not the whole team"
    r = _resolve("support")
    assert _paths(r)[str(p)] == {"path": str(p), "label": "asked", "access": "write", "commands": True}
    assert str(p) not in _paths(_resolve("marketing"))
    owner.delete(f"/api/folders/{fid}")


def test_company_budget_pauses_everyone(owner):
    from omilo_api import budgets
    from omilo_api import services as S
    from omilo_api.db import session_scope
    from omilo_api.models import InboxItem, RunEvent

    assert owner.post("/api/system", json={"budget_company_usd": -1}).status_code == 422
    ov = owner.post("/api/system", json={"budget_company_usd": 0.05}).json()
    assert ov["budget_company"]["budget_usd"] == 0.05
    try:
        spent = ov["budget_company"]["cost_usd"]
        owner.post("/api/system", json={"budget_company_usd": round(spent + 0.05, 4)})
        with session_scope() as db:
            db.add(RunEvent(staff_id="support", kind="usage", data={"tokens": 10, "cost_usd": 0.045, "seconds": 1}))
            db.commit()
            assert budgets.check_company(db) == "warn"
            assert budgets.check_company(db) is None, "once a month"
            db.add(RunEvent(staff_id="support", kind="usage", data={"tokens": 10, "cost_usd": 0.01, "seconds": 1}))
            db.commit()
            assert budgets.check_company(db) == "paused"
            assert S.is_paused(db)
            assert db.query(InboxItem).filter(InboxItem.title.like("The company reached its monthly budget%")).count() == 1
        assert owner.get("/api/overview").json()["paused"] is True
    finally:
        owner.post("/api/system", json={"budget_company_usd": 0, "paused": False})
