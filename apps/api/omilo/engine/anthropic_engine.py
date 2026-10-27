"""
omilo.engine.anthropic_engine — Direct Anthropic/Claude engine (structural, offline-gated).

Provides ``AnthropicEngine`` implementing the Engine protocol.

Offline gate:
    ``AnthropicEngine.__init__`` checks for an Anthropic API key in Settings.
    If none is present, ``EngineNotConfigured`` is raised immediately — no
    external call is ever attempted without credentials.

    Recognised env-var keys (any one suffices):
        ANTHROPIC_API_KEY
        CLAUDE_API_KEY

Tests:
    Tests run without those vars → ``get_engine({"type":"anthropic"})`` raises
    ``EngineNotConfigured``.  No network access occurs in tests.
"""
from __future__ import annotations

import os

from omilo.engine.context import TaskContext, EngineResult


_KEY_ENV_VARS = (
    "ANTHROPIC_API_KEY",
    "CLAUDE_API_KEY",
)


class AnthropicEngine:
    """Direct Anthropic/Claude engine.

    Structural stub: satisfies the Engine protocol and checks credentials at
    construction time.  The actual API call body will be filled in as the
    Anthropic SDK integration is wired (P4+).
    """

    def __init__(self) -> None:
        from omilo.engine import EngineNotConfigured

        api_key = next(
            (os.environ.get(v) for v in _KEY_ENV_VARS if os.environ.get(v)),
            None,
        )
        if not api_key:
            raise EngineNotConfigured(
                "AnthropicEngine requires one of the following env vars: "
                + ", ".join(_KEY_ENV_VARS)
            )
        self._api_key = api_key

    def run(self, ctx: TaskContext) -> EngineResult:
        """Execute a turn via Anthropic SDK.

        Structural: defers to EngineNotConfigured until the full Anthropic SDK
        integration is wired.  Credentials were already verified in __init__.
        """
        from omilo.engine import EngineNotConfigured
        raise EngineNotConfigured(
            "AnthropicEngine.run is a structural stub — full Anthropic wiring is P4+"
        )
