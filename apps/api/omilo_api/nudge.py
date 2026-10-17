"""The nudge ladder: anything waiting on the owner gets louder until they decide, snooze or delegate it.

    Decision   at once → +2 h push again → +6 h the Chief of Staff calls it out → next 07:30 top of the brief
    Blocking   at once → +30 min push again → +2 h the Chief of Staff calls it out → every 2 h (not at night)
    Critical   at once → every 15 min until the owner has seen it, ignoring quiet hours and focus

Each step is measured from the step before it, so an item that arrived during quiet hours starts its ladder when they
end, instead of jumping straight to a late step. Steps are Notification rows (channel "ladder"); every reminder is a
Notice (kind "nudge"), so it reaches open tabs live and goes out as Web Push like everything else. Snoozed items wake up
here too, and start their ladder again.
"""
from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import notify as N
from . import services as S
from .models import InboxItem, Notice, Notification, Proposal, Staff, now

log = logging.getLogger("omilo.nudge")

H = dt.timedelta(hours=1)
M = dt.timedelta(minutes=1)
BRIEF = "brief"  # a step that waits for the next morning brief instead of a fixed gap
# (channel, gap after the previous step); the last step repeats when the ladder says so
LADDERS: dict[str, tuple[list[tuple[str, dt.timedelta | str]], bool]] = {
    "decision": ([("push", dt.timedelta(0)), ("push", 2 * H), ("cos", 4 * H), ("brief", BRIEF)], False),
    "blocking": ([("push", dt.timedelta(0)), ("push", 30 * M), ("cos", 90 * M), ("push", 2 * H)], True),
    "critical": ([("push", dt.timedelta(0)), ("push", 15 * M)], True),
}
BRIEF_AT = (7, 30)
FRESH = dt.timedelta(minutes=3)  # the item's own notice still counts as the first step
STOP = {"snoozed", "asked_cos", "approved"}  # deciding closes the item; these stop the ladder too
ACK = {"seen", "opened"}  # stop the repeats of a Critical item


def ladder_for(item: InboxItem) -> str | None:
    if item.level == "critical":
        return "critical"
    if item.level == "fyi":
        return None  # FYI never pushes: it goes into the brief and the Work timeline
    return "blocking" if item.blocking else "decision"


def _aware(d: dt.datetime | None) -> dt.datetime | None:
    return d if d is None or d.tzinfo else d.replace(tzinfo=dt.UTC)


def next_brief(db: Session, after: dt.datetime) -> dt.datetime:
    local = after.astimezone(S._tz(db))
    at = local.replace(hour=BRIEF_AT[0], minute=BRIEF_AT[1], second=0, microsecond=0)
    if at <= local:
        at += dt.timedelta(days=1)
    return at.astimezone(dt.UTC)


def record(db: Session, item: InboxItem | None, channel: str, action: str, user_id: str = "", step: int = 0,
           notice_id: int | None = None, level: str = "decision", at: dt.datetime | None = None) -> Notification:
    at = at or now()
    n = Notification(inbox_item_id=item.id if item else None, channel=channel, action=action, user_id=user_id, step=step,
                     notice_id=notice_id, level=level, sent_at=at, acted_at=at if channel == "owner" else None,
                     seen_at=at if action in ACK else None)
    db.add(n)
    return n


def history(db: Session, item: InboxItem) -> list[Notification]:
    """This item's rows since it last woke from a snooze (a fresh ladder starts there)."""
    rows = list(db.scalars(select(Notification).where(Notification.inbox_item_id == item.id).order_by(Notification.id)))
    woke = [i for i, r in enumerate(rows) if r.action == "woke"]
    return rows[woke[-1]:] if woke else rows


def state(db: Session, item: InboxItem) -> dict:
    """Where the item stands on its ladder: the step that comes next and when it is due (None: the ladder is done)."""
    kind = ladder_for(item)
    if not kind or item.status != "open":
        return {"ladder": kind, "next": None, "due": None, "stopped": True}
    rows = history(db, item)
    if any(r.action in STOP for r in rows):
        return {"ladder": kind, "next": None, "due": None, "stopped": True}
    steps = [r for r in rows if r.channel == "ladder" and r.action == "nudged"]
    if kind == "critical" and steps and any(r.action in ACK and r.id > steps[0].id for r in rows):
        return {"ladder": kind, "next": None, "due": None, "stopped": True}
    plan, repeat = LADDERS[kind]
    woke = next((r for r in rows if r.action == "woke"), None)
    base = _aware(woke.sent_at) if woke else _aware(item.created_at) or now()
    if not steps:
        return {"ladder": kind, "next": 0, "due": base, "stopped": False, "fresh": not woke}
    last = steps[-1]
    k = last.step + 1
    if k >= len(plan):
        if not repeat:
            return {"ladder": kind, "next": None, "due": None, "stopped": False, "done": True}
        k = len(plan) - 1  # the last step repeats
        channel, gap = plan[-1]
    else:
        channel, gap = plan[k]
    prev = _aware(last.sent_at)
    due = next_brief(db, prev) if gap == BRIEF else prev + gap
    return {"ladder": kind, "next": k, "due": due, "channel": channel, "stopped": False}


# ------------------------------------------------------------------ the reminders themselves
def _who(db: Session, item: InboxItem) -> str:
    st = db.get(Staff, item.staff_id) if item.staff_id else None
    return st.name if st else (item.staff_id or "Omilo")


def _age(item: InboxItem) -> str:
    s = (now() - (_aware(item.created_at) or now())).total_seconds()
    if s < 3600:
        return f"{max(1, int(s // 60))} min"
    if s < 86400:
        return f"{int(s // 3600)} h"
    return f"{int(s // 86400)} d"


def _notice(db: Session, item: InboxItem, title: str, level: str) -> Notice:
    who = _who(db, item)
    n = Notice(kind="nudge", title=N._clip(title, 120), body=N._clip(item.title), url=N.item_url(item.id), tag=f"inbox-{item.id}",
               level=level, item_id=item.id, who=who if item.staff_id else "")
    db.add(n)
    db.flush()
    return n


def _cos_callout(db: Session, item: InboxItem) -> None:
    """The Chief of Staff says it in the main chat: what is waiting, for how long, and who is stuck."""
    chief = S.chief(db)
    if not chief:
        return
    who = _who(db, item)
    what = {"proposal": "approval", "question": "question", "workflow": "approval"}.get(item.kind, "item")
    stuck = f" {who} can't go on until you answer." if item.blocking else ""
    risk = ""
    if item.kind == "proposal" and item.ref_id and (p := db.get(Proposal, item.ref_id)):
        risk = f" It is {p.risk} risk."
    text = (f"**Waiting on you for {_age(item)}:** {who}'s {what}, \"{item.title}\".{stuck}{risk}\n\n"
            f"[Open it in the Inbox]({N.item_url(item.id)}), snooze it, or ask me to explain it.")
    th = S.get_or_create_thread(db, "master", None, chief.id, "Chief of Staff")
    from .models import Message

    m = Message(thread_id=th.id, role="agent", author=chief.id, text=text, blocks=[{"type": "text", "text": text}], channel="web")
    m._no_notice = True  # the nudge below is the notification; don't send a second one for the chat message
    db.add(m)
    th.updated_at = now()


def _title(item: InboxItem, who: str, kind: str, step: int, channel: str, woke: bool) -> str:
    if woke and step == 0:
        return f"Back from snooze: {item.title}"
    if kind == "critical":
        return f"Critical: {item.title}" if step == 0 else f"Still critical: {item.title}"
    if channel == "cos":
        return f"Chief of Staff: {who} is still waiting on you"
    if kind == "blocking":
        return f"{who} is stuck until you answer" if step == 0 else f"{who} is still waiting on you ({_age(item)})"
    what = "your approval" if item.kind in ("proposal", "workflow") else "an answer"
    return f"{who} needs {what}" if step == 0 else f"Reminder: {who} needs {what}"


def owner_prefs(db: Session, owner_id: str | None) -> dict:
    return N.prefs(db, owner_id) if owner_id else N._normalize(None)


def tick(db: Session, owner_id: str | None = None, at: dt.datetime | None = None, only: set[str] | None = None) -> list[str]:
    """One pass over the current company: wake snoozed items, fire every ladder step that is due and allowed.
    `only` limits it to some items (tests). Returns what it did, for logs and tests."""
    at = at or now()
    did: list[str] = []
    p = owner_prefs(db, owner_id)
    for item in list(db.scalars(select(InboxItem).where(InboxItem.status == "snoozed", InboxItem.snooze_until <= at))):
        if only is not None and item.id not in only:
            continue
        item.status, item.snooze_until = "open", None
        record(db, item, "owner", "woke", owner_id or "", at=at)
        did.append(f"woke {item.id}")
    db.flush()
    for item in list(db.scalars(select(InboxItem).where(InboxItem.status == "open"))):
        if only is not None and item.id not in only:
            continue
        st = state(db, item)
        if st.get("next") is None or st["due"] > at:
            continue
        kind, k = st["ladder"], st["next"]
        level = "critical" if kind == "critical" else "decision"
        if N.held(db, p, level, at):
            continue  # quiet hours or focus: the step waits (Critical never does)
        channel = st.get("channel", "push")
        notice_id = None
        if k == 0 and st.get("fresh") and at - st["due"] < FRESH:
            pass  # the item's own notice just went out: that is the first step
        elif channel == "brief":
            record(db, item, "brief", "nudged", owner_id or "", step=k, level=level, at=at)
        else:
            if channel == "cos":
                _cos_callout(db, item)
                record(db, item, "cos", "nudged", owner_id or "", step=k, level=level, at=at)
            woke = any(r.action == "woke" for r in history(db, item))
            notice_id = _notice(db, item, _title(item, _who(db, item), kind, k, channel, woke), level).id
        record(db, item, "ladder", "nudged", owner_id or "", step=k, notice_id=notice_id, level=level, at=at)
        did.append(f"{kind} {item.id} step {k} {channel}")
    db.commit()
    return did


# ------------------------------------------------------------------ what the owner does
def snooze_until(db: Session, hours: float | None = None, until: str | None = None) -> dt.datetime:
    """Snooze choices: a number of hours, 'tomorrow' (08:00) or 'monday' (08:00), in the company's time zone."""
    if until in ("tomorrow", "monday"):
        local = now().astimezone(S._tz(db))
        days = 1 if until == "tomorrow" else (7 - local.weekday()) or 7
        return (local + dt.timedelta(days=days)).replace(hour=8, minute=0, second=0, microsecond=0).astimezone(dt.UTC)
    if until:
        raise ValueError("until must be tomorrow or monday")
    return now() + dt.timedelta(hours=float(hours or 1))


def snooze(db: Session, item: InboxItem, user_id: str, hours: float | None = None, until: str | None = None) -> InboxItem:
    if item.status == "done":
        raise S.DomainError("already decided", 409)
    item.status, item.snooze_until = "snoozed", snooze_until(db, hours, until)
    record(db, item, "owner", "snoozed", user_id)
    S.audit(db, user_id, "inbox.snooze", item.id, until=item.snooze_until.isoformat())
    db.commit()
    return item


def seen(db: Session, item_ids: list[str], user_id: str, action: str = "seen") -> int:
    """The owner looked at these items: that acknowledges a Critical one (its repeats stop)."""
    n = 0
    for iid in item_ids[:200]:
        item = db.get(InboxItem, iid)
        if not item or item.status != "open":
            continue
        rows = history(db, item)
        last_step = max((r.id for r in rows if r.channel == "ladder"), default=0)
        if action == "seen" and any(r.action in ACK and r.id > last_step for r in rows):
            continue  # already acknowledged since the last reminder
        record(db, item, "owner", action, user_id)
        n += 1
    db.commit()
    return n


def ask_cos(db: Session, item: InboxItem, user_id: str):
    """Delegate: the owner asks the Chief of Staff to explain the item. That stops the ladder for it."""
    chief = S.chief(db)
    if not chief:
        raise S.DomainError("there is no Chief of Staff on the team", 409)
    who = _who(db, item)
    body = item.body or item.title
    if item.kind == "proposal" and item.ref_id and (p := db.get(Proposal, item.ref_id)):
        body = f"{p.type}, {p.risk} risk.\n\n{S.current_body(p)}"
    text = (f"Can you explain this {item.kind} from {who} and tell me what you'd do? (Inbox item {item.id})\n\n"
            f"**{item.title}**\n\n{body[:4000]}")
    th = S.get_or_create_thread(db, "master", None, chief.id, "Chief of Staff")
    record(db, item, "owner", "asked_cos", user_id)
    S.audit(db, user_id, "inbox.ask_cos", item.id)
    S.post_message(db, th, "owner", user_id, text, awaiting_reply=True)
    return th


# ------------------------------------------------------------------ the morning brief
def stale(db: Session, older_than: dt.timedelta = 24 * H) -> list[InboxItem]:
    """Open items older than a day, or ones whose ladder reached the brief step."""
    cut = now() - older_than
    briefed = set(db.scalars(select(Notification.inbox_item_id).where(Notification.channel == "brief")))
    items = [i for i in db.scalars(select(InboxItem).where(InboxItem.status == "open"))
             if (_aware(i.created_at) or now()) <= cut or i.id in briefed]
    items.sort(key=lambda i: (i.level != "critical", not i.blocking, _aware(i.created_at)))
    return items


def similar_groups(db: Session, items: list[InboxItem]) -> list[dict]:
    """Stale low-risk proposals of the same type from the same helper: they can be decided together."""
    groups: dict[tuple[str, str], list[str]] = {}
    for i in items:
        if i.kind == "proposal" and i.ref_id and (p := db.get(Proposal, i.ref_id)) and p.status == "pending" and p.risk == "low":
            groups.setdefault((p.staff_id, p.type), []).append(p.id)
    return [{"staff_id": s, "type": t, "proposals": ids} for (s, t), ids in groups.items() if len(ids) > 1]


def brief_section(db: Session) -> str:
    """Added to the Chief of Staff's morning brief job: what is still waiting on the owner."""
    items = stale(db)
    if not items:
        return ""
    lines = ["", "", "## Waiting on the founder (put this at the top of the brief)",
             "For each item give one line: what it is, how long it has waited, and your recommendation "
             "(for example \"approve: low risk, matches last week's\"). Blocking items first."]
    for i in items[:20]:
        extra = ""
        if i.kind == "proposal" and i.ref_id and (p := db.get(Proposal, i.ref_id)):
            extra = f", {p.type}, {p.risk} risk"
        lines.append(f"- [{i.kind}{', BLOCKING' if i.blocking else ''}{extra}] {_who(db, i)}: {i.title} "
                     f"(waiting {_age(i)}, {N.item_url(i.id)})")
        if not any(r.channel == "brief" for r in history(db, i)):
            record(db, i, "brief", "nudged", level="decision")
    for g in similar_groups(db, items):
        lines.append(f"- {len(g['proposals'])} similar low-risk {g['type']} proposals from {g['staff_id']}: "
                     "tell the founder they can approve them all at once from the Inbox.")
    return "\n".join(lines)


def similar(db: Session, p: Proposal) -> list[Proposal]:
    """Other pending low-risk proposals of the same type from the same helper."""
    if p.risk != "low":
        return []
    return list(db.scalars(select(Proposal).where(Proposal.status == "pending", Proposal.risk == "low", Proposal.type == p.type,
                                                  Proposal.staff_id == p.staff_id, Proposal.id != p.id).order_by(Proposal.created_at)))
