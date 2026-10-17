"""Connector piece catalog indexer: file-based GitHub catalog (Task 2).

All tests are file-based — no DB needed. Drive the source via PIECES_SOURCE + tmp_path,
and point OMILO_DATA_DIR at a temp dir. Since get_settings() is lru_cache'd, we clear it
between tests that mutate the env.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
import yaml

# Import the GMAIL_MANIFEST shape from the existing test module to avoid duplication.
from tests.test_pieces import GMAIL_MANIFEST

from omilo_api import pieces
from omilo_api.config import get_settings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_piece(source_dir: Path, slug: str, manifest: dict, with_logo: bool = True) -> None:
    """Write a piece.yaml (and optional logo.svg) into source_dir/pieces/<slug>/."""
    piece_dir = source_dir / "pieces" / slug
    piece_dir.mkdir(parents=True, exist_ok=True)
    (piece_dir / "piece.yaml").write_text(yaml.dump(manifest))
    if with_logo:
        (piece_dir / "logo.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg"><text>{slug}</text></svg>')


def _point_data_dir(monkeypatch, tmp_path: Path) -> None:
    """Point OMILO_DATA_DIR at tmp_path and clear the settings cache."""
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()


def _point_source(monkeypatch, source_dir: Path) -> None:
    """Point PIECES_SOURCE at source_dir."""
    monkeypatch.setenv("PIECES_SOURCE", str(source_dir))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_parse_source_reads_valid_and_flags_invalid(tmp_path):
    """_parse_source flags a valid manifest as 'ok' and an invalid one as 'invalid'."""
    source = tmp_path / "source"
    _write_piece(source, "gmail", GMAIL_MANIFEST)
    _write_piece(source, "bad", {"id": ""})  # missing required fields

    results = pieces._parse_source(source)
    by = {p["slug"]: p for p in results}

    assert by["gmail"]["status"] == "ok"
    assert by["bad"]["status"] == "invalid"
    assert by["bad"]["error"]  # non-empty error message


def test_parse_source_logo_rel_present_when_logo_exists(tmp_path):
    """logo_rel is the repo-relative path to logo.svg when it exists, else ''."""
    source = tmp_path / "source"
    _write_piece(source, "gmail", GMAIL_MANIFEST, with_logo=True)
    _write_piece(source, "slack", GMAIL_MANIFEST | {"id": "slack", "label": "Slack"}, with_logo=False)

    results = pieces._parse_source(source)
    by = {p["slug"]: p for p in results}

    assert by["gmail"]["logo_rel"] != ""
    assert by["slack"]["logo_rel"] == ""


def test_parse_source_entry_shape(tmp_path):
    """Each entry from _parse_source has all required keys."""
    source = tmp_path / "source"
    _write_piece(source, "gmail", GMAIL_MANIFEST)

    results = pieces._parse_source(source)
    assert len(results) == 1
    entry = results[0]

    required_keys = {"slug", "label", "category", "description", "logo_rel", "manifest", "status", "error"}
    assert required_keys == set(entry.keys())


def test_reindex_writes_index_and_catalog_hides_invalid(tmp_path, monkeypatch):
    """reindex() writes index.json; catalog() exposes only 'ok' pieces; get_piece() returns manifest."""
    source = tmp_path / "source"
    _write_piece(source, "gmail", GMAIL_MANIFEST)
    _write_piece(source, "bad", {"id": ""})

    _point_data_dir(monkeypatch, tmp_path)
    _point_source(monkeypatch, source)

    counts = pieces.reindex()

    assert counts["ok"] == 1
    assert counts["invalid"] == 1
    assert counts["missing"] == 0

    # index.json must exist and be parseable
    idx = pieces.index_path()
    assert idx.exists()
    data = json.loads(idx.read_text())
    assert "synced_at" in data
    assert isinstance(data["pieces"], list)

    # catalog() returns only ok pieces without manifest internals
    cat = pieces.catalog()
    slugs = {p["slug"] for p in cat}
    assert slugs == {"gmail"}
    assert "manifest" not in cat[0]

    # get_piece includes full manifest
    gp = pieces.get_piece("gmail")
    assert gp is not None
    assert gp["manifest"] == GMAIL_MANIFEST

    # invalid piece not visible via catalog but accessible via get_piece (returns entry)
    assert pieces.get_piece("bad") is not None
    assert pieces.get_piece("nonexistent") is None


def test_reindex_marks_removed_piece_missing(tmp_path, monkeypatch):
    """A piece present in reindex #1 but absent in reindex #2 is kept with status='missing'."""
    source = tmp_path / "source"
    _write_piece(source, "gmail", GMAIL_MANIFEST)
    _write_piece(source, "slack", GMAIL_MANIFEST | {"id": "slack", "label": "Slack"})

    _point_data_dir(monkeypatch, tmp_path)
    _point_source(monkeypatch, source)

    counts1 = pieces.reindex()
    assert counts1["ok"] == 2
    assert counts1["missing"] == 0

    # Remove slack from source
    slack_dir = source / "pieces" / "slack"
    import shutil
    shutil.rmtree(slack_dir)

    counts2 = pieces.reindex()
    assert counts2["ok"] == 1
    assert counts2["missing"] == 1

    # slack must still be in index.json with status='missing'
    data = json.loads(pieces.index_path().read_text())
    by = {p["slug"]: p for p in data["pieces"]}
    assert by["slack"]["status"] == "missing"
    assert by["gmail"]["status"] == "ok"


def test_fetch_failure_keeps_last_good_index(tmp_path, monkeypatch):
    """When fetch() fails, reindex() returns normally and leaves index.json untouched (last-good)."""
    source = tmp_path / "source"
    _write_piece(source, "gmail", GMAIL_MANIFEST)

    _point_data_dir(monkeypatch, tmp_path)
    _point_source(monkeypatch, source)

    # Build a good index first
    counts1 = pieces.reindex()
    assert counts1["ok"] == 1
    good_text = pieces.index_path().read_text()

    # Now point PIECES_SOURCE at a non-existent path to trigger fetch failure
    monkeypatch.setenv("PIECES_SOURCE", str(tmp_path / "nonexistent"))
    # Also override PIECES_REPO to a garbage value to prevent real network calls
    monkeypatch.setenv("PIECES_REPO", "omilo/this-repo-does-not-exist-xyzzy")

    # reindex must return normally (not raise) with last-good counts
    counts2 = pieces.reindex()
    assert counts2["ok"] == 1  # from prior index
    assert counts2["invalid"] == 0
    assert counts2["missing"] == 0

    # The prior index must still be intact
    assert pieces.index_path().read_text() == good_text


def test_catalog_public_fields_only(tmp_path, monkeypatch):
    """catalog() entries expose only public fields (no manifest internals)."""
    source = tmp_path / "source"
    _write_piece(source, "gmail", GMAIL_MANIFEST)

    _point_data_dir(monkeypatch, tmp_path)
    _point_source(monkeypatch, source)

    pieces.reindex()
    cat = pieces.catalog()
    assert len(cat) == 1

    public_fields = {"slug", "label", "category", "description", "logo_rel"}
    for entry in cat:
        assert set(entry.keys()) == public_fields


def test_root_creates_directory(tmp_path, monkeypatch):
    """root() returns <data_dir>/pieces and creates it."""
    _point_data_dir(monkeypatch, tmp_path)
    r = pieces.root()
    assert r.exists() and r.is_dir()
    assert r == tmp_path / "pieces"


def test_index_path(tmp_path, monkeypatch):
    """index_path() returns root()/index.json."""
    _point_data_dir(monkeypatch, tmp_path)
    assert pieces.index_path() == pieces.root() / "index.json"


