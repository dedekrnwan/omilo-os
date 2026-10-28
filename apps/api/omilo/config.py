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
    knowledge_database_url: str | None = None  # P11a: separate KB store; None → delegates to main DB
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

    # ---------------------------------------------------------------------------
    # Google OAuth (P10) — off by default; enabled when both creds are set.
    # GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET must both be present for any OAuth
    # endpoint to activate (/v1/auth/google/start and /v1/auth/google/callback
    # return 404 when either is absent).
    # ---------------------------------------------------------------------------
    google_client_id: str | None = None
    google_client_secret: str | None = None
    # google_redirect_base: the backend's own public base URL, used to build the
    # OAuth redirect_uri: {google_redirect_base}/v1/auth/google/callback
    google_redirect_base: str = "http://localhost:8000"
    # frontend_base: where web clients are redirected after OAuth completes.
    # e.g. http://localhost:5173 (dev) or https://app.omilo.app (prod).
    frontend_base: str = "http://localhost:5173"

    # ---------------------------------------------------------------------------
    # SMTP / transactional email (control-plane feature).
    #
    # Used by the auth flows that must email the user: email verification,
    # magic-code sign-in, password reset, team invites, two-step codes.
    # Provider-agnostic — point these at any SMTP relay (Resend, SendGrid,
    # Mailgun, Gmail, Postmark, SES, …).  When smtp_host is unset the sender
    # raises a clear 503 instead of silently dropping mail.
    # ---------------------------------------------------------------------------
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    # The From: address.  Falls back to smtp_user when unset.
    smtp_from: str | None = None
    smtp_from_name: str = "Omilo"
    # STARTTLS (587) by default; set false + port 465 for implicit TLS.
    smtp_starttls: bool = True
    smtp_ssl: bool = False


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
