"""
omilo.engine.litellm_engine — LiteLLM cloud engine (structural, offline-gated).

This module provides ``LiteLLMEngine`` which implements the same ``Engine``
protocol as ``FakeEngine`` (same ``run`` method + ``EngineResult`` shape).

Offline gate:
    ``LiteLLMEngine.__init__`` checks for a recognised API key in Settings.
    If none is present, ``EngineNotConfigured`` is raised immediately — so
    no external call is ever attempted without credentials.

    Recognised env-var keys (any one suffices):
        LITELLM_API_KEY
        LITELLM_KEY
        OPENAI_API_KEY   (litellm proxies OpenAI-compatible providers)

Tests:
    Tests run without those vars → ``get_engine({"type":"litellm"})`` raises
    ``EngineNotConfigured``.  No network access occurs in tests.
"""
from __future__ import annotations

import os

from omilo.engine.context import TaskContext, EngineResult


_KEY_ENV_VARS = (
    "LITELLM_API_KEY",
    "LITELLM_KEY",
    "OPENAI_API_KEY",
)


class LiteLLMEngine:
    """Vendor-agnostic cloud engine via litellm.

    Structural stub: the class satisfies the Engine protocol and checks for
    credentials at construction time.  The actual API call body will be filled
    in as the litellm integration is wired (P4+).  Until credentials are
    present, constructing this class raises ``EngineNotConfigured``.
    """

    def __init__(self) -> None:
        from omilo.engine import EngineNotConfigured

        api_key = next(
            (os.environ.get(v) for v in _KEY_ENV_VARS if os.environ.get(v)),
            None,
        )
        if not api_key:
            raise EngineNotConfigured(
                "LiteLLMEngine requires one of the following env vars: "
                + ", ".join(_KEY_ENV_VARS)
            )
        self._api_key = api_key

    def run(self, ctx: TaskContext) -> EngineResult:
        """Execute a turn via litellm.

        Structural: defers to EngineNotConfigured until the full litellm
        integration is wired.  Credentials were already verified in __init__.
        """
        from omilo.engine import EngineNotConfigured
        raise EngineNotConfigured(
            "LiteLLMEngine.run is a structural stub — full litellm wiring is P4+"
        )
