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


def wait_for(fn, timeout=15.0, every=0.1):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(every)
    raise AssertionError("condition not met in time")
