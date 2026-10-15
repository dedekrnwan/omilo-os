"""What a helper can use in a run: folders on this computer, connectors (MCP servers), skills and attached files.

Defaults come from each item's "default for all helpers" switch; a chat can switch items on or off for itself.
Engines turn this into their own configuration (Claude Code flags, Hermes mcp_servers, prompt notes).
"""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import secrets
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from sqlalchemy import select

from .config import get_settings
from .models import Connector, Folder, Message, ThreadTools
from .security import decrypt, encrypt

SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
MAX_FILE = 25 * 1024 * 1024
MAX_SKILL_CHARS = 30_000


@dataclass
class Resources:
    folders: list[dict] = field(default_factory=list)      # {path, label, access, commands}
    connectors: list[dict] = field(default_factory=list)   # {id, label, kind, url, command, args, headers, env, approval}
    skills: list[dict] = field(default_factory=list)       # {slug, name, description, body}
    files: list[dict] = field(default_factory=list)        # {id, name, mime, path}
    allow_connectors: set[str] = field(default_factory=set)  # one-off: approved connector calls in an execution task

    def note(self) -> str:
        """Plain-language description for any engine's prompt."""
        out = []
        if self.folders:
            out.append("Folders on the founder's computer you may use:\n" + "\n".join(
                f"- {f['path']} ({'read and write' if f['access'] == 'write' else 'read only'}{', terminal commands allowed' if f['commands'] else ''})"
                for f in self.folders))
        if self.connectors:
            lines = []
            for c in self.connectors:
                if c["approval"] == "auto" or c["id"] in self.allow_connectors:
                    lines.append(f"- {c['label']} (tools mcp__{c['id']}__*): use directly")
                else:
                    lines.append(f"- {c['label']} (tools mcp__{c['id']}__*): read-only lookups are fine; for anything that changes or sends, "
                                 f"call request_action(action='connector.{c['id']}', …) with the exact tool and arguments and wait for approval")
            out.append("Connected tools:\n" + "\n".join(lines))
        if self.files:
            out.append("Files the founder attached:\n" + "\n".join(f"- {f['name']} ({f['mime']}): {f['path']}" for f in self.files))
        if self.skills:
            out.append("Skills to apply:\n" + "\n\n".join(f"### Skill: {s['name']}\n{s['body']}" for s in self.skills))
        return "\n\n".join(out)


# ------------------------------------------------------------------ connectors
def connector_secrets(c: Connector) -> dict:
    raw = decrypt(c.secrets_enc) if c.secrets_enc else None
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return {}


def set_connector_secrets(c: Connector, headers: dict | None, env: dict | None) -> None:
    cur = connector_secrets(c)
    if headers is not None:
        cur["headers"] = {k: v for k, v in headers.items() if v}
    if env is not None:
        cur["env"] = {k: v for k, v in env.items() if v}
    c.secrets_enc = encrypt(json.dumps(cur)) if cur else ""


def connector_public(c: Connector) -> dict:
    s = connector_secrets(c)
    return {"id": c.id, "label": c.label, "kind": c.kind, "url": c.url, "command": c.command, "args": c.args or [],
            "approval": c.approval, "default_on": c.default_on, "enabled": c.enabled,
            "header_names": sorted((s.get("headers") or {}).keys()), "env_names": sorted((s.get("env") or {}).keys())}


def connector_runtime(c: Connector) -> dict:
    s = connector_secrets(c)
    return {"id": c.id, "label": c.label, "kind": c.kind, "url": c.url, "command": c.command, "args": c.args or [],
            "headers": s.get("headers") or {}, "env": s.get("env") or {}, "approval": c.approval}


# ------------------------------------------------------------------ skills (files in <data>/skills/<slug>/SKILL.md)
def skills_dir() -> Path:
    d = get_settings().data_dir / "skills"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _parse_skill(slug: str, text: str) -> dict:
    meta, body = {}, text
    if text.startswith("---"):
        try:
            _, fm, body = text.split("---", 2)
            meta = yaml.safe_load(fm) or {}
        except (ValueError, yaml.YAMLError):
            meta = {}
    return {"slug": slug, "name": str(meta.get("name") or slug), "description": str(meta.get("description") or ""),
            "default_on": bool(meta.get("default_on", False)), "body": body.strip()[:MAX_SKILL_CHARS]}


def list_skills() -> list[dict]:
    out = []
    for d in sorted(skills_dir().iterdir()):
        f = d / "SKILL.md"
        if d.is_dir() and f.exists():
            out.append(_parse_skill(d.name, f.read_text(errors="replace")))
    return out


def get_skill(slug: str) -> dict | None:
    f = skills_dir() / slug / "SKILL.md"
    return _parse_skill(slug, f.read_text(errors="replace")) if SLUG.match(slug) and f.exists() else None


def save_skill(slug: str, name: str, description: str, body: str, default_on: bool = False) -> dict:
    if not SLUG.match(slug):
        raise ValueError("skill id: lowercase letters, digits and dashes")
    d = skills_dir() / slug
    d.mkdir(parents=True, exist_ok=True)
    fm = yaml.safe_dump({"name": name, "description": description, "default_on": default_on}, sort_keys=False, allow_unicode=True)
    (d / "SKILL.md").write_text(f"---\n{fm}---\n\n{body.strip()}\n")
    return get_skill(slug)  # type: ignore[return-value]


def delete_skill(slug: str) -> None:
    import shutil

    d = skills_dir() / slug
    if SLUG.match(slug) and d.exists():
        shutil.rmtree(d)


# ------------------------------------------------------------------ files attached in chat
def files_dir() -> Path:
    d = get_settings().data_dir / "files"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_file(name: str, data_b64: str) -> dict:
    return save_bytes(name, base64.b64decode(data_b64, validate=True))


def save_bytes(name: str, raw: bytes) -> dict:
    if len(raw) > MAX_FILE:
        raise ValueError("file is larger than 25 MB")
    safe = re.sub(r"[^A-Za-z0-9._ -]", "_", Path(name).name)[:120] or "file"
    fid = "fil_" + secrets.token_hex(8)
    d = files_dir() / fid
    d.mkdir()
    (d / safe).write_bytes(raw)
    mime = mimetypes.guess_type(safe)[0] or "application/octet-stream"
    return {"id": fid, "name": safe, "mime": mime, "size": len(raw)}


def file_path(fid: str) -> Path | None:
    if not re.match(r"^fil_[0-9a-f]{16}$", fid):
        return None
    d = files_dir() / fid
    items = list(d.iterdir()) if d.exists() else []
    return items[0] if items else None


# files a browser may display inline; anything that could run script (html, svg, xml) is shown as text
INLINE_OK = ("image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "application/pdf", "audio/", "video/")
TEXT_EXT = {".txt", ".md", ".markdown", ".json", ".jsonl", ".csv", ".tsv", ".log", ".yaml", ".yml", ".toml", ".ini", ".env.example",
            ".py", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".go", ".dart", ".rs", ".java", ".kt", ".swift", ".rb", ".php", ".sh", ".sql",
            ".html", ".htm", ".css", ".scss", ".xml", ".svg", ".diff", ".patch", ".c", ".h", ".cpp", ".cs", ".vue", ".svelte", ".gradle"}


def serve_headers(p: Path, download: bool) -> tuple[str, str]:
    """(media type, content-disposition type) for serving a file safely at the app's origin."""
    mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    if download:
        return mime, "attachment"
    if mime.startswith(INLINE_OK):
        return mime, "inline"
    if p.suffix.lower() in TEXT_EXT or mime.startswith("text/"):
        return "text/plain; charset=utf-8", "inline"
    return mime, "attachment"


def readable_roots(db, staff_id: str | None = None) -> list[Path]:
    """Where files may be read from for previews and sharing: shared folders, helper workspaces and the upload store."""
    roots = [Path(f.path) for f in db.scalars(select(Folder))]
    ws = get_settings().data_dir / "workspaces"
    roots.append(ws / staff_id if staff_id else ws)
    roots.append(files_dir())
    return roots


def allowed_path(db, raw: str, staff_id: str | None = None) -> Path | None:
    p = Path(os.path.expanduser(raw.removeprefix("file://"))).resolve()
    if not p.is_file():
        return None
    for r in readable_roots(db, staff_id):
        try:
            if p.is_relative_to(r.resolve()):
                return p
        except OSError:
            continue
    return None


# ------------------------------------------------------------------ resolve for a run
def resolve(db, thread_id: str | None = None, proposal: dict | None = None, file_ids: list[str] | None = None) -> Resources:
    tt = db.get(ThreadTools, thread_id) if thread_id else None
    folders = list(db.scalars(select(Folder)))
    conns = list(db.scalars(select(Connector).where(Connector.enabled.is_(True))))
    skills = list_skills()

    def pick(items, key, chosen, default):
        """A chat's own choice when it made one, else the items marked as default."""
        return [i for i in items if key(i) in chosen] if chosen is not None else [i for i in items if default(i)]

    r = Resources(
        folders=[{"path": f.path, "label": f.label, "access": f.access, "commands": f.commands}
                 for f in pick(folders, lambda f: f.id, tt.folders if tt else None, lambda f: f.default_on) if Path(f.path).is_dir()],
        connectors=[connector_runtime(c) for c in pick(conns, lambda c: c.id, tt.connectors if tt else None, lambda c: c.default_on)],
        skills=[s for s in pick(skills, lambda s: s["slug"], tt.skills if tt else None, lambda s: s["default_on"])],
    )
    if proposal and str(proposal.get("type", "")).startswith("connector."):
        r.allow_connectors.add(proposal["type"].split(".", 1)[1])
    if thread_id and file_ids is None:  # files attached anywhere in this chat
        file_ids = []
        for m in db.scalars(select(Message).where(Message.thread_id == thread_id)):
            file_ids += [b.get("id") for b in (m.blocks or []) if isinstance(b, dict) and b.get("type") == "file"]
    for fid in file_ids or []:
        p = file_path(str(fid))
        if p:
            r.files.append({"id": fid, "name": p.name, "mime": mimetypes.guess_type(p.name)[0] or "application/octet-stream", "path": str(p)})
    return r
