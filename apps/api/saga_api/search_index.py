"""Full-text search over Docs (including Memory) with SQLite FTS5: ranked (BM25), prefix matching, snippets.

The index is a small SQLite file per company (<company>/search.db), separate from the main database so it works
the same on Postgres. It refreshes itself before each search by comparing file times, so notes edited in
Obsidian or by hand are found too. No vector database is needed at this size; the graph of [[links]] does
the "related notes" part.
"""
from __future__ import annotations

import re
import sqlite3
import threading

from .config import get_settings

_lock = threading.Lock()
_WORD = re.compile(r"[\w][\w'-]*", re.UNICODE)


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(get_settings().company_dir / "search.db", timeout=10)
    c.execute("CREATE VIRTUAL TABLE IF NOT EXISTS doc USING fts5(path UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2')")
    c.execute("CREATE TABLE IF NOT EXISTS seen (path TEXT PRIMARY KEY, mtime INTEGER)")
    return c


def refresh() -> None:
    """Index new and changed notes, forget deleted ones."""
    from . import docs as D

    with _lock, _conn() as c:
        seen = dict(c.execute("SELECT path, mtime FROM seen"))
        now: dict[str, int] = {}
        for p in D.all_paths():
            try:
                now[p] = D.file_for(p).stat().st_mtime_ns
            except OSError:
                continue
        for p in set(seen) - set(now):
            c.execute("DELETE FROM doc WHERE path = ?", (p,))
            c.execute("DELETE FROM seen WHERE path = ?", (p,))
        for p, mt in now.items():
            if seen.get(p) == mt:
                continue
            text = D.file_for(p).read_text(errors="replace")
            c.execute("DELETE FROM doc WHERE path = ?", (p,))
            c.execute("INSERT INTO doc (path, title, body) VALUES (?, ?, ?)", (p, D.title_of(p), text))
            c.execute("INSERT OR REPLACE INTO seen (path, mtime) VALUES (?, ?)", (p, mt))


def _query(q: str) -> str:
    words = _WORD.findall(q or "")
    return " ".join(f'"{w}"*' for w in words[:12])


def search(q: str, limit: int = 20, folder: str | None = None) -> list[dict]:
    refresh()
    fq = _query(q)
    if not fq:
        return []
    with _conn() as c:
        rows = c.execute(
            "SELECT path, title, snippet(doc, 2, '', '', ' … ', 32), bm25(doc, 0.0, 6.0, 1.0) AS rank FROM doc "
            "WHERE doc MATCH ? ORDER BY rank LIMIT ?", (fq, limit * 3 if folder else limit)).fetchall()
    out = [{"path": p, "title": t, "snippet": re.sub(r"\s+", " ", s).strip(), "score": round(-r, 3)} for p, t, s, r in rows]
    if folder:
        out = [r for r in out if r["path"].startswith(folder.rstrip("/") + "/")]
    return out[:limit]
