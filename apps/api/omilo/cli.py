"""CLI entry points."""

import asyncio
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


def worker() -> None:
    """Entry point for the ``omilo-worker`` console script.

    Reads configuration from environment variables (with optional overrides via
    CLI flags) and runs a :class:`~omilo.worker.runtime.WorkerRuntime` that
    dials the compute relay, registers, and processes jobs indefinitely.

    Environment variables
    ---------------------
    OMILO_RELAY_URL   WebSocket URL of the cloud relay (required).
    OMILO_TOKEN       Worker authentication token (required).
    OMILO_COMPANY_ID  Tenant identifier (required).
    OMILO_WORKER_ID   Persistent worker identifier (required).
    OMILO_CAPACITY    Max concurrent jobs (optional, default 1).
    """
    import argparse
    import os
    import sys

    parser = argparse.ArgumentParser(
        prog="omilo-worker",
        description="Run an Omilo compute worker that connects to the relay.",
    )
    parser.add_argument(
        "--relay-url",
        default=os.environ.get("OMILO_RELAY_URL", ""),
        help="WebSocket URL of the relay (env: OMILO_RELAY_URL).",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("OMILO_TOKEN", ""),
        help="Worker auth token (env: OMILO_TOKEN).",
    )
    parser.add_argument(
        "--company-id",
        default=os.environ.get("OMILO_COMPANY_ID", ""),
        help="Company/tenant identifier (env: OMILO_COMPANY_ID).",
    )
    parser.add_argument(
        "--worker-id",
        default=os.environ.get("OMILO_WORKER_ID", ""),
        help="Worker identifier from pairing (env: OMILO_WORKER_ID).",
    )
    parser.add_argument(
        "--capacity",
        type=int,
        default=int(os.environ.get("OMILO_CAPACITY", "1")),
        help="Max concurrent jobs (env: OMILO_CAPACITY, default 1).",
    )
    args = parser.parse_args()

    missing = [
        name
        for name, val in [
            ("--relay-url / OMILO_RELAY_URL", args.relay_url),
            ("--token / OMILO_TOKEN", args.token),
            ("--company-id / OMILO_COMPANY_ID", args.company_id),
            ("--worker-id / OMILO_WORKER_ID", args.worker_id),
        ]
        if not val
    ]
    if missing:
        print(
            "omilo-worker: missing required configuration:\n  "
            + "\n  ".join(missing),
            file=sys.stderr,
        )
        sys.exit(1)

    from omilo.worker.runtime import WorkerRuntime

    runtime = WorkerRuntime(
        relay_url=args.relay_url,
        token=args.token,
        company_id=args.company_id,
        worker_id=args.worker_id,
        capacity=args.capacity,
    )

    print(
        f"omilo-worker: starting (relay={args.relay_url}, "
        f"worker_id={args.worker_id}, company={args.company_id}, "
        f"capacity={args.capacity})"
    )
    try:
        asyncio.run(runtime.run())
    except KeyboardInterrupt:
        print("\nomilo-worker: interrupted, shutting down.")
