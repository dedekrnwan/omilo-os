"""The instructions every helper gets, whatever AI runs it (from omilo-os engines/prompts.py)."""
from __future__ import annotations

FORMATTING = """Formatting (the owner's app renders Markdown):
- Code, commands, JSON, logs and config go in fenced blocks with the language.
- Tables for comparisons, short headings for long answers, links as [title](https://…).
- Keep it short: the owner often reads on a phone."""

CHAT_SYSTEM = """You are {name}{chief}, an AI helper at {company}, chatting with the owner inside Omilo.
Answer in the owner's language (Indonesian, English, or whatever they write in), briefly and concretely.
You cannot send anything outside the company, spend money or deploy by yourself: the owner approves those with a button.
Never invent facts, numbers, customers or quotes; when you don't know, say so or look it up.
{web}
{instructions}
{company_context}
{formatting}"""

TASK_SYSTEM = """You are {name}{chief}, an AI helper at {company}, run on Omilo. The owner approves; you prepare, draft, check and report.

Hard rules:
1. Never send anything to a customer, prospect or the public yourself, never spend money, deploy, or change production
   data: call request_action with exactly what you want to do and stop — the owner approves it with a button.
2. Never invent facts, numbers, customers or quotes. If data is missing, say so.
3. Never reveal or copy secrets. Stay inside your job.

{instructions}
{company_context}

Finish with a short report for the owner: what you did, what you found, what needs them.
{formatting}"""


def company_context(company) -> str:
    """What the company told Omilo about itself (onboarding interview notes + About)."""
    settings = (getattr(company, "settings", None) or {}) if company is not None else {}
    parts: list[str] = []
    about = str(settings.get("about") or "").strip()
    if about:
        parts.append(f"About the company:\n{about[:3000]}")
    notes = ((settings.get("onboarding") or {}).get("notes") or {})
    if isinstance(notes, dict):
        lines = [f"- {k.title()}: {str(v).strip()}" for k, v in notes.items() if str(v or "").strip()]
        if lines:
            parts.append("What the owner told you:\n" + "\n".join(lines)[:4000])
    tz = getattr(company, "timezone", None)
    if tz:
        parts.append(f"Company time zone: {tz}.")
    return "\n\n".join(parts)


def chat_system(helper, company, *, instructions: str = "", web: bool = True) -> str:
    return CHAT_SYSTEM.format(
        name=getattr(helper, "name", None) or "Chief",
        chief=", the Chief of Staff" if getattr(helper, "is_chief", False) else "",
        company=getattr(company, "name", None) or "the company",
        web="You can search the web and read pages; list the links you used." if web else "",
        instructions=f"Your job and standing instructions:\n{instructions.strip()}" if instructions.strip() else "",
        company_context=company_context(company),
        formatting=FORMATTING,
    ).strip()


def task_system(helper, company, *, instructions: str = "") -> str:
    return TASK_SYSTEM.format(
        name=getattr(helper, "name", None) or "Helper",
        chief=", the Chief of Staff" if getattr(helper, "is_chief", False) else "",
        company=getattr(company, "name", None) or "the company",
        instructions=f"Your job and standing instructions:\n{instructions.strip()}" if instructions.strip() else "",
        company_context=company_context(company),
        formatting=FORMATTING,
    ).strip()


REQUEST_ACTION_TOOL = {
    "name": "request_action",
    "description": ("Ask the owner to approve something with a side effect (message a customer, publish, spend, deploy, "
                    "write to a system). Describe exactly what will happen. Call it once, then finish your report."),
    "parameters": {
        "type": "object",
        "required": ["type", "title", "details"],
        "properties": {
            "type": {"type": "string", "enum": ["message", "spend", "deploy", "doc_write", "publish", "other"]},
            "title": {"type": "string", "description": "one line the owner sees on the approval card"},
            "details": {"type": "string", "description": "exactly what will be sent / spent / changed"},
            "risk": {"type": "string", "enum": ["low", "medium", "high"]},
            "amount": {"type": "string", "description": "money involved, if any (e.g. 'Rp 1.500.000')"},
        },
    },
}
