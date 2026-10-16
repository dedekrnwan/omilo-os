"""Loop engineering: every regular job is a loop that runs, reports, gets your decisions, learns and improves.

  trigger (schedule) → context (knowledge, KPIs, lessons, last runs, your recent decisions) → act → report and
  proposals → you approve, reject or ask for changes (your note becomes a lesson) → approved work is executed →
  the weekly retro reviews every loop, changes what isn't working, measures the change and rolls it back if
  results got worse.

The retro changes only how helpers work: their instructions, a job's brief or schedule, and their lessons.
It can never change permissions, budgets, the engine, approvals or the hard rules (no sending, spending,
merging, deploying or touching production without your OK): those stay with you.
"""
from __future__ import annotations

import datetime as dt
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import memory as M
from .models import Improvement, Notice, Proposal, Report, Shift, Staff, Task, now

KINDS = ("job", "shift_brief", "shift_schedule", "lessons")
MAX_PER_WEEK = 3
MEASURE_DAYS = 7          # look at a change again after this long
MIN_RUNS = 3              # ...and only once it has run this often
WORSE_SUCCESS = 20        # points of success rate lost that count as worse
WORSE_APPROVAL = 25       # points of approval rate lost that count as worse
RETRO_CRON = "0 16 * * 5"  # Fridays 16:00, owner time
TRANSIENT = re.compile(r"connect(ion)?error|all connection attempts failed|timed? ?out|timeout|temporar|overloaded|\b50[234]\b|"
                       r"connection reset|server disconnected|network|eof occurred|remote protocol", re.I)


def _aware(d: dt.datetime | None) -> dt.datetime | None:
    return d.replace(tzinfo=d.tzinfo or dt.UTC) if d else None


# ------------------------------------------------------------------ scores
def _score(tasks: list[Task], props: list[Proposal]) -> dict:
    ended = [t for t in tasks if t.status in ("done", "failed")]
    done = sum(t.status == "done" for t in ended)
    decided = [p for p in props if p.status in ("approved", "executing", "done", "rejected", "changes_requested", "failed")]
    approved = sum(p.status in ("approved", "executing", "done") for p in decided)
    return {"runs": len(ended), "done": done, "failed": len(ended) - done,
            "success": round(done * 100 / len(ended)) if ended else None,
            "proposals": len(props), "decided": len(decided), "approved": approved,
            "approval": round(approved * 100 / len(decided)) if decided else None,
            "cost_usd": round(sum(t.cost_usd or 0 for t in tasks), 4), "tokens": sum(t.tokens or 0 for t in tasks)}


def _window(db: Session, since: dt.datetime, until: dt.datetime | None = None, staff_id: str | None = None,
            shift_id: str | None = None) -> tuple[list[Task], list[Proposal]]:
    q = select(Task).where(Task.created_at >= since)
    if until:
        q = q.where(Task.created_at < until)
    if staff_id:
        q = q.where(Task.staff_id == staff_id)
    if shift_id:
        q = q.where(Task.shift_id == shift_id)
    tasks = list(db.scalars(q))
    ids = {t.id for t in tasks}
    pq = select(Proposal).where(Proposal.created_at >= since)
    if until:
        pq = pq.where(Proposal.created_at < until)
    if staff_id:
        pq = pq.where(Proposal.staff_id == staff_id)
    props = [p for p in db.scalars(pq) if not shift_id or p.task_id in ids]
    return tasks, props


def scorecard(db: Session, days: int = 30) -> list[dict]:
    """One row per regular job: how it is doing."""
    since = now() - dt.timedelta(days=days)
    names = {s.id: s.name for s in db.scalars(select(Staff))}
    rows = []
    for sh in db.scalars(select(Shift)):
        tasks, props = _window(db, since, shift_id=sh.id)
        sc = _score(tasks, props)
        ended = sorted((t for t in tasks if t.ended_at), key=lambda t: _aware(t.ended_at), reverse=True)
        last_good = next((t for t in ended if t.status == "done"), None)
        rep = db.scalar(select(Report).where(Report.task_id == last_good.id)) if last_good else None
        recent = ended[:3]
        stalled = (len(recent) >= 3 and all(t.status != "done" for t in recent)) or (
            sc["decided"] >= 3 and sc["approved"] == 0)
        rows.append({"shift_id": sh.id, "name": sh.name, "staff_id": sh.staff_id, "staff": names.get(sh.staff_id, sh.staff_id),
                     "cron": sh.cron, "enabled": sh.enabled, **sc, "stalled": bool(stalled),
                     "last_useful": {"at": _aware(last_good.ended_at).isoformat(), "headline": rep.headline if rep else "", "task_id": last_good.id}
                     if last_good else None,
                     "next_at": _aware(sh.next_at).isoformat() if sh.next_at else None,
                     "log": M.loop_path(sh.staff_id, sh.name)})
    rows.sort(key=lambda r: (not r["stalled"], r["staff"].lower(), r["name"].lower()))
    return rows


# ------------------------------------------------------------------ what the retro reads
def review(db: Session, days: int = 7) -> dict:
    since = now() - dt.timedelta(days=days)
    out = {"since": since.isoformat(), "loops": scorecard(db, days=max(days, 14)), "helpers": [], "improvements": []}
    for st in db.scalars(select(Staff).where(Staff.status != "retired")):
        tasks, props = _window(db, since, staff_id=st.id)
        reps = {r.task_id: r for r in db.scalars(select(Report).where(Report.task_id.in_([t.id for t in tasks])))} if tasks else {}
        out["helpers"].append({
            "id": st.id, "name": st.name, "status": st.status, **_score(tasks, props),
            "job": st.job[:1500],
            "jobs": [{"id": t.id, "status": t.status, "origin": t.origin, "brief": t.brief.splitlines()[0][:120] if t.brief else "",
                      "headline": reps[t.id].headline if t.id in reps else "", "error": (t.error or "")[:200]} for t in tasks[-15:]],
            "decisions": [{"title": p.title[:120], "status": p.status, "note": p.decision_note[:300]} for p in props if p.decided_at],
            "lessons": M.lesson_lines(st.id)[:2500],
            "shifts": [{"id": sh.id, "name": sh.name, "cron": sh.cron, "brief": sh.brief[:800]} for sh in st.shifts],
        })
    for imp in db.scalars(select(Improvement).where(Improvement.created_at >= now() - dt.timedelta(days=35)).order_by(Improvement.created_at.desc())):
        out["improvements"].append(serialize(imp))
    out["allowed_this_week"] = max(0, MAX_PER_WEEK - _this_week(db))
    return out


def _this_week(db: Session) -> int:
    return len(list(db.scalars(select(Improvement).where(Improvement.created_at >= now() - dt.timedelta(days=6), Improvement.by != "owner"))))


# ------------------------------------------------------------------ making a change
class LoopError(Exception):
    def __init__(self, msg: str, status: int = 400):
        super().__init__(msg)
        self.status = status


def _baseline(db: Session, staff_id: str, shift_id: str | None) -> dict:
    tasks, props = _window(db, now() - dt.timedelta(days=21), staff_id=staff_id, shift_id=shift_id or None)
    return _score(tasks, props)


def improve(db: Session, by: Staff | None, staff_id: str, kind: str, change: str | list[str], reason: str,
            shift_id: str | None = None, task_id: str | None = None) -> Improvement:
    """Apply one improvement right away (fully automatic), remember the old value, and measure it later."""
    if kind not in KINDS:
        raise LoopError(f"kind must be one of {', '.join(KINDS)}")
    if not (reason or "").strip():
        raise LoopError("say why: the reason is kept with the change")
    st = db.get(Staff, staff_id)
    if not st:
        raise LoopError(f"unknown helper {staff_id}", 404)
    who = by.id if by else "owner"
    if by is not None and _this_week(db) >= MAX_PER_WEEK:
        raise LoopError(f"at most {MAX_PER_WEEK} improvements a week; pick the ones that matter most", 429)
    sh = None
    if kind.startswith("shift_"):
        sh = db.get(Shift, shift_id or "")
        if not sh or sh.staff_id != st.id:
            raise LoopError("give the shift_id of one of this helper's regular jobs")
    if kind == "lessons":
        bullets = change if isinstance(change, list) else [b.lstrip("-* ").strip() for b in str(change).splitlines() if b.strip()]
        if not bullets:
            raise LoopError("give the cleaned-up list of lessons")
        before_text, after_text = M.set_lessons(db, st.id, bullets, who, f"Retro: {reason[:120]}")
        before, after = {"text": before_text}, {"text": after_text}
    else:
        text = change if isinstance(change, str) else "\n".join(change)
        text = text.strip()
        if not text:
            raise LoopError("the new text is empty")
        if kind == "job":
            if len(text) > 12000:
                raise LoopError("instructions are too long (12,000 characters max)")
            before, after = {"job": st.job}, {"job": text}
            st.job = text
        elif kind == "shift_brief":
            before, after = {"brief": sh.brief}, {"brief": text}
            sh.brief = text
        else:
            from .services import next_run

            try:
                nxt = next_run(text, db=db)
            except Exception as e:  # noqa: BLE001
                raise LoopError(f"not a valid schedule: {e}") from e
            before, after = {"cron": sh.cron}, {"cron": text}
            sh.cron, sh.next_at = text, nxt
    imp = Improvement(by=who, staff_id=st.id, kind=kind, ref=sh.id if sh else "", before=before, after=after,
                      reason=reason.strip()[:2000], baseline=_baseline(db, st.id, sh.id if sh else None), task_id=task_id)
    db.add(imp)
    db.flush()
    _retro_note(db, imp, st, sh, "Changed")
    db.add(Notice(kind="doc", title=f"Retro improved {st.name}: {_what(imp, sh)}", body=reason[:180],
                  url="/monitor/#improve", tag=f"imp-{imp.id}"))
    db.commit()
    return imp


def _what(imp: Improvement, sh: Shift | None) -> str:
    return {"job": "instructions", "lessons": "lessons", "shift_brief": f"the brief of “{sh.name if sh else imp.ref}”",
            "shift_schedule": f"the schedule of “{sh.name if sh else imp.ref}”"}[imp.kind]


def _retro_note(db: Session, imp: Improvement, st: Staff, sh: Shift | None, verb: str, extra: str = "") -> None:
    path = M.retro_path(_aware(imp.created_at).date() if verb == "Changed" else None)
    cur = M._read(path) or (f"# Retro {path.rsplit('/', 1)[1][:-3]}\n\nWhat the weekly retro changed and why, and later whether it helped. "
                            f"Part of [[{M.ROOT}/Index|Memory]].\n")
    target = f"[[{M.lessons_path(st.id)[:-3]}|{st.name}]]" + (f" · [[{M.loop_path(st.id, sh.name)[:-3]}|{sh.name}]]" if sh else "")
    entry = f"\n### {verb}: {_what(imp, sh)} of {st.name} ({imp.id})\n\n{target}\n\n**Why:** {imp.reason}\n"
    if verb == "Changed":
        new = (imp.after.get("job") or imp.after.get("brief") or imp.after.get("cron") or "")
        if new:
            entry += "\n**Now:**\n\n> " + "\n> ".join(new[:1200].splitlines()) + "\n"
        b = imp.baseline
        entry += f"\n**Before:** success {b.get('success') if b.get('success') is not None else '–'}%, approval {b.get('approval') if b.get('approval') is not None else '–'}% over {b.get('runs', 0)} runs.\n"
    entry += extra
    M._write(db, path, cur.rstrip() + "\n" + entry, imp.by if imp.by != "owner" else "saga-os", f"{verb} {_what(imp, sh)} of {st.name}")


def _restore(db: Session, imp: Improvement) -> None:
    st = db.get(Staff, imp.staff_id)
    sh = db.get(Shift, imp.ref) if imp.ref else None
    if imp.kind == "job" and st:
        st.job = imp.before.get("job", st.job)
    elif imp.kind == "shift_brief" and sh:
        sh.brief = imp.before.get("brief", sh.brief)
    elif imp.kind == "shift_schedule" and sh:
        from .services import next_run

        sh.cron = imp.before.get("cron", sh.cron)
        sh.next_at = next_run(sh.cron, db=db)
    elif imp.kind == "lessons" and st:
        M._write(db, M.lessons_path(st.id), imp.before.get("text") or "", "saga-os", f"Rolled back the retro's lesson clean-up ({imp.id})", notify=True)


def undo(db: Session, imp: Improvement, by: str = "owner") -> Improvement:
    if imp.status not in ("active", "kept"):
        raise LoopError(f"this change is already {imp.status.replace('_', ' ')}", 409)
    _restore(db, imp)
    imp.status, imp.evaluated_at = "undone", now()
    st = db.get(Staff, imp.staff_id)
    if st:
        _retro_note(db, imp, st, db.get(Shift, imp.ref) if imp.ref else None, "Undone", "\nYou undid this change.\n")
    db.commit()
    return imp


def evaluate(db: Session) -> list[Improvement]:
    """Look again at changes that have had time to show results: keep them, or roll them back when results got worse."""
    done = []
    for imp in db.scalars(select(Improvement).where(Improvement.status == "active")):
        since = _aware(imp.created_at)
        if now() - since < dt.timedelta(days=MEASURE_DAYS):
            continue
        tasks, props = _window(db, since, staff_id=imp.staff_id, shift_id=imp.ref or None)
        after = _score(tasks, props)
        if after["runs"] < MIN_RUNS and now() - since < dt.timedelta(days=MEASURE_DAYS * 3):
            continue  # not enough evidence yet
        b = imp.baseline or {}
        worse = []
        if b.get("success") is not None and after["success"] is not None and b["success"] - after["success"] >= WORSE_SUCCESS:
            worse.append(f"success {b['success']}% → {after['success']}%")
        if b.get("approval") is not None and after["approval"] is not None and after["decided"] >= 2 and b["approval"] - after["approval"] >= WORSE_APPROVAL:
            worse.append(f"approval {b['approval']}% → {after['approval']}%")
        imp.result, imp.evaluated_at = after, now()
        st = db.get(Staff, imp.staff_id)
        sh = db.get(Shift, imp.ref) if imp.ref else None
        if worse:
            _restore(db, imp)
            imp.status = "rolled_back"
            db.add(Notice(kind="doc", title=f"Rolled back a retro change to {st.name if st else imp.staff_id}", body="; ".join(worse),
                          url="/monitor/#improve", tag=f"imp-{imp.id}"))
            if st:
                _retro_note(db, imp, st, sh, "Rolled back", f"\nResults got worse ({'; '.join(worse)}), so the old version is back.\n")
        else:
            imp.status = "kept"
            if st:
                _retro_note(db, imp, st, sh, "Kept",
                            f"\nAfter: success {after['success'] if after['success'] is not None else '–'}%, approval "
                            f"{after['approval'] if after['approval'] is not None else '–'}% over {after['runs']} runs. It stays.\n")
        done.append(imp)
    db.commit()
    return done


def serialize(imp: Improvement) -> dict:
    return {"id": imp.id, "by": imp.by, "staff_id": imp.staff_id, "kind": imp.kind, "ref": imp.ref, "reason": imp.reason,
            "before": imp.before, "after": imp.after, "baseline": imp.baseline, "result": imp.result, "status": imp.status,
            "created_at": _aware(imp.created_at).isoformat(), "evaluated_at": _aware(imp.evaluated_at).isoformat() if imp.evaluated_at else None}


# ------------------------------------------------------------------ the retro itself
RETRO_BRIEF = ("Weekly retro. Call review_week, then improve the loops that are not working: at most 3 changes, each with a clear reason. "
               "Use improve to rewrite a helper's instructions (kind=job), a regular job's brief or schedule (shift_brief, shift_schedule), "
               "or to merge duplicate lessons (lessons). Changes apply at once and are measured; ones that make results worse are rolled back. "
               "Keep what works. Report what you changed and what you left alone, and why.")


def ensure_retro(db: Session) -> None:
    """Every company with a Chief of Staff has the weekly retro loop."""
    from .services import add_shift, chief

    c = chief(db)
    if not c:
        return
    for sh in c.shifts:
        if sh.name in ("weekly-retro", "Weekly retro"):
            if sh.brief.startswith("Weekly retro: review the week's tasks"):  # the old retro could only propose
                sh.brief = RETRO_BRIEF
                db.commit()
            return
    add_shift(db, c, "weekly-retro", RETRO_CRON, RETRO_BRIEF)


def transient(error: str) -> bool:
    return bool(TRANSIENT.search(error or "")) and "usage limit" not in (error or "").lower()
