"""Connector pieces: manifest schema, validation, and file-based GitHub catalog indexer.

The catalog mirrors the talent.py pattern: a JSON index lives under <data_dir>/pieces/index.json
and is populated by fetching the omilo/pieces GitHub repo (or a local checkout), walking
pieces/*/piece.yaml, and running validate_manifest on each.

Sources, in order: PIECES_SOURCE (a local checkout path) → `git clone` → GitHub tarball.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import shutil
import subprocess
import tarfile
import time
from pathlib import Path

import httpx
import yaml

from .config import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Slug pattern (reused from validate_manifest)
# ---------------------------------------------------------------------------
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")

# ---------------------------------------------------------------------------
# Catalog repo configuration
# ---------------------------------------------------------------------------
PIECES_REPO = os.environ.get("PIECES_REPO", "omilo/pieces")
_REPO_URL = f"https://github.com/{PIECES_REPO}"
_TARBALLS = [
    f"https://codeload.github.com/{PIECES_REPO}/tar.gz/refs/heads/main",
    f"https://api.github.com/repos/{PIECES_REPO}/tarball/main",
]
MAX_FILE = 500_000


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def root() -> Path:
    """Return and create <data_dir>/pieces."""
    d = get_settings().data_dir / "pieces"
    d.mkdir(parents=True, exist_ok=True)
    return d


def repo_dir() -> Path:
    """Local clone of the pieces repo."""
    return root() / "pieces-repo"


def index_path() -> Path:
    """Path to the JSON index file."""
    return root() / "index.json"


# ---------------------------------------------------------------------------
# Fetch: source order = PIECES_SOURCE env → git clone/pull → tarball
# ---------------------------------------------------------------------------

def fetch(dest: Path | None = None) -> None:
    """Refresh the local copy of the pieces repo."""
    if dest is None:
        dest = repo_dir()

    src = os.environ.get("PIECES_SOURCE")
    if src:
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns(".git", "node_modules"))
        return

    # Re-read PIECES_REPO at call time so env overrides after module load work.
    repo = os.environ.get("PIECES_REPO", "omilo/pieces")
    repo_url = f"https://github.com/{repo}"
    tarballs = [
        f"https://codeload.github.com/{repo}/tar.gz/refs/heads/main",
        f"https://api.github.com/repos/{repo}/tarball/main",
    ]

    git = shutil.which("git")
    if git:
        try:
            if (dest / ".git").exists():
                subprocess.run(
                    [git, "-C", str(dest), "pull", "--ff-only", "-q"],
                    check=True, capture_output=True, timeout=180,
                )
            else:
                if dest.exists():
                    shutil.rmtree(dest)
                subprocess.run(
                    [git, "clone", "-q", "--depth", "1", repo_url + ".git", str(dest)],
                    check=True, capture_output=True, timeout=300,
                )
            return
        except (subprocess.SubprocessError, OSError):
            pass  # fall back to tarball

    last = None
    for url in tarballs:
        try:
            r = httpx.get(url, follow_redirects=True, timeout=120, headers={"User-Agent": "omilo"})
            r.raise_for_status()
            _extract(r.content, dest)
            return
        except Exception as e:  # noqa: BLE001
            last = e

    raise RuntimeError(f"Could not download pieces repo from GitHub ({repo}): {last}")


def _extract(data: bytes, dest: Path) -> None:
    """Extract .yaml/.yml/.svg/LICENSE files from a GitHub tarball, never outside dest."""
    tmp = dest.with_name(dest.name + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for m in tar.getmembers():
            if not m.isfile() or m.size > MAX_FILE:
                continue
            parts = Path(m.name).parts[1:]  # drop "<repo>-<sha>/" prefix
            if not parts or any(p in ("..", "") or p.startswith("/") for p in parts):
                continue
            rel = Path(*parts)
            if rel.suffix not in (".yaml", ".yml", ".svg", ".json") and rel.name != "LICENSE":
                continue
            out = (tmp / rel).resolve()
            if not str(out).startswith(str(tmp.resolve())):
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            f = tar.extractfile(m)
            if f:
                out.write_bytes(f.read())
    if dest.exists():
        shutil.rmtree(dest)
    tmp.rename(dest)


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _parse_source(path: Path) -> list[dict]:
    """Walk path/pieces/*/piece.yaml; return a list of catalog entries.

    Each entry: {slug, label, category, description, logo_rel, manifest, status, error}
    status is 'ok' (no validation errors) or 'invalid' (with error = joined messages).
    logo_rel is the repo-relative path to the piece's logo.svg if present, else ''.
    """
    pieces_root = path / "pieces"
    entries: list[dict] = []

    if not pieces_root.is_dir():
        return entries

    for piece_dir in sorted(pieces_root.iterdir()):
        if not piece_dir.is_dir():
            continue
        manifest_file = piece_dir / "piece.yaml"
        if not manifest_file.exists():
            continue

        slug = piece_dir.name

        try:
            raw = yaml.safe_load(manifest_file.read_text(errors="replace")) or {}
        except yaml.YAMLError as exc:
            entries.append({
                "slug": slug,
                "label": "",
                "category": "",
                "description": "",
                "logo_rel": "",
                "manifest": {},
                "status": "invalid",
                "error": f"YAML parse error: {exc}",
            })
            continue

        errors = validate_manifest(raw)

        # Determine logo_rel: relative to the repo root (= path)
        logo_file = piece_dir / "logo.svg"
        if logo_file.exists():
            try:
                logo_rel = str(logo_file.relative_to(path))
            except ValueError:
                logo_rel = ""
        else:
            logo_rel = ""

        if errors:
            entries.append({
                "slug": slug,
                "label": raw.get("label", "") if isinstance(raw, dict) else "",
                "category": raw.get("category", "") if isinstance(raw, dict) else "",
                "description": raw.get("description", "") if isinstance(raw, dict) else "",
                "logo_rel": logo_rel,
                "manifest": raw if isinstance(raw, dict) else {},
                "status": "invalid",
                "error": "; ".join(errors),
            })
        else:
            entries.append({
                "slug": slug,
                "label": raw.get("label", ""),
                "category": raw.get("category", ""),
                "description": raw.get("description", ""),
                "logo_rel": logo_rel,
                "manifest": raw,
                "status": "ok",
                "error": "",
            })

    return entries


# ---------------------------------------------------------------------------
# Reindex + readers
# ---------------------------------------------------------------------------

def reindex() -> dict:
    """Fetch the latest source, parse all pieces, and write index.json.

    Pieces that existed in the prior index but are absent from the new source
    are kept with status='missing'.

    On fetch/parse failure, logs the error and leaves the existing index.json
    untouched (last-good behaviour).

    Returns a counts dict: {"ok": n, "invalid": n, "missing": n}.
    """
    # Load prior index for diff
    prior_by_slug: dict[str, dict] = {}
    if index_path().exists():
        try:
            prior_data = json.loads(index_path().read_text())
            for entry in prior_data.get("pieces", []):
                prior_by_slug[entry["slug"]] = entry
        except Exception:  # noqa: BLE001
            pass

    # Attempt fetch
    try:
        fetch()
    except Exception as exc:  # noqa: BLE001
        logger.warning("pieces.reindex: fetch failed (%s); keeping last-good index", exc)
        counts = {"ok": 0, "invalid": 0, "missing": 0}
        for e in prior_by_slug.values():
            counts[e.get("status", "invalid")] = counts.get(e.get("status", "invalid"), 0) + 1
        return counts

    # Parse the freshly fetched source
    try:
        fresh = _parse_source(repo_dir())
    except Exception as exc:  # noqa: BLE001
        logger.warning("pieces.reindex: parse failed (%s); keeping last-good index", exc)
        counts = {"ok": 0, "invalid": 0, "missing": 0}
        for e in prior_by_slug.values():
            counts[e.get("status", "invalid")] = counts.get(e.get("status", "invalid"), 0) + 1
        return counts

    fresh_by_slug = {e["slug"]: e for e in fresh}

    # Carry forward missing pieces from prior index
    combined: list[dict] = list(fresh)
    for slug, prior_entry in prior_by_slug.items():
        if slug not in fresh_by_slug:
            missing_entry = dict(prior_entry)
            missing_entry["status"] = "missing"
            missing_entry["error"] = missing_entry.get("error", "")
            combined.append(missing_entry)

    # Count by status
    counts: dict[str, int] = {"ok": 0, "invalid": 0, "missing": 0}
    for entry in combined:
        s = entry.get("status", "invalid")
        counts[s] = counts.get(s, 0) + 1

    # Write index.json
    index_path().write_text(json.dumps({
        "synced_at": time.time(),
        "pieces": combined,
    }))

    return counts


def _load_index() -> list[dict]:
    """Load all entries from index.json (empty list if missing)."""
    p = index_path()
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text())
        return data.get("pieces", [])
    except Exception:  # noqa: BLE001
        return []


def catalog() -> list[dict]:
    """Return only 'ok' pieces with public fields (no manifest internals)."""
    public = ("slug", "label", "category", "description", "logo_rel")
    return [
        {k: e[k] for k in public}
        for e in _load_index()
        if e.get("status") == "ok"
    ]


def get_piece(slug: str) -> dict | None:
    """Return the full index entry (including manifest) for slug, or None if not found."""
    for entry in _load_index():
        if entry.get("slug") == slug:
            return entry
    return None


# ---------------------------------------------------------------------------
# Manifest validation (Task 1 — unchanged below)
# ---------------------------------------------------------------------------

def validate_manifest(data: dict) -> list[str]:
    """Validate a connector piece manifest.

    Args:
        data: A manifest dictionary to validate.

    Returns:
        A list of error messages (empty list = valid manifest).
    """
    errors = []

    # Top-level required fields
    if not isinstance(data, dict):
        errors.append("Manifest must be a dictionary.")
        return errors

    # Validate 'id'
    id_val = data.get("id")
    if not id_val or not isinstance(id_val, str):
        errors.append("Missing or invalid 'id': must be a non-empty string.")
    elif not SLUG.match(id_val):
        errors.append(
            f"Invalid 'id' '{id_val}': must start with lowercase alphanumeric, "
            "allow hyphens, max 41 characters."
        )

    # Validate 'label'
    label = data.get("label")
    if not label or not isinstance(label, str):
        errors.append("Missing or invalid 'label': must be a non-empty string.")

    # Validate 'category'
    category = data.get("category")
    if not category or not isinstance(category, str):
        errors.append("Missing or invalid 'category': must be a non-empty string.")

    # Validate 'description'
    description = data.get("description")
    if not description or not isinstance(description, str):
        errors.append("Missing or invalid 'description': must be a non-empty string.")

    # Validate 'auth'
    auth = data.get("auth")
    if not isinstance(auth, dict):
        errors.append("Missing or invalid 'auth': must be a dictionary.")
    else:
        # Validate auth.type
        auth_type = auth.get("type")
        if auth_type != "oauth2":
            errors.append(
                f"Invalid 'auth.type' '{auth_type}': must be 'oauth2'."
            )

        # Validate auth.provider
        provider = auth.get("provider")
        if not provider or not isinstance(provider, str):
            errors.append(
                "Missing or invalid 'auth.provider': must be a non-empty string."
            )

        # Validate auth.scopes
        scopes = auth.get("scopes")
        if not isinstance(scopes, list) or len(scopes) == 0:
            errors.append(
                "Missing or invalid 'auth.scopes': must be a non-empty list."
            )
        else:
            # Validate each scope element is a non-empty string
            for i, scope in enumerate(scopes):
                if not isinstance(scope, str) or len(scope) == 0:
                    errors.append(
                        f"Invalid 'auth.scopes[{i}]': must be a non-empty string, got {type(scope).__name__}."
                    )

    # Validate 'actions'
    actions = data.get("actions")
    if not isinstance(actions, list) or len(actions) == 0:
        errors.append("Missing or invalid 'actions': must be a non-empty list.")
    else:
        for i, action in enumerate(actions):
            if not isinstance(action, dict):
                errors.append(f"Action {i}: must be a dictionary.")
                continue

            # Validate action.name
            name = action.get("name")
            if not name or not isinstance(name, str):
                errors.append(f"Action {i}: missing or invalid 'name'.")
            elif not SLUG.match(name):
                errors.append(
                    f"Action {i}: invalid 'name' '{name}': must match slug pattern."
                )

            # Validate action.label
            action_label = action.get("label")
            if not action_label or not isinstance(action_label, str):
                errors.append(f"Action {i}: missing or invalid 'label'.")

            # Validate action.approval
            approval = action.get("approval")
            if approval not in ("auto", "ask"):
                errors.append(
                    f"Action {i}: invalid 'approval' '{approval}': must be 'auto' or 'ask'."
                )

            # Validate action.http
            http = action.get("http")
            if not isinstance(http, dict):
                errors.append(f"Action {i}: missing or invalid 'http'.")
            else:
                # Validate http.method
                method = http.get("method")
                valid_methods = {"GET", "POST", "PUT", "PATCH", "DELETE"}
                if method not in valid_methods:
                    errors.append(
                        f"Action {i}: invalid 'http.method' '{method}': "
                        f"must be one of {valid_methods}."
                    )

                # Validate http.url
                url = http.get("url")
                if not url or not isinstance(url, str):
                    errors.append(f"Action {i}: missing or invalid 'http.url'.")
                elif not url.startswith("https://"):
                    errors.append(
                        f"Action {i}: invalid 'http.url' '{url}': must be absolute HTTPS."
                    )

                # Validate http.auth
                auth_type = http.get("auth")
                if auth_type != "bearer":
                    errors.append(
                        f"Action {i}: invalid 'http.auth' '{auth_type}': must be 'bearer'."
                    )

            # Validate action.inputs (optional but if present, must be well-formed)
            inputs = action.get("inputs")
            if inputs is not None:
                if not isinstance(inputs, list):
                    errors.append(f"Action {i}: 'inputs' must be a list.")
                else:
                    for j, inp in enumerate(inputs):
                        if not isinstance(inp, dict):
                            errors.append(f"Action {i}, input {j}: must be a dictionary.")
                            continue

                        # Validate input.name
                        inp_name = inp.get("name")
                        if not inp_name or not isinstance(inp_name, str):
                            errors.append(
                                f"Action {i}, input {j}: missing or invalid 'name'."
                            )

                        # Validate input.type
                        inp_type = inp.get("type")
                        if not inp_type or not isinstance(inp_type, str):
                            errors.append(
                                f"Action {i}, input {j}: missing or invalid 'type'."
                            )

    return errors
