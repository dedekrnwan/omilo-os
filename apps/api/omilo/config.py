from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve the repo root — this file lives at <repo>/apps/api/omilo/config.py
_REPO_ROOT = Path(__file__).parent.parent.parent.parent

# Default PIECES_SOURCE: the local omilo-pieces checkout alongside the repo.
_DEFAULT_PIECES_SOURCE = str(_REPO_ROOT / ".." / "omilo-pieces" / "pieces")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://omilo:omilo@localhost:5432/omilo"
    jwt_secret: str = "change-me-in-production"
    jwt_access_ttl_s: int = 3600
    env: str = "development"
    # Path to the omilo-pieces/pieces directory (glob for piece.yaml manifests).
    # Overridable via PIECES_SOURCE env var.
    pieces_source: str = _DEFAULT_PIECES_SOURCE

    # ---------------------------------------------------------------------------
    # Asymmetric JWT signing (RS256) — optional; HS256 used when not set
    # ---------------------------------------------------------------------------
    # OMILO_JWT_PRIVATE_KEY: RSA private key in PEM format (PKCS8).  When set,
    #   make_access_token() signs with RS256 and get_jwks() returns the public JWK.
    # OMILO_JWT_PUBLIC_KEY:  Corresponding RSA public key PEM.  If omitted when
    #   a private key is configured, the public key is derived from the private key.
    omilo_jwt_private_key: str | None = None
    omilo_jwt_public_key: str | None = None

    # ---------------------------------------------------------------------------
    # Run mode (P6 control-plane / runtime split + P6b local mode)
    # ---------------------------------------------------------------------------
    # OMILO_MODE=local   — fully-local, cloud-free, BYO-only self-host (P6b).
    #                      LocalControlPlane (authoritative, in-process).  No
    #                      OMILO_CONTROL_PLANE_URL / OMILO_INSTALL_TOKEN required.
    #                      Pooled cloud inference (litellm) is disabled; BYO keys
    #                      and local models only.  No metering, no credit ledger.
    #                      Air-gap-capable.
    # OMILO_MODE=hybrid  — local runtime (the former "runtime" mode, renamed).
    #                      Auth/billing delegate to the cloud control plane via
    #                      RemoteControlPlane + HTTP.  Requires
    #                      OMILO_CONTROL_PLANE_URL + OMILO_INSTALL_TOKEN.
    # OMILO_MODE=cloud   — control plane mode (default, vendor-hosted).  Auth +
    #                      billing resolve in-process via LocalControlPlane.
    #                      This is the existing production behavior; no code change.
    # OMILO_MODE=runtime — ALIAS for hybrid (accepted for backward compat).
    omilo_mode: str = "cloud"

    # ---------------------------------------------------------------------------
    # Remote control plane (runtime mode — T3)
    # ---------------------------------------------------------------------------
    # OMILO_CONTROL_PLANE_URL: Base URL of the cloud control plane.
    #   Required when OMILO_MODE=runtime.
    #   Example: https://api.omilo.app
    omilo_control_plane_url: str | None = None

    # OMILO_INSTALL_TOKEN: Per-company, revocable install token issued by
    #   POST /control/register during first-run setup.
    #   Required when OMILO_MODE=runtime.
    omilo_install_token: str | None = None

    # ---------------------------------------------------------------------------
    # Payment provider
    # ---------------------------------------------------------------------------
    # Which payment provider to use: "manual" (default, offline), "doit",
    # "stripe", "xendit".
    omilo_payment_provider: str = "manual"

    # ---------------------------------------------------------------------------
    # Product analytics (PostHog) — P7
    # ---------------------------------------------------------------------------
    # POSTHOG_API_KEY: Server-side project key.  Leave empty to disable telemetry
    #   in all modes (the safe default — no events leave the process).
    # POSTHOG_HOST: PostHog ingest endpoint.  Defaults to PostHog Cloud US.
    #   Override to https://eu.i.posthog.com (EU residency) or a self-hosted URL.
    # TELEMETRY_ENABLED: Explicit override.  True → enable even in local mode
    #   (requires POSTHOG_API_KEY).  False → always Noop.  None (default) → auto
    #   by mode + key (local = Noop unless opted in; hybrid/cloud = on when key set).
    posthog_api_key: str = ""
    posthog_host: str = "https://us.i.posthog.com"
    telemetry_enabled: bool | None = None

    # Doit (pay.doit.id) credentials
    doit_api_key: str | None = None
    doit_signing_secret: str | None = None
    doit_base_url: str = "https://pay.doit.id/v1"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
