"""Guided onboarding for owners who are not engineers.

The owner answers plain questions; this module turns the answers into the knowledge files every agent reads,
recommends a team from the goals, and describes schedules in words instead of cron.
"""
from functools import lru_cache
from pathlib import Path

import yaml

from . import catalog

FILE = Path(__file__).parent / "templates" / "onboarding.yaml"
MISSING = "_Not filled in yet. Ask the founder (ask_founder) before relying on this._"


@lru_cache
def options() -> dict:
    return yaml.safe_load(FILE.read_text())


# ------------------------------------------------------------------ schedules in words
DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]


def _days(field: str) -> str | None:
    if field == "*":
        return "every day"
    if field in ("1-5", "MON-FRI", "mon-fri"):
        return "every weekday"
    if field in ("0,6", "6,0"):
        return "every weekend"
    try:
        idx = [int(x) % 7 for x in field.split(",")]
    except ValueError:
        return None
    names = [DAYS[i] for i in idx]
    if len(names) == 1:
        return f"every {names[0]}"
    return "every " + ", ".join(names[:-1]) + " and " + names[-1]


def describe_cron(cron: str) -> str:
    """'30 7 * * *' -> 'Every day at 07:30'. Falls back to the raw expression for anything unusual."""
    parts = cron.split()
    if len(parts) != 5:
        return cron
    minute, hour, dom, month, dow = parts
    if dom != "*" or month != "*" or not minute.isdigit():
        return f"Custom schedule ({cron})"
    if hour == "*" and dow == "*":
        return "Every hour" if minute == "0" else f"Every hour at :{int(minute):02d}"
    days = _days(dow)
    hours = hour.split(",")
    if days is None or not all(h.isdigit() for h in hours):
        return f"Custom schedule ({cron})"
    times = " and ".join(f"{int(h):02d}:{int(minute):02d}" for h in hours)
    return f"{days[0].upper()}{days[1:]} at {times}"


# ------------------------------------------------------------------ team recommendation
def has_software(a: dict) -> bool:
    return bool(a.get("has_software")) or a.get("industry") == "software"


def recommend(a: dict) -> dict:
    """Pick helpers from the goals. 'small' merges roles into the all-in-one helpers."""
    goals = options()["goals"]
    wanted: list[str] = []
    for g in a.get("goals") or []:
        spec = goals.get(g)
        if not spec or (spec.get("software") and not has_software(a)):
            continue
        for r in spec.get("roles", []):
            if r not in wanted:
                wanted.append(r)
    if not wanted:  # no goals picked: a sensible default
        wanted = ["marketing", "support"] + (["ops"] if has_software(a) else [])
    size = a.get("team_style") or "small"
    if size == "small":
        merged: list[str] = []
        for r in wanted:
            r = {"marketing": "grower", "sales": "grower", "support": "grower", "dev": "builder", "ops": "builder"}.get(r, r)
            if r not in merged:
                merged.append(r)
        wanted = merged
    roles = ["chief-of-staff"] + wanted
    return {"roles": roles, "max_concurrent_tasks": max(1, min(len(roles), 4 if size == "small" else 8))}


def roles_for_people() -> dict:
    """Role cards in plain words for the onboarding and Staff pages."""
    out = {}
    for rid, r in catalog.catalog()["roles"].items():
        out[rid] = {"name": r["name"], "tagline": r.get("tagline", ""), "summary": r.get("summary", ""),
                    "does": r.get("does", []), "is_chief": bool(r.get("is_chief")),
                    "schedule": [describe_cron(s["cron"]) for s in r.get("shifts", [])],
                    "software": rid in ("dev", "ops", "builder")}
    return out


# ------------------------------------------------------------------ knowledge files
def _t(a: dict, key: str) -> str:
    return str(a.get(key) or "").strip()


def _label(group: str, key: str) -> str:
    v = options()[group].get(key, key)
    return v["label"] if isinstance(v, dict) else v


def _line(label: str, value: str) -> str:
    return f"- **{label}:** {value or MISSING}"


def _list(items: list[str]) -> str:
    return "\n".join(f"- {i}" for i in items) if items else MISSING


def render(a: dict) -> dict[str, str]:
    name = _t(a, "company_name") or "The company"
    industry = _label("industries", a["industry"]) if a.get("industry") else ""
    if a.get("industry") == "other" and _t(a, "industry_other"):
        industry = _t(a, "industry_other")
    files: dict[str, str] = {}

    files["company.md"] = "\n".join([
        f"# {name}", "",
        _t(a, "one_liner") or MISSING, "",
        _line("Type of business", industry),
        _line("Where we operate", _t(a, "location")),
        _line("Stage", _label("stages", a["stage"]) if a.get("stage") else ""),
        _line("Team size (people)", _label("team_sizes", a["team_size"]) if a.get("team_size") else ""),
        _line("Website or main page", _t(a, "website")),
        _line("Runs its own app or website code", "yes" if has_software(a) else "no"),
        "", "## What makes us different", "", _t(a, "different") or MISSING, "",
    ])

    goal_lines = []
    for g in a.get("goals") or []:
        note = _t(a.get("goal_notes") or {}, g)
        goal_lines.append(f"{_label('goals', g)}" + (f": {note}" if note else ""))
    files["goals.md"] = "\n".join([
        "# Goals", "",
        _line("Focus period", _t(a, "focus_until")), "",
        "## What the founder wants most right now", "", _list(goal_lines), "",
        "Work on what moves these goals. When a task does not help any of them, say so in the report.", "",
    ])

    files["customers.md"] = "\n".join([
        "# Customers", "",
        "## Who they are", "", _t(a, "customers") or MISSING, "",
        "## The problem we solve for them", "", _t(a, "customer_problem") or MISSING, "",
        "## Why they hesitate to buy", "", _t(a, "customer_objections") or MISSING, "",
    ])

    offers = [o for o in (a.get("offers") or []) if str(o.get("name") or "").strip()]
    rows = ["| Product or service | Price | Notes |", "| --- | --- | --- |"] + [
        f"| {o.get('name', '').strip()} | {str(o.get('price') or '').strip() or '-'} | {str(o.get('note') or '').strip() or '-'} |"
        for o in offers]
    files["offer.md"] = "\n".join([
        "# What we sell", "",
        "\n".join(rows) if offers else MISSING, "",
        "## Not available yet (never sell or promise these)", "", _t(a, "not_yet") or "Nothing listed.", "",
        "Only quote the prices above. If a customer needs a price that is not here, ask the founder.", "",
    ])

    langs = [_label("languages", x) for x in a.get("languages") or []]
    if _t(a, "language_other"):
        langs.append(_t(a, "language_other"))
    tones = [_label("tones", x) for x in a.get("tones") or []]
    files["voice.md"] = "\n".join([
        "# How we talk", "",
        _line("Languages", ", ".join(langs)),
        _line("Tone", ", ".join(tones)),
        _line("Words and topics to avoid", _t(a, "avoid")), "",
        "## An example the founder likes", "", _t(a, "example") or MISSING, "",
    ])

    tools = [_label("tools", x) for x in a.get("tools") or []]
    if _t(a, "tools_other"):
        tools.append(_t(a, "tools_other"))
    files["systems.md"] = "\n".join([
        "# Tools we use", "",
        _list(tools), "",
        "Agents can only use a tool after it is connected in Saga OS. If a task needs a tool that is not connected, "
        "ask the founder instead of guessing.", "",
    ])

    rules = [_label("rules", r) for r in a.get("rules") or []]
    if _t(a, "rules_other"):
        rules += [x.strip() for x in _t(a, "rules_other").splitlines() if x.strip()]
    files["rules.md"] = "\n".join([
        "# Rules (never break these)", "",
        _list(rules), "",
        "Anything that leaves the company (posting, sending, spending, changing live systems) goes through an "
        "approval in Saga OS. When unsure, ask the founder.", "",
    ])
    return files


def completeness(a: dict) -> dict:
    """How much the agents will know, for the review step."""
    checks = {
        "What you do": bool(_t(a, "one_liner")),
        "Who your customers are": bool(_t(a, "customers")),
        "What you sell": any(str(o.get("name") or "").strip() for o in a.get("offers") or []),
        "Your goals": bool(a.get("goals")),
        "How you talk": bool(a.get("tones") or a.get("languages")),
        "Your rules": bool(a.get("rules") or _t(a, "rules_other")),
    }
    return {"items": checks, "score": round(100 * sum(checks.values()) / len(checks))}


def default_answers(company_name: str = "") -> dict:
    return {"company_name": company_name, "goals": [], "offers": [{"name": "", "price": "", "note": ""}],
            "languages": [], "tones": [], "tools": [], "team_style": "small", "approval_mode": "ask_all",
            "rules": [k for k, v in options()["rules"].items() if v.get("default")], "has_software": False}
