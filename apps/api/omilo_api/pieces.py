"""Connector pieces: manifest schema, validation, file-based GitHub catalog indexer,
and declarative action runtime (MCP tool compilation + SSRF-guarded HTTP execution).

The catalog mirrors the talent.py pattern: a JSON index lives under <data_dir>/pieces/index.json
and is populated by fetching the pieces GitHub repo (PIECES_REPO, or a local checkout), walking
pieces/*/piece.yaml, and running validate_manifest on each.

Sources, in order: PIECES_SOURCE (a local checkout path) → `git clone` → GitHub tarball.
"""
from __future__ import annotations

import base64 as _base64
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
from urllib.parse import urlparse

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
# Default catalog repo. Override with PIECES_REPO (owner/name on GitHub) or, for local
# development, PIECES_SOURCE (a path to a checkout) which takes precedence in fetch().
DEFAULT_PIECES_REPO = "dedekrnwan/omilo-pieces"
PIECES_REPO = os.environ.get("PIECES_REPO", DEFAULT_PIECES_REPO)
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
    repo = os.environ.get("PIECES_REPO", DEFAULT_PIECES_REPO)
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
                "type": raw.get("type", "piece") if isinstance(raw, dict) else "piece",
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
                "type": raw.get("type", "piece"),
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
        {**{k: e[k] for k in public}, "type": e.get("type", "piece")}
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

    # Validate 'type' (optional; absent ⇒ "piece")
    manifest_type = data.get("type", "piece")
    if manifest_type not in {"piece", "mcp"}:
        errors.append(
            f"Invalid 'type' '{manifest_type}': must be 'piece' or 'mcp'."
        )
        # Fall through to collect any other errors but skip type-specific checks
        manifest_type = None

    # Validate 'id'
    id_val = data.get("id")
    if not id_val or not isinstance(id_val, str):
        errors.append("Missing or invalid 'id': must be a non-empty string.")
    elif not SLUG.match(id_val):
        errors.append(
            f"Invalid 'id' '{id_val}': must start with lowercase alphanumeric, "
            "allow hyphens, max 41 characters."
        )

    if manifest_type == "mcp":
        # -----------------------------------------------------------------------
        # MCP manifest validation — requires label/category/description + mcp block
        # -----------------------------------------------------------------------

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

        # Validate 'mcp' block
        mcp_block = data.get("mcp")
        if not isinstance(mcp_block, dict):
            errors.append("Missing or invalid 'mcp': must be a dictionary.")
        else:
            # Validate mcp.url
            mcp_url = mcp_block.get("url")
            if not mcp_url or not isinstance(mcp_url, str):
                errors.append("Missing or invalid 'mcp.url': must be a non-empty string.")
            elif not mcp_url.startswith("https://"):
                errors.append(
                    f"Invalid 'mcp.url' '{mcp_url}': must start with https://."
                )
            elif not mcp_host_allowed(mcp_url):
                errors.append(
                    f"Invalid 'mcp.url' host: host is not in the MCP host allowlist."
                )

            # Validate mcp.auth
            mcp_auth = mcp_block.get("auth")
            if not isinstance(mcp_auth, dict):
                errors.append("Missing or invalid 'mcp.auth': must be a dictionary.")
            else:
                # Validate mcp.auth.scheme
                scheme = mcp_auth.get("scheme")
                if scheme not in {"header", "basic"}:
                    errors.append(
                        f"Invalid 'mcp.auth.scheme' '{scheme}': must be 'header' or 'basic'."
                    )

                # Validate mcp.auth.fields
                fields = mcp_auth.get("fields")
                if not isinstance(fields, list) or len(fields) == 0:
                    errors.append(
                        "Missing or invalid 'mcp.auth.fields': must be a non-empty list."
                    )
                else:
                    # MCP field names allow underscores (credential identifiers like access_key).
                    _FIELD_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,40}$")
                    for i, field in enumerate(fields):
                        if not isinstance(field, dict):
                            errors.append(f"mcp.auth.fields[{i}]: must be a dictionary.")
                            continue
                        f_name = field.get("name")
                        if not f_name or not isinstance(f_name, str) or not _FIELD_NAME_RE.match(f_name):
                            errors.append(
                                f"mcp.auth.fields[{i}]: 'name' must be a non-empty slug string."
                            )
                        f_label = field.get("label")
                        if not f_label or not isinstance(f_label, str):
                            errors.append(
                                f"mcp.auth.fields[{i}]: 'label' must be a non-empty string."
                            )

                # Validate mcp.auth.attach
                attach = mcp_auth.get("attach")
                if not isinstance(attach, dict) or len(attach) == 0:
                    errors.append(
                        "Missing or invalid 'mcp.auth.attach': must be a non-empty dictionary."
                    )

        return errors

    # -----------------------------------------------------------------------
    # piece manifest validation (type == "piece" or absent) — existing checks
    # -----------------------------------------------------------------------

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

    # Validate 'runtime' (optional; absent ⇒ treated as "http")
    if "runtime" in data:
        runtime_val = data["runtime"]
        if runtime_val not in ("http", "engine"):
            errors.append(
                f"Invalid 'runtime' '{runtime_val}': must be 'http' or 'engine'."
            )

    # Validate 'auth'
    auth = data.get("auth")
    if not isinstance(auth, dict):
        errors.append("Missing or invalid 'auth': must be a dictionary.")
    else:
        # Validate auth.type
        auth_type = auth.get("type")
        _VALID_AUTH_TYPES = {"oauth2", "apikey"}
        if auth_type not in _VALID_AUTH_TYPES:
            errors.append(
                f"Invalid 'auth.type' '{auth_type}': must be 'oauth2' or 'apikey'."
            )
        elif auth_type == "apikey":
            # Validate auth.scheme
            _VALID_APIKEY_SCHEMES = {"bearer", "basic", "header", "query"}
            scheme = auth.get("scheme")
            if scheme not in _VALID_APIKEY_SCHEMES:
                errors.append(
                    f"Invalid 'auth.scheme' '{scheme}': must be one of {sorted(_VALID_APIKEY_SCHEMES)}."
                )

            # Validate auth.fields
            _FIELD_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,40}$")
            fields = auth.get("fields")
            if not isinstance(fields, list) or len(fields) == 0:
                errors.append(
                    "Missing or invalid 'auth.fields': must be a non-empty list."
                )
            else:
                for i, field in enumerate(fields):
                    if not isinstance(field, dict):
                        errors.append(f"auth.fields[{i}]: must be a dictionary.")
                        continue
                    f_name = field.get("name")
                    if not f_name or not isinstance(f_name, str) or not _FIELD_NAME_RE.match(f_name):
                        errors.append(
                            f"auth.fields[{i}]: 'name' must be a non-empty slug string."
                        )
                    f_label = field.get("label")
                    if not f_label or not isinstance(f_label, str):
                        errors.append(
                            f"auth.fields[{i}]: 'label' must be a non-empty string."
                        )

            # Validate auth.attach
            attach = auth.get("attach")
            if not isinstance(attach, dict) or len(attach) == 0:
                errors.append(
                    "Missing or invalid 'auth.attach': must be a non-empty dictionary."
                )
        else:
            # auth_type == "oauth2": existing checks unchanged
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

                # Validate http.auth (only required to be "bearer" for oauth2 manifests)
                manifest_auth_type = auth.get("type") if isinstance(auth, dict) else None
                if manifest_auth_type == "oauth2":
                    http_auth = http.get("auth")
                    if http_auth != "bearer":
                        errors.append(
                            f"Action {i}: invalid 'http.auth' '{http_auth}': must be 'bearer'."
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

    # Validate 'triggers' (optional; if present must be a list of well-formed trigger dicts)
    if "triggers" in data:
        triggers = data["triggers"]
        if not isinstance(triggers, list):
            errors.append("Invalid 'triggers': must be a list.")
        else:
            for i, trigger in enumerate(triggers):
                if not isinstance(trigger, dict):
                    errors.append(f"triggers[{i}]: must be a dictionary.")
                    continue

                # Validate trigger.name (slug pattern, required)
                name = trigger.get("name")
                if not name or not isinstance(name, str) or not SLUG.match(name):
                    errors.append(f"Trigger {i}: missing or invalid 'name'.")

                # Validate trigger.event (non-empty string, required)
                event = trigger.get("event")
                if not event or not isinstance(event, str):
                    errors.append(f"Trigger {i}: missing or invalid 'event'.")

                # Validate trigger.mapping (optional, must be dict if present)
                if "mapping" in trigger and not isinstance(trigger["mapping"], dict):
                    errors.append(f"Trigger {i}: 'mapping' must be a dictionary.")

    return errors


# ---------------------------------------------------------------------------
# Declarative action runtime (Task 3)
# ---------------------------------------------------------------------------

# Map manifest input types → JSON Schema types.  Unmapped types fall through as-is.
_TYPE_MAP: dict[str, str] = {
    "string": "string",
    "integer": "integer",
    "number": "number",
    "boolean": "boolean",
    "array": "array",
    "object": "object",
}

# Regex that matches a {{ ... }} template expression
_TMPL_RE = re.compile(r"\{\{\s*(.+?)\s*\}\}")

# Regex that detects a base64(expr) helper call
_BASE64_RE = re.compile(r"^base64\((.+)\)$")


def _render_value(expr: str, args: dict) -> str:
    """Resolve a single template expression (the content between {{ }}).

    Supported:
    - Plain variable reference: ``some_var``
    - base64 helper: ``base64(some_var)``

    Raises KeyError if a variable is not present in args.
    Raises ValueError for unrecognised helper calls.
    """
    expr = expr.strip()
    m = _BASE64_RE.match(expr)
    if m:
        inner = m.group(1).strip()
        raw_val = str(args[inner])
        return _base64.b64encode(raw_val.encode()).decode()
    # Plain variable
    return str(args[expr])


def _render_str(template: str, args: dict) -> str:
    """Substitute every {{ expr }} in *template* using args.

    Raises KeyError for missing variables, ValueError for unknown helpers.
    """
    def _sub(match: re.Match) -> str:
        return _render_value(match.group(1), args)

    return _TMPL_RE.sub(_sub, template)


def _render_obj(obj: object, args: dict) -> object:
    """Recursively render template expressions in dicts, lists, and strings."""
    if isinstance(obj, str):
        return _render_str(obj, args)
    if isinstance(obj, dict):
        return {k: _render_obj(v, args) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_render_obj(item, args) for item in obj]
    return obj


def _has_template(value: str) -> bool:
    """Return True if the string contains a {{ ... }} placeholder."""
    return bool(_TMPL_RE.search(value))


# ---------------------------------------------------------------------------
# Out-of-band provider domain registry (security boundary — never derive from manifest).
#
# Each provider maps to the set of apex domains it is authorised to call.
# A request host passes iff it equals one of these domains OR is a dotted-left-subdomain
# of one of them (e.g. "gmail.googleapis.com" passes "googleapis.com" because it ends
# with ".googleapis.com"; but "googleapis.com.evil.com" is REJECTED).
#
# IMPORTANT: Adding a new provider here is a deliberate security decision — do not add
# entries without review. Any connector whose provider is absent from this registry will
# have provider_hosts() return an empty set, which blocks every outbound request.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# MCP host allowlist (security boundary — seed empty; Task 5 adds mcp.repliz.com).
#
# A URL's host passes iff it equals a host in MCP_HOSTS or is a dotted-left-subdomain
# of one (same rule as _check_host / PROVIDER_DOMAINS).
# ---------------------------------------------------------------------------
MCP_HOSTS: set[str] = {"mcp.repliz.com"}


def mcp_host_allowed(url: str) -> bool:
    """Return True iff the URL's host equals or is a dotted subdomain of an MCP_HOSTS entry.

    All comparisons are case-insensitive.  Returns False for unparseable URLs.
    """
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower().strip()
    if not hostname:
        return False
    for h in MCP_HOSTS:
        d = h.lower()
        if hostname == d or hostname.endswith("." + d):
            return True
    return False


PROVIDER_DOMAINS: dict[str, set[str]] = {
    "google": {"googleapis.com", "google.com"},
    "meta": {"facebook.com", "instagram.com", "whatsapp.com"},
    "slack": {"slack.com"},
    "github": {"github.com", "api.github.com"},
    "microsoft": {"microsoft.com", "microsoftonline.com", "graph.microsoft.com"},
    "stripe": {"stripe.com"},
    "twilio": {"twilio.com"},
    "shopify": {"shopify.com", "myshopify.com"},
    "hubspot": {"hubspot.com", "hubapi.com"},
    "notion": {"notion.so", "notion.com"},
    "discord": {"discord.com", "discordapp.com"},
    "twitter": {"twitter.com", "x.com", "api.twitter.com"},
    "linkedin": {"linkedin.com"},
    "dropbox": {"dropbox.com", "dropboxapi.com"},
    "box": {"box.com", "boxcloud.com"},
    "salesforce": {"salesforce.com", "force.com"},
    "zendesk": {"zendesk.com"},
    "jira": {"atlassian.com", "atlassian.net"},
    "asana": {"asana.com"},
    "airtable": {"airtable.com"},
    "mailchimp": {"mailchimp.com", "mandrillapp.com"},
    "sendgrid": {"sendgrid.com", "api.sendgrid.com"},
    "zoom": {"zoom.us"},
    "calendly": {"calendly.com"},
    "typeform": {"typeform.com", "api.typeform.com"},
}


def provider_hosts(manifest: dict) -> set[str]:
    """Return the set of allowed apex domains for the manifest's declared auth.provider.

    Uses an OUT-OF-BAND hardcoded registry (PROVIDER_DOMAINS) — never derives the
    allowlist from the manifest itself, so an attacker-controlled manifest cannot
    inject an off-provider host into the allowlist.

    Returns an empty set for any provider not present in the registry, which causes
    _check_host to block every outbound request (fail-closed).
    """
    provider = (manifest.get("auth") or {}).get("provider", "").lower()
    return set(PROVIDER_DOMAINS.get(provider, set()))


def _check_host(url: str, manifest: dict) -> None:
    """Raise ValueError if the resolved request URL's host is not permitted by the registry.

    A host H is permitted for a provider iff, for some domain D in PROVIDER_DOMAINS[provider]:
      - H == D  (exact match), OR
      - H.endswith('.' + D)  (dotted-left-subdomain, e.g. 'gmail.googleapis.com' → 'googleapis.com')

    This dotted-suffix check means 'googleapis.com.evil.com' is REJECTED even though
    it ends with 'com' and contains 'googleapis.com' as a substring.

    All comparisons are case-insensitive.

    This is the SSRF guard: no call may leave the provider's registered domain(s).
    """
    allowed_domains = provider_hosts(manifest)
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower().strip()

    if not hostname:
        raise ValueError(
            "Request URL has no resolvable host. Action aborted (SSRF prevention)."
        )

    for domain in allowed_domains:
        d = domain.lower()
        if hostname == d or hostname.endswith("." + d):
            return  # PASS

    raise ValueError(
        f"Request host '{hostname}' is not permitted for this provider. "
        f"Allowed domains: {sorted(allowed_domains)!r}. "
        "Possible SSRF attempt — action aborted."
    )


def action_tools(manifest: dict) -> list[dict]:
    """Compile a manifest's actions into MCP tool definitions.

    Each action becomes:
    ``{"name": action.name, "description": action.label, "inputSchema": {...}}``

    The inputSchema is a JSON Schema object built from the action's ``inputs`` list:
    - ``type`` is always ``"object"``
    - ``properties`` maps each input name → ``{"type": <json-schema-type>}``
    - ``required`` lists the names of inputs with ``required: true``
    """
    tools: list[dict] = []
    for action in manifest.get("actions", []):
        inputs = action.get("inputs") or []
        properties: dict[str, dict] = {}
        required: list[str] = []
        for inp in inputs:
            name = inp["name"]
            raw_type = inp.get("type", "string")
            json_type = _TYPE_MAP.get(raw_type, raw_type)
            properties[name] = {"type": json_type}
            if inp.get("required"):
                required.append(name)

        tools.append({
            "name": action["name"],
            "description": action.get("label", ""),
            "inputSchema": {
                "type": "object",
                "properties": properties,
                "required": required,
            },
        })
    return tools


def run_action(
    manifest: dict,
    action: str,
    args: dict,
    token: str,
) -> tuple[str, dict]:
    """Execute a named action against the provider API.

    Steps:
    1. Find the action definition in the manifest; raise ValueError if missing.
    2. Resolve the URL (template path variables from args, but *never* the host).
    3. SSRF guard: verify the resolved host is in provider_hosts(manifest).
    4. Template the request body (if any) from args.
    5. Issue the HTTP request via httpx with ``Authorization: Bearer <token>``.
    6. Map 401/403 → needs_reconnect=True.
    7. Return ``(summary_text, meta_dict)``.

    Args:
        manifest: A validated connector piece manifest.
        action: The action ``name`` to execute.
        args: Template arguments (variable substitutions).
        token: OAuth2 bearer token for the request.

    Returns:
        A ``(summary, meta)`` tuple where meta has keys:
        ``status`` (int), ``needs_reconnect`` (bool), and optionally ``raw`` (dict).

    Raises:
        ValueError: If the action is not found, or the resolved host is off-provider.
        KeyError: If a required template variable is missing from args.
    """
    # 1. Locate action definition
    action_def: dict | None = None
    for a in manifest.get("actions", []):
        if a["name"] == action:
            action_def = a
            break
    if action_def is None:
        raise ValueError(f"Action '{action}' not found in manifest '{manifest.get('id')}'.")

    http_cfg = action_def.get("http", {})
    method: str = http_cfg.get("method", "POST").upper()
    url_template: str = http_cfg.get("url", "")

    # 2. Template the URL — but only the path/query, never the host.
    #    Parse first, render only path and query, reassemble.
    parsed = urlparse(url_template)
    # Reject if the host itself is templated
    if _has_template(parsed.netloc):
        raise ValueError(
            f"Action '{action}' http.url has a templated host '{parsed.netloc}', "
            "which is not allowed (SSRF prevention)."
        )
    rendered_path = _render_str(parsed.path, args)
    rendered_query = _render_str(parsed.query, args) if parsed.query else ""
    rendered_url = parsed._replace(path=rendered_path, query=rendered_query).geturl()

    # 3. SSRF guard on the final URL — before issuing the request
    _check_host(rendered_url, manifest)

    # 4. Template the request body
    body_template = http_cfg.get("body")
    rendered_body: dict | None = None
    if body_template is not None:
        rendered_raw = _render_obj(body_template, args)
        if not isinstance(rendered_raw, dict):
            raise ValueError(
                f"Action '{action}' body must render to a dict, "
                f"got {type(rendered_raw).__name__!r}. Check the manifest's http.body."
            )
        rendered_body = rendered_raw

    # 5. Issue the HTTP request (follow_redirects=False prevents redirect-based SSRF)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        with httpx.Client(follow_redirects=False) as client:
            request = client.build_request(
                method,
                rendered_url,
                json=rendered_body,
                headers=headers,
            )
            # Second host check after request construction guards url-with-userinfo tricks
            _check_host(str(request.url), manifest)
            response = client.send(request)
    except httpx.RequestError as exc:
        # Transport-level failure (DNS, timeout, connection refused, etc.).
        # Return a structured result so callers don't need to handle the httpx exception.
        return (
            f"Action '{action}' failed: {exc}",
            {"status": None, "needs_reconnect": False},
        )

    # 6. Map 401/403 → needs_reconnect
    status = response.status_code
    needs_reconnect = status in (401, 403)

    # 7. Build result
    raw: dict | None = None
    try:
        raw = response.json()
    except Exception:  # noqa: BLE001
        pass

    if needs_reconnect:
        summary = f"Action '{action}' failed with {status}; reconnect required."
    else:
        summary = f"Action '{action}' completed with status {status}."

    meta: dict = {"status": status, "needs_reconnect": needs_reconnect}
    if raw is not None:
        meta["raw"] = raw

    return summary, meta
