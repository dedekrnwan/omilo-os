"""The Check step's summary data: notes Chief *suggested* and how long the interview took.

Pure logic (no DB): the LLM is monkeypatched. Covers
  - save_note(suggested=true) marks a topic; a later plain save_note clears it
  - the view only lists suggested topics that still have a note
  - took_min from the interview's first/last answered turn
"""
from __future__ import annotations

from omilo.ai import AiConfig
import omilo.interview as I
from omilo.api.onboarding_interview import _took_min, _view


def _cfg() -> AiConfig:
    return AiConfig(provider="anthropic", label="test", key="k")


def _converse_saving(*calls: dict):
    async def fake_converse(cfg, system, messages, **kw):
        for args in calls:
            await kw["on_call"]("save_note", args)
        yield {"type": "text", "delta": "Noted."}

    return fake_converse


async def _final(state: dict) -> dict:
    out = {}
    async for ev in I.stream_turn(_cfg(), "Sahabat Warga", state, "Suggest some rules for us"):
        if ev["type"] == "final":
            out = ev
    return out


async def test_suggested_note_is_flagged_then_cleared(monkeypatch):
    state = I.empty_state()
    monkeypatch.setattr(I, "converse", _converse_saving(
        {"topic": "rules", "content": "Never message residents without the RT's OK.", "suggested": True},
        {"topic": "company", "content": "Community app for RT/RW neighbourhoods."},
    ))
    final = await _final(state)
    assert final["suggested"] == ["rules"]

    # The owner confirms the rules in their own words → Chief saves without the flag.
    state = {**state, "notes": final["notes"], "suggested": final["suggested"]}
    monkeypatch.setattr(I, "converse", _converse_saving(
        {"topic": "rules", "content": "Never message residents without the RT's OK."},
    ))
    assert (await _final(state))["suggested"] == []


def test_view_lists_only_suggested_topics_with_a_note():
    cfg = AiConfig(provider="fake", label="fake")
    state = {**I.empty_state(), "notes": {"rules": "Never promise refunds.", "voice": ""},
             "suggested": ["rules", "voice"]}
    assert _view(state, cfg)["suggested"] == ["rules"]


def test_took_min():
    assert _took_min({"started_at": "2026-10-30T07:00:00+00:00", "last_at": "2026-10-30T07:09:20+00:00"}) == 9
    assert _took_min({"started_at": "2026-10-30T07:00:00+00:00", "last_at": "2026-10-30T07:00:10+00:00"}) == 1
    assert _took_min({"history": []}) is None
