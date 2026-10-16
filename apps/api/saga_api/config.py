"""Runtime settings. Every value can come from the environment (prefix SAGA_) or a .env file."""
import os
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_data_dir() -> Path:
    return Path(os.environ.get("SAGA_DATA_DIR") or Path.home() / ".saga-os")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SAGA_", env_file=".env", extra="ignore")

    data_dir: Path = _default_data_dir()
    database_url: str = ""  # default: sqlite file in data_dir
    secret_key: str = ""  # default: generated once and stored in data_dir/secret.key
    public_url: str = "http://localhost:7700"  # how browsers (and agents outside Docker) reach this gateway
    internal_url: str = ""  # how engines reach it from inside the deployment, e.g. http://saga-os:7700 (default: public_url)
    base_path: str = ""  # e.g. "/os" when served under a path prefix
    timezone: str = "UTC"

    embedded_worker: bool = True  # run the worker inside the API process (laptop mode)
    worker_interval_s: float = 3.0
    max_concurrent_tasks: int = 3  # how many agents may work at the same time
    task_timeout_s: int = 30 * 60
    strict_mode: bool = True  # new installs: every external action needs approval

    cookie_secure: bool = False
    session_days: int = 14
    cors_origins: str = ""  # comma-separated, for a web app served from another origin

    def mcp_url(self) -> str:
        """The MCP endpoint helpers of the current company call (other companies get a /co/<id> prefix)."""
        from .company import prefix

        return (self.internal_url or self.public_url).rstrip("/") + self.base_path.rstrip("/") + prefix() + "/mcp"

    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{self.data_dir / 'saga.db'}"

    def resolved_secret(self) -> str:
        if self.secret_key:
            return self.secret_key
        self.data_dir.mkdir(parents=True, exist_ok=True)
        f = self.data_dir / "secret.key"
        if not f.exists():
            f.write_text(secrets.token_urlsafe(48))
            f.chmod(0o600)
        return f.read_text().strip()

    @property
    def company_dir(self) -> Path:
        """Where the current company keeps its files (the data dir itself for the first company)."""
        from .company import dir_for

        return dir_for()

    @property
    def knowledge_dir(self) -> Path:
        d = self.company_dir / "knowledge"
        d.mkdir(parents=True, exist_ok=True)
        return d


@lru_cache
def get_settings() -> Settings:
    return Settings()
