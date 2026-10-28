"""FastAPI auth dependency: `get_current_user`.

Reads the `Authorization: Bearer <jwt>` header, decodes it through the
ControlPlane port (verify_token), and loads the User from the database.

In cloud mode (default) the ControlPlane is LocalControlPlane which calls
auth.tokens.decode_token — identical behavior to before.  In runtime mode
(T3) RemoteControlPlane will verify against the cloud JWKS offline.

Returns 401 on:
- Missing / malformed Authorization header
- Invalid or expired JWT
- (Cloud only) User not found in the DB

Returns 503 on:
- Control plane misconfigured (e.g. OMILO_MODE=runtime before T3 is wired)
- Runtime mode first-run: no local Company shadow AND entitlements unreachable

Identity resolution — RUNTIME vs CLOUD
---------------------------------------
**RUNTIME mode** (not LocalControlPlane):
  The JWT is cryptographically verified against the cloud JWKS (RS256/offline
  capable).  The verified claims ARE the identity — user_id, company_id, role
  come directly from the token.  No local ``User`` or ``Member`` row is
  required.  A lightweight ``_RuntimeIdentity`` carrier (duck-typed to ``User``)
  is returned so the rest of the app (tenancy/deps.py, /me handler) works
  identically.

**CLOUD mode** (LocalControlPlane, default):
  Behavior IDENTICAL to before — ``session.get(User, user_id)`` + Member
  lookup in get_context.  No change.  Cloud mode still 401s if no local User
  row exists.

Shadow wiring (RUNTIME mode only)
----------------------------------
After the JWT is verified, ``get_current_user`` checks whether a local
Company row exists for the authenticated company_id.  If not (first-run or
stale), it calls ``sync_company_shadow`` to upsert the row from the cloud
control plane's entitlements.

Resilience:
- If a shadow already exists → skip entitlements call entirely (cheap path).
- If the shadow is missing AND entitlements are unreachable (offline first-run)
  → return 503 with a clear message.  We cannot bootstrap a brand-new tenant
  without the cloud entitlements on first contact.
- Cloud mode: NO shadow call at all — the authoritative Company row already
  exists in the local DB; we do not clobber it.
"""
from __future__ import annotations

import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import PyJWTError
from sqlalchemy.orm import Session

from omilo.control import ControlPlaneUnreachable, Identity
from omilo.control.factory import NotConfiguredError, get_control_plane
from omilo.control.local import LocalControlPlane
from omilo.db import SessionLocal
from omilo.models.tenancy import Company, User

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)

# Default role when JWT claims contain no 'role' field (mirrors cloud-mode default).
_DEFAULT_ROLE = "member"


class _RuntimeIdentity:
    """Lightweight claims-carrier that duck-types ``User`` for runtime mode.

    In RUNTIME mode the local DB has no ``User`` rows (cloud-authoritative).
    The verified JWT claims ARE the identity.  This object satisfies the
    ``user.id`` / ``user._jwt_claims`` contract that the rest of the app uses,
    without requiring a DB lookup.

    It is intentionally NOT a SQLAlchemy model — it is never persisted.
    """

    __slots__ = ("id", "_jwt_claims")

    def __init__(self, identity: Identity) -> None:
        self.id: str = identity.user_id
        self._jwt_claims: dict = {
            "sub": identity.user_id,
            "cmp": identity.company_id,
            "role": identity.role or _DEFAULT_ROLE,
        }

_401 = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or missing authentication credentials.",
    headers={"WWW-Authenticate": "Bearer"},
)

_503 = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail="Authentication service is not configured. Contact your administrator.",
)

_503_offline_first_run = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail=(
        "Runtime mode: cannot bootstrap this tenant — "
        "no local Company shadow exists and the cloud control plane is unreachable. "
        "Ensure OMILO_CONTROL_PLANE_URL is reachable on first connection."
    ),
)


def _ensure_company_shadow(cp, company_id: str, db: Session) -> None:
    """Ensure a local Company shadow row exists in RUNTIME mode.

    Only called when ``cp`` is NOT a ``LocalControlPlane`` (i.e. runtime mode).

    Algorithm:
    1. Cheap existence check: ``db.get(Company, company_id)``.
       If present → return immediately (no entitlements call).
    2. If missing → call ``sync_company_shadow`` to upsert from entitlements.
       If ``ControlPlaneUnreachable`` → raise 503 (first-run offline is
       unrecoverable; the tenant cannot be bootstrapped without cloud data).

    Args:
        cp:         The active ControlPlane (guaranteed non-Local by caller).
        company_id: Authenticated company id from the verified JWT.
        db:         A writable SQLAlchemy Session (superuser context).

    Raises:
        HTTPException(503): if entitlements are unreachable on first-run.
    """
    # 1. Cheap path: shadow already exists → nothing to do.
    existing = db.get(Company, company_id)
    if existing is not None:
        return

    # 2. No shadow — attempt to sync from cloud entitlements.
    logger.info(
        "deps: no local Company shadow for company_id=%s in runtime mode — syncing from control plane",
        company_id,
    )
    try:
        from omilo.control.shadow import sync_company_shadow

        sync_company_shadow(db, company_id, cp)
        # Flush is done inside sync_company_shadow; the caller (get_current_user)
        # commits the session so the shadow is visible to subsequent handlers.
    except ControlPlaneUnreachable as exc:
        logger.warning(
            "deps: first-run offline for company_id=%s — entitlements unreachable: %s",
            company_id,
            exc,
        )
        raise _503_offline_first_run from exc


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User | _RuntimeIdentity:
    """Dependency that resolves a Bearer JWT to the authenticated User.

    Routes token verification through the ControlPlane port so that cloud
    mode (LocalControlPlane) continues to call decode_token in-process while
    runtime mode (T3) can verify against the cloud JWKS offline.

    Behavior in cloud mode: IDENTICAL to before — LocalControlPlane delegates
    to auth.tokens.decode_token.  No shadow call is made in cloud mode.

    In runtime mode: after JWT verification, ensures a local Company shadow
    exists for the authenticated company before returning.  See module
    docstring for resilience contract.

    Raises 503 if the control plane is misconfigured (NotConfiguredError),
    rather than allowing an unhandled 500 to propagate.
    """
    if credentials is None:
        raise _401

    try:
        cp = get_control_plane()
        identity = cp.verify_token(credentials.credentials)
    except NotConfiguredError:
        raise _503
    except PyJWTError:
        raise _401

    user_id: str = identity.user_id
    company_id: str = identity.company_id
    if not user_id:
        raise _401

    if not isinstance(cp, LocalControlPlane):
        # ── RUNTIME MODE ────────────────────────────────────────────────────
        # The JWT is cryptographically verified (RS256/JWKS, T3).  The claims
        # ARE the identity — no local User/Member row required.
        # We only touch the DB to ensure the Company shadow exists.
        if company_id:
            with SessionLocal() as session:
                with session.begin():
                    _ensure_company_shadow(cp, company_id, session)
        return _RuntimeIdentity(identity)

    # ── CLOUD MODE (LocalControlPlane) — IDENTICAL to before ────────────────
    # The local DB is authoritative for User and Member.  We load the User row
    # and attach _jwt_claims so get_context can read them without re-decoding.
    with SessionLocal() as session:
        with session.begin():
            user = session.get(User, user_id)

    if user is None:
        raise _401

    # Attach the identity as a claims-compatible dict so that tenancy/deps.py
    # (get_context) can read company_id / role without another token decode.
    # We preserve the dict shape the existing code expects: {sub, cmp, role}.
    user._jwt_claims = {  # type: ignore[attr-defined]
        "sub": identity.user_id,
        "cmp": identity.company_id,
        "role": identity.role,
    }
    return user
