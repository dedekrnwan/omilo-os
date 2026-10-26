"""Alembic env.py — wired to omilo.db.Base.metadata and Settings.database_url."""
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Alembic Config object (access .ini values via this).
config = context.config

# Set up logging from the ini file.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ---------------------------------------------------------------------------
# Wire to the project's declarative Base and Settings
# ---------------------------------------------------------------------------
from omilo.config import get_settings  # noqa: E402
from omilo.db import Base  # noqa: E402  — also registers all models that import it
import omilo.models  # noqa: F401, E402  — registers all ORM models onto Base.metadata

target_metadata = Base.metadata

# Override the sqlalchemy.url from Settings so that .ini placeholder is not used.
settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.database_url)


# ---------------------------------------------------------------------------
# Migration runners
# ---------------------------------------------------------------------------

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (no live DB connection needed)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode (connects to the live DB)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
