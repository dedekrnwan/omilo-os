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
    Reserved for T3 (RemoteControlPlane).  Currently raises
    NotConfiguredError with a clear message so the failure is descriptive
    rather than silent.

The factory is intentionally NOT cached (no lru_cache) so that tests can
change Settings.omilo_mode without stale state.  For production the mode is
set once at startup and the object is cheap to construct each call.
"""
from __future__ import annotations

from omilo.config import get_settings
from omilo.control import ControlPlane
from omilo.control.local import LocalControlPlane


class NotConfiguredError(RuntimeError):
    """Raised when the requested run-mode is not yet available in this build."""


def get_control_plane() -> ControlPlane:
    """Return the appropriate ControlPlane implementation for the current mode.

    Cloud mode (default, OMILO_MODE != "runtime"):
        Returns ``LocalControlPlane()``.  This is the existing behavior;
        auth, balance, and metering resolve in-process.

    Runtime mode (OMILO_MODE == "runtime"):
        T3 will add ``RemoteControlPlane``.  Until then this raises
        ``NotConfiguredError`` with a descriptive message so that
        misconfigured deployments fail loudly rather than silently.

    Returns:
        A ControlPlane-compatible object.
    """
    settings = get_settings()
    mode = getattr(settings, "omilo_mode", "cloud") or "cloud"

    if mode == "runtime":
        # T3 implements RemoteControlPlane.
        raise NotConfiguredError(
            "OMILO_MODE=runtime is not yet configured in this build. "
            "Set OMILO_MODE=cloud (or unset it) to use LocalControlPlane. "
            "RemoteControlPlane will be added in P6 Task 3."
        )

    # Default: cloud mode → LocalControlPlane (authoritative, in-process)
    return LocalControlPlane()
