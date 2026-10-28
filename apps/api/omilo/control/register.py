"""omilo.control.register — Install registration flow + CLI entry point.

Usage (CLI)::

    omilo-register --jwt <user_jwt>

Or with env vars::

    OMILO_CONTROL_PLANE_URL=https://api.omilo.app \\
    OMILO_USER_JWT=<your_jwt> \\
    omilo-register

What it does
------------
1. Reads OMILO_CONTROL_PLANE_URL (required) and OMILO_INSTALL_TOKEN (optional)
   from settings / env.
2. Accepts a user JWT (from --jwt arg or OMILO_USER_JWT env var).
3. Calls RemoteControlPlane.register_install(user_jwt) → receives an
   InstallTokenInfo {install_token, company_id}.
4. Prints the install token and instructions for where to store it:
   - For server self-host: set OMILO_INSTALL_TOKEN=<token> in your env/.env.
   - For desktop (P5c): stored in the OS keychain (out of scope here).

This module exposes two public callables:

    register_install(user_jwt, *, control_plane) -> InstallTokenInfo
        Pure function: call register_install on the given ControlPlane.
        Testable without CLI wiring.

    register_main(user_jwt, *, control_plane) -> None
        Core logic: call register_install and print the result + instructions.
        Testable without argparse / sys.argv.

    main() -> None
        CLI entry point (``omilo-register`` console script).  Reads args
        from sys.argv and env; calls register_main; exits non-zero on error.
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import TYPE_CHECKING

from omilo.config import get_settings

if TYPE_CHECKING:
    from omilo.control import ControlPlane, InstallTokenInfo


def register_install(
    user_jwt: str,
    *,
    control_plane: "ControlPlane",
) -> "InstallTokenInfo":
    """Call register_install on *control_plane* and return the result.

    Args:
        user_jwt:       A valid cloud-issued user JWT (from /auth/sign-in).
        control_plane:  A ControlPlane instance (typically RemoteControlPlane).

    Returns:
        InstallTokenInfo{install_token, company_id}.

    Raises:
        Whatever the control_plane raises (ControlPlaneUnreachable, etc.).
    """
    return control_plane.register_install(user_jwt)


def register_main(
    user_jwt: str,
    *,
    control_plane: "ControlPlane",
) -> None:
    """Core registration logic: register and print the install token.

    Prints the install_token and tells the user where to set it
    (OMILO_INSTALL_TOKEN environment variable or .env file).

    Args:
        user_jwt:       A valid cloud-issued user JWT.
        control_plane:  A ControlPlane instance.
    """
    result = register_install(user_jwt, control_plane=control_plane)

    print(f"Install token obtained for company: {result.company_id}")
    print(f"Install token: {result.install_token}")
    print()
    print("Store this token as OMILO_INSTALL_TOKEN:")
    print(f"  OMILO_INSTALL_TOKEN={result.install_token}")
    print()
    print("Add it to your .env file or pass it as an environment variable.")
    print("On desktop (P5c) the Tauri shell stores it in the OS keychain.")


def main() -> None:
    """CLI entry point for ``omilo-register`` console script.

    Reads OMILO_CONTROL_PLANE_URL from settings/env (required).
    Accepts --jwt <token> or OMILO_USER_JWT env var.

    Exits non-zero on any error.
    """
    parser = argparse.ArgumentParser(
        prog="omilo-register",
        description=(
            "Register this local runtime with the cloud control plane. "
            "Exchanges a user JWT for a per-company install token."
        ),
    )
    parser.add_argument(
        "--jwt",
        metavar="TOKEN",
        default=os.environ.get("OMILO_USER_JWT", ""),
        help="User JWT from cloud /auth/sign-in (or set OMILO_USER_JWT env var).",
    )
    args = parser.parse_args()

    settings = get_settings()

    control_plane_url = getattr(settings, "omilo_control_plane_url", None)
    if not control_plane_url:
        print(
            "ERROR: OMILO_CONTROL_PLANE_URL is not set.\n"
            "Example: OMILO_CONTROL_PLANE_URL=https://api.omilo.app",
            file=sys.stderr,
        )
        sys.exit(1)

    user_jwt = args.jwt
    if not user_jwt:
        print(
            "ERROR: No user JWT provided.\n"
            "Pass --jwt <token> or set OMILO_USER_JWT env var.\n"
            "Obtain a JWT from the cloud control plane: POST /auth/sign-in",
            file=sys.stderr,
        )
        sys.exit(1)

    # Build a RemoteControlPlane for the registration call.
    # We don't have an install token yet (that's what we're getting), so we
    # pass an empty string — register_install does NOT require the install
    # token header (it authenticates via the user JWT in the body).
    from omilo.control.remote import RemoteControlPlane

    install_token = getattr(settings, "omilo_install_token", None) or ""
    cp = RemoteControlPlane(
        control_plane_url=control_plane_url,
        install_token=install_token,
    )

    try:
        register_main(user_jwt, control_plane=cp)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: Registration failed: {exc}", file=sys.stderr)
        sys.exit(1)
