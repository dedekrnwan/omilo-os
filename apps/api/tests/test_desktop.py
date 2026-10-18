"""The Mac app's launcher: ports, saved state and PATH (starting Postgres itself is covered by the desktop workflow)."""
import json
import socket

from omilo_api import desktop as D


def test_free_port_skips_a_busy_one():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        busy = s.getsockname()[1]
        p = D.free_port(busy)
        assert p != busy and p > 0
    assert D.free_port(busy) == busy, "free again once the other server is gone"


def test_state_keeps_generated_values_private(tmp_path):
    st = D.State(tmp_path / "desktop.json")
    pw = st.get("pg_password", lambda: "first")
    assert st.get("pg_password", lambda: "second") == pw == "first"
    st.save()
    f = tmp_path / "desktop.json"
    assert json.loads(f.read_text())["pg_password"] == "first"
    assert f.stat().st_mode & 0o077 == 0
    assert D.State(f).get("pg_password", lambda: "x") == "first"


def test_merge_path_keeps_order_and_drops_repeats():
    assert D.merge_path("/a:/b", "/b:/c", "", "/a") == "/a:/b:/c"


def test_one_copy_per_data_folder(tmp_path):
    a = D.Services(tmp_path / "rt", tmp_path / "data")
    assert a.lock() is None
    (tmp_path / "data" / "desktop.json").write_text(json.dumps({"url": "http://127.0.0.1:7700"}))
    b = D.Services(tmp_path / "rt", tmp_path / "data")
    import subprocess
    import sys

    # flock is per open file description: a second process sees the lock
    out = subprocess.run([sys.executable, "-c", "from pathlib import Path; from omilo_api import desktop as D; "
                          f"print(D.Services(Path('{tmp_path}/rt'), Path('{tmp_path}/data')).lock(wait=0))"],
                         capture_output=True, text=True).stdout
    assert "7700" in out
    del b
