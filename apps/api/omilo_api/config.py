"""Runtime settings. Every value can come from the environment (prefix OMILO_) or a .env file."""
import os
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_data_dir() -> Path:
    return Path(os.environ.get("OMILO_DATA_DIR") or Path.home() / ".omilo")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OMILO_", env_file=".env", extra="ignore")

    data_dir: Path = _default_data_dir()
    # Postgres (with the pgvector extension) holds every company's data, one schema per company; Redis carries live
    # events, locks, shared counters and the knowledge-base queue. `make db` starts both in Docker.
    database_url: str = "postgresql+psycopg://omilo:omilo@127.0.0.1:5432/omilo"
    redis_url: str = "redis://127.0.0.1:6379/0"
    redis_prefix: str = "omilo"  # key prefix, so several installs can share one Redis
    # knowledge base embeddings: local (runs inside Omilo) | voyage | openai | hash (tests, no model). Owners can
    # switch in Settings; the setting there wins over this default.
    embed_provider: str = "local"
    models_dir: str = ""  # where local embedding models are cached (default: <data_dir>/models)
    secret_key: str = ""  # default: generated once and stored in data_dir/secret.key
    public_url: str = "http://localhost:7700"  # how browsers (and agents outside Docker) reach this gateway
    internal_url: str = ""  # how engines reach it from inside the deployment, e.g. http://omilo:7700 (default: public_url)
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

    def piece_mcp_url(self, slug: str) -> str:
        """The MCP endpoint for a piece connector identified by slug."""
        return self.mcp_url() + "/piece/" + slug

    def resolved_database_url(self) -> str:
        url = self.database_url
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]
        if not url.startswith("postgresql+psycopg://"):
            raise RuntimeError("OMILO_DATABASE_URL must be a PostgreSQL address (postgresql://user:pass@host:5432/db). "
                               "Run `make db` to start Postgres and Redis in Docker.")
        return url

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
