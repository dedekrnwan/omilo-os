"""FastAPI auth dependency: `get_current_user`.

Reads the `Authorization: Bearer <jwt>` header, decodes it through the
ControlPlane port (verify_token), and loads the User from the database.

In cloud mode (default) the ControlPlane is LocalControlPlane which calls
auth.tokens.decode_token — identical behavior to before.  In runtime mode
(T3) RemoteControlPlane will verify against the cloud JWKS offline.

Returns 401 on:
- Missing / malformed Authorization header
- Invalid or expired JWT
- User not found in the DB

Returns 503 on:
- Control plane misconfigured (e.g. OMILO_MODE=runtime before T3 is wired)
- Runtime mode first-run: no local Company shadow AND entitlements unreachable

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

from omilo.control import ControlPlaneUnreachable
from omilo.control.factory import NotConfiguredError, get_control_plane
from omilo.control.local import LocalControlPlane
from omilo.db import SessionLocal
from omilo.models.tenancy import Company, User

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)

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
) -> User:
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

    # Open a plain session (no RLS needed — User and Company are global tables).
    with SessionLocal() as session:
        with session.begin():
            user = session.get(User, user_id)

            # RUNTIME mode only: ensure local Company shadow exists before handler runs.
            # Cloud mode (LocalControlPlane): pure no-op — authoritative Company already
            # in the local DB; we never clobber or add extra queries.
            # The transaction is committed at the end of the `with session.begin()` block,
            # making the shadow visible to all subsequent DB reads in this request.
            if not isinstance(cp, LocalControlPlane) and company_id:
                _ensure_company_shadow(cp, company_id, session)

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
