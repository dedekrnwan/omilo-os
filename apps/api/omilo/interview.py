"""The onboarding interview: Chief gets to know the business in a real
conversation, writes what it learns into seven notes (Company, Customers,
Goals, Offer, Rules, Systems, Voice), then proposes the team that fits.

Ported from omilo-os ``interview.py``. It runs on whichever AI the owner
connected in "Your AI" (omilo.ai): the model gets ``save_note``,
``suggest_replies``, ``set_topic`` and ``read_website`` tools and streams its
reply. Without an AI (practice mode) the same screens work from a fixed list of
questions, one per topic.

State lives in ``company.settings["onboarding"]``:
    {"interview": {"history": [{role: owner|ai, text, options?}], "topic"},
     "notes": {topic: text}, "website": str}
"""
from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from typing import Any

import httpx

from omilo.ai import AiConfig, AiError, converse
from omilo.ai.llm import attachment_content

TOPICS: list[dict[str, str]] = [
    {"id": "company", "label": "Company", "ask": "What does {company} do, and who's on the team?",
     "dig": "what they make or sell, how long they've been at it, how many people, where they work"},
    {"id": "customers", "label": "Customers", "ask": "Who are your customers?",
     "dig": "who pays, who uses it, where they find you, what they complain about"},
    {"id": "goals", "label": "Goals", "ask": "What would make the next 3 months a win for {company}?",
     "dig": "1-3 goals with a number and a date when possible; what's in the way"},
    {"id": "offer", "label": "Offer", "ask": "What do you sell, and for how much?",
     "dig": "products or plans, prices (Rupiah is fine), discounts, what's most popular"},
    {"id": "rules", "label": "Rules", "ask": "What should your helpers never do without asking you?",
     "dig": "money, promises, who they may message, tone limits, legal or brand rules"},
    {"id": "systems", "label": "Systems", "ask": "Which tools do you run the business on?",
     "dig": "WhatsApp, Instagram, Google Sheets, accounting, code repo, where files live"},
    {"id": "voice", "label": "Voice", "ask": "How should your helpers sound when they write for you?",
     "dig": "language (Bahasa / English), formal or casual, how they address customers, words to avoid"},
]
TOPIC_IDS = [t["id"] for t in TOPICS]

STYLE = """Style:
- One question at a time, short and warm, in the owner's language (Indonesian, English, or what they write in).
- React to what they said before asking the next thing; never repeat a question they already answered.
- When they share a website or a URL, read it at once with read_website and react to what's there.
- Offer 2-4 clickable suggestions with suggest_replies when a choice or brainstorm helps.
- Save facts the moment you hear them with save_note (the whole note for that topic, rewritten, concise, in the
  owner's words; only what they said or their website states — never invent numbers or customers).
- If they ask you to propose something (e.g. rules) or you fill a gap with your own idea, save it with
  save_note(..., suggested=true) so they are asked to check it on the summary.
- Move on with set_topic when a topic is covered well enough; call set_topic("finish") when every topic has a note."""

TOOLS: list[dict[str, Any]] = [
    {"name": "save_note", "description": "Write the note for one topic (replaces the note; include what to keep).",
     "parameters": {"type": "object", "required": ["topic", "content"], "properties": {
         "topic": {"type": "string", "enum": TOPIC_IDS},
         "content": {"type": "string", "description": "2-6 short lines, facts only"},
         "suggested": {"type": "boolean",
                       "description": "true when the note holds your own proposal, not what the owner said"}}}},
    {"name": "suggest_replies", "description": "Show 2-4 short clickable replies under your message (each < 60 chars).",
     "parameters": {"type": "object", "required": ["options"],
                    "properties": {"options": {"type": "array", "items": {"type": "string"}}}}},
    {"name": "set_topic", "description": "Move to another topic, or 'finish' when everything is covered.",
     "parameters": {"type": "object", "required": ["topic"],
                    "properties": {"topic": {"type": "string", "enum": [*TOPIC_IDS, "finish"]}}}},
    {"name": "read_website", "description": "Read a web page the owner gave you (their site, a product page).",
     "parameters": {"type": "object", "required": ["url"], "properties": {"url": {"type": "string"}}}},
]
SILENT = {"save_note", "suggest_replies", "set_topic"}
URL_RE = re.compile(r"(https?://[^\s<>\"')\]]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|id|co\.id|net|org|io|app|ai|co)\b[^\s]*)",
                    re.I)


def empty_state() -> dict:
    return {"interview": {"history": [], "topic": "company"}, "notes": {}, "website": "", "suggested": []}


def coverage(notes: dict) -> list[dict]:
    return [{"id": t["id"], "label": t["label"], "done": bool(str(notes.get(t["id"]) or "").strip())} for t in TOPICS]


def next_topic(notes: dict, after: str | None = None) -> str:
    ids = TOPIC_IDS
    start = ids.index(after) + 1 if after in ids else 0
    for tid in ids[start:] + ids[:start]:
        if not str(notes.get(tid) or "").strip():
            return tid
    return "finish"


def system_prompt(company_name: str, notes: dict, topic: str) -> str:
    cur = next((t for t in TOPICS if t["id"] == topic), TOPICS[0])
    remaining = [f"  - {t['label']} [{t['id']}]: {t['dig']}" for t in TOPICS if not str(notes.get(t["id"]) or "").strip()]
    captured = "\n".join(f"  - {k}: {v}" for k, v in notes.items() if str(v or "").strip()) or "  (nothing yet)"
    return f"""You are Chief of Staff, an AI helping the owner of {company_name} set up their AI team in Omilo.
To pick the right helpers and write their jobs you need to understand the business — through a real conversation, not a form.

{STYLE}

Private checklist (weave it in naturally, any order):
{chr(10).join(remaining) or "  (all covered — wrap up and call set_topic('finish'))"}

Right now you're on: {cur['label']}. A natural way in: "{cur['ask'].format(company=company_name)}"

Notes so far:
{captured}"""


async def read_site(url: str) -> str:
    url = (url or "").strip()
    if not re.match(r"^https?://", url):
        url = "https://" + url
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True,
                                     headers={"User-Agent": "Mozilla/5.0 (Omilo onboarding)"}) as c:
            r = await c.get(url)
        html = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", r.text)
        title = re.search(r"(?is)<title[^>]*>(.*?)</title>", r.text)
        meta = re.search(r'(?is)<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)', r.text)
        text = re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", html)).strip()
        head = " · ".join(x for x in [(title.group(1).strip() if title else ""), (meta.group(1).strip() if meta else "")] if x)
        return (f"{url}\n{head}\n\n{text}"[:12000]) if text else f"(the page at {url} had no readable text)"
    except Exception as e:  # noqa: BLE001
        return f"(could not open {url}: {e})"


def _scripted(company_name: str, state: dict, message: str) -> dict:
    """Practice mode: the next fixed question; the owner's answer becomes the note it was asked for."""
    iv = state["interview"]
    notes = dict(state.get("notes") or {})
    asked = next((h.get("topic") for h in reversed(iv["history"]) if h.get("role") == "ai" and h.get("topic")), None)
    if message and asked in TOPIC_IDS:
        prev = str(notes.get(asked) or "").strip()
        notes[asked] = f"{prev}\n{message}".strip() if prev else message
    nxt = next_topic(notes, asked) if message else (asked or next_topic(notes))
    if nxt == "finish":
        reply = "Thank you — that's everything I need. Check the notes, then let's put your team together."
        return {"reply": reply, "notes": notes, "topic": "finish", "options": []}
    t = next(x for x in TOPICS if x["id"] == nxt)
    prefix = "Got it. " if message else f"Hi! I'm Chief. Let's get to know {company_name} — about 5 minutes. "
    return {"reply": prefix + t["ask"].format(company=company_name), "notes": notes, "topic": nxt, "options": [],
            "practice": True}


async def stream_turn(cfg: AiConfig, company_name: str, state: dict, message: str,
                      website: str | None = None, file: dict | None = None) -> AsyncIterator[dict]:
    """One interview exchange. Yields:
        {"type": "activity", "label"} · {"type": "text", "delta"} · {"type": "note", "topic", "content"}
        {"type": "final", "reply", "notes", "topic", "options"}
    """
    iv = state["interview"]
    notes = dict(state.get("notes") or {})
    topic = iv.get("topic") or "company"
    if topic == "finish":
        topic = next_topic(notes)
        topic = "company" if topic == "finish" else topic

    if cfg.is_fake:
        r = _scripted(company_name, state, message)
        for tid, content in r["notes"].items():
            if content != notes.get(tid):
                yield {"type": "note", "topic": tid, "content": content}
        yield {"type": "text", "delta": r["reply"]}
        yield {"type": "final", **r}
        return

    history = [{"role": "user" if h["role"] == "owner" else "assistant", "content": h.get("text") or ""}
               for h in iv["history"][-30:]]
    owner_msg = message
    if website:
        yield {"type": "activity", "label": f"Reading {website}…"}
        page = await read_site(website)
        owner_msg = (f"{message}\n\n" if message else "") + f"(I shared my website: {website})\n<website>\n{page[:8000]}\n</website>"
    if owner_msg or file:
        owner_content = attachment_content(cfg, owner_msg, file) if file else owner_msg
        history.append({"role": "user", "content": owner_content})
    else:
        history = history or [{"role": "user", "content": "(The owner just opened the interview. Greet them in one line "
                                                          "and ask the first question.)"}]

    options: list[str] = []
    state_topic = {"topic": topic}
    # Topics whose note is Chief's own proposal — the Check step asks the owner to check them.
    suggested = set(state.get("suggested") or [])

    async def on_call(name: str, args: dict) -> str:
        if name == "save_note":
            tid = str(args.get("topic") or "")
            content = str(args.get("content") or "").strip()
            if tid in TOPIC_IDS and content:
                notes[tid] = content[:2000]
                (suggested.add if args.get("suggested") else suggested.discard)(tid)
                pending_notes.append((tid, notes[tid]))
                return "saved"
            return "unknown topic"
        if name == "suggest_replies":
            options[:] = [str(x)[:80] for x in (args.get("options") or []) if str(x).strip()][:4]
            return "shown"
        if name == "set_topic":
            t = str(args.get("topic") or "")
            if t in (*TOPIC_IDS, "finish"):
                state_topic["topic"] = t
                return f"now on {t}"
            return "unknown topic"
        if name == "read_website":
            return await read_site(str(args.get("url") or ""))
        return "unknown tool"

    pending_notes: list[tuple[str, str]] = []
    reply = ""
    async for ev in converse(cfg, system_prompt(company_name, notes, topic), history, tools=TOOLS, on_call=on_call,
                             final_tools=SILENT, max_turns=5, max_tokens=1500, timeout=180):
        while pending_notes:
            tid, content = pending_notes.pop(0)
            yield {"type": "note", "topic": tid, "content": content}
        if ev["type"] == "text":
            reply += ev["delta"]
            yield ev
        elif ev["type"] == "activity":
            if not ev["label"].startswith(("Noting", "Using set_topic", "Using suggest_replies")):
                yield ev
        elif ev["type"] == "done":
            reply = ev.get("text") or reply
    while pending_notes:
        tid, content = pending_notes.pop(0)
        yield {"type": "note", "topic": tid, "content": content}
    new_topic = state_topic["topic"]
    if new_topic != "finish" and str(notes.get(new_topic) or "").strip() and next_topic(notes) == "finish":
        new_topic = "finish"
    yield {"type": "final", "reply": reply.strip() or "Got it. Tell me more?", "notes": notes, "topic": new_topic,
           "options": options, "suggested": sorted(suggested)}


# ── the team that fits ───────────────────────────────────────────────────────

ROLES: list[dict[str, str]] = [
    {"id": "builder", "name": "Builder", "area": "dev", "role": "engineering",
     "summary": "Builds and checks your app or website code, one task at a time."},
    {"id": "grower", "name": "Grower", "area": "marketing", "role": "growth & marketing",
     "summary": "Content, campaigns and a weekly growth review."},
    {"id": "support", "name": "Support", "area": "support", "role": "customer support",
     "summary": "Answers customers in your voice; anything unusual comes to you."},
    {"id": "seller", "name": "Sales", "area": "sales", "role": "sales",
     "summary": "Follows up leads, drafts offers and keeps the pipeline moving."},
    {"id": "finance", "name": "Finance", "area": "finance", "role": "money",
     "summary": "Matches payments, chases invoices and flags what's late."},
    {"id": "ops", "name": "Ops", "area": "ops", "role": "operations",
     "summary": "Keeps the day-to-day running: orders, schedules, suppliers."},
]

PROPOSE_TEAM = {
    "name": "propose_team",
    "description": "The helpers to hire (the Chief of Staff always joins and is not listed).",
    "parameters": {"type": "object", "required": ["helpers"], "properties": {"helpers": {
        "type": "array", "maxItems": 5, "items": {"type": "object", "required": ["base", "name", "focus", "why"],
                                                  "properties": {
            "base": {"type": "string", "enum": [r["id"] for r in ROLES]},
            "name": {"type": "string", "description": "short title the owner recognises, e.g. 'Grower' or 'TikTok Creator'"},
            "focus": {"type": "string", "description": "one sentence: what it takes off the owner's plate, for this business"},
            "why": {"type": "string", "description": "one short phrase tying it to what the owner said"},
            "on": {"type": "boolean", "description": "true when clearly needed now, false when optional"}}}}}},
}


def fallback_team(notes: dict) -> list[dict]:
    text = " ".join(str(v) for v in notes.values()).lower()
    picks: list[tuple[str, str, bool]] = []
    if re.search(r"\b(app|code|software|website|developer|dev|saas|backend|github)\b", text):
        picks.append(("builder", "You build software", True))
    picks.append(("grower", "To win more customers" if "customer" in text or "pelanggan" in text else "Growth and content", True))
    if re.search(r"(support|chat|whatsapp|complain|keluhan|cs\b|customer service)", text):
        picks.append(("support", "Customers reach you on chat", True))
    if re.search(r"(invoice|payment|bayar|tagihan|finance|accounting|sheet)", text):
        picks.append(("finance", "You track payments", False))
    if re.search(r"(lead|sales|jual|deal|b2b|client)", text):
        picks.append(("seller", "You sell to clients", False))
    out = []
    for rid, why, on in picks:
        r = next(x for x in ROLES if x["id"] == rid)
        out.append({"id": rid, "base": rid, "name": r["name"], "area": r["area"], "role": r["role"],
                    "description": r["summary"], "reason": why, "on": on})
    return out


async def plan_team(cfg: AiConfig, company_name: str, notes: dict) -> dict:
    if cfg.is_fake or not any(str(v or "").strip() for v in notes.values()):
        return {"helpers": fallback_team(notes), "by": "rules"}
    picked: list[dict] = []

    async def on_call(name: str, args: dict) -> str:
        if name == "propose_team":
            picked.extend([h for h in (args.get("helpers") or []) if isinstance(h, dict)])
        return "ok"

    system = ("You design the AI team for a small business in Omilo. A Chief of Staff always joins and routes work. "
              "Pick the fewest helpers that cover the owner's goals and the work they want to hand off (usually 2-4). "
              "Never add Builder unless they build their own app or website code.\nRoles you can base helpers on:\n"
              + "\n".join(f"- {r['id']}: {r['name']} — {r['summary']}" for r in ROLES)
              + f"\n\nWhat {company_name} told you:\n" + json.dumps(notes, ensure_ascii=False)[:6000])
    try:
        async for _ in converse(cfg, system, [{"role": "user", "content": "Propose the team with propose_team."}],
                                tools=[PROPOSE_TEAM], on_call=on_call, final_tools={"propose_team"}, max_turns=2,
                                max_tokens=1200, timeout=120):
            pass
    except AiError:
        return {"helpers": fallback_team(notes), "by": "rules"}
    out, seen = [], set()
    for h in picked:
        r = next((x for x in ROLES if x["id"] == h.get("base")), None)
        if r is None:
            continue
        name = str(h.get("name") or r["name"]).strip()[:40]
        hid = r["id"] if name.lower() == r["name"].lower() else re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]
        if hid in seen:
            continue
        seen.add(hid)
        out.append({"id": hid, "base": r["id"], "name": name, "area": r["area"], "role": r["role"],
                    "description": str(h.get("focus") or r["summary"])[:300],
                    "reason": str(h.get("why") or "")[:160], "on": h.get("on", True) is not False})
    return {"helpers": out or fallback_team(notes), "by": "ai" if out else "rules"}


# ── company-profile extraction (prefills the "Your company" step) ─────────────
# The structured fields the onboarding form asks for are NOT free knowledge —
# they're enums (team size, region, currency) plus two short labels. Rather than
# make the owner re-type what they already told Chief in the interview, infer
# them from the notes and prefill; the owner confirms or edits.

_PROFILE_ENUMS = {
    "team_size": {"1-10", "11-50", "51-200", "200+"},
    "region": {"Indonesia", "Southeast Asia", "Global"},
    "currency": {"IDR", "USD", "SGD", "MYR"},
}

SUGGEST_PROFILE = {
    "name": "suggest_profile",
    "description": "The company profile inferred from what the owner said. Omit any field the owner's "
                   "words don't clearly imply — never guess.",
    "parameters": {"type": "object", "properties": {
        "industry": {"type": "string", "description": "short industry label, e.g. 'Fintech', 'F&B', 'Gov-tech'"},
        "team_size": {"type": "string", "enum": sorted(_PROFILE_ENUMS["team_size"])},
        "region": {"type": "string", "enum": sorted(_PROFILE_ENUMS["region"])},
        "currency": {"type": "string", "enum": sorted(_PROFILE_ENUMS["currency"])},
        "pic_role": {"type": "string", "description": "the owner's own role, e.g. 'Founder', 'Ops Lead', 'CTO'"},
    }},
}

_PROFILE_KEYS = ("industry", "team_size", "region", "currency", "pic_role")


async def suggest_profile(cfg: AiConfig, company_name: str, notes: dict) -> dict:
    """Infer the structured company profile from the interview notes.

    Returns only the fields the model could ground in what the owner said;
    omits the rest. Empty dict when there's nothing to go on (fake AI, no
    notes) — the form then keeps its own defaults. Never raises.
    """
    if cfg.is_fake or not any(str(v or "").strip() for v in notes.values()):
        return {}
    got: dict = {}

    async def on_call(name: str, args: dict) -> str:
        if name == "suggest_profile" and isinstance(args, dict):
            got.update(args)
        return "ok"

    system = ("You extract a small business's structured profile from its onboarding interview. "
              "Only fill a field when the owner's words clearly imply it; omit anything you'd have to "
              f"guess at.\n\nWhat {company_name} told you:\n" + json.dumps(notes, ensure_ascii=False)[:6000])
    try:
        async for _ in converse(cfg, system, [{"role": "user", "content": "Infer the profile with suggest_profile."}],
                                tools=[SUGGEST_PROFILE], on_call=on_call, final_tools={"suggest_profile"},
                                max_turns=2, max_tokens=400, timeout=60):
            pass
    except AiError:
        return {}
    out: dict = {}
    for k in _PROFILE_KEYS:
        v = str(got.get(k) or "").strip()
        if not v or (k in _PROFILE_ENUMS and v not in _PROFILE_ENUMS[k]):
            continue
        out[k] = v[:80]
    return out


def find_url(text: str) -> str | None:
    m = URL_RE.search(text or "")
    return m.group(0).rstrip(".,;") if m else None
