"""Deterministic flow suggestions (GET /v1/flows/suggestions).

Derived from what the company has installed — no model call:
  * each installed connector whose slug matches ``_CONNECTOR_CATALOG`` yields
    that catalog suggestion;
  * each enabled, un-paused routine yields "Turn <routine> into a flow".
Suggestions whose title already exists as a flow are dropped. Output order is
stable (catalog order, then routines by name).

Each suggestion carries a ready-to-create draft (``draft``: title, trigger,
nodes, edges in the engine's node shape) so "Create flow" is a plain
POST /v1/flows.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

_CONNECTOR_CATALOG: list[dict[str, Any]] = [
    {
        "match": ("github",),
        "id": "sg-github-deploy-triage",
        "title": "Triage failed deploys for you?",
        "sub": "GitHub is connected — Dev can read the logs when a deploy fails",
        "area": "Engineering",
        "runs_as": "Dev",
        "helper_area": "dev",
        "from": "github",
        "to": "slack",
        "trigger": {"kind": "connector_poll", "spec": {"event": "deploy_failed"}},
        "steps": ["Read logs, find the cause", "Post the likely cause"],
    },
    {
        "match": ("stripe",),
        "id": "sg-stripe-payout-digest",
        "title": "Summarise Stripe payouts every Friday?",
        "sub": "Stripe is connected — Growth can match payouts to signups",
        "area": "Business",
        "runs_as": "Growth",
        "helper_area": "marketing",
        "from": "chart-line",
        "to": "mail",
        "trigger": {"kind": "schedule", "spec": {"cron": "0 16 * * 5"}},
        "steps": ["Match payouts to signups", "Send the summary"],
    },
    {
        "match": ("gmail", "google-mail", "email"),
        "id": "sg-gmail-inbox-digest",
        "title": "Get a morning digest of important email?",
        "sub": "Gmail is connected — Chief can sort what needs you",
        "area": "Business",
        "runs_as": "Chief",
        "helper_area": "brand",
        "from": "mail",
        "to": "message-circle",
        "trigger": {"kind": "schedule", "spec": {"cron": "0 8 * * 1-5"}},
        "steps": ["Sort email by what needs you", "Post the digest"],
    },
    {
        "match": ("slack",),
        "id": "sg-slack-standup",
        "title": "Collect a daily stand-up in Slack?",
        "sub": "Slack is connected — Chief can gather updates for you",
        "area": "Engineering",
        "runs_as": "Chief",
        "helper_area": "brand",
        "from": "clock",
        "to": "slack",
        "trigger": {"kind": "schedule", "spec": {"cron": "0 9 * * 1-5"}},
        "steps": ["Collect yesterday's updates", "Post the stand-up"],
    },
    {
        "match": ("whatsapp",),
        "id": "sg-whatsapp-replies",
        "title": "Draft replies to new WhatsApp messages?",
        "sub": "WhatsApp is connected — Support can draft, you approve",
        "area": "Growth",
        "runs_as": "Support",
        "helper_area": "support",
        "from": "message-circle",
        "to": "user-check",
        "trigger": {"kind": "connector_poll", "spec": {"event": "message_received"}},
        "steps": ["Draft a reply", "You approve before sending"],
    },
]


def _draft(title: str, trigger: dict[str, Any], steps: list[str], src: str, dst: str) -> dict[str, Any]:
    """Build a linear trigger → AI steps → connector graph in the engine shape."""
    nodes: list[dict[str, Any]] = [
        {
            "id": "trigger", "kind": "trigger", "label": title, "sublabel": "",
            "x": 277, "y": 36, "config": {"ui": {"app": src}},
        }
    ]
    y = 176
    for i, label in enumerate(steps[:-1] or steps):
        nodes.append({
            "id": f"step-{i + 1}", "kind": "ai_step", "label": label, "sublabel": "",
            "x": 277, "y": y, "config": {"brief": label},
        })
        y += 140
    if len(steps) > 1:
        nodes.append({
            "id": "send", "kind": "connector", "label": steps[-1], "sublabel": "",
            "x": 277, "y": y, "config": {"ui": {"app": dst}},
        })
    edges = [
        {"id": f"e{i}", "from": a["id"], "to": b["id"]}
        for i, (a, b) in enumerate(zip(nodes, nodes[1:]), start=1)
    ]
    return {"title": title, "trigger": trigger, "nodes": nodes, "edges": edges}


def build_suggestions(db: Session) -> list[dict[str, Any]]:
    from omilo.models.connectors import Connector
    from omilo.models.flows import Flow
    from omilo.models.routines import Routine

    existing = {f.title.strip().lower() for f in db.query(Flow).all()}
    slugs = {
        (c.slug or "").lower()
        for c in db.query(Connector).all()
        if getattr(c, "enabled", True)
    }
    out: list[dict[str, Any]] = []

    for entry in _CONNECTOR_CATALOG:
        if not any(any(m in slug for m in entry["match"]) for slug in slugs):
            continue
        title = entry["title"].rstrip("?")
        flow_title = title.replace(" for you", "")
        if flow_title.lower() in existing:
            continue
        out.append({
            "id": entry["id"],
            "title": entry["title"],
            "sub": entry["sub"],
            "hint": f"{entry['runs_as']} · {len(entry['steps'])} steps",
            "area": entry["area"],
            "runs_as": entry["runs_as"],
            "helper_area": entry["helper_area"],
            "from": entry["from"],
            "to": entry["to"],
            "count": max(1, len(entry["steps"]) - 1),
            "source": "connector",
            "draft": _draft(flow_title, entry["trigger"], entry["steps"], entry["from"], entry["to"]),
        })

    routines = (
        db.query(Routine)
        .filter(Routine.enabled.is_(True), Routine.paused.is_(False))
        .order_by(Routine.name)
        .all()
    )
    for r in routines:
        if r.name.strip().lower() in existing:
            continue
        brief = (r.instructions or r.subtitle or r.name).strip()
        out.append({
            "id": f"sg-routine-{r.id}",
            "title": f"Turn “{r.name}” into a flow?",
            "sub": "Runs on its schedule today — a flow adds steps and approvals",
            "hint": f"{r.freq} · {r.at}",
            "area": "Business",
            "runs_as": "Chief",
            "helper_area": "brand",
            "from": "clock",
            "to": "message-circle",
            "count": 1,
            "source": "routine",
            "draft": _draft(
                r.name,
                {"kind": "schedule", "spec": {"cron": r.cron or "", "routine_id": r.id}},
                [brief[:80] or r.name, "Post the result"],
                "clock",
                "message-circle",
            ),
        })
    return out
