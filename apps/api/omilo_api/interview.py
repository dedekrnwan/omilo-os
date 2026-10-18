"""The onboarding interview: an AI that interviews the founder about the business, structured by us
(templates/interview.yaml), and fills the company profile as it goes. Then it proposes the team that fits what it
learned, and drafts each helper's job for the founder to approve.

It runs on whichever AI the founder picked in the first step (any provider in engines/providers.py through LiteLLM,
the Claude API key, or the Claude subscription pool through the Claude Code CLI). Without an AI ("practice mode") the
same interview runs as a fixed list of questions, so the screens and the result are the same.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
from functools import lru_cache
from pathlib import Path

import yaml

from . import catalog
from . import onboarding as OB

FILE = Path(__file__).parent / "templates" / "interview.yaml"
MAX_TOOL_TURNS = 5


@lru_cache
def script() -> dict:
    return yaml.safe_load(FILE.read_text())


def topics() -> list[dict]:
    return script()["topics"]


TOPIC_IDS = [t["id"] for t in topics()]


# ------------------------------------------------------------------ the profile (answers) and how complete it is
def _filled(a: dict, field: str) -> bool:
    v = a.get(field)
    if field == "offers":
        return any(str(o.get("name") or "").strip() for o in v or [])
    if isinstance(v, bool):
        return field in a
    if isinstance(v, (list, dict)):
        return bool(v)
    return bool(str(v or "").strip())


def coverage(a: dict) -> list[dict]:
    """Per topic: done when every 'must' field is filled."""
    out = []
    for t in topics():
        must = t.get("must", [])
        have = [f for f in must if _filled(a, f)]
        out.append({"id": t["id"], "label": t["label"], "icon": t.get("icon", ""), "done": len(have) == len(must),
                    "filled": len(have), "of": len(must)})
    return out


def profile_schema() -> dict:
    from .onboarding_assist import answers_schema

    s = answers_schema()
    s["properties"]["workload"] = {"type": "string", "description": "what takes the founder's time each week"}
    s["properties"]["handoff"] = {"type": "string", "description": "the work they want to hand off to helpers first"}
    return s


def clean(patch: dict) -> dict:
    from .onboarding_assist import _clean

    out = _clean({k: v for k, v in (patch or {}).items() if k not in ("workload", "handoff")})
    for k in ("workload", "handoff"):
        if isinstance((patch or {}).get(k), str):
            out[k] = patch[k].strip()
    return out


# ------------------------------------------------------------------ the AI, whichever the founder picked
class AiError(RuntimeError):
    pass


def ai_config(db) -> dict:
    """The AI chosen in onboarding (or later in Settings): provider, model and key."""
    from . import services as S
    from .engines import providers as P

    cfg = dict(S.get_setting(db, "onboarding_ai", None) or {})
    provider = cfg.get("provider") or S.get_setting(db, "ai_provider", None) or "fake"
    model = cfg.get("model")
    if provider in ("claude", "claude-direct", "anthropic"):
        key = S.ai_api_key(db, "claude") or S.ai_api_key(db, "anthropic") or os.environ.get("ANTHROPIC_API_KEY") or ""
        return {"provider": "anthropic", "model": model or S.get_setting(db, "claude_model", None) or P.get_provider("anthropic").tiers["balanced"],
                "key": key, "label": "Claude"}
    if provider in P.provider_ids():
        p = P.get_provider(provider)
        return {"provider": provider, "model": model or p.tiers["balanced"], "key": S.ai_api_key(db, provider) or "", "label": p.label}
    if provider == "claude-code":
        return {"provider": "claude-code", "model": model, "label": "Claude subscription"}
    return {"provider": "fake", "label": "Practice mode"}


async def complete(cfg: dict, system: str, messages: list[dict], tools: list[dict] | None = None) -> dict:
    """One model turn. messages/tools in the OpenAI shape. Returns {"text", "calls": [{id, name, args}], "message"}."""
    pid = cfg["provider"]
    if pid == "claude-code":
        return await _complete_cli(cfg, system, messages, tools)
    import litellm

    from .engines import providers as P

    prefix = P.get_provider(pid).prefix
    model = cfg["model"] if "/" in cfg["model"] else f"{prefix}/{cfg['model']}"
    kw: dict = {"model": model, "messages": [{"role": "system", "content": system}, *messages], "max_tokens": 1500,
                "api_key": cfg.get("key") or None, "timeout": 90}
    if tools:
        kw["tools"] = tools
    try:
        resp = await litellm.acompletion(**kw)
    except Exception as e:  # noqa: BLE001
        raise AiError(f"{cfg.get('label', pid)} didn't answer: {str(e)[:300]}") from e
    msg = resp.choices[0].message
    calls = []
    for c in getattr(msg, "tool_calls", None) or []:
        try:
            args = json.loads(c.function.arguments or "{}")
        except ValueError:
            args = {}
        calls.append({"id": c.id, "name": c.function.name, "args": args})
    raw = {"role": "assistant", "content": msg.content or ""}
    if calls:
        raw["tool_calls"] = [{"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": json.dumps(c["args"])}} for c in calls]
    return {"text": (msg.content or "").strip(), "calls": calls, "message": raw}


async def _complete_cli(cfg: dict, system: str, messages: list[dict], tools: list[dict] | None) -> dict:
    """The Claude subscription pool: one Claude Code call that answers with JSON (it has no function calling here)."""
    from . import harness as H

    cli = H.find_cli()
    if not cli:
        raise AiError("Claude Code isn't installed yet. Wait for it to finish installing, then try again.")
    leased = H.lease()
    if not leased:
        raise AiError("Add a Claude subscription first (paste the token from `claude setup-token`), or wait for one to be free.")
    account_id, _label_, token = leased
    shape = {t["function"]["name"]: t["function"]["parameters"] for t in tools or []}
    convo = "\n\n".join(f"{m['role'].upper()}: {m.get('content') or ''}" for m in messages if m["role"] in ("user", "assistant"))
    prompt = (f"{system}\n\nConversation so far:\n{convo}\n\nAnswer with ONE JSON object only, no other text: "
              '{"reply": "<what you say to the founder>", "calls": [{"name": "<tool>", "args": {...}}]}. '
              f"Tools you may call (name: JSON schema of args): {json.dumps(shape)[:6000]}")
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY",)}
    env["CLAUDE_CODE_OAUTH_TOKEN"] = token
    try:
        proc = await asyncio.create_subprocess_exec(cli, "-p", prompt, "--output-format", "json", "--max-turns", "1",
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env)
        out, err = await asyncio.wait_for(proc.communicate(), timeout=180)
    finally:
        H.release(account_id, ok=True)
    try:
        result = json.loads(out.decode() or "{}").get("result", "")
        data = json.loads(re.search(r"\{.*\}", result, re.S).group(0))
    except Exception as e:  # noqa: BLE001
        raise AiError(f"Claude Code gave an answer I couldn't read: {(err or out).decode()[:200]}") from e
    calls = [{"id": f"c{i}", "name": c.get("name"), "args": c.get("args") or {}} for i, c in enumerate(data.get("calls") or []) if isinstance(c, dict)]
    return {"text": str(data.get("reply") or "").strip(), "calls": calls, "message": {"role": "assistant", "content": str(data.get("reply") or "")}}


async def check(cfg: dict) -> None:
    """A tiny call to prove the key and model work. Raises AiError with a plain message."""
    if cfg["provider"] == "fake":
        return
    if cfg["provider"] != "claude-code" and not cfg.get("key") and cfg["provider"] != "bedrock":
        raise AiError("Paste your API key first.")
    r = await complete(cfg, "Reply with the single word OK.", [{"role": "user", "content": "Say OK"}])
    if not r["text"] and not r["calls"]:
        raise AiError("The AI answered with nothing. Check the model name.")


# ------------------------------------------------------------------ interview tools
def _fn(name: str, desc: str, params: dict) -> dict:
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": params}}


def tools() -> list[dict]:
    return [
        _fn("update_profile", "Save what you learned into the company profile. Only facts the founder gave (or their website "
            "states). Lists replace the whole list, so include items to keep.", profile_schema()),
        _fn("suggest_replies", "Show 2-5 short clickable replies under your message: likely answers or your ideas when they "
            "are unsure. Each under 60 characters.", {"type": "object", "properties": {"options": {"type": "array", "items": {"type": "string"}}},
                                                      "required": ["options"]}),
        _fn("set_topic", "Move the interview to another topic when the current one is covered well enough, or finish when all "
            "topics are covered.", {"type": "object", "properties": {"topic": {"type": "string", "enum": [*TOPIC_IDS, "finish"]}},
                                    "required": ["topic"]}),
        _fn("read_website", "Read a web page the founder gave you (their site, a product page).",
            {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}),
    ]


def _opt_lines() -> str:
    o = OB.options()
    out = []
    for g, field in (("industries", "industry"), ("stages", "stage"), ("team_sizes", "team_size"), ("goals", "goals"),
                     ("tones", "tones"), ("languages", "languages"), ("tools", "tools"), ("rules", "rules")):
        out.append(f"- {field}: " + ", ".join(f"{k} ({v['label'] if isinstance(v, dict) else v})" for k, v in o[g].items()))
    return "\n".join(out)


def system_prompt(a: dict, topic: str) -> str:
    cur = next((t for t in topics() if t["id"] == topic), topics()[0])
    cov = coverage(a)
    plan = "\n".join(f"{i + 1}. {t['label']} [{t['id']}]{' ✓ covered' if c['done'] else ''}: must find out {', '.join(t['must'])}"
                     + (f"; also useful: {', '.join(t.get('nice', []))}" if t.get("nice") else "")
                     for i, (t, c) in enumerate(zip(topics(), cov, strict=True)))
    return f"""You are Omilo's onboarding interviewer. You are getting to know a founder's business so their team of AI helpers
can work for them from day one. The team itself is chosen from what you learn, so the work they want to hand off matters.

{script()['style']}
Interview plan (go in this order, skip what is already covered):
{plan}

Current topic: {cur['label']} [{cur['id']}]. Start it with something like: "{cur['ask']}"
How to dig here: {cur['dig']}

Tools: save facts with update_profile as soon as you hear them; offer clickable replies with suggest_replies whenever a
choice or ideas would help; call set_topic to move on, and set_topic("finish") when everything is covered well enough.
Allowed option keys for list and choice fields:
{_opt_lines()}

The profile so far (JSON):
{json.dumps(a, ensure_ascii=False)[:9000]}

Reply in the founder's language (they may write Indonesian, English or another language)."""


async def _read_site(url: str) -> str:
    import httpx

    if not re.match(r"^https?://", url or ""):
        url = "https://" + (url or "").strip()
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, headers={"User-Agent": "Omilo onboarding"}) as c:
            r = await c.get(url)
        text = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", r.text)
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        return re.sub(r"\s+", " ", text).strip()[:12000] or "(the page had no readable text)"
    except Exception as e:  # noqa: BLE001
        return f"(could not open {url}: {e})"


async def turn(cfg: dict, a: dict, history: list[dict], topic: str) -> dict:
    """The interviewer's next message. history: [{"role": "owner"|"ai", "text"}], the last one is the owner's."""
    if cfg["provider"] == "fake":
        return scripted_turn(a, history)
    msgs: list[dict] = []
    for h in history[-30:]:
        role = "user" if h["role"] == "owner" else "assistant"
        msgs.append({"role": role, "content": h.get("text") or ""})
    if not msgs or msgs[0]["role"] != "user":
        msgs.insert(0, {"role": "user", "content": "(The founder just opened the interview. Greet them in one line and ask the first question.)"})
    patch: dict = {}
    options: list[str] = []
    new_topic = topic
    text = ""
    for _ in range(MAX_TOOL_TURNS):
        r = await complete(cfg, system_prompt({**a, **patch}, new_topic), msgs, tools())
        text = r["text"] or text
        if not r["calls"]:
            break
        msgs.append(r["message"])
        for c in r["calls"]:
            result = "ok"
            if c["name"] == "update_profile":
                patch.update(clean(c["args"]))
            elif c["name"] == "suggest_replies":
                options = [str(x)[:80] for x in (c["args"].get("options") or []) if str(x).strip()][:5]
            elif c["name"] == "set_topic":
                t = c["args"].get("topic")
                if t in (*TOPIC_IDS, "finish"):
                    new_topic = t
                    result = f"now on {t}"
            elif c["name"] == "read_website":
                result = await _read_site(str(c["args"].get("url") or ""))
            msgs.append({"role": "tool", "tool_call_id": c["id"], "content": result})
        if text and all(c["name"] in ("update_profile", "suggest_replies", "set_topic") for c in r["calls"]):
            break  # it already talked; the tools only saved things
    if not text:
        text = "Got it. Tell me more?"
    return {"reply": text, "patch": patch, "options": options, "topic": new_topic}


# ------------------------------------------------------------------ practice mode: the fixed questions
def _label(v) -> str:
    return v["label"] if isinstance(v, dict) else str(v)


def _match_options(group: str, text: str, multi: bool) -> list[str] | str | None:
    opts = OB.options()[group]
    t = text.lower()
    hits = [k for k, v in opts.items() if _label(v).lower() in t or k.lower() == t.strip()]
    if not hits:
        hits = [k for k, v in opts.items() if any(w in t for w in re.findall(r"[a-z]{4,}", _label(v).lower()))]
    if multi:
        return hits
    return hits[0] if hits else None


def _offers(text: str) -> list[dict]:
    """'Sambal 250g - Rp 45.000' per line (or ';') → [{name, price}]."""
    items = []
    for line in re.split(r"[\n;]+", text):
        line = line.strip(" -•\t")
        if not line:
            continue
        parts = re.split(r"\s+[-–:]\s+|\s+@\s+", line, maxsplit=1)
        items.append({"name": parts[0].strip(), "price": parts[1].strip() if len(parts) > 1 else "", "note": ""})
    return items


def _answered(a: dict, field: str) -> bool:
    if field == "focus_note":
        return bool(a.get("goal_notes"))
    if field in ("industry", "stage", "team_size", "languages", "tones", "tools", "rules_other"):
        return False  # always asked: defaults or partial picks shouldn't skip them
    return _filled(a, field)


def scripted_turn(a: dict, history: list[dict]) -> dict:
    """Practice mode: the next fixed question; the owner's last answer fills the field it was asked for."""
    qs = script()["scripted"]
    asked = [h["field"] for h in history if h["role"] == "ai" and h.get("field")]
    patch: dict = {}
    last = history[-1]["text"].strip() if history and history[-1]["role"] == "owner" else None
    if asked and last:
        q = next(x for x in qs if x["field"] == asked[-1])
        f = q["field"]
        if q.get("options"):
            m = _match_options(q["options"], last, bool(q.get("multi")))
            if m:
                patch[f] = m
        elif f == "offers":
            patch["offers"] = _offers(last)
        elif f == "focus_note":
            g = (a.get("goals") or ["save_time"])[0]
            patch["goal_notes"] = {**(a.get("goal_notes") or {}), g: last}
        else:
            patch[f] = last
    merged = {**a, **patch}
    nxt = next((q for q in qs if q["field"] not in asked and not _answered(merged, q["field"])), None)
    if nxt is None:
        return {"reply": "Thank you, that's everything I need. Let's put your team together.", "patch": patch, "options": [], "topic": "finish"}
    options = [_label(v) for v in OB.options()[nxt["options"]].values()] if nxt.get("options") else []
    return {"reply": nxt["ask"], "patch": patch, "options": options[:15], "topic": nxt["topic"], "field": nxt["field"],
            "multi": bool(nxt.get("multi"))}


# ------------------------------------------------------------------ the team that fits
def role_cards() -> list[dict]:
    return [{"id": k, "name": r["name"], "tagline": r.get("tagline", ""), "summary": r.get("summary", ""), "does": r.get("does", [])}
            for k, r in catalog.catalog()["roles"].items() if not r.get("is_chief")]


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "helper"


def fallback_team(a: dict) -> list[dict]:
    rec = OB.recommend(a)
    cards = {c["id"]: c for c in role_cards()}
    why_goal = {g: OB.options()["goals"][g]["label"] for g in a.get("goals") or [] if g in OB.options()["goals"]}
    out = []
    for rid in rec["roles"]:
        if rid == "chief-of-staff" or rid not in cards:
            continue
        reasons = [lbl for g, lbl in why_goal.items() if rid in (OB.options()["goals"][g].get("roles") or [])
                   or {"grower": "marketing", "builder": "dev"}.get(rid) in (OB.options()["goals"][g].get("roles") or [])]
        why = f"For your goal{'s' if len(reasons) > 1 else ''}: {', '.join(reasons)}." if reasons else cards[rid]["tagline"]
        out.append({"id": rid, "base": rid, "name": cards[rid]["name"], "focus": cards[rid]["summary"], "why": why})
    return out


async def plan_team(cfg: dict, a: dict) -> dict:
    """Which helpers join, from what the interview found (goals, workload, what to hand off). Each one has a base role
    (its skills and permissions) and may get its own name and focus, e.g. a "TikTok Creator" based on Marketing."""
    if cfg["provider"] == "fake":
        return {"helpers": fallback_team(a), "by": "rules"}
    cards = role_cards()
    tool = _fn("propose_team", "The helpers to hire (besides the Chief of Staff, who always joins).", {
        "type": "object", "required": ["helpers"], "properties": {"helpers": {"type": "array", "maxItems": 6, "items": {
            "type": "object", "required": ["base", "name", "focus", "why"], "properties": {
                "base": {"type": "string", "enum": [c["id"] for c in cards]},
                "name": {"type": "string", "description": "short job title the founder will recognise, e.g. 'Marketing' or 'TikTok Creator'"},
                "focus": {"type": "string", "description": "1-2 sentences: what this helper takes off the founder's plate, specific to this business"},
                "why": {"type": "string", "description": "one sentence linking it to what the founder said (a goal, the work they want to hand off)"}}}}}})
    system = (
        "You design the AI team for a small business in Omilo. A Chief of Staff always joins and routes work. Pick the fewest "
        "helpers that cover the founder's goals and the work they want to hand off (usually 2-4; a solo founder with a small "
        "budget may need just 1-2 all-in-one helpers like Grower or Builder). Use specific names when it helps (e.g. 'Content "
        "& TikTok' based on marketing). Never add software roles (dev, ops, builder) unless they build their own app or website "
        "code.\nRoles you can base helpers on:\n" + "\n".join(f"- {c['id']}: {c['name']}: {c['summary']}" for c in cards)
        + "\n\nCompany profile:\n" + json.dumps(a, ensure_ascii=False)[:9000])
    try:
        r = await complete(cfg, system, [{"role": "user", "content": "Propose the team with propose_team."}],
                           [tool, ])
    except AiError:
        return {"helpers": fallback_team(a), "by": "rules"}
    call = next((c for c in r["calls"] if c["name"] == "propose_team"), None)
    helpers = []
    seen: set[str] = set()
    for h in (call or {}).get("args", {}).get("helpers") or []:
        base = h.get("base")
        if base not in {c["id"] for c in cards} or (base in ("dev", "ops", "builder") and not OB.has_software(a)):
            continue
        name = str(h.get("name") or "").strip()[:40] or catalog.role(base)["name"]
        hid = base if name.lower() == catalog.role(base)["name"].lower() else _slug(name)
        if hid in seen or hid == "chief-of-staff":
            continue
        seen.add(hid)
        helpers.append({"id": hid, "base": base, "name": name, "focus": str(h.get("focus") or "")[:400], "why": str(h.get("why") or "")[:300]})
    return {"helpers": helpers or fallback_team(a), "by": "ai" if helpers else "rules"}


# ------------------------------------------------------------------ each helper's first job proposal
def fallback_job(a: dict, helper: dict) -> dict:
    r = catalog.role(helper.get("base") or helper["id"]) or {}
    goals = []
    for g in a.get("goals") or []:
        spec = OB.options()["goals"].get(g) or {}
        base = helper.get("base") or helper["id"]
        if base in (spec.get("roles") or []) or helper.get("is_chief") or {"grower": "marketing", "builder": "dev"}.get(base) in (spec.get("roles") or []):
            note = (a.get("goal_notes") or {}).get(g)
            goals.append(spec.get("label", g) + (f": {note}" if note else ""))
    return {"responsibilities": list(r.get("does") or [])[:6] or [helper.get("focus") or r.get("summary", "")],
            "goals": goals[:3], "ideas": [], "questions": ["Is there anything I should never do, or always check with you first?"]}


async def draft_jobs(cfg: dict, a: dict, helpers: list[dict]) -> dict[str, dict]:
    """For every helper: what it thinks its job is, measurable goals, first ideas and a question for the founder."""
    out = {h["id"]: fallback_job(a, h) for h in helpers}
    if cfg["provider"] == "fake":
        return out
    tool = _fn("save_jobs", "Each helper's proposed job.", {"type": "object", "required": ["jobs"], "properties": {"jobs": {
        "type": "array", "items": {"type": "object", "required": ["id", "responsibilities", "goals", "ideas"], "properties": {
            "id": {"type": "string", "enum": [h["id"] for h in helpers]},
            "responsibilities": {"type": "array", "items": {"type": "string"}, "description": "3-6 concrete things it will own, for THIS business"},
            "goals": {"type": "array", "items": {"type": "string"}, "description": "1-3 measurable goals (number + by when), from the founder's goals"},
            "ideas": {"type": "array", "items": {"type": "string"}, "description": "2-3 first moves it suggests"},
            "questions": {"type": "array", "items": {"type": "string"}, "description": "1-2 questions it still has for the founder"}}}}}})
    system = ("Draft the first job proposal for each new AI helper of this business. Be specific to the business: its customers, "
              "offers, goals and the work the founder wants to hand off. Never invent facts or numbers the founder didn't give; when a "
              "goal needs a number they didn't give, propose one as a suggestion and ask in questions.\nHelpers:\n"
              + "\n".join(f"- {h['id']}: {h['name']} (based on {h.get('base', h['id'])}): {h.get('focus', '')}" for h in helpers)
              + "\n\nCompany profile:\n" + json.dumps(a, ensure_ascii=False)[:9000])
    try:
        r = await complete(cfg, system, [{"role": "user", "content": "Save every helper's job with save_jobs."}], [tool])
    except AiError:
        return out
    for c in r["calls"]:
        if c["name"] != "save_jobs":
            continue
        for j in c["args"].get("jobs") or []:
            if j.get("id") in out:
                out[j["id"]] = {k: [str(x)[:300] for x in (j.get(k) or [])][:6] for k in ("responsibilities", "goals", "ideas", "questions")}
    return out


def job_text(p: dict) -> str:
    """The agreed job, as a section added to the helper's job description."""
    part = ["## Agreed with the founder"]
    if p.get("responsibilities"):
        part += ["", "What I own:", *[f"- {x}" for x in p["responsibilities"]]]
    if p.get("goals"):
        part += ["", "Goals:", *[f"- {x}" for x in p["goals"]]]
    if p.get("ideas"):
        part += ["", "First moves:", *[f"- {x}" for x in p["ideas"]]]
    return "\n".join(part)
