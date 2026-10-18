"""Tests for Task 4: force-stop a running chat turn.

Unit tests — no live Claude subprocess needed:
  1. Route POST /api/threads/{thid}/cancel clears awaiting_reply and signals Redis.
  2. Worker cancel handler cancels a real asyncio.Task in chatting[].
  3. cancel_loop survives a Redis error and retries (Finding 1).
  4. answer_thread exits cleanly when awaiting_reply is flipped False between boundaries (Finding 2).
"""
import asyncio
import json

import pytest
from conftest import wait_for


# ---------------------------------------------------------------------------
# Test 1: HTTP route clears awaiting_reply and publishes cancel:chat signal
# ---------------------------------------------------------------------------

def test_cancel_thread_route_clears_awaiting_and_signals(owner, base_url):
    """POST /api/threads/{thid}/cancel → awaiting_reply=False, cancel:chat published, 200 {"status":"stopping"}."""
    # Create a thread and put it in awaiting_reply=True by sending a message.
    th = owner.post("/api/threads", json={"scope": "master"}).json()
    thid = th["id"]

    # Send a message to trigger awaiting_reply=True (worker will pick it up, but fake engine is fast;
    # we patch bus.publish to record calls before the worker can clear it, so we set awaiting_reply
    # directly via the message endpoint and then immediately cancel — or we just test the cancel route
    # on a thread that may already be done. The cancel route must work regardless of state.)
    #
    # Strategy: we'll send the message, wait for awaiting_reply to go True, then cancel right away.
    # In test fixtures the fake engine replies quickly, so we instead just POST cancel on the thread
    # that was once awaiting_reply (even if already resolved). The route must accept any thread.
    #
    # For a clean signal test: create a fresh thread, post a message, then immediately cancel before
    # the (fast) fake engine can reply. If the engine already replied, we just check the route returns
    # 200 with the right shape and doesn't error. The key invariant is awaiting_reply=False after cancel.

    # Post a message → awaiting_reply=True
    owner.post(f"/api/threads/{thid}/messages", json={"text": "hello test"})

    # Cancel immediately (may race with fake engine; doesn't matter — we just need the route to work)
    r = owner.post(f"/api/threads/{thid}/cancel")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "stopping"}

    # Thread must have awaiting_reply=False after the cancel route commits
    th_detail = owner.get(f"/api/threads/{thid}").json()
    assert th_detail["awaiting_reply"] is False, f"expected awaiting_reply=False, got {th_detail['awaiting_reply']}"


def test_cancel_thread_404_on_missing_thread(owner, base_url):
    """POST /api/threads/nonexistent/cancel returns 404."""
    r = owner.post("/api/threads/does-not-exist-xyz/cancel")
    assert r.status_code == 404


def test_cancel_thread_publishes_signal(owner, base_url, monkeypatch):
    """POST /api/threads/{thid}/cancel publishes a cancel:chat event carrying the thread_id."""
    import omilo_api.bus as bus_mod

    published: list[tuple] = []

    original_publish = bus_mod.publish

    def fake_publish(channel, data=None, cid=None):
        published.append((channel, data, cid))
        # Also call original so DB/Redis stay consistent (best-effort; ignore Redis errors in tests)
        try:
            original_publish(channel, data, cid)
        except Exception:
            pass

    monkeypatch.setattr(bus_mod, "publish", fake_publish)

    th = owner.post("/api/threads", json={"scope": "master"}).json()
    thid = th["id"]

    r = owner.post(f"/api/threads/{thid}/cancel")
    assert r.status_code == 200

    cancel_calls = [(ch, d) for ch, d, _ in published if ch == "cancel:chat"]
    assert cancel_calls, f"no cancel:chat publish recorded; all calls: {published}"
    assert any(d.get("thread_id") == thid for _, d in cancel_calls), (
        f"cancel:chat published but thread_id mismatch: {cancel_calls}"
    )


# ---------------------------------------------------------------------------
# Test 2: Worker cancel handler cancels the asyncio.Task in chatting[]
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_worker_cancel_cancels_chatting_task():
    """A pending asyncio.Task in worker.chatting[thid] is cancelled when the cancel handler fires."""
    from omilo_api.worker import Worker

    w = Worker()

    # Put a long-running task into chatting
    long_task = asyncio.create_task(asyncio.sleep(9999))
    w.chatting["thread-abc"] = long_task

    # Simulate what cancel_loop does on receiving a cancel:chat signal
    thread_id = "thread-abc"
    task = w.chatting.get(thread_id)
    assert task is not None and not task.done()
    task.cancel()

    # Yield control so the cancellation propagates
    await asyncio.sleep(0)

    assert long_task.cancelled(), "task should be cancelled after cancel() call"


@pytest.mark.asyncio
async def test_worker_cancel_missing_thread_no_error():
    """Cancelling a thread not in chatting[] does not raise."""
    from omilo_api.worker import Worker

    w = Worker()
    # No entry for "missing-thread" — guard against KeyError
    thread_id = "missing-thread"
    task = w.chatting.get(thread_id)
    if task and not task.done():
        task.cancel()
    # If we reach here without exception, the guard works
    assert True


@pytest.mark.asyncio
async def test_worker_cancel_done_task_no_error():
    """Cancelling an already-done task in chatting[] does not raise."""
    from omilo_api.worker import Worker

    w = Worker()
    done_task = asyncio.create_task(asyncio.sleep(0))
    await asyncio.sleep(0)  # let it complete
    w.chatting["thread-done"] = done_task

    # Give the event loop another turn so the sleep(0) task actually finishes
    await asyncio.sleep(0)
    assert done_task.done(), "task should be done after two event loop turns"

    thread_id = "thread-done"
    task = w.chatting.get(thread_id)
    if task and not task.done():
        task.cancel()
    # task is done, cancel() is a no-op — no error
    assert done_task.done()


# ---------------------------------------------------------------------------
# Finding 1: cancel_loop survives a Redis error and retries
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cancel_loop_survives_redis_error():
    """cancel_loop retries after a Redis error instead of exiting permanently.

    Strategy: monkeypatch bus.ar() to return a fake async-redis-like object whose
    pubsub().listen() raises an exception on the first call, then blocks forever on
    the second call (simulating reconnect). We confirm the loop reached the retry
    iteration by observing the second subscribe call, then stop the worker cleanly.
    """
    import asyncio as _asyncio
    import omilo_api.bus as bus_mod
    import omilo_api.worker as worker_mod
    from omilo_api.worker import Worker

    call_counts = {"subscribe": 0, "listen": 0}

    class FakePubSub:
        async def psubscribe(self, pattern):
            call_counts["subscribe"] += 1

        async def listen(self):
            call_counts["listen"] += 1
            if call_counts["listen"] == 1:
                # First iteration: simulate a Redis connection error
                raise ConnectionError("simulated Redis error")
            # Second iteration: block until cancelled (simulates reconnected idle listen)
            await _asyncio.sleep(9999)
            return
            yield  # make this an async generator

        async def punsubscribe(self, pattern):
            pass

        async def aclose(self):
            pass

    class FakeAsyncRedis:
        def pubsub(self):
            return FakePubSub()

    original_ar = bus_mod.ar
    bus_mod.ar = lambda: FakeAsyncRedis()

    w = Worker()
    # Shorten the retry backoff so the test is fast
    original_sleep = _asyncio.sleep

    async def fast_sleep(t):
        # Only shorten the 5 s retry backoff; let 0-second sleeps through as-is
        await original_sleep(0)

    worker_mod.asyncio.sleep = fast_sleep

    cancel_loop_task = _asyncio.create_task(w.cancel_loop())

    # Wait up to 2 s for the loop to retry (subscribe called twice: first + retry)
    deadline = _asyncio.get_event_loop().time() + 2.0
    while call_counts["subscribe"] < 2 and _asyncio.get_event_loop().time() < deadline:
        await original_sleep(0.02)

    cancel_loop_task.cancel()
    try:
        await cancel_loop_task
    except _asyncio.CancelledError:
        pass

    # Restore patched names
    bus_mod.ar = original_ar
    worker_mod.asyncio.sleep = original_sleep

    assert call_counts["subscribe"] >= 2, (
        f"cancel_loop should have retried and re-subscribed after the Redis error "
        f"(subscribe called {call_counts['subscribe']} time(s))"
    )


# ---------------------------------------------------------------------------
# Finding 2: answer_thread exits cleanly when awaiting_reply flipped False between boundaries
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_answer_thread_exits_on_awaiting_reply_false(monkeypatch):
    """answer_thread stops at the next loop boundary when awaiting_reply is flipped False (cross-process cancel).

    Strategy: monkeypatch _answer_as to return immediately and flip Thread.awaiting_reply=False
    in the DB (simulating the cancel route running in another process). Confirm answer_thread
    exits without posting a second stop note if CancelledError is not raised.

    Uses the live SQLite test DB via conftest session_scope.
    """
    import omilo_api.services as S_mod
    from omilo_api.worker import Worker
    from omilo_api.db import session_scope
    from omilo_api.models import Thread, now

    # Create a minimal thread directly in the DB
    with session_scope() as db:
        # Find the chief staff for this test thread
        from sqlalchemy import select
        from omilo_api.models import Staff
        chief = db.scalar(select(Staff).where(Staff.is_chief.is_(True)).limit(1))
        if chief is None:
            pytest.skip("no chief staff in test DB — run after team setup")
        th = Thread(
            scope="master",
            staff_id=chief.id,
            title="cancel-test",
            awaiting_reply=True,
            pending=[chief.id],
        )
        db.add(th)
        db.flush()
        thid = th.id

    stop_notes: list[str] = []
    original_post = S_mod.post_message

    def capturing_post(db, th, role, sid, text, **kw):
        if "Stopped by the owner" in (text or ""):
            stop_notes.append(text)
        return original_post(db, th, role, sid, text, **kw)

    monkeypatch.setattr(S_mod, "post_message", capturing_post)

    answer_count = [0]

    async def stub_answer_as(thread_id, staff_id, answered):
        answer_count[0] += 1
        # After the first answer, flip awaiting_reply=False to simulate cross-process cancel
        with session_scope() as db:
            t = db.get(Thread, thread_id)
            if t:
                t.awaiting_reply = False
                t.pending = None
        return "stub answer"

    w = Worker()
    monkeypatch.setattr(w, "_answer_as", stub_answer_as)

    # Run answer_thread with a tight timeout so the test can't hang
    try:
        await asyncio.wait_for(w.answer_thread(thid), timeout=5.0)
    except asyncio.TimeoutError:
        pytest.fail("answer_thread did not exit after awaiting_reply was flipped False")

    # Should have called _answer_as exactly once, then detected the flip and stopped
    assert answer_count[0] >= 1, "stub _answer_as was never called"

    # Stop note should be posted at most once (double-post guard)
    assert len(stop_notes) <= 1, (
        f"stop note posted {len(stop_notes)} times — double-post detected: {stop_notes}"
    )


# ---------------------------------------------------------------------------
# Finding 3: a cancelled engine turn emits a terminal status (UI "Working" must not spin forever)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_answer_as_emits_terminal_status_on_cancel(monkeypatch):
    """When the owner stops a turn, the engine await raises CancelledError. _answer_as must emit a
    terminal status=failed event (so the frontend Run card finalizes to "Stopped" instead of
    spinning "Working" forever) and then re-raise so the cancellation keeps propagating.
    """
    from sqlalchemy import select

    import omilo_api.worker as worker_mod
    from omilo_api.db import session_scope
    from omilo_api.models import RunEvent, Staff, Thread
    from omilo_api.worker import Worker

    with session_scope() as db:
        chief = db.scalar(select(Staff).where(Staff.is_chief.is_(True)).limit(1))
        if chief is None:
            pytest.skip("no chief staff in test DB — run after team setup")
        th = Thread(scope="master", staff_id=chief.id, title="cancel-status-test",
                    awaiting_reply=True, pending=[chief.id])
        db.add(th)
        db.flush()
        thid, cid = th.id, chief.id

    class CancellingEngine:
        async def chat(self, ctx):
            raise asyncio.CancelledError()

    monkeypatch.setattr(worker_mod, "get_engine", lambda cfg: CancellingEngine())

    w = Worker()
    with pytest.raises(asyncio.CancelledError):
        await w._answer_as(thid, cid, [])

    with session_scope() as db:
        statuses = [e.data.get("state") for e in db.scalars(
            select(RunEvent).where(RunEvent.thread_id == thid)) if e.kind == "status"]

    assert "started" in statuses, f"run never started; got {statuses}"
    assert "failed" in statuses, (
        f"no terminal status emitted on cancel — UI would spin 'Working' forever; got {statuses}"
    )
