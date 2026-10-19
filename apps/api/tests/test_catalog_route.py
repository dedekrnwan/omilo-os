"""Task 6 — GET /catalog route and logo-proxy.

TDD: tests written first (failing), then implementation added.

Catalog seeding strategy:
  Same approach as test_pieces_connect.py — set PIECES_SOURCE to a temp dir,
  call pieces.reindex() in-process, then exercise the API via the owner client.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

import omilo_api.pieces as pieces
from omilo_api.config import get_settings
from tests.test_pieces import GMAIL_MANIFEST

# A minimal valid manifest for the "bad" piece that should be excluded.
# It is deliberately invalid (missing required fields) so it has status!=ok.
BAD_MANIFEST_INVALID = {
    "id": "bad",
    # missing label, category, description, auth, actions → validate_manifest errors
}


def _write_piece(source_dir: Path, slug: str, manifest: dict, logo: bool = False) -> None:
    """Write pieces/<slug>/piece.yaml (and optionally logo.svg) under source_dir."""
    piece_dir = source_dir / "pieces" / slug
    piece_dir.mkdir(parents=True, exist_ok=True)
    (piece_dir / "piece.yaml").write_text(yaml.dump(manifest))
    if logo:
        (piece_dir / "logo.svg").write_text(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
            '<circle cx="16" cy="16" r="12" fill="#EA4335"/></svg>'
        )


def _seed_catalog(tmp_path: Path, *, with_logo: bool = True) -> None:
    """Write gmail (ok, with logo) + bad (invalid) into PIECES_SOURCE and reindex."""
    source = tmp_path / "pieces-src"
    _write_piece(source, "gmail", GMAIL_MANIFEST, logo=with_logo)
    _write_piece(source, "bad", BAD_MANIFEST_INVALID, logo=False)
    os.environ["PIECES_SOURCE"] = str(source)
    get_settings.cache_clear()
    pieces.reindex()


class TestCatalogRoute:
    """GET /catalog returns only valid (ok) pieces with connected/needs_reconnect flags."""

    @pytest.fixture(autouse=True)
    def seed(self, tmp_path):
        _seed_catalog(tmp_path)
        yield
        os.environ.pop("PIECES_SOURCE", None)
        get_settings.cache_clear()

    def test_catalog_lists_only_valid_pieces_with_connected_flag(self, owner):
        """Only ok pieces appear; connected=false before connecting gmail."""
        rows = owner.get("/api/catalog").json()
        slugs = {r["slug"]: r for r in rows}

        # "bad" piece (invalid manifest) must NOT appear
        assert "bad" not in slugs, f"Invalid piece 'bad' must not appear in catalog: {list(slugs)}"
        # "gmail" piece (ok) must appear
        assert "gmail" in slugs, f"Valid piece 'gmail' must appear in catalog: {list(slugs)}"

        gmail = slugs["gmail"]
        # Before connecting, connected must be False
        assert gmail["connected"] is False, f"gmail not yet connected, expected connected=false: {gmail}"
        assert gmail["needs_reconnect"] is False, f"Expected needs_reconnect=false: {gmail}"

        # Required response fields
        for field in ("slug", "label", "category", "logo_url", "connected", "needs_reconnect"):
            assert field in gmail, f"Missing field '{field}' in catalog entry: {gmail}"

    def test_catalog_shows_connected_true_after_connect(self, owner):
        """After connecting gmail, catalog shows connected=true and needs_reconnect=false."""
        # Connect gmail via the Task 5 route
        r = owner.post("/api/connectors/pieces/gmail/connect")
        assert r.status_code == 200, r.text
        state = r.json()["state"]

        # Poll until connected
        r2 = owner.get(f"/api/connectors/pieces/connect/{state}")
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "connected"

        # Now catalog should reflect connected=true
        rows = owner.get("/api/catalog").json()
        slugs = {r["slug"]: r for r in rows}
        assert "gmail" in slugs, f"gmail not in catalog after connect: {list(slugs)}"

        gmail = slugs["gmail"]
        assert gmail["connected"] is True, f"Expected connected=true after connect: {gmail}"
        assert gmail["needs_reconnect"] is False, f"Expected needs_reconnect=false: {gmail}"

        # Disconnect to avoid polluting later tests
        owner.delete("/api/connectors/gmail")

    def test_catalog_excludes_invalid_piece(self, owner):
        """The 'bad' piece (invalid manifest) never appears regardless of connection state."""
        rows = owner.get("/api/catalog").json()
        slugs = {r["slug"]: r for r in rows}
        assert "bad" not in slugs, f"'bad' piece must always be excluded: {list(slugs)}"

    def test_catalog_logo_url_for_piece_with_logo(self, owner):
        """gmail has a logo so its logo_url is non-empty and points at the proxy route."""
        rows = owner.get("/api/catalog").json()
        slugs = {r["slug"]: r for r in rows}
        assert "gmail" in slugs
        logo_url = slugs["gmail"]["logo_url"]
        assert logo_url, f"Expected non-empty logo_url for gmail (has logo.svg): {slugs['gmail']}"
        assert "gmail" in logo_url, f"logo_url should contain slug 'gmail': {logo_url}"

    def test_logo_proxy_returns_svg(self, owner):
        """GET /catalog/gmail/logo returns image/svg+xml for a piece that has a logo.svg."""
        r = owner.get("/api/catalog/gmail/logo")
        assert r.status_code == 200, f"Expected 200 for gmail logo, got {r.status_code}: {r.text}"
        assert "image/svg+xml" in r.headers.get("content-type", ""), (
            f"Expected image/svg+xml content-type: {r.headers}"
        )
        # Must be non-empty SVG
        body = r.text
        assert "<svg" in body or "<?xml" in body, f"Response body does not look like SVG: {body[:200]}"
        # Security: must not be served as script-executable
        assert "text/javascript" not in r.headers.get("content-type", "")

    def test_logo_proxy_404_for_unknown_slug(self, owner):
        """GET /catalog/no-such-piece/logo returns 404."""
        r = owner.get("/api/catalog/no-such-piece/logo")
        assert r.status_code == 404, f"Expected 404 for unknown slug, got {r.status_code}"

    def test_logo_proxy_path_traversal_rejected(self, owner):
        """Path traversal is blocked at the catalog-slug lookup layer.

        The primary security guard is that slug must be in the ok catalog before any
        filesystem path is joined.  A slug that is not in the catalog returns 404 regardless
        of its content.  URL-level traversal (../../etc/passwd) is normalised away by the
        HTTP layer before FastAPI sees it, so we test with a percent-encoded segment that
        some parsers forward as-is.
        """
        # A slug that looks like a path segment but is not in the catalog
        r = owner.get("/api/catalog/%2F%2F%2Fetc%2Fpasswd/logo")
        # FastAPI decodes %2F in path params → the full string is the slug value,
        # which is not in the catalog → 404.  Some stacks may return 422 (validation).
        assert r.status_code in (404, 422), (
            f"Expected 404 or 422 for path-like slug, got {r.status_code}: {r.text[:200]}"
        )

        # Also test: a slug whose catalog entry exists but has no path traversal capability
        # (guard 2 covers this — logo_rel from index cannot escape repo_dir).
        # Verify a random slug that is not in the catalog is rejected.
        r2 = owner.get("/api/catalog/not-in-catalog-xyz/logo")
        assert r2.status_code == 404, (
            f"Expected 404 for unknown slug 'not-in-catalog-xyz', got {r2.status_code}"
        )


class TestLogoProxyGuard2:
    """Guard-2 isolation: path-traversal check inside catalog_logo.

    Guard 1 rejects unknown slugs before any FS join.
    Guard 2 resolves the logo_rel path and verifies the result stays inside repo_dir.
    This test exercises Guard 2 specifically by monkeypatching pieces.get_piece so that
    a KNOWN slug ('gmail') returns an entry whose logo_rel points outside repo_dir,
    then asserts the route returns 404 (not a file read from outside the repo).
    """

    @pytest.fixture(autouse=True)
    def seed(self, tmp_path):
        _seed_catalog(tmp_path)
        yield
        os.environ.pop("PIECES_SOURCE", None)
        get_settings.cache_clear()

    def test_guard2_rejects_logo_rel_outside_repo_dir(self, owner, monkeypatch):
        """Guard 2 blocks logo_rel values that resolve outside repo_dir.

        TDD: this test would fail if the resolve+prefix check in catalog_logo were removed.
        With Guard 2 in place the route must return 404.
        """
        import omilo_api.pieces as P

        # Capture the real repo_dir so we can confirm the guard is about escaping it.
        real_repo_dir = P.repo_dir()

        # Build a fake index entry for 'gmail' (Guard 1 passes) but with a logo_rel that
        # traverses outside repo_dir.  Use an absolute path to make the escape obvious.
        traversal_logo_rel = "../../etc/passwd"
        fake_entry = {
            "slug": "gmail",
            "status": "ok",
            "label": "Gmail",
            "category": "Email",
            "description": "Read and draft email",
            "logo_rel": traversal_logo_rel,
            "manifest": {},
        }

        # Monkeypatch pieces.get_piece so the route sees our crafted entry.
        monkeypatch.setattr(P, "get_piece", lambda slug: fake_entry if slug == "gmail" else None)

        r = owner.get("/api/catalog/gmail/logo")

        # Guard 2 must block this — resolved path escapes repo_dir.
        assert r.status_code == 404, (
            f"Guard 2 must reject logo_rel '{traversal_logo_rel}' that escapes repo_dir "
            f"(repo_dir={real_repo_dir}).  Got {r.status_code}: {r.text[:300]}"
        )

    def test_guard2_rejects_absolute_logo_rel(self, owner, monkeypatch):
        """Guard 2 also blocks an absolute logo_rel (e.g. /etc/passwd)."""
        import omilo_api.pieces as P

        real_repo_dir = P.repo_dir()

        fake_entry = {
            "slug": "gmail",
            "status": "ok",
            "label": "Gmail",
            "category": "Email",
            "description": "Read and draft email",
            "logo_rel": "/etc/passwd",
            "manifest": {},
        }

        monkeypatch.setattr(P, "get_piece", lambda slug: fake_entry if slug == "gmail" else None)

        r = owner.get("/api/catalog/gmail/logo")

        assert r.status_code == 404, (
            f"Guard 2 must reject absolute logo_rel '/etc/passwd' "
            f"(repo_dir={real_repo_dir}).  Got {r.status_code}: {r.text[:300]}"
        )
