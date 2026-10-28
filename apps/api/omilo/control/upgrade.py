"""omilo.control.upgrade — local → hybrid upgrade flow.

``connect_to_cloud(db_bootstrap, user_jwt, control_plane_url) -> UpgradeResult``

Upgrades a fully-local install to hybrid mode:
1. Registers the install with the cloud control plane → cloud company_id + install token.
2. Re-keys all local workspace data from the local company_id to the cloud company_id.
3. Persists the new mode config (OMILO_MODE=hybrid, OMILO_CONTROL_PLANE_URL,
   OMILO_INSTALL_TOKEN) to the runtime .env file so the next start is hybrid.
4. Retires the local User + Member authority (identity is now cloud).

One-way guard: calling this when the current mode is already hybrid or cloud raises
``AlreadyHybridError``.

Config persistence strategy
----------------------------
The app reads settings from a ``.env`` file via pydantic-settings.  The upgrade
writes the three new env vars to the same ``.env`` file the app uses (located at
the working directory from which the server is started, typically ``apps/api/.env``
for a server self-host or the process cwd for the CLI).

The path can be overridden via the ``OMILO_RUNTIME_ENV_FILE`` environment variable.
If the file does not exist yet it is created.  Existing vars are preserved; the three
upgrade vars are upserted (appended if absent, replaced if present).

After writing, the operator must **restart** the server for the new mode to take
effect.  The CLI prints a reminder.

Local User/Member retirement
-----------------------------
In local mode, ``User`` and ``Member`` rows are the authoritative local identity.
After upgrade to hybrid, identity is cloud-authoritative (verified via JWKS).  We
delete all ``Member`` rows under the OLD company_id (already re-keyed to new, so
we delete under the new company_id) and mark local ``User`` rows as retired by
setting ``password_hash=None`` (they can no longer sign in locally; the cloud
JWT is now the auth mechanism).  We do NOT delete ``User`` rows outright because
they may be referenced by other records (audit trails, etc.).

``omilo-connect`` console script
----------------------------------
See ``main()`` at the bottom — mirrors ``omilo-register``.
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from omilo.config import get_settings
from omilo.control import InstallTokenInfo
from omilo.control.factory import _normalize_mode
from omilo.control.rekey import rekey_company
from omilo.models.tenancy import Company, Member, User

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Default runtime env-file path
# ---------------------------------------------------------------------------

_DEFAULT_ENV_FILE = Path(".env")
_ENV_FILE_ENV_VAR = "OMILO_RUNTIME_ENV_FILE"


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class AlreadyHybridError(RuntimeError):
    """Raised when connect_to_cloud is called but the mode is already hybrid/cloud."""


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass
class UpgradeResult:
    """Result returned by connect_to_cloud."""

    cloud_company_id: str
    install_token: str
    rows_rekeyed: int
    mode: str = "hybrid"


# ---------------------------------------------------------------------------
# Config persistence helpers
# ---------------------------------------------------------------------------


def _get_env_file_path() -> Path:
    """Return the path to the runtime .env file.

    Reads OMILO_RUNTIME_ENV_FILE env var; falls back to ``.env`` in cwd.
    """
    override = os.environ.get(_ENV_FILE_ENV_VAR)
    if override:
        return Path(override)
    return _DEFAULT_ENV_FILE


def _upsert_env_vars(env_file: Path, updates: dict[str, str]) -> None:
    """Upsert key=value pairs in an env file.

    Existing lines for the same key are replaced in-place.  New keys are
    appended.  The file is created if it does not exist.

    Args:
        env_file: Path to the .env file.
        updates:  Mapping of KEY → value to set.
    """
    existing_lines: list[str] = []
    if env_file.exists():
        existing_lines = env_file.read_text(encoding="utf-8").splitlines(keepends=True)

    keys_done: set[str] = set()
    new_lines: list[str] = []

    for line in existing_lines:
        stripped = line.strip()
        # Try to match KEY=... or export KEY=...
        m = re.match(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=", stripped)
        if m:
            key = m.group(1)
            if key in updates:
                new_lines.append(f"{key}={updates[key]}\n")
                keys_done.add(key)
                continue
        new_lines.append(line)

    # Append any keys that were not already in the file.
    for key, val in updates.items():
        if key not in keys_done:
            new_lines.append(f"{key}={val}\n")

    env_file.write_text("".join(new_lines), encoding="utf-8")
    logger.info("upsert_env_vars: wrote %s to %s", list(updates.keys()), env_file)


# ---------------------------------------------------------------------------
# Core upgrade function
# ---------------------------------------------------------------------------


def connect_to_cloud(
    db_bootstrap: Session,
    user_jwt: str,
    control_plane_url: str,
    *,
    env_file: Path | None = None,
    local_company_id: str | None = None,
) -> UpgradeResult:
    """Upgrade a local install to hybrid by connecting to the cloud.

    Args:
        db_bootstrap:      Open privileged (superuser/bootstrap) Session.
                           The function operates inside the caller's
                           transaction; on any failure the caller should
                           let the exception propagate so the transaction
                           rolls back automatically.
        user_jwt:          A valid cloud-issued user JWT (from cloud /auth/sign-in).
        control_plane_url: Base URL of the cloud control plane.
        env_file:          Override the .env file path (default: see
                           ``_get_env_file_path()``).
        local_company_id:  Override the local company ID to re-key from.
                           If None, the function queries for the single Company row
                           in the database (expected in local mode).

    Returns:
        UpgradeResult with cloud_company_id, install_token, rows_rekeyed, mode="hybrid".

    Raises:
        AlreadyHybridError: if the current OMILO_MODE is not "local".
        omilo.control.ControlPlaneUnreachable: if registration fails.
        ValueError: if no local Company exists or old==new company_id.
    """
    # -----------------------------------------------------------------------
    # Guard: one-way upgrade — local → hybrid only.
    # -----------------------------------------------------------------------
    settings = get_settings()
    current_mode_raw = getattr(settings, "omilo_mode", "cloud") or "cloud"
    current_mode = _normalize_mode(current_mode_raw)

    if current_mode != "local":
        raise AlreadyHybridError(
            f"connect_to_cloud: current mode is {current_mode!r}; "
            "local → hybrid upgrade only works from mode=local. "
            "hybrid → local is not supported."
        )

    # -----------------------------------------------------------------------
    # Step 1: Find the local company_id (single Company row in local mode).
    # -----------------------------------------------------------------------
    if local_company_id is not None:
        # Explicit override — look up by that ID.
        local_company = db_bootstrap.get(Company, local_company_id)
        if local_company is None:
            raise ValueError(
                f"connect_to_cloud: no Company found with id={local_company_id!r}"
            )
    else:
        companies = db_bootstrap.query(Company).all()
        if not companies:
            raise ValueError(
                "connect_to_cloud: no Company row found in the local database. "
                "The local install must be initialized before connecting to the cloud."
            )
        if len(companies) > 1:
            logger.warning(
                "connect_to_cloud: %d Company rows found; using the first one: %s",
                len(companies), companies[0].id,
            )
        local_company = companies[0]
        local_company_id = local_company.id

    logger.info(
        "connect_to_cloud: local company_id=%s, connecting to %s",
        local_company_id, control_plane_url,
    )

    # -----------------------------------------------------------------------
    # Step 2: Register with the cloud → get cloud company_id + install token.
    # -----------------------------------------------------------------------
    from omilo.control.remote import RemoteControlPlane

    # For registration, no install token yet — pass empty string.
    # register_install authenticates via the user JWT body, not the install token header.
    remote_cp = RemoteControlPlane(
        control_plane_url=control_plane_url,
        install_token="",
    )
    token_info: InstallTokenInfo = remote_cp.register_install(user_jwt)
    cloud_company_id = token_info.company_id
    install_token = token_info.install_token

    logger.info(
        "connect_to_cloud: registered — cloud_company_id=%s", cloud_company_id
    )

    # -----------------------------------------------------------------------
    # Step 3: Re-key all tenant data (atomic — inside caller's transaction).
    # -----------------------------------------------------------------------
    rows_rekeyed = rekey_company(db_bootstrap, local_company_id, cloud_company_id)

    logger.info(
        "connect_to_cloud: re-keyed %d rows from %s to %s",
        rows_rekeyed, local_company_id, cloud_company_id,
    )

    # -----------------------------------------------------------------------
    # Step 4: Retire local User / Member authority.
    #
    # Member rows under the new company_id are deleted — the cloud is now the
    # authoritative identity provider; membership comes from cloud JWTs.
    # User rows have their password_hash set to None so they cannot sign in
    # locally any more (they still exist for referential integrity).
    # -----------------------------------------------------------------------
    db_bootstrap.query(Member).filter_by(company_id=cloud_company_id).delete()
    db_bootstrap.query(User).update({"password_hash": None}, synchronize_session=False)

    logger.info("connect_to_cloud: retired local User/Member authority")

    # -----------------------------------------------------------------------
    # Step 5: Persist hybrid config to the .env file.
    # -----------------------------------------------------------------------
    _target_env_file = env_file if env_file is not None else _get_env_file_path()
    _upsert_env_vars(
        _target_env_file,
        {
            "OMILO_MODE": "hybrid",
            "OMILO_CONTROL_PLANE_URL": control_plane_url,
            "OMILO_INSTALL_TOKEN": install_token,
        },
    )

    logger.info(
        "connect_to_cloud: wrote hybrid config to %s — restart the server to activate",
        _target_env_file,
    )

    return UpgradeResult(
        cloud_company_id=cloud_company_id,
        install_token=install_token,
        rows_rekeyed=rows_rekeyed,
        mode="hybrid",
    )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """CLI entry point for the ``omilo-connect`` console script.

    Reads OMILO_CONTROL_PLANE_URL from settings/env (required).
    Accepts --jwt <token> or OMILO_USER_JWT env var.

    Exits non-zero on any error.
    """
    parser = argparse.ArgumentParser(
        prog="omilo-connect",
        description=(
            "Connect this local install to the Omilo cloud control plane. "
            "Re-keys workspace data to the cloud company ID and switches to hybrid mode."
        ),
    )
    parser.add_argument(
        "--jwt",
        metavar="TOKEN",
        default=os.environ.get("OMILO_USER_JWT", ""),
        help="User JWT from cloud /auth/sign-in (or set OMILO_USER_JWT env var).",
    )
    parser.add_argument(
        "--url",
        metavar="URL",
        default=os.environ.get("OMILO_CONTROL_PLANE_URL", ""),
        help="Cloud control plane URL (or set OMILO_CONTROL_PLANE_URL env var).",
    )
    args = parser.parse_args()

    control_plane_url = args.url
    if not control_plane_url:
        print(
            "ERROR: OMILO_CONTROL_PLANE_URL is not set.\n"
            "Pass --url <url> or set OMILO_CONTROL_PLANE_URL env var.\n"
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

    from omilo.db import SessionLocal

    try:
        with SessionLocal() as session:
            with session.begin():
                result = connect_to_cloud(session, user_jwt, control_plane_url)
    except AlreadyHybridError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: Upgrade failed: {exc}", file=sys.stderr)
        sys.exit(1)

    env_file = _get_env_file_path()
    print(f"Connected to cloud successfully!")
    print(f"  Cloud company ID : {result.cloud_company_id}")
    print(f"  Install token    : {result.install_token}")
    print(f"  Rows re-keyed    : {result.rows_rekeyed}")
    print(f"  New mode         : {result.mode}")
    print()
    print(f"Config written to: {env_file}")
    print("IMPORTANT: Restart the omilo server to activate hybrid mode.")
    print()
    print("Config values set:")
    print(f"  OMILO_MODE=hybrid")
    print(f"  OMILO_CONTROL_PLANE_URL={control_plane_url}")
    print(f"  OMILO_INSTALL_TOKEN={result.install_token}")
