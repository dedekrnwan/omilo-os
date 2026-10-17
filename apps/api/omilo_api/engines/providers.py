"""Vendor-agnostic provider registry.

PROVIDERS maps provider id → Provider dataclass with capability flags and
fast/balanced/deep tier → model-id tables that LiteLLM will consume.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    prefix: str            # LiteLLM vendor prefix (used to build "prefix/model-id")
    icon: str              # UI asset key (e.g. "anthropic", "openai")
    default_model: str     # Fallback when neither explicit model nor tier is given
    tiers: dict[str, str]  # {"fast"|"balanced"|"deep" -> model id}
    supports_cache: bool   # Provider supports prompt caching via LiteLLM
    supports_web: bool     # Provider supports web-search tool calls


PROVIDERS: dict[str, Provider] = {
    "anthropic": Provider(
        id="anthropic",
        label="Anthropic",
        prefix="anthropic",
        icon="anthropic",
        default_model="claude-sonnet-4-5",
        tiers={
            "fast": "claude-haiku-3-5",
            "balanced": "claude-sonnet-4-5",
            "deep": "claude-opus-4-5",
        },
        supports_cache=True,
        supports_web=True,
    ),
    "openai": Provider(
        id="openai",
        label="OpenAI",
        prefix="openai",
        icon="openai",
        default_model="gpt-4o",
        tiers={
            "fast": "gpt-4o-mini",
            "balanced": "gpt-4o",
            "deep": "o3",
        },
        supports_cache=False,
        supports_web=True,
    ),
    "gemini": Provider(
        id="gemini",
        label="Google Gemini",
        prefix="gemini",
        icon="gemini",
        default_model="gemini/gemini-2.0-flash",
        tiers={
            "fast": "gemini/gemini-2.0-flash-lite",
            "balanced": "gemini/gemini-2.0-flash",
            "deep": "gemini/gemini-2.5-pro",
        },
        supports_cache=True,
        supports_web=True,
    ),
    "xai": Provider(
        id="xai",
        label="xAI Grok",
        prefix="xai",
        icon="xai",
        default_model="xai/grok-2",
        tiers={
            "fast": "xai/grok-3-mini",
            "balanced": "xai/grok-2",
            "deep": "xai/grok-3",
        },
        supports_cache=False,
        supports_web=True,
    ),
    "deepseek": Provider(
        id="deepseek",
        label="DeepSeek",
        prefix="deepseek",
        icon="deepseek",
        default_model="deepseek/deepseek-chat",
        tiers={
            "fast": "deepseek/deepseek-chat",
            "balanced": "deepseek/deepseek-chat",
            "deep": "deepseek/deepseek-reasoner",
        },
        supports_cache=False,
        supports_web=False,
    ),
    "mistral": Provider(
        id="mistral",
        label="Mistral AI",
        prefix="mistral",
        icon="mistral",
        default_model="mistral/mistral-small-latest",
        tiers={
            "fast": "mistral/mistral-small-latest",
            "balanced": "mistral/mistral-large-latest",
            "deep": "mistral/magistral-medium-latest",
        },
        supports_cache=False,
        supports_web=False,
    ),
    "bedrock": Provider(
        id="bedrock",
        label="AWS Bedrock",
        prefix="bedrock",
        icon="bedrock",
        default_model="bedrock/amazon.nova-pro-v1:0",
        tiers={
            "fast": "bedrock/amazon.nova-lite-v1:0",
            "balanced": "bedrock/amazon.nova-pro-v1:0",
            "deep": "bedrock/us.anthropic.claude-opus-4-5-20251101-v1:0",
        },
        supports_cache=False,
        supports_web=False,
    ),
    "groq": Provider(
        id="groq",
        label="Groq",
        prefix="groq",
        icon="groq",
        default_model="groq/llama-3.3-70b-versatile",
        tiers={
            "fast": "groq/llama-3.1-8b-instant",
            "balanced": "groq/llama-3.3-70b-versatile",
            "deep": "groq/llama3-groq-70b-8192-tool-use-preview",
        },
        supports_cache=False,
        supports_web=False,
    ),
}


def get_provider(pid: str) -> Provider | None:
    """Return the Provider for *pid*, or None if unknown."""
    return PROVIDERS.get(pid)


def provider_ids() -> list[str]:
    """Return the 8 provider ids in stable insertion order."""
    return list(PROVIDERS.keys())


def litellm_model(prov: Provider, model: str | None, tier: str | None) -> str:
    """Build the LiteLLM model string for *prov*.

    Precedence:
    1. *model* (explicit override) — returned as-is under the provider prefix
    2. *tier*  ("fast"|"balanced"|"deep") — looks up prov.tiers
    3. prov.default_model — final fallback
    """
    resolved = model or prov.tiers.get(tier or "") or prov.default_model
    return f"{prov.prefix}/{resolved}"
