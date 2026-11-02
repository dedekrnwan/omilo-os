"""Unit tests for interview.suggest_profile — the company-profile extraction
that prefills the onboarding "Your company" step from the interview notes.

Pure-logic (no DB): the LLM call is monkeypatched, so these exercise the
grounding guards (fake/empty → nothing) and the enum validation / cleanup the
function applies to whatever the model returns.
"""
from __future__ import annotations

from omilo.ai import AiConfig
import omilo.interview as I

NOTES = {"company": "We build a fintech lending app for Indonesian SMEs."}


def _real_cfg() -> AiConfig:
    return AiConfig(provider="anthropic", label="test", key="k")


async def test_fake_ai_suggests_nothing():
    """A fake/practice AI never guesses a profile — the form keeps its defaults."""
    assert await I.suggest_profile(AiConfig(provider="fake", label="fake"), "Acme", NOTES) == {}


async def test_empty_notes_suggest_nothing():
    """No interview content → nothing to infer from, even with a real AI."""
    assert await I.suggest_profile(_real_cfg(), "Acme", {"company": "   ", "goals": ""}) == {}


async def test_valid_fields_kept_and_bad_enum_dropped(monkeypatch):
    """Grounded fields survive; an out-of-enum value is dropped, not coerced."""
    async def fake_converse(cfg, system, messages, **kw):
        await kw["on_call"]("suggest_profile", {
            "industry": "Fintech",
            "team_size": "11-50",
            "region": "Mars",        # not in the region enum → dropped
            "currency": "IDR",
            "pic_role": "Founder",
        })
        return
        yield  # noqa: make this an async generator like the real converse

    monkeypatch.setattr(I, "converse", fake_converse)
    out = await I.suggest_profile(_real_cfg(), "Acme", NOTES)
    assert out == {"industry": "Fintech", "team_size": "11-50", "currency": "IDR", "pic_role": "Founder"}


async def test_blank_and_unknown_values_ignored(monkeypatch):
    """Blank strings and keys outside the profile schema never make it through."""
    async def fake_converse(cfg, system, messages, **kw):
        await kw["on_call"]("suggest_profile", {
            "industry": "   ",          # blank → dropped
            "pic_role": "Ops Lead",
            "favourite_colour": "teal",  # unknown key → ignored
        })
        return
        yield

    monkeypatch.setattr(I, "converse", fake_converse)
    out = await I.suggest_profile(_real_cfg(), "Acme", NOTES)
    assert out == {"pic_role": "Ops Lead"}


async def test_llm_error_degrades_to_empty(monkeypatch):
    """An AI error during extraction is swallowed — suggestion is best-effort."""
    from omilo.ai import AiError

    async def boom(cfg, system, messages, **kw):
        raise AiError("model unavailable")
        yield

    monkeypatch.setattr(I, "converse", boom)
    assert await I.suggest_profile(_real_cfg(), "Acme", NOTES) == {}
