"""Per-user account endpoints (sweep/control).

  GET    /v1/me/account            → profile header + sign-in methods + 2FA state
  GET    /v1/me/preferences        → personal preferences ({} by default)
  PATCH  /v1/me/preferences        → deep-merge a partial; returns the full object
  POST   /v1/me/avatar {data_url}  → set the profile photo (data: URL, ≤ 512 KB)
  DELETE /v1/me/avatar             → remove the profile photo
  GET    /v1/me/sessions           → signed-in devices (current one flagged)
  DELETE /v1/me/sessions/{id}      → sign that device out (revokes its token)

Preferences are per *user* (not company-wide, not admin-only): nickname,
language, the notification matrix and quiet hours live here.
"""
from __future__ import annotations

import base64
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm.attributes import flag_modified

from omilo.auth.deps import get_current_user
from omilo.db import SessionLocal
from omilo.models.control import UserSession
from omilo.models.tenancy import Company, User

router = APIRouter(tags=["me"])

MAX_IMAGE_BYTES = 512 * 1024
_DATA_URL_RE = re.compile(r"^data:(image/(?:png|jpeg|jpg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$")


class ImageBody(BaseModel):
    data_url: str


def validate_image_data_url(data_url: str) -> str:
    """Validate an image data: URL (type + size). Returns the normalised URL."""
    m = _DATA_URL_RE.match(data_url.strip())
    if m is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Upload a PNG, JPEG, GIF, WebP or SVG image.",
        )
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except Exception:
        raise HTTPException(status_code=422, detail="The image could not be read.")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Images must be 512 KB or smaller.",
        )
    return f"data:{m.group(1)};base64,{base64.b64encode(raw).decode()}"


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _claims(user: Any) -> dict:
    return getattr(user, "_jwt_claims", {}) or {}


def _load_user(session: Any, user_id: str) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


# ---------------------------------------------------------------------------
# Account header
# ---------------------------------------------------------------------------


@router.get("/me/account")
def get_account(current_user: User = Depends(get_current_user)) -> dict[str, Any]:
    claims = _claims(current_user)
    with SessionLocal() as session:
        user = _load_user(session, current_user.id)
        company = session.get(Company, claims.get("cmp")) if claims.get("cmp") else None
        google = (
            session.query(UserSession)
            .filter(UserSession.user_id == user.id, UserSession.method == "google")
            .first()
            is not None
        )
        return {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "avatar_url": user.avatar_url,
            "role": claims.get("role"),
            "company_name": company.name if company else None,
            "two_factor_enabled": bool(user.two_factor_enabled),
            "email_verified": user.email_verified_at is not None,
            "google_linked": google,
        }


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------


@router.get("/me/preferences")
def get_preferences(current_user: User = Depends(get_current_user)) -> dict[str, Any]:
    with SessionLocal() as session:
        user = _load_user(session, current_user.id)
        return dict(user.preferences or {})


@router.patch("/me/preferences")
def patch_preferences(
    body: dict[str, Any],
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    with SessionLocal() as session:
        with session.begin():
            user = _load_user(session, current_user.id)
            merged = _deep_merge(dict(user.preferences or {}), body or {})
            user.preferences = merged
            flag_modified(user, "preferences")
            return dict(merged)


# ---------------------------------------------------------------------------
# Avatar
# ---------------------------------------------------------------------------


@router.post("/me/avatar")
def set_avatar(body: ImageBody, current_user: User = Depends(get_current_user)) -> dict[str, Any]:
    url = validate_image_data_url(body.data_url)
    with SessionLocal() as session:
        with session.begin():
            user = _load_user(session, current_user.id)
            user.avatar_url = url
    return {"avatar_url": url}


@router.delete("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
def delete_avatar(current_user: User = Depends(get_current_user)) -> None:
    with SessionLocal() as session:
        with session.begin():
            user = _load_user(session, current_user.id)
            user.avatar_url = None


# ---------------------------------------------------------------------------
# Sessions (devices)
# ---------------------------------------------------------------------------


def _device_label(ua: str | None) -> tuple[str, str]:
    """Return (label, kind) from a User-Agent — kind: desktop | mobile | cli."""
    if not ua:
        return "Unknown device", "desktop"
    u = ua.lower()
    if any(k in u for k in ("curl", "python", "httpx", "omilo-cli", "node-fetch")):
        return "Command line", "cli"
    browser = (
        "Edge" if "edg/" in u else
        "Chrome" if "chrome" in u else
        "Firefox" if "firefox" in u else
        "Safari" if "safari" in u else
        "Browser"
    )
    if "tauri" in u or "omilo-desktop" in u:
        browser = "Omilo app"
    os_name = (
        "iPhone" if "iphone" in u else
        "iPad" if "ipad" in u else
        "Android" if "android" in u else
        "Mac" if "mac os" in u or "macintosh" in u else
        "Windows" if "windows" in u else
        "Linux" if "linux" in u else
        ""
    )
    kind = "mobile" if os_name in ("iPhone", "Android", "iPad") else "desktop"
    return (f"{browser} · {os_name}" if os_name else browser), kind


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


@router.get("/me/sessions")
def list_sessions(current_user: User = Depends(get_current_user)) -> list[dict[str, Any]]:
    current_sid = _claims(current_user).get("sid")
    now = datetime.now(timezone.utc)
    with SessionLocal() as session:
        rows = (
            session.query(UserSession)
            .filter(UserSession.user_id == current_user.id, UserSession.revoked_at.is_(None))
            .order_by(UserSession.last_seen_at.desc().nullslast())
            .limit(50)
            .all()
        )
    out: list[dict[str, Any]] = []
    for r in rows:
        exp = r.expires_at
        if exp is not None and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp is not None and exp < now:
            continue
        label, kind = _device_label(r.user_agent)
        out.append(
            {
                "id": r.id,
                "label": label,
                "kind": kind,
                "method": r.method,
                "ip": r.ip,
                "created_at": _iso(r.created_at),
                "last_seen_at": _iso(r.last_seen_at),
                "current": r.id == current_sid,
            }
        )
    return out


@router.delete("/me/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(session_id: str, current_user: User = Depends(get_current_user)) -> None:
    with SessionLocal() as session:
        with session.begin():
            row = session.get(UserSession, session_id)
            if row is None or row.user_id != current_user.id:
                raise HTTPException(status_code=404, detail="Session not found.")
            if row.revoked_at is None:
                row.revoked_at = datetime.now(timezone.utc)
