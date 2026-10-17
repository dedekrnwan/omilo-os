"""BrokerClient protocol + DevBroker (in-process dev/test implementation).

The real HttpBroker (delegating OAuth to an external broker service) is deferred;
it swaps in by replacing the module-level `default_broker` instance.

Protocol
--------
BrokerClient.start_connect(manifest)  -> {"auth_url": str, "state": str}
BrokerClient.poll(state)              -> {"token": {...}} | None
BrokerClient.revoke(token)            -> None   (best-effort, may be no-op)
BrokerClient.slug_for_state(state)    -> str | None
BrokerClient.consume_state(state)     -> None

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
                              The "token" key always wraps the credential dict.
            None              when the flow is still in progress.
        """
        ...

    def revoke(self, token: dict) -> None:
        """Best-effort token revocation.  Implementations may be a no-op."""
        ...

    def slug_for_state(self, state: str) -> str | None:
        """Return the piece slug a pending state is for, or None if unknown/expired.

        Used by the poll route to recover which manifest to load without requiring
        the client to pass the slug again on each poll request.
        """
        ...

    def consume_state(self, state: str) -> None:
        """Single-use invalidation: remove a state after a successful connect.

        Prevents state replay.  After this call, slug_for_state(state) returns None
        and poll(state) returns None.
        """
        ...


class DevBroker:
    """In-process broker for local development and automated tests.

    start_connect returns immediately with a stub auth_url; poll also returns
    a fixture token immediately (no browser, no network).  This lets the full
    connect → poll → upsert Connector flow be exercised in tests without any
    external dependency.

    In-memory limitation
    --------------------
    All state correlation lives in a process-local dict (_pending).  In a
    multi-worker deployment (e.g., Gunicorn with multiple processes), a poll
    request routed to a different worker than the one that handled start_connect
    would fail to find the state and return None.  DevBroker is intentionally
    single-worker only (dev server, unit tests).  The real HttpBroker uses
    durable external storage so state is visible to all workers.

    Internal state
    --------------
    _pending : dict[state, slug]
        Correlates each generated state to the piece slug it belongs to.
        Entries are removed by consume_state() after a successful upsert to
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
        """Return a fixture token immediately if state is known, else None.

        Returns {"token": {"access_token": ..., "token_type": ...}} to match
        the Protocol contract.  The outer "token" key is always present so the
        poll route can read token_result["token"] unconditionally.
        """
        if state not in self._pending:
            return None
        # Do NOT consume the entry here — the route needs the slug after poll.
        # The route removes it from _pending via consume_state after a successful upsert.
        return {"token": {"access_token": f"dev-token-{state}", "token_type": "bearer"}}

    def revoke(self, token: dict) -> None:
        """No-op for DevBroker — the token is fictional."""
        return

    def slug_for_state(self, state: str) -> str | None:
        """Return the slug associated with a state, or None if state is unknown/expired."""
        return self._pending.get(state)

    def consume_state(self, state: str) -> None:
        """Remove a state from the pending map after a successful connect."""
        self._pending.pop(state, None)


# Module-level default instance.  The real HttpBroker swaps this out.
# Annotated as BrokerClient so type-checkers enforce that the routes only call
# methods on the Protocol surface (slug_for_state and consume_state are part of
# the Protocol; any implementation that omits them will be caught here).
default_broker: BrokerClient = DevBroker()
