"""omilo.control.remote — RemoteControlPlane (runtime mode).

HTTP client implementation of the ControlPlane Protocol.  Used when
OMILO_MODE=runtime; the cloud control plane is the authority.

Key behaviors
-------------
verify_token(jwt)
    Verified LOCALLY against the cloud's JWKS public key (JwksVerifier).
    No per-call round-trip; works OFFLINE once the JWKS is cached.
    Raises jwt.PyJWTError on invalid signature/expiry.

get_entitlements(company_id) / check_balance(company_id)
    HTTP GET /control/entitlements | /control/balance.
    Results are cached per company_id with a short TTL (default 30 s).
    On transport/HTTP failure:
    - If a cached value exists within TTL → return cache (blip tolerance).
    - If no cache → raise ControlPlaneUnreachable.

report_usage(ev)
    HTTP POST /control/usage.
    On success → UsageResult.
    On failure → enqueue to outbox AND raise ControlPlaneUnreachable.

flush_outbox()
    Re-post all queued usage events idempotently.

register_install(user_jwt)
    HTTP POST /control/register → InstallTokenInfo.

heartbeat(install_token)
    HTTP POST /control/heartbeat → bool (True = active, False = revoked).
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt as pyjwt

from omilo.control import (
    BalanceState,
    ControlPlaneUnreachable,
    Entitlements,
    Identity,
    InstallTokenInfo,
    UsageEvent,
    UsageResult,
)
from omilo.control.jwks import JwksVerifier
from omilo.control.outbox import UsageOutbox

logger = logging.getLogger(__name__)

_DEFAULT_TTL_S: int = 30  # cache TTL for entitlements / balance


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float  # monotonic time


class RemoteControlPlane:
    """Runtime-mode ControlPlane — delegates to the cloud over HTTP.

    Args:
        control_plane_url: Base URL of the cloud control plane
                           (e.g. ``https://api.omilo.app``).
        install_token:     Per-company, revocable install token.  Sent as
                           ``Authorization: Bearer <install_token>`` on all
                           authenticated calls.
        http:              Optional httpx.Client (inject for tests).
        verifier:          Optional JwksVerifier (inject for tests).
        outbox:            Optional UsageOutbox (inject for tests).
        ttl_s:             Cache TTL in seconds for entitlements / balance.
    """

    def __init__(
        self,
        control_plane_url: str,
        install_token: str,
        *,
        http: httpx.Client | None = None,
        verifier: JwksVerifier | None = None,
        outbox: UsageOutbox | None = None,
        ttl_s: int = _DEFAULT_TTL_S,
    ) -> None:
        self._url = control_plane_url.rstrip("/")
        self._install_token = install_token
        self._http = http or httpx.Client()
        self._verifier = verifier or JwksVerifier(
            control_plane_url=self._url, http=self._http
        )
        self._outbox = outbox or UsageOutbox()
        self._ttl_s = ttl_s
        # Caches: keyed by company_id → _CacheEntry
        self._balance_cache: dict[str, _CacheEntry] = {}
        self._entitlements_cache: dict[str, _CacheEntry] = {}

    # ------------------------------------------------------------------
    # Auth header helper
    # ------------------------------------------------------------------

    def _auth_headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._install_token}"}

    # ------------------------------------------------------------------
    # verify_token — LOCAL, OFFLINE-capable
    # ------------------------------------------------------------------

    def verify_token(self, jwt: str) -> Identity:
        """Verify a user JWT locally against the cloud JWKS.

        No round-trip to the cloud once the JWKS is cached.

        Returns:
            Identity with user_id (sub), company_id (cmp), role.

        Raises:
            jwt.PyJWTError: on invalid signature, expiry, or unknown kid.
        """
        claims = self._verifier.verify(jwt)
        return Identity(
            user_id=claims["sub"],
            company_id=claims["cmp"],
            role=claims["role"],
        )

    # ------------------------------------------------------------------
    # get_entitlements — HTTP GET, TTL-cached
    # ------------------------------------------------------------------

    def get_entitlements(self, company_id: str, **kw) -> Entitlements:
        """Return the company's plan/limits from the cloud (TTL-cached).

        Raises:
            ControlPlaneUnreachable: on transport/HTTP error with no cache.
        """
        cached = self._get_cache(self._entitlements_cache, company_id)
        if cached is not None:
            return cached

        try:
            resp = self._http.get(
                f"{self._url}/control/entitlements",
                headers=self._auth_headers(),
            )
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, httpx.TransportError, httpx.ConnectError) as exc:
            # Check stale cache as last resort (not within TTL — already missed above)
            raise ControlPlaneUnreachable(
                f"Cannot reach control plane for entitlements: {exc}"
            ) from exc

        ents = Entitlements(
            edition=data.get("edition", "cloud"),
            plan_id=data.get("plan_id"),
            included_credits=data.get("included_credits", 0),
            overage_policy=data.get("overage_policy", "soft"),
            features=data.get("features", {}),
        )
        self._set_cache(self._entitlements_cache, company_id, ents)
        return ents

    # ------------------------------------------------------------------
    # check_balance — HTTP GET, TTL-cached, blip-tolerant
    # ------------------------------------------------------------------

    def check_balance(self, company_id: str, **kw) -> BalanceState:
        """Return the company's credit balance (cloud-authoritative, TTL-cached).

        Cache hit (within TTL) → return cache (no HTTP).
        Cache miss + transport ok → fetch + cache.
        Cache miss + transport error → ControlPlaneUnreachable.
        Cache hit but transport error (blip) → return cache (no Unreachable).

        Raises:
            ControlPlaneUnreachable: on transport/HTTP error with no cache.
        """
        cached = self._get_cache(self._balance_cache, company_id)
        if cached is not None:
            # Within TTL — return cache, don't even try HTTP
            return cached

        try:
            resp = self._http.get(
                f"{self._url}/control/balance",
                headers=self._auth_headers(),
            )
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, httpx.TransportError, httpx.ConnectError) as exc:
            raise ControlPlaneUnreachable(
                f"Cannot reach control plane for balance: {exc}"
            ) from exc

        state = BalanceState(
            balance=data.get("balance", 0),
            overage_policy=data.get("overage_policy", "soft"),
        )
        self._set_cache(self._balance_cache, company_id, state)
        return state

    # ------------------------------------------------------------------
    # report_usage — HTTP POST; on failure → outbox + Unreachable
    # ------------------------------------------------------------------

    def report_usage(self, ev: UsageEvent, **kw) -> UsageResult:
        """Post a usage event to the cloud; on failure enqueue to outbox.

        Returns:
            UsageResult on success.

        Raises:
            ControlPlaneUnreachable: on transport/HTTP error (event is
            enqueued to the outbox for later flush).
        """
        try:
            result = self._post_usage(ev)
            return result
        except (httpx.HTTPError, httpx.TransportError, httpx.ConnectError) as exc:
            logger.warning(
                "report_usage failed for job_id=%s — enqueuing to outbox: %s",
                ev.job_id, exc,
            )
            self._outbox.enqueue(ev)
            raise ControlPlaneUnreachable(
                f"Cannot reach control plane for usage report: {exc}"
            ) from exc

    def _post_usage(self, ev: UsageEvent) -> UsageResult:
        """Internal: HTTP POST /control/usage. Raises httpx errors on failure."""
        body = {
            "job_id": ev.job_id,
            "engine_type": ev.engine_type,
            "model": ev.model,
            "tokens_in": ev.tokens_in,
            "tokens_out": ev.tokens_out,
            "credits": ev.credits,
        }
        resp = self._http.post(
            f"{self._url}/control/usage",
            json=body,
            headers=self._auth_headers(),
        )
        resp.raise_for_status()
        data = resp.json()
        return UsageResult(
            accepted=data.get("accepted", True),
            new_balance=data.get("new_balance", 0),
        )

    def flush_outbox(self) -> None:
        """Re-post all queued usage events idempotently.

        Events are removed from the outbox on successful re-post.
        On failure the event stays in the outbox and flushing stops
        (FIFO order preserved).
        """
        self._outbox.flush(self._post_usage)

    # ------------------------------------------------------------------
    # register_install — HTTP POST /control/register
    # ------------------------------------------------------------------

    def register_install(self, user_jwt: str, **kw) -> InstallTokenInfo:
        """Register a local runtime to a company.

        Args:
            user_jwt: A valid user access JWT (issued by cloud /auth/sign-in).

        Returns:
            InstallTokenInfo{install_token, company_id}.

        Raises:
            ControlPlaneUnreachable: on transport/HTTP error.
        """
        try:
            resp = self._http.post(
                f"{self._url}/control/register",
                json={"user_jwt": user_jwt},
            )
            resp.raise_for_status()
            data = resp.json()
        except (httpx.HTTPError, httpx.TransportError, httpx.ConnectError) as exc:
            raise ControlPlaneUnreachable(
                f"Cannot reach control plane to register install: {exc}"
            ) from exc

        return InstallTokenInfo(
            install_token=data["install_token"],
            company_id=data["company_id"],
        )

    # ------------------------------------------------------------------
    # heartbeat — HTTP POST /control/heartbeat
    # ------------------------------------------------------------------

    def heartbeat(self, install_token: str, **kw) -> bool:
        """Liveness + revocation check against the cloud.

        Returns:
            True if the install token is active.
            False if the server returns 401/403 (revoked/unknown).

        Raises:
            ControlPlaneUnreachable: on transport error (not HTTP 4xx).
        """
        try:
            resp = self._http.post(
                f"{self._url}/control/heartbeat",
                headers={"Authorization": f"Bearer {install_token}"},
            )
            if resp.status_code in (401, 403):
                return False
            resp.raise_for_status()
            data = resp.json()
            return bool(data.get("ok", True)) and not bool(data.get("revoked", False))
        except (httpx.HTTPError, httpx.TransportError, httpx.ConnectError) as exc:
            raise ControlPlaneUnreachable(
                f"Cannot reach control plane for heartbeat: {exc}"
            ) from exc

    # ------------------------------------------------------------------
    # Cache helpers
    # ------------------------------------------------------------------

    def _get_cache(self, cache: dict[str, _CacheEntry], key: str) -> Any | None:
        """Return a cached value if it exists and has not expired, else None."""
        entry = cache.get(key)
        if entry is None:
            return None
        if time.monotonic() < entry.expires_at:
            return entry.value
        # Expired — remove it and return None
        del cache[key]
        return None

    def _set_cache(self, cache: dict[str, _CacheEntry], key: str, value: Any) -> None:
        """Store a value in the cache with the configured TTL."""
        cache[key] = _CacheEntry(
            value=value,
            expires_at=time.monotonic() + self._ttl_s,
        )
