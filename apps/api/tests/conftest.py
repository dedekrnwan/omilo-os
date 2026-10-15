import os
import socket
import tempfile
import threading
import time

import httpx
import pytest

_tmp = tempfile.mkdtemp(prefix="saga-test-")


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


PORT = _free_port()
os.environ.update({
    "SAGA_DATA_DIR": _tmp,
    "SAGA_PUBLIC_URL": f"http://127.0.0.1:{PORT}",
    "SAGA_WORKER_INTERVAL_S": "0.2",
    "SAGA_STRICT_MODE": "false",
})


@pytest.fixture(scope="session")
def base_url():
    import uvicorn

    from saga_api.main import app

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
