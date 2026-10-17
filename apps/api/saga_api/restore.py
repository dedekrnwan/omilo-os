"""Bring back connectors from an earlier Saga OS data folder.

`make reset` (and older resets) move the whole data folder aside as `<data-dir>-old-<date>` instead of deleting it.
Everything you set up then lives on in that folder, including your connectors and their secret headers. This module
finds those folders, lists their connectors, and copies the ones you pick into the current company, re-encrypting
their secrets with this install's key. Only folders next to the data folder that match that name are read, read-only;
secrets are never returned by the API.

CLI: python -m saga_api.restore [<old folder>]   (lists, then restores every connector not already here)
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from . import company as C
from .config import get_settings
from .models import Connector
from .security import encrypt

_SUFFIX = re.compile(r"-old-(\d{8}-\d{6}|\d+)$")


def candidates() -> list[Path]:
    """Earlier data folders next to the current one, newest first."""
    d = get_settings().data_dir.resolve()
    out = [p for p in d.parent.glob(f"{d.name}-old-*") if p.is_dir() and _SUFFIX.search(p.name)]
    return sorted(out, key=lambda p: p.stat().st_mtime, reverse=True)


def _moved_at(p: Path) -> str | None:
    m = _SUFFIX.search(p.name)
    if not m:
        return None
    s = m.group(1)
    try:
        t = dt.datetime.strptime(s, "%Y%m%d-%H%M%S") if "-" in s else dt.datetime.fromtimestamp(int(s), dt.UTC).replace(tzinfo=None)
        return t.isoformat()
    except ValueError:
        return None


def _db_for(old: Path, cid: str) -> Path | None:
    p = old / "saga.db" if cid == C.MAIN else old / "companies" / cid / "saga.db"
    return p if p.exists() else None


def _rows(db: Path) -> list[dict]:
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        try:
            return [dict(r) for r in con.execute("select * from connector order by created_at")]
        finally:
            con.close()
    except sqlite3.Error:
        return []


def _old_fernet(old: Path) -> Fernet | None:
    s = get_settings().secret_key
    if not s:
        f = old / "secret.key"
        if not f.exists():
            return None
        s = f.read_text().strip()
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("saga-vault:" + s).encode()).digest()))


def restorable(db: Session, cid: str | None = None) -> list[dict]:
    """For the current company: earlier folders that hold connectors, and which of them are not here yet."""
    cid = cid or C.current()
    have = {c.id for c in db.query(Connector).all()}
    out = []
    for old in candidates():
        p = _db_for(old, cid)
        rows = _rows(p) if p else []
        if rows:
            out.append({"dir": old.name, "moved_at": _moved_at(old),
                        "connectors": [{"id": r["id"], "label": r["label"], "kind": r["kind"], "here": r["id"] in have} for r in rows]})
    return out


def restore(db: Session, dir_name: str, ids: list[str] | None = None, cid: str | None = None) -> dict:
    """Copy connectors from the earlier folder `dir_name` (a name from candidates()) into the current company."""
    cid = cid or C.current()
    old = next((p for p in candidates() if p.name == dir_name), None)
    if not old:
        raise ValueError("unknown folder")
    p = _db_for(old, cid)
    if not p:
        raise ValueError("that folder has no data for this company")
    fer = _old_fernet(old)
    restored, skipped, no_secret = [], [], []
    for r in _rows(p):
        if ids is not None and r["id"] not in ids:
            continue
        if db.get(Connector, r["id"]):
            skipped.append(r["id"])
            continue
        secrets_enc = ""
        if r.get("secrets_enc"):
            try:
                plain = fer.decrypt(r["secrets_enc"].encode()).decode() if fer else None
            except InvalidToken:
                plain = None
            if plain:
                secrets_enc = encrypt(plain)
            else:
                no_secret.append(r["id"])
        args = r.get("args")
        db.add(Connector(id=r["id"], label=r["label"], kind=r["kind"] or "http", url=r.get("url") or "", command=r.get("command") or "",
                         args=json.loads(args) if isinstance(args, str) and args else (args or []), secrets_enc=secrets_enc,
                         approval=r.get("approval") or "ask", default_on=bool(r.get("default_on", 1)), enabled=bool(r.get("enabled", 1))))
        restored.append(r["id"])
    from . import services as S

    S.audit(db, "owner", "connector.restore", dir_name, restored=restored, skipped=skipped, no_secret=no_secret)
    db.commit()
    return {"restored": restored, "skipped": skipped, "secrets_missing": no_secret}


def main(argv: list[str] | None = None) -> int:
    from .db import init_db, session_scope

    args = sys.argv[1:] if argv is None else argv
    init_db()
    olds = candidates()
    if not olds:
        print("No earlier Saga OS data folders found next to", get_settings().data_dir)
        return 1
    with session_scope(C.MAIN) as db:
        found = restorable(db, C.MAIN)
        for f in found:
            print(f"{f['dir']}: " + ", ".join(f"{c['label']}{' (already here)' if c['here'] else ''}" for c in f["connectors"]))
        name = args[0].rstrip("/").split("/")[-1] if args else (found[0]["dir"] if found else None)
        if not name:
            print("None of them has connectors.")
            return 1
        r = restore(db, name, None, C.MAIN)
    print(f"Restored {len(r['restored'])} connector(s) from {name}."
          + (f" Already here: {', '.join(r['skipped'])}." if r["skipped"] else "")
          + (f" Re-enter the secret for: {', '.join(r['secrets_missing'])}." if r["secrets_missing"] else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
