"""omilo.control.factory — get_control_plane() by OMILO_MODE.

Usage::

    from omilo.control.factory import get_control_plane, is_local_mode

    cp = get_control_plane()
    identity = cp.verify_token(jwt)

Modes (P6b: three modes + runtime alias)
-----------------------------------------
OMILO_MODE=local (P6b NEW)
    Returns LocalControlPlane().  Fully-local, cloud-free BYO-only install.
    Requires NO OMILO_CONTROL_PLANE_URL / OMILO_INSTALL_TOKEN.  No pooled
    cloud inference; no metering; no credit ledger.  Air-gap-capable.

OMILO_MODE=hybrid (= former "runtime", renamed P6b)
    Returns RemoteControlPlane() configured from OMILO_CONTROL_PLANE_URL
    and OMILO_INSTALL_TOKEN settings.  Raises NotConfiguredError if those
    settings are missing.

OMILO_MODE=runtime
    ALIAS for hybrid — accepted for backward compat; normalized at read.

OMILO_MODE=cloud (default)
    Returns LocalControlPlane().  All auth/billing resolve in-process
    against the local database — exactly today's behavior.

The factory is intentionally NOT cached (no lru_cache) so that tests can
change Settings.omilo_mode without stale state.  For production the mode is
set once at startup and the object is cheap to construct each call.
"""
from __future__ import annotations

from omilo.config import get_settings
from omilo.control import ControlPlane
from omilo.control.local import LocalControlPlane


class NotConfiguredError(RuntimeError):
    """Raised when the requested run-mode is not properly configured."""


def _normalize_mode(raw: str) -> str:
    """Normalize raw OMILO_MODE value; maps 'runtime' alias → 'hybrid'."""
    raw = (raw or "cloud").strip().lower()
    if raw == "runtime":
        return "hybrid"
    return raw


def is_local_mode() -> bool:
    """Return True when OMILO_MODE=local (fully-local, cloud-free BYO install).

    Helper for billing and engine factory to gate local-mode branches without
    importing the full ControlPlane object.
    """
    settings = get_settings()
    raw = getattr(settings, "omilo_mode", "cloud") or "cloud"
    return _normalize_mode(raw) == "local"


def is_cloud_authoritative() -> bool:
    """Return True when this process owns auth + billing (local or cloud mode).

    False only in hybrid/runtime mode where a RemoteControlPlane is used.
    """
    settings = get_settings()
    raw = getattr(settings, "omilo_mode", "cloud") or "cloud"
    return _normalize_mode(raw) in {"local", "cloud"}


def get_control_plane() -> ControlPlane:
    """Return the appropriate ControlPlane implementation for the current mode.

    local/cloud (default, OMILO_MODE ∈ {local, cloud, or unset}):
        Returns ``LocalControlPlane()``.  Auth, balance, and metering resolve
        in-process.  local mode adds BYO-only billing posture in billing/engine.

    hybrid/runtime (OMILO_MODE ∈ {hybrid, runtime}):
        Returns ``RemoteControlPlane`` configured from
        ``OMILO_CONTROL_PLANE_URL`` and ``OMILO_INSTALL_TOKEN``.
        Raises ``NotConfiguredError`` if those settings are missing.

    Returns:
        A ControlPlane-compatible object.
    """
    settings = get_settings()
    raw = getattr(settings, "omilo_mode", "cloud") or "cloud"
    mode = _normalize_mode(raw)

    if mode == "hybrid":
        from omilo.control.remote import RemoteControlPlane

        control_plane_url = getattr(settings, "omilo_control_plane_url", None)
        install_token = getattr(settings, "omilo_install_token", None)

        if not control_plane_url:
            raise NotConfiguredError(
                f"OMILO_MODE={raw!r} requires OMILO_CONTROL_PLANE_URL to be set. "
                "Example: OMILO_CONTROL_PLANE_URL=https://api.omilo.app"
            )
        if not install_token:
            raise NotConfiguredError(
                f"OMILO_MODE={raw!r} requires OMILO_INSTALL_TOKEN to be set. "
                "Obtain one via POST /control/register on the cloud control plane."
            )

        return RemoteControlPlane(
            control_plane_url=control_plane_url,
            install_token=install_token,
        )

    # local + cloud → LocalControlPlane (authoritative, in-process)
    # local mode billing posture (BYO-only, 0-credit, no ledger) is enforced
    # in billing/balance.py, billing/meter.py, and engine/__init__.py via is_local_mode().
    return LocalControlPlane()
