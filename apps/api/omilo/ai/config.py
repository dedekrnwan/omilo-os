"""Which AI answers for a company (and for one helper).

The owner connects AI in onboarding ("Your AI") or Control panel → AI accounts.
Each connection is a ``HarnessAccount`` row:

- an API key: ``harness`` = anthropic | openai | gemini | gemini-cli (Google key)
  | openrouter | xai | deepseek | groq | mistral, ``token_enc`` = the key
- a local sign-in found on this computer: ``harness`` = claude-code | codex |
  gemini-cli | opencode, empty ``token_enc`` (``tag='session'``)

Resolution order:
1. the helper's own engine config (``helper.engine.account_id`` / explicit type)
2. the company default (``settings.aiEngine.defaultAccountId``, set when the
   owner picks an account in onboarding)
3. the first usable account (API keys before local sessions)
4. ``ANTHROPIC_API_KEY`` / ``OPENAI_API_KEY`` in the server environment
5. practice mode (``provider='fake'``): deterministic, no network
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

# OpenAI-compatible chat endpoints per vendor (all speak /chat/completions).
OPENAI_COMPAT: dict[str, dict[str, Any]] = {
    "openai": {"base": "https://api.openai.com/v1", "label": "OpenAI",
               "models": {"fast": "gpt-5-5-mini", "balanced": "gpt-5-5", "deep": "gpt-5-5"}},
    "gemini": {"base": "https://generativelanguage.googleapis.com/v1beta/openai", "label": "Gemini",
               "models": {"fast": "gemini-2.5-flash", "balanced": "gemini-2.5-pro", "deep": "gemini-2.5-pro"}},
    "openrouter": {"base": "https://openrouter.ai/api/v1", "label": "OpenRouter",
                   "models": {"fast": "anthropic/claude-haiku-5-5", "balanced": "anthropic/claude-sonnet-5-5",
                              "deep": "anthropic/claude-opus-5-5"}},
    "xai": {"base": "https://api.x.ai/v1", "label": "Grok",
            "models": {"fast": "grok-3-mini", "balanced": "grok-3", "deep": "grok-3"}},
    "deepseek": {"base": "https://api.deepseek.com/v1", "label": "DeepSeek",
                 "models": {"fast": "deepseek-chat", "balanced": "deepseek-chat", "deep": "deepseek-reasoner"}},
    "groq": {"base": "https://api.groq.com/openai/v1", "label": "Groq",
             "models": {"fast": "llama-3.1-8b-instant", "balanced": "llama-3.3-70b-versatile",
                        "deep": "llama-3.3-70b-versatile"}},
    "mistral": {"base": "https://api.mistral.ai/v1", "label": "Mistral",
                "models": {"fast": "mistral-small-latest", "balanced": "mistral-large-latest",
                           "deep": "mistral-large-latest"}},
}

ANTHROPIC_MODELS = {"fast": "claude-haiku-5-5", "balanced": "claude-sonnet-5-5", "deep": "claude-opus-5-5"}

# Local CLIs Omilo can drive on the owner's computer.
LOCAL_CLIS = {
    "claude-code": "Claude Code (your sign-in)",
    "codex": "Codex (your sign-in)",
    "gemini-cli": "Gemini CLI (your sign-in)",
    "opencode": "OpenCode (your sign-in)",
}

# Chat UI model ids (src/ui/ChatSession/ModelMenu.tsx) → API model ids.
UI_MODELS = {
    "opus-5-5": ("anthropic", "claude-opus-5-5"),
    "sonnet-5-5": ("anthropic", "claude-sonnet-5-5"),
    "haiku-5-5": ("anthropic", "claude-haiku-5-5"),
    "gpt-5-5": ("openai", "gpt-5-5"),
    "gpt-5-5-mini": ("openai", "gpt-5-5-mini"),
}

_KEY_VENDOR = {"gemini-cli": "gemini", "google": "gemini"}


@dataclass
class AiConfig:
    provider: str              # anthropic | openai_compat | cli | fake
    label: str
    vendor: str = ""           # anthropic | openai | gemini | … | claude-code | codex | …
    key: str = ""
    base_url: str = ""
    model: str | None = None
    tier: str = "balanced"     # fast | balanced | deep
    account_id: str | None = None
    extra: dict = field(default_factory=dict)

    @property
    def is_fake(self) -> bool:
        return self.provider == "fake"

    def with_model(self, ui_model: str | None) -> "AiConfig":
        """Apply a model picked in the chat UI when it belongs to this vendor."""
        if not ui_model:
            return self
        vendor, api_id = UI_MODELS.get(ui_model, (None, None))
        if vendor and vendor == self.vendor:
            return AiConfig(**{**self.__dict__, "model": api_id})
        if ui_model.startswith(("claude-", "gpt-", "gemini-")) and self.vendor in ui_model.split("-")[0]:
            return AiConfig(**{**self.__dict__, "model": ui_model})
        return self

    def resolved_model(self) -> str | None:
        if self.model:
            return self.model
        if self.provider == "anthropic":
            return ANTHROPIC_MODELS.get(self.tier, ANTHROPIC_MODELS["balanced"])
        if self.provider == "openai_compat":
            return OPENAI_COMPAT[self.vendor]["models"].get(self.tier) or OPENAI_COMPAT[self.vendor]["models"]["balanced"]
        return None  # CLIs use their own default unless told


FAKE = AiConfig(provider="fake", label="Practice mode")


def from_account(acc: Any) -> AiConfig | None:
    """Build a config from a HarnessAccount row (None when it can't run)."""
    from omilo.ai.secrets import decrypt

    if acc is None or not getattr(acc, "enabled", True) or (acc.status or "") == "disabled":
        return None
    harness = (acc.harness or "").strip().lower().replace("_", "-")  # claude_code == claude-code
    key = decrypt(acc.token_enc)
    if not key:
        if harness in LOCAL_CLIS:
            return AiConfig(provider="cli", vendor=harness, label=LOCAL_CLIS[harness], account_id=acc.id)
        return None
    vendor = _KEY_VENDOR.get(harness, harness)
    if vendor in ("anthropic", "claude", "claude-code"):
        return AiConfig(provider="anthropic", vendor="anthropic", key=key, label="Claude",
                        base_url=os.environ.get("OMILO_ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
                        account_id=acc.id)
    if vendor in OPENAI_COMPAT:
        spec = OPENAI_COMPAT[vendor]
        base = os.environ.get(f"OMILO_{vendor.upper()}_BASE_URL") or spec["base"]
        return AiConfig(provider="openai_compat", vendor=vendor, key=key, base_url=base,
                        label=spec["label"], account_id=acc.id)
    return None


def _env_config() -> AiConfig | None:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return AiConfig(provider="anthropic", vendor="anthropic", key=os.environ["ANTHROPIC_API_KEY"], label="Claude",
                        base_url=os.environ.get("OMILO_ANTHROPIC_BASE_URL", "https://api.anthropic.com"))
    if os.environ.get("OPENAI_API_KEY"):
        return AiConfig(provider="openai_compat", vendor="openai", key=os.environ["OPENAI_API_KEY"],
                        base_url=OPENAI_COMPAT["openai"]["base"], label="OpenAI")
    return None


def _rank(cfg: AiConfig) -> int:
    order = {"anthropic": 0, "openai_compat": 1, "cli": 2}
    return order.get(cfg.provider, 9)


def resolve(db: Session, company_id: str, helper: Any = None, *, tier: str = "balanced") -> AiConfig:
    """The AI that should answer for this company / helper right now."""
    from omilo.models.accounts import HarnessAccount
    from omilo.models.tenancy import Company

    accounts = db.query(HarnessAccount).filter(HarnessAccount.company_id == company_id).all()
    by_id = {a.id: a for a in accounts}

    def pick(account_id: str | None) -> AiConfig | None:
        return from_account(by_id.get(account_id)) if account_id else None

    eng = (getattr(helper, "engine", None) or {}) if helper is not None else {}
    cfg = pick(eng.get("account_id")) if isinstance(eng, dict) else None

    if cfg is None:
        company = db.get(Company, company_id)
        settings = (company.settings or {}) if company is not None else {}
        cfg = pick(((settings.get("aiEngine") or {}).get("defaultAccountId")))

    if cfg is None:
        usable = [c for c in (from_account(a) for a in accounts) if c is not None]
        usable.sort(key=_rank)
        cfg = usable[0] if usable else None

    cfg = cfg or _env_config() or FAKE
    if isinstance(eng, dict) and eng.get("model") and not cfg.is_fake:
        cfg = AiConfig(**{**cfg.__dict__, "model": eng["model"]})
    if cfg.tier != tier and not cfg.model:
        cfg = AiConfig(**{**cfg.__dict__, "tier": tier})
    return cfg
