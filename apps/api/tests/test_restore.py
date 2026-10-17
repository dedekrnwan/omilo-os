"""Connectors left in a folder moved aside by a reset can be brought back, secrets included."""
import base64
import hashlib
import json
import sqlite3

from cryptography.fernet import Fernet


def test_restore_connectors_from_old_folder(owner):
    from omilo_api.config import get_settings

    data = get_settings().data_dir.resolve()
    old = data.parent / f"{data.name}-old-20260101-120000"
    old.mkdir(exist_ok=True)
    (old / "secret.key").write_text("old-install-key")
    fer = Fernet(base64.urlsafe_b64encode(hashlib.sha256(b"omilo-vault:old-install-key").digest()))
    con = sqlite3.connect(old / "omilo.db")
    con.execute("create table connector (id text primary key, label text, kind text, url text, command text, args text, secrets_enc text,"
                " approval text, default_on int, enabled int, created_at text)")
    sec = fer.encrypt(json.dumps({"headers": {"Authorization": "Bearer abc"}}).encode()).decode()
    con.execute("insert into connector values ('old-crm','Old CRM','http','https://crm.example/mcp','','[]',?,'ask',1,1,'2026-01-01')", (sec,))
    con.execute("insert into connector values ('old-fs','Files','stdio','','npx','[\"-y\",\"fs\"]','','auto',1,1,'2026-01-01')")
    con.commit()
    con.close()

    found = owner.get("/api/connectors/restorable").json()
    f = next(x for x in found if x["dir"] == old.name)
    assert {c["id"] for c in f["connectors"]} == {"old-crm", "old-fs"} and "secrets_enc" not in json.dumps(found)

    r = owner.post("/api/connectors/restore", json={"dir": old.name}).json()
    assert set(r["restored"]) == {"old-crm", "old-fs"} and not r["secrets_missing"]
    conns = {c["id"]: c for c in owner.get("/api/connectors").json()}
    assert conns["old-crm"]["header_names"] == ["Authorization"], "the secret header came back, re-encrypted"
    assert conns["old-fs"]["args"] == ["-y", "fs"]
    assert owner.post("/api/connectors/restore", json={"dir": old.name}).json()["skipped"] == ["old-crm", "old-fs"]
    assert owner.post("/api/connectors/restore", json={"dir": "../etc"}).status_code == 400
