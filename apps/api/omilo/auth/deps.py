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
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import PyJWTError
from sqlalchemy.orm import Session

from omilo.control.factory import get_control_plane
from omilo.db import SessionLocal
from omilo.models.tenancy import User

_bearer = HTTPBearer(auto_error=False)

_401 = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or missing authentication credentials.",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    """Dependency that resolves a Bearer JWT to the authenticated User.

    Routes token verification through the ControlPlane port so that cloud
    mode (LocalControlPlane) continues to call decode_token in-process while
    runtime mode (T3) can verify against the cloud JWKS offline.

    Behavior in cloud mode: IDENTICAL to before — LocalControlPlane delegates
    to auth.tokens.decode_token.
    """
    if credentials is None:
        raise _401

    try:
        cp = get_control_plane()
        identity = cp.verify_token(credentials.credentials)
    except PyJWTError:
        raise _401

    user_id: str = identity.user_id
    if not user_id:
        raise _401

    # Open a plain session (no RLS needed — User is a global table).
    with SessionLocal() as session:
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
