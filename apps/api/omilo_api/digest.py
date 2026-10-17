"""The weekly digest: every Monday at 08:00 (owner's time zone) the Chief of Staff posts last week's numbers in the
main chat, which also arrives as a notification. It is built from the Monitor data, so the numbers always agree."""
from __future__ import annotations

from sqlalchemy.orm import Session

from . import monitor
from . import services as S
from .models import Setting

SEND_HOUR = 8


def enabled(db: Session) -> bool:
    return S.get_setting(db, "digest_enabled", True) is not False


def last_sent(db: Session) -> str | None:
    return S.get_setting(db, "digest_last", None)


def _money(x: float) -> str:
    return f"${x:,.2f}" if x >= 1 else f"${x:.3f}"


def _dur(s: float | None) -> str:
    if not s:
        return "–"
    return f"{round(s)}s" if s < 60 else f"{round(s / 60)} min" if s < 3600 else f"{s / 3600:.1f} h"


def compose(db: Session) -> str:
    m = monitor.build(db, "7d")
    k = m["kpi"]
    jobs = k["jobs_done"] + k["jobs_failed"]
    ok = round(k["jobs_done"] * 100 / jobs) if jobs else None

    def delta(cur, prev):
        if not prev:
            return ""
        p = round((cur - prev) * 100 / prev)
        return f" ({'+' if p >= 0 else ''}{p}% vs the week before)"

    lines = ["## Your week in Omilo", "",
             f"- **{k['jobs_done']} jobs finished**" + (f", {k['jobs_failed']} failed ({ok}% succeeded)" if jobs else "") + delta(k["jobs_done"], k["jobs_done_prev"]),
             f"- **{k['tokens']:,} tokens**, {_money(k['cost_usd'])} at API prices" + delta(k["tokens"], k["tokens_prev"]),
             f"- **{k['waiting']} waiting on you**" + (f", the oldest since {k['oldest_waiting'][:10]}" if k["oldest_waiting"] else "") +
             (f"; you answered in about {k['avg_decision_minutes']} min on average" if k["avg_decision_minutes"] is not None else "")]
    top = sorted(m["helpers"], key=lambda h: -h["tokens"])[:3]
    if any(h["tokens"] for h in top):
        lines += ["", "**Busiest helpers**", ""] + [f"- {h['name']}: {h['jobs_done']} jobs, {h['tokens']:,} tokens, {_money(h['cost_usd'])}" for h in top if h["tokens"]]
    worth = [v for v in m["value"] if v["approved"]]
    if worth:
        lines += ["", "**What got approved**", ""] + [
            f"- {v['name']}: {v['approved']} of {v['proposals']} proposals approved" + (f", {_money(v['cost_per_approved'])} per approved item" if v["cost_per_approved"] else "") for v in worth[:4]]
    if m["failures"]:
        f = m["failures"][0]
        lines += ["", f"**Most common failure:** {f['label'].lower()} ({f['count']}×). {f['fix']}."]
    slow = [e for e in m["timing"]["engines"] if e["jobs"] >= 3 and e["fail_rate"] >= 20]
    for e in slow[:2]:
        lines.append(f"- {e['engine']} failed {e['fail_rate']}% of its jobs (median {_dur(e['median_s'])}).")
    over = [(sid, b) for sid, b in m["budgets"].items() if b["pct"] is not None and b["pct"] >= 80]
    if over:
        names = {h["id"]: h["name"] for h in m["helpers"]}
        lines += ["", "**Budgets**", ""] + [f"- {names.get(sid, sid)} is at {round(b['pct'])}% of its monthly budget" for sid, b in over]
    pool = m["pool"]
    if pool["total"]:
        lines += ["", f"**Claude Code pool:** {pool['ready']} of {pool['total']} accounts ready, {m['pool_history']['hits_7d']} limit hits this week."]
    lines += ["", "Details on the [Monitor](/monitor/) page."]
    return "\n".join(lines)


def send(db: Session) -> str:
    ch = S.chief(db)
    if not ch:
        raise S.DomainError("no Chief of Staff yet")
    th = S.get_or_create_thread(db, "master", None, ch.id, "Chief of Staff")
    text = compose(db)
    S.post_message(db, th, "agent", ch.id, text)
    week = S.now().astimezone(S._tz(db)).strftime("%G-W%V")
    s = db.get(Setting, "digest_last")
    if s:
        s.value = week
    else:
        db.add(Setting(key="digest_last", value=week))
    db.commit()
    return th.id


def maybe_send(db: Session) -> bool:
    """Called by the worker: Monday from 08:00 local time, once per ISO week."""
    if not enabled(db):
        return False
    local = S.now().astimezone(S._tz(db))
    if local.isoweekday() != 1 or local.hour < SEND_HOUR or last_sent(db) == local.strftime("%G-W%V"):
        return False
    send(db)
    return True
