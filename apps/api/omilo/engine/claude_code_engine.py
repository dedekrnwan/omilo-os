"""
omilo.engine.claude_code_engine — Pool-backed Claude Code engine (structural, offline-gated).

Provides ``ClaudeCodeEngine`` which implements the Engine protocol.

Pool gate:
    ``ClaudeCodeEngine.__init__`` opens a DB session, calls
    ``pool.select_account`` to find an eligible HarnessAccount for
    harness="claude_code" and the given company_id.  If none exists,
    ``EngineNotConfigured`` is raised immediately — no subprocess or network
    call is ever attempted without a ready account.

Tests:
    Tests with no seeded accounts (or a fresh company_id) → raises
    ``EngineNotConfigured``.  No subprocess calls occur in tests.
"""
from __future__ import annotations

from omilo.engine.context import TaskContext, EngineResult


class ClaudeCodeEngine:
    """Headless Claude Code CLI engine backed by the account pool.

    Structural stub: satisfies the Engine protocol, selects an account from
    the pool at construction time, and defers the actual subprocess wiring
    to a later task.  If no eligible account is available, raises
    ``EngineNotConfigured``.
    """

    def __init__(self, *, company_id: str) -> None:
        from omilo.engine import EngineNotConfigured
        from omilo.engine.pool import select_account
        from omilo.db import SessionLocal

        self._company_id = company_id
        self._account_id: str | None = None

        with SessionLocal() as session:
            with session.begin():
                account = select_account(
                    session,
                    company_id=company_id,
                    harness="claude_code",
                )

        if account is None:
            raise EngineNotConfigured(
                f"No eligible claude_code account in the pool for company {company_id!r}. "
                "All accounts are cooling, near-limit, or error."
            )
        self._account_id = account.id

    def run(self, ctx: TaskContext) -> EngineResult:
        """Execute a turn via headless Claude Code CLI.

        Structural: defers to EngineNotConfigured until subprocess wiring is
        complete.  Account was already selected in __init__.
        """
        from omilo.engine import EngineNotConfigured
        raise EngineNotConfigured(
            "ClaudeCodeEngine.run is a structural stub — subprocess wiring is a later task"
        )
