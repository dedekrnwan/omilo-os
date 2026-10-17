"""Several companies in one Omilo, fully separate.

Each company has its own database, Docs vault, knowledge, skills, files, workspaces and Claude Code
pool. Only the owner's login is shared (it lives in the first company's database).

- The first company ("main") keeps the original layout: everything directly in <data_dir>.
- Every other company lives in <data_dir>/companies/<id>/ with the same layout.
- The list of companies is <data_dir>/companies.json.

Which company a piece of code works on is a context variable: set per request by `CompanyMiddleware`
(path prefix /co/<id>/..., the X-Omilo-Company header, or the omilo_co cookie), and per company by the worker.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import secrets
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

MAIN = "main"
COOKIE = "omilo_co"
HEADER = "x-omilo-company"

_cid: ContextVar[str] = ContextVar("omilo_company", default=MAIN)
_lock = threading.Lock()
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")


def current() -> str:
    return _cid.get()


@contextmanager
def use(cid: str) -> Iterator[str]:
    """Work on one company inside this block (and in tasks started from it)."""
    tok = _cid.set(cid or MAIN)
    try:
        yield cid
    finally:
        _cid.reset(tok)


def _root() -> Path:
    from .config import get_settings

    return get_settings().data_dir


def dir_for(cid: str | None = None) -> Path:
    cid = cid or current()
    d = _root() if cid == MAIN else _root() / "companies" / cid
    d.mkdir(parents=True, exist_ok=True)
    return d


# ------------------------------------------------------------------ registry
def _file() -> Path:
    return _root() / "companies.json"


_cache: dict = {}


def _load() -> list[dict]:
    f = _file()
    try:
        mt = f.stat().st_mtime_ns if f.exists() else 0
        if _cache.get("key") == (str(f), mt):
            rows = [dict(r) for r in _cache["rows"]]
        else:
            rows = json.loads(f.read_text()) if mt else []
            _cache.update(key=(str(f), mt), rows=[dict(r) for r in rows])
    except (OSError, ValueError):
        rows = []
    if not any(r.get("id") == MAIN for r in rows):
        rows.insert(0, {"id": MAIN, "created_at": None, "archived": False})
    return rows


def _save(rows: list[dict]) -> None:
    _root().mkdir(parents=True, exist_ok=True)
    tmp = _file().with_suffix(".tmp")
    tmp.write_text(json.dumps(rows, indent=2))
    tmp.replace(_file())
    _cache.clear()


def registry(include_archived: bool = False) -> list[dict]:
    return [r for r in _load() if include_archived or not r.get("archived")]


def ids(include_archived: bool = False) -> list[str]:
    return [r["id"] for r in registry(include_archived)]


def exists(cid: str, include_archived: bool = False) -> bool:
    return bool(cid) and cid in ids(include_archived)


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:30] or "company"
    return s if s != MAIN else "main-2"


def create(name: str) -> str:
    """Register a new, empty company and create its database. Returns its id."""
    with _lock:
        rows = _load()
        cid = slug(name)
        if any(r["id"] == cid for r in rows):
            cid = f"{cid}-{secrets.token_hex(2)}"
        rows.append({"id": cid, "created_at": dt.datetime.now(dt.UTC).isoformat(), "archived": False})
        _save(rows)
    from . import db

    db.engine(cid)  # creates the tables
    return cid


def set_archived(cid: str, archived: bool) -> None:
    if cid == MAIN and archived:
        raise ValueError("the first company can't be archived")
    with _lock:
        rows = _load()
        for r in rows:
            if r["id"] == cid:
                r["archived"] = archived
        _save(rows)


def valid_id(cid: str) -> bool:
    return bool(_ID.match(cid or ""))


# ------------------------------------------------------------------ choosing the company for a request
class CompanyMiddleware:
    """ASGI middleware: picks the company for each request and strips a /co/<id> path prefix."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        path: str = scope.get("path", "")
        root = scope.get("root_path", "")
        rel = path[len(root):] if root and path.startswith(root) else path
        cid = None
        if rel.startswith("/co/"):
            parts = rel.split("/", 3)  # ['', 'co', '<id>', rest]
            cid = parts[2] if len(parts) > 2 else ""
            if not exists(cid):
                await _not_found(send)
                return
            new = "/" + (parts[3] if len(parts) > 3 else "")
            scope = {**scope, "path": (root + new) if root and path.startswith(root) else new}
            scope["raw_path"] = scope["path"].encode()
        else:
            headers = dict(scope.get("headers") or [])
            want = (headers.get(HEADER.encode()) or b"").decode() or _cookie(headers.get(b"cookie", b"").decode(), COOKIE)
            if want and exists(want):
                cid = want
        with use(cid or MAIN):
            await self.app(scope, receive, send)


def _cookie(header: str, name: str) -> str:
    for part in header.split(";"):
        k, _, v = part.strip().partition("=")
        if k == name:
            return v
    return ""


async def _not_found(send):
    await send({"type": "http.response.start", "status": 404, "headers": [(b"content-type", b"application/json")]})
    await send({"type": "http.response.body", "body": b'{"detail":"no such company"}'})


def prefix(cid: str | None = None) -> str:
    """URL prefix that pins a company (used for the MCP endpoint helpers call)."""
    cid = cid or current()
    return "" if cid == MAIN else f"/co/{cid}"


# ------------------------------------------------------------------ helpers across companies
def each(include_archived: bool = False) -> Iterator[str]:
    """Run the body once per company: `for cid in each(): ...` sets the company for each turn."""
    for cid in ids(include_archived):
        with use(cid):
            yield cid


def summary(cid: str) -> dict:
    """Name and a few live numbers for the company picker."""
    from sqlalchemy import func, select

    from .db import session_scope
    from .models import InboxItem, Setting, Task

    row = next((r for r in registry(True) if r["id"] == cid), {"id": cid})
    with session_scope(cid) as db:
        name = db.get(Setting, "company_name")
        onb = db.get(Setting, "onboarded")
        inbox = db.scalar(select(func.count()).select_from(InboxItem).where(InboxItem.status == "open")) or 0
        running = db.scalar(select(func.count()).select_from(Task).where(Task.status == "running")) or 0
    return {"id": cid, "name": (name.value if name and name.value else "") or ("My company" if cid == MAIN else "New company"),
            "onboarded": bool(onb and onb.value), "inbox": inbox, "running": running,
            "archived": bool(row.get("archived")), "created_at": row.get("created_at")}
