"""KPIs: the numbers you watch. A definition (label, unit, target, the goal it measures, who keeps it current)
and a history of values, each with its source, written by you or a helper (update_kpi)."""
from __future__ import annotations

import datetime as dt
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Goal, KpiDef, KpiValue, Staff

NAME = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")


def key(name: str) -> str:
    k = re.sub(r"[^a-z0-9_.-]+", "_", (name or "").strip().lower()).strip("_")[:64]
    if not NAME.match(k or ""):
        raise ValueError("give the KPI a short name, e.g. mrr or paying_rts")
    return k


def _iso(d):
    return (d if d.tzinfo else d.replace(tzinfo=dt.UTC)).isoformat() if d else None


def board(db: Session, history: int = 12) -> list[dict]:
    defs = {d.name: d for d in db.scalars(select(KpiDef))}
    vals: dict[str, list[KpiValue]] = {}
    for v in db.scalars(select(KpiValue).order_by(KpiValue.at.desc()).limit(3000)):
        if len(vals.setdefault(v.name, [])) < history:
            vals[v.name].append(v)
    goals = {g.id: g.title for g in db.scalars(select(Goal))}
    names = {s.id: s.name for s in db.scalars(select(Staff))}
    out = []
    for name in sorted(set(defs) | set(vals), key=lambda n: (defs[n].position if n in defs else 999, n)):
        d, vs = defs.get(name), vals.get(name, [])
        cur, prev = (vs[0] if vs else None), (vs[1] if len(vs) > 1 else None)
        target = d.target if d else None
        direction = d.direction if d else "up"
        progress = None
        if cur is not None and target:
            progress = round(min(1.5, (cur.value / target) if direction == "up" else (target / cur.value if cur.value else 1.5)) * 100)
        out.append({
            "name": name, "label": (d.label if d and d.label else name.replace("_", " ").capitalize()), "unit": d.unit if d else "",
            "target": target, "direction": direction, "goal_id": d.goal_id if d else None, "goal": goals.get(d.goal_id) if d and d.goal_id else None,
            "owner": d.owner if d else "", "owner_name": names.get(d.owner, "") if d and d.owner else "", "note": d.note if d else "", "defined": d is not None,
            "value": cur.value if cur else None, "period": cur.period if cur else "", "source": cur.source if cur else "",
            "by": ("You" if cur.staff_id in ("", "owner") else names.get(cur.staff_id, cur.staff_id)) if cur else "", "at": _iso(cur.at) if cur else None,
            "previous": prev.value if prev else None, "progress": progress,
            "history": [{"id": v.id, "value": v.value, "period": v.period, "source": v.source, "at": _iso(v.at),
                         "by": "You" if v.staff_id in ("", "owner") else names.get(v.staff_id, v.staff_id)} for v in reversed(vs)],
        })
    return out


def for_prompt(db: Session) -> list[dict]:
    """What helpers see in get_context: each KPI with its target, so they know what moves the needle."""
    return [{k: r[k] for k in ("name", "label", "unit", "value", "period", "target", "direction", "goal", "owner")} for r in board(db, history=2)]
