"""Per-helper Behavior settings → runner (sweep/team-analytics).

The Team → helper → Behavior tab stores ``helper.behavior``:

    {
      "spend_per_task_idr": 50000,      # pause-and-ask threshold per task (Rupiah)
      "messages_per_hour": 60,          # runaway-loop guard on external channels
      "never_discuss": ["Legal", ...],  # topics always handed to a person
      "work_hours_override": false,     # use the helper's own hours instead of the company's
      "handoff_to": "owner" | "helper:<id>" | "member:<id>",
      "language": "Bahasa Indonesia" | "English" | "auto",
    }

``build_helper_instructions`` turns the job description + these settings into
the standing instructions every engine gets on ``TaskContext.instructions``
(the system-prompt material). ``enforce_spend_cap`` raises an Inbox alert when
one task costs more than the per-task cap (engines report cost only after the
turn, so the cap is enforced as an alert rather than a mid-turn stop).
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

# Rupiah per credit — the small top-up pack is 1 000 credits for Rp 15 000
# (omilo.api.billing TOPUP_PACKS). Used to convert the Rupiah cap to credits.
IDR_PER_CREDIT = 15


def _behavior(helper: Any) -> dict[str, Any]:
    b = getattr(helper, "behavior", None)
    return b if isinstance(b, dict) else {}


def spend_cap_credits(helper: Any) -> int | None:
    idr = _behavior(helper).get("spend_per_task_idr")
    try:
        idr = int(idr)
    except (TypeError, ValueError):
        return None
    if idr <= 0:
        return None
    return max(1, idr // IDR_PER_CREDIT)


def build_helper_instructions(helper: Any) -> str:
    """Job description + Behavior settings as plain-language standing instructions."""
    b = _behavior(helper)
    lines: list[str] = []
    jd = (getattr(helper, "job_description", "") or "").strip()
    if jd:
        lines.append(jd)
    title = getattr(helper, "title", None)
    if title:
        lines.append(f"Your job title: {title}.")
    lang = b.get("language")
    if lang and lang != "auto":
        lines.append(f"Reply in {lang} unless the person writes in another language.")
    elif lang == "auto":
        lines.append("Reply in the language the person writes in.")
    topics = [t for t in (b.get("never_discuss") or []) if isinstance(t, str) and t.strip()]
    if topics:
        lines.append(
            "Never discuss these topics yourself — hand the conversation to a person: "
            + ", ".join(topics)
            + "."
        )
    handoff = b.get("handoff_to")
    if handoff:
        who = "the owner" if handoff == "owner" else handoff.split(":", 1)[-1]
        lines.append(f"When you're stuck, hand off to {who} with a short summary.")
    idr = b.get("spend_per_task_idr")
    if idr:
        lines.append(f"Pause and ask before one task costs more than Rp {int(idr):,}.".replace(",", "."))
    mph = b.get("messages_per_hour")
    if mph:
        lines.append(f"Send at most {int(mph)} messages per hour on any channel.")
    return "\n".join(lines)


def enforce_spend_cap(db: Session, job: Any, helper: Any, cap: int | None) -> bool:
    """Create an Inbox alert when *job* cost more than the per-task cap. Returns True if over."""
    if cap is None or (job.cost_credits or 0) <= cap:
        return False
    try:
        from omilo.models.base import prefixed_id
        from omilo.models.inbox import InboxItem

        summary = (
            f"One task cost {job.cost_credits} credits; the limit is {cap} credits "
            f"(≈ Rp {cap * IDR_PER_CREDIT:,}).".replace(",", ".")
        )
        item = InboxItem(
            id=prefixed_id("inb"),
            company_id=job.company_id,
            title=f"{helper.name} went over its per-task limit",
            summary=summary,
            session_id=job.session_id or "",
            channel_id=(helper.channel_ids[0] if getattr(helper, "channel_ids", None) else ""),
            kind="alert",
            status="pending",
            asker=helper.name,
            asker_area=helper.area,
            needs_you=True,
        )
        with db.begin_nested():
            db.add(item)
    except Exception:  # alerts are best-effort; never break the job
        return True
    return True
