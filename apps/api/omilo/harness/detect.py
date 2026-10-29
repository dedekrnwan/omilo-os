"""Local AI-harness detection — a self-host/runtime feature.

Probes the machine the runtime runs on for the coding-assistant CLIs whose
subscriptions Omilo can pool: Claude Code, OpenCode, Codex, GitHub Copilot,
Gemini CLI, and Cursor.  For each, reports whether the binary is on PATH (or a
known install dir exists) and whether a credential/auth file is present
("signed in").

This only sees the machine where the runtime executes — in a vendor-hosted
*cloud* deployment it will find nothing, which is correct (there's no user
machine to inspect).  It is read-only and never raises: a probe failure for one
harness degrades to ``installed=False`` for that harness, not a 500.
"""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

# Declarative probe table. ``bins`` are checked on PATH; ``install_paths`` mark
# presence even without a PATH entry; ``signin_paths`` indicate an authenticated
# session (credential/config files the CLIs write on login).
_PROBES: list[dict[str, Any]] = [
    {
        "id": "claude-code",
        "name": "Claude Code",
        "bins": ["claude"],
        "install_paths": ["~/.claude", "~/.claude.json"],
        "signin_paths": [
            "~/.claude/.credentials.json",
            "~/.claude.json",
            "~/.config/claude/.credentials.json",
        ],
    },
    {
        "id": "opencode",
        "name": "OpenCode",
        "bins": ["opencode"],
        "install_paths": ["~/.config/opencode", "~/.local/share/opencode", "~/.opencode"],
        "signin_paths": [
            "~/.local/share/opencode/auth.json",
            "~/.config/opencode/auth.json",
        ],
    },
    {
        "id": "codex",
        "name": "Codex",
        "bins": ["codex"],
        "install_paths": ["~/.codex"],
        "signin_paths": ["~/.codex/auth.json"],
    },
    {
        "id": "copilot",
        "name": "GitHub Copilot",
        "bins": ["copilot"],
        "install_paths": ["~/.config/github-copilot", "~/.copilot"],
        "signin_paths": [
            "~/.config/github-copilot/apps.json",
            "~/.config/github-copilot/hosts.json",
            "~/.copilot/config.json",
        ],
    },
    {
        "id": "gemini-cli",
        "name": "Gemini CLI",
        "bins": ["gemini"],
        "install_paths": ["~/.gemini"],
        "signin_paths": [
            "~/.gemini/oauth_creds.json",
            "~/.gemini/access_tokens.json",
        ],
    },
    {
        "id": "cursor",
        "name": "Cursor",
        "bins": ["cursor-agent", "cursor"],
        "install_paths": [
            "~/.cursor",
            "~/Library/Application Support/Cursor",
            "~/.config/Cursor",
        ],
        "signin_paths": ["~/.cursor/cli-config.json", "~/.cursor/auth.json"],
    },
]


def _which(bins: list[str]) -> str | None:
    for name in bins:
        try:
            path = shutil.which(name)
        except OSError:
            path = None
        if path:
            return path
    return None


def _first_existing(paths: list[str]) -> str | None:
    for p in paths:
        try:
            if Path(p).expanduser().exists():
                return p
        except OSError:
            continue
    return None


def _probe_one(probe: dict[str, Any]) -> dict[str, Any]:
    bin_path = _which(probe["bins"])
    install_path = _first_existing(probe["install_paths"])
    installed = bool(bin_path or install_path)
    signin_path = _first_existing(probe["signin_paths"]) if installed else None
    signed_in = bool(signin_path)

    if bin_path:
        detail = bin_path
    elif install_path:
        detail = install_path
    else:
        detail = ""

    return {
        "id": probe["id"],
        "name": probe["name"],
        "installed": installed,
        "signed_in": signed_in,
        "detail": detail,
    }


def detect_harnesses() -> list[dict[str, Any]]:
    """Probe every known harness on this machine. Never raises."""
    out: list[dict[str, Any]] = []
    for probe in _PROBES:
        try:
            out.append(_probe_one(probe))
        except Exception:  # pragma: no cover — defensive; one bad probe != 500
            out.append(
                {
                    "id": probe["id"],
                    "name": probe["name"],
                    "installed": False,
                    "signed_in": False,
                    "detail": "",
                }
            )
    return out
