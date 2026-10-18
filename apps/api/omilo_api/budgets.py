"""Monthly budgets per helper: spend (USD, at API prices) and tokens.

After every run the worker calls check(): at 80% of a budget the owner gets an Inbox alert, at 100% the helper is
paused (with a critical alert) until the owner raises the budget or resumes it. Each level fires once per month."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import services as S
from .models import RunEvent, Setting, Staff


def month_start(db: Session) -> dt.datetime:
    local = S.now().astimezone(S._tz(db))
    return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def token_budget(db: Session, staff_id: str) -> int:
    s = db.get(Setting, f"budget_tokens:{staff_id}")
    return int(s.value or 0) if s else 0


def set_token_budget(db: Session, staff_id: str, tokens: int) -> None:
    key = f"budget_tokens:{staff_id}"
    s = db.get(Setting, key)
    if s:
        s.value = int(tokens)
    else:
        db.add(Setting(key=key, value=int(tokens)))


def month_usage(db: Session, staff_id: str | None = None) -> dict[str, dict]:
    """Month-to-date tokens and spend per helper, from run usage events."""
    q = select(RunEvent).where(RunEvent.kind == "usage", RunEvent.at >= month_start(db))
    if staff_id:
        q = q.where(RunEvent.staff_id == staff_id)
    out: dict[str, dict] = {}
    for e in db.scalars(q):
        u = out.setdefault(e.staff_id, {"tokens": 0, "cost_usd": 0.0})
        u["tokens"] += int((e.data or {}).get("tokens") or 0)
        u["cost_usd"] += float((e.data or {}).get("cost_usd") or 0)
    return out


def status(db: Session, st: Staff, used: dict | None = None) -> dict:
    used = used if used is not None else month_usage(db, st.id).get(st.id, {"tokens": 0, "cost_usd": 0.0})
    usd, tok = float(st.budget_usd_month or 0), token_budget(db, st.id)
    pct_usd = used["cost_usd"] / usd * 100 if usd else None
    pct_tok = used["tokens"] / tok * 100 if tok else None
    pcts = [p for p in (pct_usd, pct_tok) if p is not None]
    return {"budget_usd": usd, "budget_tokens": tok, "cost_usd": round(used["cost_usd"], 4), "tokens": used["tokens"],
            "pct_usd": round(pct_usd, 1) if pct_usd is not None else None, "pct_tokens": round(pct_tok, 1) if pct_tok is not None else None,
            "pct": round(max(pcts), 1) if pcts else None}


def check(db: Session, staff_id: str) -> str | None:
    """Alert at 80%, pause at 100%. Returns 'warn', 'paused' or None."""
    st = db.get(Staff, staff_id)
    if not st:
        return None
    b = status(db, st)
    if b["pct"] is None:
        return None
    month = month_start(db).strftime("%Y-%m")
    key = f"budget_flag:{staff_id}:{month}"
    flag = db.get(Setting, key)
    sent = int(flag.value or 0) if flag else 0
    what = (f"${b['cost_usd']:.2f} of ${b['budget_usd']:.2f}" if b["pct_usd"] is not None and (b["pct_tokens"] is None or b["pct_usd"] >= b["pct_tokens"])
            else f"{b['tokens']:,} of {b['budget_tokens']:,} tokens")
    level = None
    if b["pct"] >= 100 and sent < 100:
        if st.status == "active":
            st.status = "paused"
        S.alert(db, f"{st.name} reached its monthly budget and is paused",
                f"{st.name} used {what} this month. It is paused so it stops spending. Raise its budget on its page "
                f"(Team → {st.name} → Budget) or resume it to continue.", st.id, None, level="critical", commit=False)
        sent, level = 100, "paused"
    elif b["pct"] >= 80 and sent < 80:
        S.alert(db, f"{st.name} used 80% of its monthly budget",
                f"{st.name} used {what} this month. At 100% it pauses until you raise the budget.", st.id, None, level="decision", commit=False)
        sent, level = 80, "warn"
    if level:
        if flag:
            flag.value = sent
        else:
            db.add(Setting(key=key, value=sent))
        db.commit()
    return level


# ------------------------------------------------------------------ the whole company
def company_budget(db: Session) -> float:
    return float(S.get_setting(db, "budget_company_usd", 0) or 0)


def company_status(db: Session) -> dict:
    """Month-to-date spend of every helper together against the company's monthly cap (0 = no cap)."""
    spent = sum(u["cost_usd"] for u in month_usage(db).values())
    cap = company_budget(db)
    return {"budget_usd": cap, "cost_usd": round(spent, 4), "pct": round(spent / cap * 100, 1) if cap else None}


def check_company(db: Session) -> str | None:
    """Alert at 80% of the company cap; at 100% pause everything (the same switch as Pause all helpers)."""
    b = company_status(db)
    if b["pct"] is None:
        return None
    key = f"budget_company_flag:{month_start(db).strftime('%Y-%m')}"
    flag = db.get(Setting, key)
    sent = int(flag.value or 0) if flag else 0
    what = f"${b['cost_usd']:.2f} of ${b['budget_usd']:.2f}"
    level = None
    if b["pct"] >= 100 and sent < 100:
        S.set_setting(db, "paused", True)
        S.alert(db, "The company reached its monthly budget: every helper is paused",
                f"Your helpers spent {what} this month together. Nothing new starts until you raise the company budget "
                "(Settings → Safety) or resume (Pause all helpers in the sidebar).", None, None, level="critical", commit=False)
        sent, level = 100, "paused"
    elif b["pct"] >= 80 and sent < 80:
        S.alert(db, "Your helpers used 80% of the company's monthly budget",
                f"Your helpers spent {what} this month together. At 100% every helper pauses until you raise it.",
                None, None, level="decision", commit=False)
        sent, level = 80, "warn"
    if level:
        if flag:
            flag.value = sent
        else:
            db.add(Setting(key=key, value=sent))
        db.commit()
    return level
