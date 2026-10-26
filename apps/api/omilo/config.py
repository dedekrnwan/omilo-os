from pydantic_settings import BaseSettings, SettingsConfigDict


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


def get_settings() -> Settings:
    return Settings()
