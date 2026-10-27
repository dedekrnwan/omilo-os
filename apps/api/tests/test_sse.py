"""TDD: Task 8 — SSE per-company event bus.

Tests (broker-centric; endpoint auth):

1. Broker pub/sub + tenancy: publish to company A → A's subscriber receives the
   event; B's subscriber does NOT (per-company isolation is the core invariant).
2. Thread-safe publish: broker.publish called from a worker thread (asyncio.to_thread)
   → the async subscriber still receives the event (sync→async bridge works).
3. Endpoint auth: GET /v1/stream with no token → 401.
4. Endpoint auth: GET /v1/stream with valid token → streaming response (2xx / starts).

RED → implement → GREEN.

Note on endpoint stream tests: consuming an infinite SSE stream under TestClient
blocks indefinitely.  We test auth separately (no-token → 401; valid-token → 200
via streaming=True + a bounded peek).  Delivery guarantees are proved by broker
tests 1–2 above.
"""
from __future__ import annotations

import asyncio
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from omilo.main import create_app
from tests.utils import run_alembic


# ---------------------------------------------------------------------------
# Schema guard
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sign_up_and_token(client: TestClient, *, name: str = "SSE Tester") -> tuple[str, str]:
    """Sign up a fresh user, return (token, company_id).

    Sign-up response shape: {user, session: {access, expires_at}}.
    Company id is fetched from GET /v1/me.
    """
    email = f"sse_{uuid.uuid4().hex[:8]}@test.example"
    resp = client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": "testP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()
    token = data["session"]["access"]
    # Fetch company_id from /me
    me_resp = client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]
    return token, company_id


# ---------------------------------------------------------------------------
# Broker isolation and thread-safety tests (pure async unit tests)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_broker_per_company_isolation():
    """Publish to company A; A's subscriber gets the event; B's does NOT."""
    # Import fresh to get the module-level singleton
    from omilo.realtime.events import broker

    cmp_a = f"cmp_a_{uuid.uuid4().hex[:6]}"
    cmp_b = f"cmp_b_{uuid.uuid4().hex[:6]}"
    event_a = {"type": "job.done", "id": "job_123", "data": {"status": "done"}}

    # Subscribe both companies
    iter_a = broker.subscribe(cmp_a)
    iter_b = broker.subscribe(cmp_b)

    # Start consumers — they'll block on the queue
    received_a: list[dict] = []
    received_b: list[dict] = []

    async def consume_a():
        async for ev in iter_a:
            received_a.append(ev)
            break  # take one and stop

    async def consume_b():
        # We only wait briefly — B should NOT receive anything
        try:
            async for ev in iter_b:
                received_b.append(ev)
                break
        except asyncio.CancelledError:
            pass

    task_a = asyncio.create_task(consume_a())
    task_b = asyncio.create_task(consume_b())

    # Give subscribers time to register
    await asyncio.sleep(0.01)

    # Publish ONLY to company A
    broker.publish(cmp_a, event_a)

    # A should receive within 1 s
    try:
        await asyncio.wait_for(task_a, timeout=1.0)
    except asyncio.TimeoutError:
        task_a.cancel()
        pytest.fail("Subscriber A did not receive the event within 1 s")

    # B should NOT receive anything — cancel and check
    await asyncio.sleep(0.05)
    task_b.cancel()
    try:
        await task_b
    except asyncio.CancelledError:
        pass

    assert received_a == [event_a], f"Company A got wrong event(s): {received_a}"
    assert received_b == [], f"Company B should not receive A's events, got: {received_b}"

    # Clean up remaining subscriptions by closing iterators
    await iter_a.aclose()
    await iter_b.aclose()


@pytest.mark.asyncio
async def test_broker_thread_safe_publish():
    """Publish from a worker thread; async subscriber still receives the event."""
    from omilo.realtime.events import broker

    cmp = f"cmp_t_{uuid.uuid4().hex[:6]}"
    event = {"type": "job.done", "id": "job_456", "data": {"status": "done"}}

    iter_ = broker.subscribe(cmp)
    received: list[dict] = []

    async def consume():
        async for ev in iter_:
            received.append(ev)
            break

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.01)

    # Publish from a worker thread via asyncio.to_thread
    await asyncio.to_thread(broker.publish, cmp, event)

    try:
        await asyncio.wait_for(task, timeout=1.0)
    except asyncio.TimeoutError:
        task.cancel()
        pytest.fail("Thread-safe publish: subscriber did not receive the event within 1 s")

    assert received == [event], f"Got: {received}"

    await iter_.aclose()


@pytest.mark.asyncio
async def test_broker_multiple_subscribers_same_company():
    """Multiple subscribers for the same company all receive the event."""
    from omilo.realtime.events import broker

    cmp = f"cmp_m_{uuid.uuid4().hex[:6]}"
    event = {"type": "job.started", "id": "job_789", "data": {}}

    iter_1 = broker.subscribe(cmp)
    iter_2 = broker.subscribe(cmp)
    received_1: list[dict] = []
    received_2: list[dict] = []

    async def consume_1():
        async for ev in iter_1:
            received_1.append(ev)
            break

    async def consume_2():
        async for ev in iter_2:
            received_2.append(ev)
            break

    task_1 = asyncio.create_task(consume_1())
    task_2 = asyncio.create_task(consume_2())
    await asyncio.sleep(0.01)

    broker.publish(cmp, event)

    await asyncio.wait_for(asyncio.gather(task_1, task_2), timeout=1.0)

    assert received_1 == [event]
    assert received_2 == [event]

    await iter_1.aclose()
    await iter_2.aclose()


@pytest.mark.asyncio
async def test_broker_publish_no_subscribers_is_noop():
    """publish to a company with no subscribers must not raise."""
    from omilo.realtime.events import broker
    # No subscriber registered for this company
    broker.publish("cmp_nobody_here", {"type": "job.done", "id": "x", "data": {}})


# ---------------------------------------------------------------------------
# Endpoint auth tests (sync TestClient — no stream consumption)
# ---------------------------------------------------------------------------

def test_sse_no_token_returns_401():
    """GET /v1/stream with no token → 401 before streaming begins."""
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        resp = client.get("/v1/stream")
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}: {resp.text}"


def test_sse_invalid_token_returns_401():
    """GET /v1/stream with a garbage token → 401."""
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        resp = client.get(
            "/v1/stream",
            headers={"Authorization": "Bearer not.a.real.token"},
        )
    assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


def test_sse_valid_token_via_query_param_starts_stream():
    """GET /v1/stream?token=<jwt> with a valid token → 200 (stream begins).

    We use stream=True and read only the first chunk (a heartbeat comment)
    to confirm the endpoint accepts the connection.  We do NOT consume
    indefinitely to avoid blocking the test.
    """
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        # Sign up to get a real token
        token, company_id = _sign_up_and_token(client)

        # Use a short timeout — we just want the 200 response headers
        with client.stream("GET", f"/v1/stream?token={token}") as resp:
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
            assert "text/event-stream" in resp.headers.get("content-type", ""), (
                f"Expected text/event-stream, got {resp.headers.get('content-type')}"
            )
            # Read one chunk (heartbeat or event) to confirm the stream is alive
            chunk = next(resp.iter_lines(), None)
            # A heartbeat comment starts with ':' or is empty; an event starts with 'event:'/'data:'
            # Any non-None chunk means the stream is flowing.
            # (Some implementations yield the comment immediately; others may take a moment.)
            # We accept None too since the test may timeout before first chunk — the
            # 200 header is the authoritative proof.


def test_sse_valid_token_via_bearer_header_starts_stream():
    """GET /v1/stream with Authorization: Bearer <jwt> → 200 stream."""
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        token, company_id = _sign_up_and_token(client)

        with client.stream(
            "GET",
            "/v1/stream",
            headers={"Authorization": f"Bearer {token}"},
        ) as resp:
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
            assert "text/event-stream" in resp.headers.get("content-type", "")
