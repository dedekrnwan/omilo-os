import os
import socket
import tempfile
import threading
import time

import httpx
import pytest

_tmp = tempfile.mkdtemp(prefix="omilo-test-")


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


PORT = _free_port()
# Postgres (with pgvector) and Redis are required: `make db` starts both. Tests use their own database and key prefix.
DB_URL = os.environ.get("OMILO_TEST_DATABASE_URL", "postgresql+psycopg://omilo:omilo@127.0.0.1:5432/omilo_test")
REDIS_URL = os.environ.get("OMILO_TEST_REDIS_URL", "redis://127.0.0.1:6379/15")


def _fresh_database() -> None:
    import sqlalchemy as sa

    eng = sa.create_engine(DB_URL, poolclass=sa.pool.NullPool)
    with eng.begin() as c:
        for (name,) in c.exec_driver_sql("SELECT nspname FROM pg_namespace WHERE left(nspname, 3) = 'co_'").all():
            c.exec_driver_sql(f'DROP SCHEMA "{name}" CASCADE')
    eng.dispose()


_fresh_database()
os.environ.update({
    "OMILO_DATABASE_URL": DB_URL,
    "OMILO_REDIS_URL": REDIS_URL,
    "OMILO_REDIS_PREFIX": "omilotest-" + os.urandom(4).hex(),
    "OMILO_EMBED_PROVIDER": "hash",
    "OMILO_DATA_DIR": _tmp,
    "OMILO_PUBLIC_URL": f"http://127.0.0.1:{PORT}",
    "OMILO_WORKER_INTERVAL_S": "0.2",
    "OMILO_STRICT_MODE": "false",
})


@pytest.fixture(scope="session")
def base_url():
    import uvicorn

    from omilo_api.main import app

    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="warning"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    for _ in range(100):
        try:
            if httpx.get(f"http://127.0.0.1:{PORT}/healthz").status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.05)
    yield f"http://127.0.0.1:{PORT}"
    server.should_exit = True
    th.join(timeout=5)


def _seed_owner(c: "httpx.Client") -> None:
    """(Re)establish the signed-in owner + Small team on the shared MAIN company.

    Idempotent: /api/setup/owner returns 200 when the owner is absent (e.g. a test
    dropped and recreated co_main) and 409 when it already exists; both are fine.
    """
    c.post("/api/setup/owner", json={"email": "owner@example.com", "password": "correct-horse-1", "company_name": "Acme"})
    tok = c.post("/api/auth/login", json={"email": "owner@example.com", "password": "correct-horse-1", "token_name": "tests"}).json()["token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    c.post("/api/onboarding/company", json={"company_name": "Acme", "files": {"company.md": "# Acme\n\nWe sell anvils to coyotes."}})
    team = c.post("/api/team/apply", json={"preset": "small", "engine": {"type": "fake"}}).json()
    c.mcp_tokens = team.get("mcp_tokens")


@pytest.fixture(scope="session")
def owner(base_url):
    """A signed-in API client (bearer token, like the CLI) with the Small team on the fake engine."""
    c = httpx.Client(base_url=base_url, timeout=20)
    r = c.post("/api/setup/owner", json={"email": "owner@example.com", "password": "correct-horse-1", "company_name": "Acme"})
    assert r.status_code == 200, r.text
    tok = c.post("/api/auth/login", json={"email": "owner@example.com", "password": "correct-horse-1", "token_name": "tests"}).json()["token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    c.post("/api/onboarding/company", json={"company_name": "Acme", "files": {"company.md": "# Acme\n\nWe sell anvils to coyotes."}})
    team = c.post("/api/team/apply", json={"preset": "small", "engine": {"type": "fake"}}).json()
    c.mcp_tokens = team["mcp_tokens"]
    return c


@pytest.fixture(autouse=True)
def _heal_owner_token(request):
    """Self-heal the shared owner session between tests.

    Some tests (e.g. test_migrate's light_env) legitimately DROP the co_main schema,
    which destroys the owner's AuthToken and cascades 401 "invalid token" into every
    later test that uses the session-scoped `owner` client. Before each test that uses
    `owner`, verify the token still works and re-establish it (cheap re-login, or a full
    re-seed if the owner itself is gone) so one isolation-breaking test can't poison the
    rest of the suite. No-op for tests that don't use `owner`.
    """
    if "owner" not in request.fixturenames:
        yield
        return
    c = request.getfixturevalue("owner")
    try:
        if c.get("/api/auth/me").status_code != 200:
            r = c.post("/api/auth/login", json={"email": "owner@example.com", "password": "correct-horse-1", "token_name": "tests"})
            if r.status_code == 200:
                c.headers["Authorization"] = f"Bearer {r.json()['token']}"
            else:
                _seed_owner(c)
    except Exception:  # noqa: BLE001 - healing must never break collection
        pass
    yield


def wait_for(fn, timeout=15.0, every=0.1):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(every)
    raise AssertionError("condition not met in time")


def cleanup_main_company_non_terminal_tasks(staff_id_prefix: str) -> None:
    """Delete non-terminal Task rows (and their synthetic Staff/Thread/InboxItem rows)
    whose staff_id starts with *staff_id_prefix* from the shared MAIN company.

    Called at module teardown by autouse fixtures in test_worklog, test_board,
    test_orchestration, and test_creation to prevent slot saturation in the shared
    worker that later causes test_harness dispatch timeouts.

    Only deletes rows created by the feature-test modules (identified by prefix) so
    we never interfere with tasks that test_harness / test_pool_wait are waiting on.
    """
    from sqlalchemy import delete, select

    from omilo_api.db import session_scope
    from omilo_api.models import InboxItem, Staff, Task, Thread

    NON_TERMINAL = ("queued", "running", "waiting")

    with session_scope() as db:
        # Find all staff rows whose id starts with the given prefix
        staff_ids = list(db.scalars(
            select(Staff.id).where(Staff.id.like(staff_id_prefix + "%"))
        ))
        if not staff_ids:
            return

        # Delete non-terminal tasks for these staff
        db.execute(
            delete(Task).where(
                Task.staff_id.in_(staff_ids),
                Task.status.in_(NON_TERMINAL),
            )
        )

        # Also delete any awaiting-reply threads (live work) these staff left open
        db.execute(
            delete(Thread).where(
                Thread.staff_id.in_(staff_ids),
                Thread.awaiting_reply.is_(True),
            )
        )

        # Delete any open InboxItems for these staff
        db.execute(
            delete(InboxItem).where(
                InboxItem.staff_id.in_(staff_ids),
                InboxItem.status == "open",
            )
        )

        db.commit()
