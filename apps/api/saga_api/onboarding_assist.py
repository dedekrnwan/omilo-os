"""The onboarding assistant: the chat half of the hybrid onboarding.

The owner talks (or pastes a website link, a pitch, notes); Claude reads it, fills in the guided form
through one tool, `update_answers`, and asks a short follow-up for what is still missing. It can open a
pasted website with Anthropic's hosted web fetch. The form stays the source of truth: the owner sees every
change highlighted and can edit it.

This runs before any helper exists, so it calls Claude with the owner's key directly; helpers themselves
always run through Hermes.
"""
from __future__ import annotations

import json

import httpx

from . import onboarding as OB
from .engines.claude import DEFAULT_MODEL, api_base, headers

MAX_TURNS = 4


def _keys(group: str) -> list[str]:
    return list(OB.options()[group].keys())


def answers_schema() -> dict:
    s, arr = {"type": "string"}, lambda enum: {"type": "array", "items": {"type": "string", "enum": enum}}
    return {
        "type": "object",
        "properties": {
            "company_name": s, "one_liner": {**s, "description": "1-2 sentences: what, for whom, where"},
            "industry": {"type": "string", "enum": _keys("industries")}, "industry_other": s,
            "location": s, "stage": {"type": "string", "enum": _keys("stages")},
            "team_size": {"type": "string", "enum": _keys("team_sizes")},
            "has_software": {"type": "boolean", "description": "true only if they build their own app or website code"},
            "website": s, "different": s,
            "customers": s, "customer_problem": s, "customer_objections": s,
            "offers": {"type": "array", "items": {"type": "object", "properties": {"name": s, "price": s, "note": s}, "required": ["name"]}},
            "not_yet": s,
            "goals": arr(_keys("goals")), "goal_notes": {"type": "object", "additionalProperties": {"type": "string"}},
            "focus_until": s,
            "languages": arr(_keys("languages")), "language_other": s,
            "tones": {**arr(_keys("tones")), "maxItems": 3}, "avoid": s, "example": s,
            "tools": arr(_keys("tools")), "tools_other": s,
            "rules": arr(_keys("rules")), "rules_other": s,
        },
    }


TOOL = {"name": "update_answers", "description": "Fill in or correct fields of the onboarding form. Only include fields you are confident about. "
        "Lists replace the whole list, so include existing items you want to keep.", "input_schema": answers_schema()}
WEB_FETCH = {"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 3}

SYSTEM = """You help a business owner set up Saga OS, where AI helpers work for their company. Most owners are not technical.
The owner is filling in a form about their business. Your job:
1. Read what the owner writes (or a website they paste: open it with web_fetch) and fill the form with update_answers.
   Use only facts the owner gave or that the website states. Never invent prices, numbers or customers.
2. Then reply in 1-3 short, friendly sentences, in the owner's language: say what you filled in, and ask ONE question
   about the most important thing still missing (priority: what they do, customers, what they sell and prices, goals, voice, rules).
3. If the owner asks a question about Saga OS or the form, answer it simply.
Option keys you may use:
{options}
Current form (JSON):
{answers}
The owner is on this part of the form: {step}."""


def _options_text() -> str:
    o = OB.options()
    lines = []
    for g in ("industries", "stages", "team_sizes", "goals", "tones", "languages", "tools", "rules"):
        vals = o[g]
        lines.append(f"- {g}: " + ", ".join(f"{k} ({v['label'] if isinstance(v, dict) else v})" for k, v in vals.items()))
    return "\n".join(lines)


def _clean(patch: dict) -> dict:
    """Keep only known fields and valid option keys."""
    props = answers_schema()["properties"]
    out: dict = {}
    for k, v in (patch or {}).items():
        if k not in props or v is None:
            continue
        p = props[k]
        if p.get("type") == "string" and "enum" in p:
            if v in p["enum"]:
                out[k] = v
        elif p.get("type") == "array" and "enum" in p.get("items", {}):
            vals = [x for x in v if x in p["items"]["enum"]] if isinstance(v, list) else []
            out[k] = vals[: p.get("maxItems", len(vals))]
        elif k == "offers" and isinstance(v, list):
            out[k] = [{"name": str(o.get("name", "")), "price": str(o.get("price", "") or ""), "note": str(o.get("note", "") or "")}
                      for o in v if isinstance(o, dict) and str(o.get("name", "")).strip()]
        elif k == "goal_notes" and isinstance(v, dict):
            out[k] = {str(a): str(b) for a, b in v.items()}
        elif p.get("type") == "boolean":
            out[k] = bool(v)
        elif p.get("type") == "string":
            out[k] = str(v)
    return out


async def assist(key: str, model: str | None, answers: dict, history: list[dict], step: str) -> dict:
    """history: [{"role": "owner"|"assistant", "text": str}] oldest first, last is the owner's new message."""
    system = SYSTEM.format(options=_options_text(), answers=json.dumps(answers, ensure_ascii=False)[:12000], step=step or "start")
    msgs: list[dict] = []
    for h in history[-16:]:
        role = "user" if h.get("role") == "owner" else "assistant"
        if msgs and msgs[-1]["role"] == role:
            msgs[-1]["content"] += "\n\n" + str(h.get("text", ""))
        else:
            msgs.append({"role": role, "content": str(h.get("text", ""))})
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    if not msgs:
        return {"reply": "", "patch": {}}
    tools = [TOOL, WEB_FETCH]
    patch: dict = {}
    reply = ""
    async with httpx.AsyncClient(timeout=120) as c:
        for _ in range(MAX_TURNS):
            body = {"model": model or DEFAULT_MODEL, "max_tokens": 2048, "system": system, "messages": msgs, "tools": tools}
            r = await c.post(f"{api_base()}/v1/messages", json=body, headers=headers(key))
            if r.status_code == 400 and WEB_FETCH in tools and "web_fetch" in r.text:
                tools = [TOOL]
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"Claude answered {r.status_code}: {r.text[:200]}")
            data = r.json()
            content = data.get("content") or []
            reply = "\n".join(b.get("text", "") for b in content if b.get("type") == "text").strip() or reply
            uses = [b for b in content if b.get("type") == "tool_use" and b.get("name") == "update_answers"]
            for u in uses:
                patch.update(_clean(u.get("input") or {}))
            if data.get("stop_reason") == "pause_turn":
                msgs.append({"role": "assistant", "content": content})
                continue
            if uses and not reply:  # it filled the form but did not talk yet: ask for the reply
                msgs.append({"role": "assistant", "content": content})
                msgs.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": u["id"], "content": "saved"} for u in uses]})
                continue
            break
    return {"reply": reply or "Done. Anything else about your business?", "patch": patch}
