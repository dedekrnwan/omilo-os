"""BrokerClient protocol + DevBroker (in-process dev/test implementation) + HttpBroker.

HttpBroker implements the real authorization-code OAuth flow with Redis-backed state.
DevBroker is the in-process implementation for local development and automated tests.
Both implement the BrokerClient Protocol so the routes can swap them via default_broker.

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

HttpBroker
----------
- Redis-backed state: all state correlation lives in Redis under namespaced keys.
- start_connect: builds a real authorize URL and stores state → slug in Redis.
- stash_token: called by the OAuth callback route (Task 4) to store the token.
- poll: checks Redis for a token; returns {"token": <dict>} or None.
- slug_for_state: reads the slug for a pending state from Redis.
- consume_state: deletes both state and token keys from Redis (single-use).
- revoke: best-effort POST to the provider's revoke_url; swallows all errors.
"""
from __future__ import annotations

import json
import logging
import secrets
import urllib.parse
from typing import Protocol, runtime_checkable

import httpx

from .config import get_settings

logger = logging.getLogger(__name__)

# TTL for OAuth state and token keys in Redis (10 minutes)
OAUTH_TTL_S = 600


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


class HttpBroker:
    """Redis-backed OAuth broker for production deployments.

    All state is stored in Redis under namespaced keys so it is visible to all
    worker processes (unlike DevBroker's in-memory dict).

    Key layout (under settings.redis_prefix):
      {prefix}:oauth:state:{state}  — maps state → slug (set by start_connect)
      {prefix}:oauth:token:{state}  — maps state → JSON token dict (set by stash_token)

    Both keys carry a TTL of OAUTH_TTL_S (600 s) to prevent stale-state accumulation.

    The stash_token method is called by the OAuth callback route (Task 4) after it
    exchanges the authorization code for tokens; poll then returns the token to the
    polling client.
    """

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _state_key(self, state: str) -> str:
        return f"{get_settings().redis_prefix}:oauth:state:{state}"

    def _token_key(self, state: str) -> str:
        return f"{get_settings().redis_prefix}:oauth:token:{state}"

    def _store_state(self, state: str, slug: str) -> None:
        """Store state → slug in Redis with TTL.  Called internally by start_connect
        and directly by tests that want to seed state without a full start_connect."""
        from . import bus

        bus.r().set(self._state_key(state), slug, ex=OAUTH_TTL_S)

    # ------------------------------------------------------------------
    # BrokerClient Protocol surface
    # ------------------------------------------------------------------

    def start_connect(self, manifest: dict) -> dict:
        """Build the provider authorize URL and store state → slug in Redis.

        Reads provider config from OAUTH_PROVIDERS and client credentials from
        Settings.oauth_clients.  Scopes come from manifest["auth"]["scopes"].

        Returns:
            {"auth_url": str, "state": str}
        """
        from .oauth import OAUTH_PROVIDERS, provider_client

        provider = manifest["auth"]["provider"]
        scopes = manifest["auth"]["scopes"]
        slug = manifest["id"]

        cfg = OAUTH_PROVIDERS[provider]
        client_id, _ = provider_client(provider)
        redirect_uri = get_settings().oauth_redirect_uri()
        state = secrets.token_urlsafe(24)

        # Build query parameters: base params + authorize_extra
        params: dict[str, str] = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(scopes),
            "state": state,
        }
        # Merge provider-specific extras (e.g. access_type=offline, prompt=consent for Google)
        params.update(cfg.get("authorize_extra", {}))

        auth_url = cfg["authorize_url"] + "?" + urllib.parse.urlencode(params)

        self._store_state(state, slug)
        logger.info("start_connect: provider=%s slug=%s", provider, slug)

        return {"auth_url": auth_url, "state": state}

    def stash_token(self, state: str, token_dict: dict) -> None:
        """Store a token dict in Redis for the given state.

        Called by the OAuth callback route (Task 4) after exchanging the
        authorization code for tokens.  poll() reads this key.
        """
        from . import bus

        bus.r().set(self._token_key(state), json.dumps(token_dict), ex=OAUTH_TTL_S)

    def poll(self, state: str) -> dict | None:
        """Return {"token": <dict>} if the token has been stashed, else None."""
        from . import bus

        raw = bus.r().get(self._token_key(state))
        if raw is None:
            return None
        return {"token": json.loads(raw)}

    def slug_for_state(self, state: str) -> str | None:
        """Return the piece slug for a pending state, or None if unknown/expired."""
        from . import bus

        return bus.r().get(self._state_key(state))

    def consume_state(self, state: str) -> None:
        """Delete both the state and token keys from Redis (single-use invalidation)."""
        from . import bus

        bus.r().delete(self._state_key(state), self._token_key(state))

    def revoke(self, token: dict) -> None:
        """Best-effort POST to the provider's revoke_url; swallows all errors.

        token must contain a "provider" key to look up the provider's revoke_url.
        If the provider has no revoke_url (e.g. Meta), this is a no-op.
        """
        from .oauth import OAUTH_PROVIDERS

        provider = token.get("provider")
        if not provider:
            return

        cfg = OAUTH_PROVIDERS.get(provider, {})
        revoke_url = cfg.get("revoke_url")
        if not revoke_url:
            return

        try:
            httpx.post(
                revoke_url,
                data={"token": token.get("access_token", "")},
                timeout=10,
            )
        except Exception:
            # Best-effort: swallow all errors (network, HTTP, etc.)
            logger.debug("revoke: swallowed error for provider=%s", provider)


# Module-level default instance.  The real HttpBroker swaps this out.
# Annotated as BrokerClient so type-checkers enforce that the routes only call
# methods on the Protocol surface (slug_for_state and consume_state are part of
# the Protocol; any implementation that omits them will be caught here).
default_broker: BrokerClient = DevBroker()
