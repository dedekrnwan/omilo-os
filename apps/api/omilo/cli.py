"""CLI entry points."""


def migrate() -> None:
    print("omilo-migrate: not yet implemented")


def seed() -> None:
    """Entry point for the ``omilo-seed`` console script."""
    from omilo.seed.run import main
    main()
