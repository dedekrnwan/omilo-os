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
    # Run mode (P6 control-plane / runtime split)
    # ---------------------------------------------------------------------------
    # OMILO_MODE=cloud   — control plane mode (default).  Auth + billing resolve
    #                      in-process via LocalControlPlane.  This is the existing
    #                      production behavior; no code changes in cloud mode.
    # OMILO_MODE=runtime — local runtime mode (T3).  Auth/billing delegate to the
    #                      cloud control plane via RemoteControlPlane + HTTP.
    omilo_mode: str = "cloud"

    # ---------------------------------------------------------------------------
    # Payment provider
    # ---------------------------------------------------------------------------
    # Which payment provider to use: "manual" (default, offline), "doit",
    # "stripe", "xendit".
    omilo_payment_provider: str = "manual"

    # Doit (pay.doit.id) credentials
    doit_api_key: str | None = None
    doit_signing_secret: str | None = None
    doit_base_url: str = "https://pay.doit.id/v1"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
