"""Docs: a shared vault of Markdown notes for the owner and every helper, Obsidian-style.

- The vault is a plain folder (`<data dir>/vault`) of .md files, so it can be opened in Obsidian as well. Company
  knowledge (`<data dir>/knowledge`) shows up as the `Company/` folder (and is linked into the vault folder when the
  file system allows, so Obsidian sees it too).
- [[Wiki links]] connect notes; backlinks and the graph are computed from them.
- Every save is a version with its author (owner, a helper, or "outside" when the file was changed in Obsidian or on
  disk). Saves carry the version they started from, so two people editing at once get a conflict instead of a lost edit.
- Helpers edit through MCP tools: by default directly, with a notice to the owner ("docs.write": do and tell). Company
  knowledge is stricter ("knowledge.write": ask): the change becomes a suggestion you approve in the Inbox.
"""
from __future__ import annotations

import difflib
import hashlib
import os
import re
import shutil
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import DocVersion, Notice, Staff, now

COMPANY = "Company"
SEG = re.compile(r"^[^/\\<>:\"|?*\x00-\x1f]{1,120}$")
LINK = re.compile(r"\[\[([^\]\|#]+)(?:#[^\]\|]*)?(?:\|[^\]]*)?\]\]")
MAX_DOC = 2_000_000


class DocError(Exception):
    def __init__(self, msg: str, code: int = 400, **extra):
        super().__init__(msg)
        self.code, self.extra = code, extra


def vault_dir() -> Path:
    d = get_settings().company_dir / "vault"
    if not d.exists():
        d.mkdir(parents=True, exist_ok=True)
        (d / "Welcome.md").write_text(WELCOME)
    link = d / COMPANY
    if not link.exists() and not link.is_symlink():
        try:
            os.symlink(get_settings().knowledge_dir, link, target_is_directory=True)  # so Obsidian sees company knowledge
        except OSError:
            pass
    return d


WELCOME = """# Welcome to Docs

This is the shared notebook for you and your helpers. Notes are plain Markdown files, so you can also open this
folder in Obsidian.

- Link notes with double brackets, like [[Company/company]] or [[Meeting notes]].
- Every note shows the notes that link to it (backlinks) and its history.
- Helpers read and write notes too; you see who changed what, and can restore any version.
"""


def norm(path: str) -> str:
    """A safe vault-relative path like 'Projects/Launch plan.md'."""
    p = (path or "").strip().replace("\\", "/").strip("/")
    if not p.lower().endswith(".md"):
        p += ".md"
    parts = [x.strip() for x in p.split("/")]
    if not parts or any(not SEG.match(x) or x in (".", "..") or x.startswith(".") for x in parts) or len(parts) > 8:
        raise DocError("use a simple name: letters, numbers, spaces and - _ ( ), with / between folders")
    if parts[0].lower() == COMPANY.lower():
        if len(parts) != 2:
            raise DocError("Company knowledge has no subfolders")
        parts[0] = COMPANY
    return "/".join(parts)


def file_for(path: str) -> Path:
    p = norm(path)
    if p.startswith(COMPANY + "/"):
        return get_settings().knowledge_dir / p.split("/", 1)[1]
    f = (vault_dir() / p).resolve()
    if vault_dir().resolve() not in f.parents:
        raise DocError("outside the vault")
    return f


def is_company(path: str) -> bool:
    return norm(path).startswith(COMPANY + "/")


def title_of(path: str) -> str:
    return Path(path).name[:-3] if path.endswith(".md") else Path(path).name


def _iso(v) -> str:
    from .serialize import iso

    return iso(v) or ""


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def all_paths() -> list[str]:
    root = vault_dir()
    out = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        rel_dir = Path(dirpath).relative_to(root)
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and not (rel_dir == Path(".") and d == COMPANY)]
        for f in filenames:
            if f.endswith(".md") and not f.startswith("."):
                out.append(str((rel_dir / f).as_posix()).lstrip("./") if str(rel_dir) != "." else f)
    for f in sorted(get_settings().knowledge_dir.glob("*.md")):
        out.append(f"{COMPANY}/{f.name}")
    return sorted(out, key=str.lower)


def latest(db: Session, path: str) -> DocVersion | None:
    return db.scalar(select(DocVersion).where(DocVersion.path == path, DocVersion.status == "saved").order_by(DocVersion.version.desc()).limit(1))


def _sync(db: Session, path: str, text: str) -> DocVersion:
    """Make sure the newest version matches the file; a change made outside Omilo becomes an 'outside' version."""
    last = latest(db, path)
    if last and _hash(last.content) == _hash(text):
        return last
    v = DocVersion(path=path, version=(last.version + 1) if last else 1, content=text, author="outside" if last else "",
                   author_kind="outside" if last else "owner", summary="Changed outside Omilo" if last else "First seen")
    db.add(v)
    db.flush()
    return v


def resolve_link(target: str, paths: list[str]) -> str | None:
    t = target.strip().replace("\\", "/")
    t_md = t if t.lower().endswith(".md") else t + ".md"
    by_lower = {p.lower(): p for p in paths}
    if t_md.lower() in by_lower:
        return by_lower[t_md.lower()]
    base = Path(t_md).name.lower()
    hits = sorted((p for p in paths if Path(p).name.lower() == base), key=len)
    return hits[0] if hits else None


def links_in(text: str) -> list[str]:
    return list(dict.fromkeys(m.group(1).strip() for m in LINK.finditer(text or "")))


def _read_file(path: str) -> str | None:
    f = file_for(path)
    if not f.is_file():
        return None
    return f.read_text(errors="replace")


def tree(db: Session) -> list[dict]:
    paths = all_paths()
    meta = {}
    for v in db.scalars(select(DocVersion).where(DocVersion.status == "saved").order_by(DocVersion.version)):
        meta[v.path] = v
    names = _names(db)
    out = []
    for p in paths:
        f = file_for(p)
        v = meta.get(p)
        out.append({"path": p, "title": title_of(p), "folder": p.rsplit("/", 1)[0] if "/" in p else "",
                    "size": f.stat().st_size if f.exists() else 0, "mtime": f.stat().st_mtime if f.exists() else 0,
                    "version": v.version if v else 0, "updated_by": _who(v, names) if v else None, "company": p.startswith(COMPANY + "/")})
    return out


def _names(db: Session) -> dict[str, str]:
    return {s.id: s.name for s in db.scalars(select(Staff))}


def _who(v: DocVersion, names: dict[str, str]) -> dict:
    if v.author_kind == "agent":
        return {"kind": "agent", "id": v.author, "name": names.get(v.author, v.author)}
    if v.author_kind == "outside":
        return {"kind": "outside", "id": "", "name": "Outside Omilo"}
    return {"kind": "owner", "id": v.author, "name": "You"}


def read(db: Session, path: str) -> dict:
    p = norm(path)
    text = _read_file(p)
    if text is None:
        raise DocError("no such doc", 404)
    v = _sync(db, p, text)
    db.commit()
    paths = all_paths()
    out_links = [{"target": t, "path": resolve_link(t, paths)} for t in links_in(text)]
    back = []
    t_low, base_low = p[:-3].lower(), title_of(p).lower()
    for other in paths:
        if other == p:
            continue
        ot = _read_file(other) or ""
        for t in links_in(ot):
            if resolve_link(t, paths) == p or t.lower() in (t_low, base_low):
                i = ot.lower().find("[[" + t.lower())
                back.append({"path": other, "title": title_of(other), "snippet": _plain(ot[max(0, i - 80): i + 120])})
                break
    names = _names(db)
    sugg = list(db.scalars(select(DocVersion).where(DocVersion.path == p, DocVersion.status == "suggested").order_by(DocVersion.at.desc())))
    return {"path": p, "title": title_of(p), "content": text, "version": v.version, "updated_by": _who(v, names), "updated_at": _iso(v.at),
            "links": out_links, "backlinks": back, "company": p.startswith(COMPANY + "/"),
            "suggestions": [{"id": s.id, "by": _who(s, names), "summary": s.summary, "proposal_id": s.proposal_id, "at": _iso(s.at)} for s in sugg]}


def write(db: Session, path: str, content: str, *, author: str, author_kind: str, base_version: int | None = None, summary: str = "",
          notify: bool = True) -> dict:
    p = norm(path)
    if len(content) > MAX_DOC:
        raise DocError("this doc is too large (2 MB max)")
    f = file_for(p)
    cur_text = f.read_text(errors="replace") if f.is_file() else None
    cur = _sync(db, p, cur_text) if cur_text is not None else latest(db, p)
    if base_version is not None and cur is not None and cur_text is not None and base_version != cur.version:
        raise DocError("this doc changed since you opened it", 409, current={"version": cur.version, "content": cur.content, "updated_by": _who(cur, _names(db))})
    if cur_text is not None and _hash(cur_text) == _hash(content):
        db.commit()
        return {"path": p, "version": cur.version if cur else 0, "unchanged": True}
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f".{f.name}.tmp")
    tmp.write_text(content)
    tmp.replace(f)
    v = DocVersion(path=p, version=(cur.version + 1) if cur else 1, content=content, author=author, author_kind=author_kind,
                   summary=(summary or ("Created" if cur_text is None else "Edited"))[:300])
    db.add(v)
    if author_kind == "agent" and notify:
        names = _names(db)
        db.add(Notice(kind="doc", title=f"{names.get(author, author)} {'created' if cur_text is None else 'edited'} {title_of(p)}",
                      body=(summary or "")[:180], url=f"/docs/?path={p}", tag=f"doc-{p}"[:80]))
    db.commit()
    _kb(db, p)
    return {"path": p, "version": v.version, "created": cur_text is None}


def _kb(db: Session, path: str) -> None:
    """Keep the knowledge base in step with the vault (never fails the doc change)."""
    from . import kb

    try:
        kb.sync_doc(db, path)
    except Exception:  # noqa: BLE001
        db.rollback()
        import logging

        logging.getLogger("omilo.docs").exception("indexing %s failed", path)


def suggest(db: Session, st: Staff, task_id: str | None, path: str, content: str, summary: str) -> dict:
    """A helper's change to a doc it may not edit directly: saved as a suggestion, approved through the Inbox."""
    from . import services as S

    p = norm(path)
    old = _read_file(p) or ""
    diff = "".join(difflib.unified_diff(old.splitlines(True), content.splitlines(True), fromfile=p, tofile=p, n=2))[:6000]
    body = f"{summary or 'Suggested change'}\n\n```diff\n{diff or '(new doc)'}\n```"
    prop = S.create_proposal(db, st, task_id, f"Change {title_of(p)}", "docs.write", "low", body)
    v = DocVersion(path=p, version=0, content=content, author=st.id, author_kind="agent", summary=(summary or "Suggested change")[:300],
                   status="suggested", proposal_id=prop.id)
    db.add(v)
    db.commit()
    return {"suggestion_id": v.id, "proposal_id": prop.id}


def apply_suggestion(db: Session, proposal_id: str, by: str) -> bool:
    """Approving a docs.write proposal saves the suggested content (by the helper, approved by the owner)."""
    v = db.scalar(select(DocVersion).where(DocVersion.proposal_id == proposal_id, DocVersion.status == "suggested"))
    if not v:
        return False
    res = write(db, v.path, v.content, author=v.author, author_kind="agent", summary=f"{v.summary} (approved)")
    v.status = "applied"
    db.commit()
    return bool(res)


def reject_suggestion(db: Session, proposal_id: str) -> None:
    for v in db.scalars(select(DocVersion).where(DocVersion.proposal_id == proposal_id, DocVersion.status == "suggested")):
        v.status = "rejected"


def history(db: Session, path: str) -> list[dict]:
    p = norm(path)
    names = _names(db)
    rows = db.scalars(select(DocVersion).where(DocVersion.path == p, DocVersion.status == "saved").order_by(DocVersion.version.desc()).limit(200))
    return [{"version": v.version, "by": _who(v, names), "summary": v.summary, "at": _iso(v.at), "chars": len(v.content)} for v in rows]


def version_content(db: Session, path: str, version: int) -> str:
    v = db.scalar(select(DocVersion).where(DocVersion.path == norm(path), DocVersion.version == version, DocVersion.status == "saved"))
    if not v:
        raise DocError("no such version", 404)
    return v.content


def move(db: Session, src: str, dst: str, *, author: str, author_kind: str) -> dict:
    a, b = norm(src), norm(dst)
    fa, fb = file_for(a), file_for(b)
    if not fa.is_file():
        raise DocError("no such doc", 404)
    if fb.exists():
        raise DocError("a doc with that name already exists", 409)
    fb.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(fa), str(fb))
    for v in db.scalars(select(DocVersion).where(DocVersion.path == a)):
        v.path = b
    # keep links working: [[Old name]] -> [[New name]] across the vault
    old_t, new_t = title_of(a), title_of(b)
    changed = 0
    if old_t != new_t:
        pat = re.compile(r"\[\[(" + re.escape(a[:-3]) + "|" + re.escape(old_t) + r")((?:#[^\]\|]*)?(?:\|[^\]]*)?)\]\]", re.I)
        for p in all_paths():
            t = _read_file(p)
            if t and pat.search(t):
                write(db, p, pat.sub(lambda m: f"[[{new_t}{m.group(2)}]]", t), author=author, author_kind=author_kind, summary=f"Link renamed to {new_t}")
                changed += 1
    db.commit()
    _kb(db, a)
    _kb(db, b)
    return {"path": b, "links_updated": changed}


def delete(db: Session, path: str, *, author: str) -> dict:
    p = norm(path)
    f = file_for(p)
    if not f.is_file():
        raise DocError("no such doc", 404)
    trash = vault_dir() / ".trash"
    trash.mkdir(exist_ok=True)
    stamp = now().strftime("%Y%m%d-%H%M%S")
    shutil.move(str(f), str(trash / f"{stamp} {p.replace('/', ' » ')}"))
    db.add(DocVersion(path=p, version=0, content="", author=author, author_kind="owner", summary="Deleted (kept in .trash)", status="deleted"))
    db.commit()
    _kb(db, p)
    return {"ok": True}


def _plain(s: str) -> str:
    """Markdown → short plain text for snippets."""
    s = LINK.sub(lambda m: m.group(1).split("/")[-1], s)
    s = re.sub(r":?-{2,}:?|[#*_`>|]+|\[\[|\]\]", " ", s)
    return " ".join(s.split())


def search(db: Session, q: str, limit: int = 20, folder: str | None = None) -> list[dict]:
    """Ranked full-text search on the knowledge base (Postgres); an empty query lists docs (newest-named first)."""
    if (q or "").strip():
        from . import kb

        try:
            return kb.docs_search(db, q, limit, folder)
        except Exception:  # noqa: BLE001 - fall back to a plain scan
            db.rollback()
    words = [w for w in re.split(r"\s+", (q or "").lower().strip()) if w]
    out = []
    for p in all_paths():
        t = _read_file(p) or ""
        low, title = t.lower(), title_of(p).lower()
        if words and not all(w in low or w in title or w in p.lower() for w in words):
            continue
        if folder and not p.startswith(folder.rstrip("/") + "/"):
            continue
        score = sum(title.count(w) * 5 + low.count(w) for w in words) if words else 0
        i = low.find(words[0]) if words else 0
        out.append({"path": p, "title": title_of(p), "score": score, "snippet": _plain(t[max(0, i - 60): i + 160])})
    out.sort(key=lambda x: (-x["score"], x["path"].lower()))
    return out[:limit]


def graph(db: Session) -> dict:
    paths = all_paths()
    names = _names(db)
    last = {}
    for v in db.scalars(select(DocVersion).where(DocVersion.status == "saved").order_by(DocVersion.version)):
        last[v.path] = v
    edges, missing = [], {}
    for p in paths:
        for t in links_in(_read_file(p) or ""):
            r = resolve_link(t, paths)
            if r and r != p:
                edges.append({"source": p, "target": r})
            elif not r:
                key = "?" + t.lower()
                missing.setdefault(key, {"id": key, "title": t, "missing": True})
                edges.append({"source": p, "target": key})
    deg: dict[str, int] = {}
    for e in edges:
        deg[e["source"]] = deg.get(e["source"], 0) + 1
        deg[e["target"]] = deg.get(e["target"], 0) + 1
    nodes = [{"id": p, "title": title_of(p), "folder": p.rsplit("/", 1)[0] if "/" in p else "", "degree": deg.get(p, 0),
              "by": _who(last[p], names)["kind"] if p in last else "owner"} for p in paths]
    nodes += [{**m, "folder": "", "degree": deg.get(m["id"], 0), "by": "missing"} for m in missing.values()]
    seen: dict[str, int] = {}
    for n in nodes:
        seen[n["title"].lower()] = seen.get(n["title"].lower(), 0) + 1
    for n in nodes:  # several notes called "Lessons": show whose ("marketing · Lessons")
        if seen[n["title"].lower()] > 1 and n.get("folder"):
            n["title"] = f"{n['folder'].rsplit('/', 1)[-1]} · {n['title']}"
    return {"nodes": nodes, "edges": edges}


def stats(db: Session) -> dict:
    return {"count": len(all_paths()), "versions": db.scalar(select(func.count()).select_from(DocVersion)) or 0}
