"""Repro: a helper granted write+terminal access to a folder should get Bash in the Claude Code engine."""
import tempfile


def test_granted_write_commands_folder_enables_bash():
    from omilo_api import capabilities as C
    from omilo_api import services as S
    from omilo_api.db import session_scope
    from omilo_api.engines import claude_code
    from omilo_api.models import Folder, Staff, new_id

    d = tempfile.mkdtemp(prefix="bashrepro-")  # a real existing dir (resolve requires is_dir)

    with session_scope() as db:
        st = Staff(id=new_id("stf"), name="Developer", role="developer", job="code", is_chief=False)
        db.add(st)
        f = Folder(id=new_id("fld"), path=d, label="repro", access="write", commands=True, default_on=False)
        db.add(f)
        db.flush()
        fid, sid = f.id, st.id
        db.commit()

    # Grant the helper write + terminal commands on that folder (the exact UI/agent path)
    with session_scope() as db:
        st = db.get(Staff, sid)
        S.set_staff_access(db, st, {"folders": {fid: {"access": "write", "commands": True}}}, actor="owner")
        db.commit()
        print("STORED access:", st.access)

    # Resolve for a run as that helper, then ask the engine what tools it gets
    with session_scope() as db:
        st = db.get(Staff, sid)
        res = C.resolve(db, staff=st)
        print("RESOLVED folders:", res.folders)
        servers, tools, extra = claude_code.plan({"_mcp_url": "http://x", "_mcp_token": "t"}, res)
        print("ENGINE tools:", tools)
        assert any(fo.get("commands") for fo in res.folders), f"no folder carries commands: {res.folders}"
        assert "Bash" in tools, f"Bash not enabled for a write+commands grant; tools={tools}"


def test_granted_folder_with_missing_path_is_auto_created():
    """A folder the helper is GRANTED whose path is missing is auto-created by resolve(), so Bash works
    instead of being silently dropped (#5 fix)."""
    import os
    import tempfile

    from omilo_api import capabilities as C
    from omilo_api import services as S
    from omilo_api.db import session_scope
    from omilo_api.engines import claude_code
    from omilo_api.models import Folder, Staff, new_id

    ghost = os.path.join(tempfile.gettempdir(), f"bashrepro-ghost-{new_id('x')}", "proj")  # does NOT exist yet
    assert not os.path.isdir(ghost)

    with session_scope() as db:
        st = Staff(id=new_id("stf"), name="Dev2", role="dev2", job="code", is_chief=False)
        db.add(st)
        f = Folder(id=new_id("fld"), path=ghost, label="ghost", access="write", commands=True, default_on=False)
        db.add(f)
        db.flush()
        S.set_staff_access(db, st, {"folders": {f.id: {"access": "write", "commands": True}}}, actor="owner")
        db.commit()
        res = C.resolve(db, staff=st)
        _, tools, _ = claude_code.plan({"_mcp_url": "http://x", "_mcp_token": "t"}, res)
        assert os.path.isdir(ghost), "granted folder path should have been auto-created"
        assert res.folders and "Bash" in tools, f"Bash should be enabled after auto-create; tools={tools}"
