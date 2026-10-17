"""Tests for the 8-vendor provider registry (providers.py)."""
from omilo_api.engines import providers as P


def test_all_eight_vendors_present():
    assert set(P.provider_ids()) == {"anthropic", "openai", "gemini", "xai", "deepseek", "mistral", "bedrock", "groq"}


def test_each_provider_has_three_tiers_and_default():
    for pid in P.provider_ids():
        pr = P.get_provider(pid)
        assert set(pr.tiers) == {"fast", "balanced", "deep"} and pr.default_model


def test_litellm_model_prefixes_and_precedence():
    pr = P.get_provider("openai")
    assert P.litellm_model(pr, "gpt-x", None) == "openai/gpt-x"                      # explicit model wins
    assert P.litellm_model(pr, None, "fast") == f"openai/{pr.tiers['fast']}"           # tier
    assert P.litellm_model(pr, None, None) == f"openai/{pr.default_model}"             # default


def test_unknown_provider_is_none():
    assert P.get_provider("nope") is None


def test_cache_capability_flags_match_spec():
    assert P.get_provider("anthropic").supports_cache is True
    assert P.get_provider("gemini").supports_cache is True
    assert P.get_provider("groq").supports_cache is False
