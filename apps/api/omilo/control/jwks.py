"""omilo.control.jwks — Local JWKS verification (offline-capable).

JwksVerifier fetches the cloud control plane's JWKS once, caches the public
keys by kid, and verifies RS256 JWTs locally — no per-call round-trip.

After the initial fetch the verifier is offline-capable: network outages do
not break token verification as long as the signing kid is cached.

If a JWT presents an unknown kid the verifier refetches the JWKS exactly once
(to handle key rotation), then fails with PyJWTError if the kid is still
unknown.

Usage::

    verifier = JwksVerifier(control_plane_url="https://api.omilo.app")
    claims = verifier.verify(jwt_string)  # Identity claims dict
"""
from __future__ import annotations

import threading
from typing import Any

import httpx
import jwt as pyjwt
from jwt.algorithms import RSAAlgorithm


class JwksVerifier:
    """Fetch-and-cache the cloud JWKS; verify RS256 JWTs locally.

    Args:
        control_plane_url: Base URL of the cloud control plane
                           (e.g. ``https://api.omilo.app``).
        http:              Optional httpx.Client for injection (tests).
                           If omitted a default client is created.

    Thread safety: the internal cache is guarded by a lock; concurrent
    calls are safe.
    """

    def __init__(
        self,
        control_plane_url: str,
        *,
        http: httpx.Client | None = None,
    ) -> None:
        self._url = control_plane_url.rstrip("/")
        self._http = http or httpx.Client()
        # kid → RSA public key object (from jwt.algorithms.RSAAlgorithm)
        self._keys: dict[str, Any] = {}
        self._lock = threading.Lock()
        self._fetched: bool = False  # True once at least one successful fetch done

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def verify(self, token: str) -> dict:
        """Decode and verify an RS256 JWT.

        Steps:
        1. Peek at the unverified header to get the ``kid``.
        2. If the kid is in the cache → verify locally (OFFLINE, no HTTP).
        3. If the kid is NOT cached → fetch JWKS once (rotation support).
        4. If still unknown → raise ``jwt.PyJWTError``.

        Returns:
            The decoded claims dict.

        Raises:
            jwt.PyJWTError: on invalid signature, expiry, or unknown kid.
            httpx.HTTPError: only on the initial fetch when keys are not
                             cached yet and the transport is down.
        """
        header = pyjwt.get_unverified_header(token)
        kid: str = header.get("kid", "")

        # Ensure the cache is primed before the first verify
        with self._lock:
            if not self._fetched:
                self._fetch_jwks_locked()

        # Check cache (outside lock since reading is fine; worst case we
        # re-fetch safely below under lock)
        if kid not in self._keys:
            # Unknown kid — try one refetch (key rotation)
            with self._lock:
                if kid not in self._keys:  # still missing after lock
                    self._fetch_jwks_locked()

        with self._lock:
            public_key = self._keys.get(kid)

        if public_key is None:
            raise pyjwt.exceptions.InvalidKeyError(
                f"Unknown kid {kid!r} — not in JWKS after refetch"
            )

        # Verify locally — RS256 only; let PyJWT raise on bad sig / exp.
        claims = pyjwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
        )
        return claims

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _fetch_jwks_locked(self) -> None:
        """Fetch /control/jwks and update the key cache.

        MUST be called while holding self._lock.

        Raises:
            httpx.HTTPError: if the transport fails.
        """
        resp = self._http.get(f"{self._url}/control/jwks")
        resp.raise_for_status()
        jwks: dict = resp.json()

        for key_data in jwks.get("keys", []):
            kid = key_data.get("kid", "")
            # Use PyJWT's helper to build the RSA public key from the JWK dict.
            try:
                import json
                public_key = RSAAlgorithm.from_jwk(json.dumps(key_data))
                self._keys[kid] = public_key
            except Exception:
                # Skip malformed JWK entries
                continue

        self._fetched = True
