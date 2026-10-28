"""omilo.control.factory — get_control_plane() by OMILO_MODE.

Usage::

    from omilo.control.factory import get_control_plane

    cp = get_control_plane()
    identity = cp.verify_token(jwt)

Modes
-----
OMILO_MODE=cloud (default)
    Returns LocalControlPlane().  All auth/billing resolve in-process
    against the local database — exactly today's behavior.

OMILO_MODE=runtime
    Returns RemoteControlPlane() configured from OMILO_CONTROL_PLANE_URL
    and OMILO_INSTALL_TOKEN settings.  Raises NotConfiguredError if those
    settings are missing.

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


def get_control_plane() -> ControlPlane:
    """Return the appropriate ControlPlane implementation for the current mode.

    Cloud mode (default, OMILO_MODE != "runtime"):
        Returns ``LocalControlPlane()``.  This is the existing behavior;
        auth, balance, and metering resolve in-process.

    Runtime mode (OMILO_MODE == "runtime"):
        Returns ``RemoteControlPlane`` configured from
        ``OMILO_CONTROL_PLANE_URL`` and ``OMILO_INSTALL_TOKEN``.
        Raises ``NotConfiguredError`` if those settings are missing.

    Returns:
        A ControlPlane-compatible object.
    """
    settings = get_settings()
    mode = getattr(settings, "omilo_mode", "cloud") or "cloud"

    if mode == "runtime":
        from omilo.control.remote import RemoteControlPlane

        control_plane_url = getattr(settings, "omilo_control_plane_url", None)
        install_token = getattr(settings, "omilo_install_token", None)

        if not control_plane_url:
            raise NotConfiguredError(
                "OMILO_MODE=runtime requires OMILO_CONTROL_PLANE_URL to be set. "
                "Example: OMILO_CONTROL_PLANE_URL=https://api.omilo.app"
            )
        if not install_token:
            raise NotConfiguredError(
                "OMILO_MODE=runtime requires OMILO_INSTALL_TOKEN to be set. "
                "Obtain one via POST /control/register on the cloud control plane."
            )

        return RemoteControlPlane(
            control_plane_url=control_plane_url,
            install_token=install_token,
        )

    # Default: cloud mode → LocalControlPlane (authoritative, in-process)
    return LocalControlPlane()
