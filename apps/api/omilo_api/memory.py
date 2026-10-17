"""Memory: what the company of helpers learns, kept as plain notes in Docs (the Memory/ folder), so you can read,
edit and see it in the graph, and helpers read it before every run.

Memory/
  Index.md                     links to everything below (keeps the graph connected)
  <helper id>/Lessons.md       rules learned from your decisions and from the weekly retro (newest first)
  <helper id>/Notes.md         things a helper chose to remember (remember tool)
  Loops/<helper id> · <job>.md the run log of one regular job: date, outcome, headline, proposals
  Retros/<year>-W<week>.md     what the weekly retro changed, why, and later whether it helped

Your edits win: everything is read back from the files, so editing or deleting a lesson changes what helpers do.
"""
from __future__ import annotations

import datetime as dt
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import docs as D
from .models import Proposal, Report, Shift, Staff, Task, now

ROOT = "Memory"
MAX_LESSONS_CHARS = 4000
MAX_LOG_ENTRIES = 40
_ENTRY = re.compile(r"^### ", re.M)


def _safe(name: str) -> str:
    return re.sub(r"[\\/<>:\"|?*\x00-\x1f\[\]#^]+", " ", name).strip()[:80] or "job"


def lessons_path(sid: str) -> str:
    return f"{ROOT}/{sid}/Lessons.md"


def notes_path(sid: str) -> str:
    return f"{ROOT}/{sid}/Notes.md"


def loop_path(sid: str, shift_name: str) -> str:
    return f"{ROOT}/Loops/{sid} · {_safe(shift_name)}.md"


def retro_path(day: dt.date | None = None) -> str:
    y, w, _ = (day or now().date()).isocalendar()
    return f"{ROOT}/Retros/{y}-W{w:02d}.md"


def _link(path: str, label: str | None = None) -> str:
    p = path[:-3] if path.endswith(".md") else path
    return f"[[{p}|{label}]]" if label else f"[[{p}]]"


def _read(path: str) -> str | None:
    try:
        f = D.file_for(D.norm(path))
    except D.DocError:
        return None
    return f.read_text(errors="replace") if f.is_file() else None


def _write(db: Session, path: str, text: str, author: str, summary: str, notify: bool = False) -> None:
    D.write(db, path, text, author=author, author_kind="agent", summary=summary, notify=notify)
    _index(db)


def _name(db: Session, sid: str) -> str:
    st = db.get(Staff, sid)
    return st.name if st else sid


# ------------------------------------------------------------------ the index note
def _index(db: Session) -> None:
    """Memory/Index.md lists every memory note, so the graph shows one connected map."""
    paths = [p for p in D.all_paths() if p.startswith(ROOT + "/") and p != f"{ROOT}/Index.md"]
    staff = {s.id: s.name for s in db.scalars(select(Staff))}
    lines = ["# Memory", "", "What your helpers have learned. You can edit any note: helpers read these files before they work.", ""]
    by: dict[str, list[str]] = {}
    for p in paths:
        part = p.split("/")[1]
        by.setdefault(part, []).append(p)
    for part in sorted(by, key=lambda k: (k in ("Loops", "Retros"), staff.get(k, k).lower())):
        title = "Regular jobs" if part == "Loops" else "Weekly retros" if part == "Retros" else staff.get(part, part)
        lines += [f"## {title}", ""] + [f"- {_link(p, D.title_of(p))}" for p in sorted(by[part], reverse=part == "Retros")] + [""]
    text = "\n".join(lines).rstrip() + "\n"
    if _read(f"{ROOT}/Index.md") != text:
        D.write(db, f"{ROOT}/Index.md", text, author="omilo", author_kind="agent", summary="Memory map updated", notify=False)


# ------------------------------------------------------------------ lessons
def _lessons_head(db: Session, sid: str) -> str:
    return (f"# Lessons for {_name(db, sid)}\n\n"
            f"Rules {_name(db, sid)} follows, learned from your decisions and the weekly retro. Newest first. "
            f"Edit or delete freely. Part of {_link(ROOT + '/Index', 'Memory')}.\n\n")


def lessons(sid: str) -> str:
    return _read(lessons_path(sid)) or ""


def lesson_lines(sid: str) -> str:
    """Just the bullet list (everything from the first '- '), whatever you wrote above it."""
    cur = lessons(sid)
    i = 0 if cur.startswith("- ") else cur.find("\n- ") + 1
    return cur[i:].strip() if i or cur.startswith("- ") else ""


def add_lesson(db: Session, sid: str, text: str, source: str = "", author: str = "omilo") -> None:
    text = " ".join((text or "").split())
    if not text:
        return
    cur = lessons(sid)
    if text.lower() in cur.lower():  # already known
        return
    head = _lessons_head(db, sid)
    body = lesson_lines(sid)
    line = f"- **{now().date().isoformat()}** · {text}" + (f" _({source})_" if source else "")
    _write(db, lessons_path(sid), head + line + "\n" + body.lstrip("\n"), author, f"Learned: {text[:120]}", notify=True)


def set_lessons(db: Session, sid: str, bullets: list[str], author: str, summary: str) -> tuple[str, str]:
    """Replace the lessons with a cleaned-up list (the retro merges duplicates). Returns (before, after)."""
    before = lessons(sid)
    after = _lessons_head(db, sid) + "".join(f"- {' '.join(b.split())}\n" for b in bullets if b.strip())
    _write(db, lessons_path(sid), after, author, summary, notify=True)
    return before, after


def lesson_from_decision(db: Session, p: Proposal, decision: str, note: str) -> None:
    """Your note on a proposal becomes a lesson for the helper that wrote it."""
    note = (note or "").strip()
    if not note:
        return
    what = {"reject": "Rejected", "changes": "Changes asked on", "approve": "Approved"}.get(decision, decision)
    add_lesson(db, p.staff_id, note, source=f"{what} “{p.title[:80]}”")


# ------------------------------------------------------------------ notes a helper keeps
def remember(db: Session, st: Staff, text: str, title: str | None = None) -> str:
    text = (text or "").strip()
    if not text:
        raise D.DocError("nothing to remember")
    if title:
        path = f"{ROOT}/{st.id}/{_safe(title)}.md"
        cur = _read(path)
        body = (cur.rstrip() + "\n\n" if cur else f"# {_safe(title)}\n\nBy {st.name}. See also {_link(lessons_path(st.id), 'Lessons')}.\n\n") + \
            f"**{now().date().isoformat()}**: {text}\n"
        _write(db, path, body, st.id, f"Remembered: {text[:100]}")
        if _link(path) not in (_read(notes_path(st.id)) or ""):
            _append_note(db, st, f"See {_link(path, _safe(title))}.")
        return path
    _append_note(db, st, text)
    return notes_path(st.id)


def _append_note(db: Session, st: Staff, text: str) -> None:
    cur = _read(notes_path(st.id)) or (f"# Notes of {st.name}\n\nWhat {st.name} decided to remember. "
                                        f"See also {_link(lessons_path(st.id), 'Lessons')}.\n")
    _write(db, notes_path(st.id), cur.rstrip() + f"\n\n- **{now().date().isoformat()}** · {text}\n", st.id, f"Remembered: {text[:100]}")


# ------------------------------------------------------------------ run log of a regular job
def log_run(db: Session, t: Task) -> None:
    if not t.shift_id or not (sh := db.get(Shift, t.shift_id)):
        return
    path = loop_path(t.staff_id, sh.name)
    rep = db.scalar(select(Report).where(Report.task_id == t.id))
    props = list(db.scalars(select(Proposal).where(Proposal.task_id == t.id)))
    when = (t.ended_at or now()).astimezone(dt.UTC).strftime("%Y-%m-%d %H:%M UTC")
    entry = [f"### {when} · {'✓ done' if t.status == 'done' else '✕ ' + t.status}", ""]
    if rep:
        entry.append(f"**{rep.headline}**")
    if t.error:
        entry.append(f"What went wrong: {t.error[:300]}")
    if props:
        entry.append("Proposed: " + "; ".join(f"“{p.title[:80]}”" for p in props))
    entry.append("")
    cur = _read(path)
    head = (f"# {sh.name}\n\nThe run log of {_name(db, t.staff_id)}'s regular job “{sh.name}” ({sh.cron}). "
            f"Each run reads the latest entries. Lessons: {_link(lessons_path(t.staff_id), 'Lessons of ' + _name(db, t.staff_id))}.\n\n")
    old = ["### " + e.strip() + "\n" for e in _ENTRY.split(cur or "")[1:] if e.strip()][: MAX_LOG_ENTRIES - 1]
    _write(db, path, head + "\n".join(entry) + "\n" + "\n".join(old), t.staff_id, f"Run log: {(rep.headline if rep else t.status)[:100]}")


def recent_runs(sid: str, shift_name: str, n: int = 3) -> list[str]:
    cur = _read(loop_path(sid, shift_name)) or ""
    return ["### " + e.strip() for e in _ENTRY.split(cur)[1:][:n]]


# ------------------------------------------------------------------ what a run is told
def brief_for(db: Session, st: Staff, t: Task | None = None) -> str:
    """Memory handed to a run: lessons, the last runs of this job, and how you decided on recent proposals."""
    parts = []
    les = lesson_lines(st.id)
    if les:
        parts.append(f"Your lessons (follow them; from {lessons_path(st.id)}):\n{les[:MAX_LESSONS_CHARS]}")
    if t is not None and t.shift_id and (sh := db.get(Shift, t.shift_id)):
        runs = recent_runs(st.id, sh.name)
        if runs:
            parts.append("The last runs of this job (build on them, do not repeat them):\n" + "\n\n".join(r[:700] for r in runs))
    since = now() - dt.timedelta(days=30)
    decided = list(db.scalars(select(Proposal).where(Proposal.staff_id == st.id, Proposal.decided_at >= since)
                              .order_by(Proposal.decided_at.desc()).limit(12)))
    if decided:
        rows = [f"- “{p.title[:90]}”: {p.status}" + (f" (founder: {p.decision_note[:160]})" if p.decision_note else "") for p in decided]
        parts.append("How the founder decided on your recent proposals (don't propose rejected ideas again):\n" + "\n".join(rows))
    if not parts:
        return ""
    return "\n\n## Memory\n" + "\n\n".join(parts) + "\n\nTo keep something for next time, call remember. To look something up, call recall.\n"
