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


def test_litellm_model_no_double_prefix_for_affected_providers():
    """C1 regression: tier/default model ids must be BARE (no vendor prefix) so
    litellm_model produces exactly 'prefix/bare-model-id', never 'prefix/prefix/...'."""
    for pid in ("gemini", "xai", "deepseek", "mistral", "bedrock", "groq"):
        pr = P.get_provider(pid)
        for tier in ("fast", "balanced", "deep"):
            result = P.litellm_model(pr, None, tier)
            double = f"{pr.prefix}/{pr.prefix}/"
            assert double not in result, (
                f"{pid}/{tier}: double prefix detected — got {result!r}"
            )
        # also test the tier lookup gives the exact expected string
    # spot-check gemini fast tier specifically
    gemini = P.get_provider("gemini")
    fast_result = P.litellm_model(gemini, None, "fast")
    assert fast_result == f"gemini/{gemini.tiers['fast']}", (
        f"Expected 'gemini/{{bare-model}}', got {fast_result!r}"
    )
    assert "gemini/gemini/" not in fast_result


def test_deepseek_tiers_are_distinct():
    """I2: deepseek fast and balanced must resolve to different model ids."""
    ds = P.get_provider("deepseek")
    assert ds.tiers["fast"] != ds.tiers["balanced"], (
        f"deepseek fast and balanced must differ; both are {ds.tiers['fast']!r}"
    )


def test_unknown_provider_is_none():
    assert P.get_provider("nope") is None


def test_cache_capability_flags_match_spec():
    assert P.get_provider("anthropic").supports_cache is True
    assert P.get_provider("gemini").supports_cache is True
    assert P.get_provider("groq").supports_cache is False
