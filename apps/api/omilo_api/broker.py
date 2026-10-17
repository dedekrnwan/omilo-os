"""BrokerClient protocol + DevBroker (in-process dev/test implementation).

The real HttpBroker (delegating OAuth to an external broker service) is deferred;
it swaps in by replacing the module-level `default_broker` instance.

Protocol
--------
BrokerClient.start_connect(manifest) -> {"auth_url": str, "state": str}
BrokerClient.poll(state)             -> {"token": {...}} | None
BrokerClient.revoke(token)           -> None   (best-effort, may be no-op)

DevBroker
---------
- No network.  All state lives in-memory (process-local dict).
- start_connect: generates a random `state` via secrets.token_urlsafe, stashes
  state → slug mapping, returns a stub auth_url + the state.
- poll: returns a fixture token immediately so tests can complete the flow
  without a real browser redirect.
- revoke: no-op (the token is fictional).
"""
from __future__ import annotations

import secrets
from typing import Protocol, runtime_checkable


@runtime_checkable
class BrokerClient(Protocol):
    """Minimal OAuth broker seam.  DevBroker and HttpBroker both implement this."""

    def start_connect(self, manifest: dict) -> dict:
        """Begin an OAuth flow for the given piece manifest.

        Returns:
            {"auth_url": str, "state": str}
            auth_url — where the user should be redirected to grant access.
            state    — an opaque token that correlates the pending flow.
        """
        ...

    def poll(self, state: str) -> dict | None:
        """Check whether the OAuth flow identified by `state` has completed.

        Returns:
            {"token": {...}}  when the token is available (flow complete).
            None              when the flow is still in progress.
        """
        ...

    def revoke(self, token: dict) -> None:
        """Best-effort token revocation.  Implementations may be a no-op."""
        ...


class DevBroker:
    """In-process broker for local development and automated tests.

    start_connect returns immediately with a stub auth_url; poll also returns
    a fixture token immediately (no browser, no network).  This lets the full
    connect → poll → upsert Connector flow be exercised in tests without any
    external dependency.

    Internal state
    --------------
    _pending : dict[state, slug]
        Correlates each generated state to the piece slug it belongs to.
        Entries are consumed by poll() (removed on first successful poll) to
        prevent stale-state accumulation in long-running processes.
    """

    def __init__(self) -> None:
        self._pending: dict[str, str] = {}

    def start_connect(self, manifest: dict) -> dict:
        """Generate a random state, stash it, and return a stub auth_url."""
        slug = manifest.get("id", "unknown")
        state = secrets.token_urlsafe(24)
        self._pending[state] = slug
        # The stub auth_url is a local page that the real browser flow would
        # redirect to.  For DevBroker it is never actually visited.
        auth_url = f"/connectors/pieces/connect/{state}/auth"
        return {"auth_url": auth_url, "state": state}

    def poll(self, state: str) -> dict | None:
        """Return a fixture token immediately if state is known, else None."""
        if state not in self._pending:
            return None
        # Do NOT consume the entry here — the route needs the slug after poll.
        # The route deletes it from _pending after a successful upsert.
        return {"access_token": f"dev-token-{state}", "token_type": "bearer"}

    def revoke(self, token: dict) -> None:
        """No-op for DevBroker — the token is fictional."""
        return

    def slug_for_state(self, state: str) -> str | None:
        """Return the slug associated with a state, or None if state is unknown."""
        return self._pending.get(state)

    def consume_state(self, state: str) -> None:
        """Remove a state from the pending map after a successful connect."""
        self._pending.pop(state, None)


# Module-level default instance.  The real HttpBroker swaps this out.
default_broker: DevBroker = DevBroker()
