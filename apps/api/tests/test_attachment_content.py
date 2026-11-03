"""Pure unit tests for attachment_content — no network, no DB.

The helper shapes user message content as a provider-native block list (for
Anthropic and OpenAI-compat with images) or degrades to a plain string (for
cli / fake and openai-compat non-image).
"""
from __future__ import annotations

import pytest

from omilo.ai.config import AiConfig
from omilo.ai.llm import attachment_content

# ── test fixtures ─────────────────────────────────────────────────────────────

F = {"name": "a.pdf", "mime": "application/pdf", "data": "QUJD"}
IMG = {"name": "a.png", "mime": "image/png", "data": "QUJD"}


def cfg_anthropic() -> AiConfig:
    return AiConfig(provider="anthropic", label="Claude", key="sk-test")


def cfg_openai() -> AiConfig:
    return AiConfig(provider="openai_compat", vendor="openai", label="OpenAI", key="sk-test",
                    base_url="https://api.openai.com/v1")


def cfg_cli() -> AiConfig:
    return AiConfig(provider="cli", vendor="claude-code", label="Claude Code")


def cfg_fake() -> AiConfig:
    return AiConfig(provider="fake", label="Practice mode")


# ── tests ─────────────────────────────────────────────────────────────────────

def test_attachment_content_none_is_plain_text():
    """No file → the text is returned as-is."""
    assert attachment_content(cfg_anthropic(), "hi", None) == "hi"


def test_attachment_content_anthropic_pdf_document_block():
    """Anthropic + PDF → a block list with a document block."""
    out = attachment_content(cfg_anthropic(), "", F)
    assert isinstance(out, list)
    doc = [b for b in out if b["type"] == "document"][0]
    assert doc["source"] == {"type": "base64", "media_type": "application/pdf", "data": "QUJD"}


def test_attachment_content_anthropic_image_block():
    """Anthropic + image/* → a block list containing an image block."""
    out = attachment_content(cfg_anthropic(), "", IMG)
    assert isinstance(out, list)
    assert any(b["type"] == "image" for b in out)


def test_attachment_content_openai_image_url():
    """OpenAI-compat + image/* → a block list with an image_url block."""
    out = attachment_content(cfg_openai(), "", IMG)
    assert isinstance(out, list)
    assert any(
        b["type"] == "image_url" and b["image_url"]["url"].startswith("data:image/png;base64,")
        for b in out
    )


def test_attachment_content_text_fallback():
    """openai-compat + non-image and cli → a plain string mention."""
    openai_result = attachment_content(cfg_openai(), "", F)
    assert isinstance(openai_result, str)
    assert "a.pdf" in openai_result

    cli_result = attachment_content(cfg_cli(), "", F)
    assert isinstance(cli_result, str)
    assert "a.pdf" in cli_result


def test_attachment_content_fake_text_fallback():
    """fake provider → plain string mention."""
    result = attachment_content(cfg_fake(), "hello", F)
    assert isinstance(result, str)
    assert "a.pdf" in result


def test_attachment_content_anthropic_text_with_note():
    """Anthropic + text + file → the block list includes a text block with the note."""
    out = attachment_content(cfg_anthropic(), "please review", F)
    assert isinstance(out, list)
    texts = [b for b in out if b["type"] == "text"]
    assert texts, "Expected at least one text block"
    combined = " ".join(b["text"] for b in texts)
    assert "please review" in combined


def test_attachment_content_anthropic_unknown_mime_falls_back():
    """Anthropic + unknown mime (not image/* or application/pdf) → plain string."""
    weird = {"name": "a.csv", "mime": "text/csv", "data": "QUJD"}
    result = attachment_content(cfg_anthropic(), "here", weird)
    assert isinstance(result, str)
    assert "a.csv" in result


def test_attachment_content_openai_image_data_url_correct():
    """OpenAI-compat image_url has the correct data:... prefix."""
    out = attachment_content(cfg_openai(), "", IMG)
    url_block = next(b for b in out if b["type"] == "image_url")
    assert url_block["image_url"]["url"] == f"data:image/png;base64,QUJD"
