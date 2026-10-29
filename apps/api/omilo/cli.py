"""CLI entry points."""

from pathlib import Path


def migrate() -> None:
    """Entry point for the ``omilo-migrate`` console script.

    Runs ``alembic upgrade head`` against the configured database so a fresh
    checkout (or ``make dev``) applies every migration, including the auth
    tables.  Alembic is driven programmatically with an explicit config path so
    it works regardless of the process's current working directory.
    """
    from alembic import command
    from alembic.config import Config

    api_dir = Path(__file__).resolve().parent.parent  # apps/api
    cfg = Config(str(api_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(api_dir / "migrations"))
    command.upgrade(cfg, "head")


def seed() -> None:
    """Entry point for the ``omilo-seed`` console script."""
    from omilo.seed.run import main
    main()


def index() -> None:
    """Entry point for the ``omilo-index`` console script.

    Parses the omilo-pieces manifests and upserts the GLOBAL Piece catalog
    (connectors + MCP pieces) so a fresh stack (or ``make dev``) has pieces to
    install — without this the marketplace/connectors UI is empty. Idempotent.
    """
    from omilo.db import SessionLocal
    from omilo.marketplace.index import index_pieces

    print("omilo-index: indexing pieces catalog …")
    with SessionLocal() as db:
        with db.begin():
            summary = index_pieces(db)
    print(
        f"  indexed {summary.get('indexed', 0)} "
        f"({summary.get('ok', 0)} ok, {summary.get('invalid', 0)} invalid)"
    )
    for err in summary.get("errors", []):
        print(f"  ! {err}")
