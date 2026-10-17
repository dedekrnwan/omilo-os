"""POST /api/catalog/refresh rebuilds the file-based catalog index."""
import os
from pathlib import Path

import yaml

from omilo_api import pieces as P


def _write_piece(src: Path, slug: str, manifest: dict) -> None:
    d = src / "pieces" / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / "piece.yaml").write_text(yaml.safe_dump(manifest))


GMAIL = {
    "id": "gmail", "label": "Gmail", "category": "Email", "description": "Email.",
    "auth": {"type": "oauth2", "provider": "google", "scopes": ["s"]},
    "actions": [{"name": "send-email", "label": "Send", "approval": "ask",
                 "http": {"method": "POST", "url": "https://gmail.googleapis.com/x", "auth": "bearer"},
                 "inputs": [{"name": "to", "type": "string", "required": True}]}],
}


def test_refresh_rebuilds_catalog(owner, tmp_path, monkeypatch):
    _write_piece(tmp_path, "gmail", GMAIL)
    monkeypatch.setenv("PIECES_SOURCE", str(tmp_path))
    r = owner.post("/api/catalog/refresh")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": 1, "invalid": 0, "missing": 0}
    assert "gmail" in [c["slug"] for c in owner.get("/api/catalog").json()]
