"""Task 4: pool fallback-then-wait.

When the pool is exhausted, the engine spills to the API key if one exists (in BOTH "auto"
and pure "pool" mode — the pool is non-load-bearing). With no key, it returns
``EngineResult(defer=True)`` and the worker re-queues the task WITHOUT counting an attempt,
capped at ``POOL_WAIT_CAP_S``; once the cap is reached the task fails and surfaces to the inbox.
"""
import asyncio

from sqlalchemy import select

from omilo_api import harness as H
from omilo_api.db import session_scope
from omilo_api.engines import EngineResult
from omilo_api.engines import claude_code as CC
from omilo_api.engines.claude_code import ClaudeCodeEngine
from omilo_api.models import InboxItem, Staff, Task
from omilo_api.worker import Worker


def _cfg(auth: str) -> dict:
    return {"auth": auth, "_mcp_url": "http://127.0.0.1:0/mcp", "_mcp_token": "tok"}


def _emit_sink():
    events: list[tuple] = []
    return events, (lambda kind, **kw: events.append((kind, kw)))


def _drive_run(monkeypatch, tmp_path, auth: str, has_key: bool):
    """Drive the real _run() with an empty pool; stub _run_api to tag that it ran."""
    from omilo_api.config import get_settings

    monkeypatch.setattr(type(get_settings()), "company_dir", tmp_path, raising=False)
    monkeypatch.setattr(H, "find_cli", lambda: "claude")
    monkeypatch.setattr(H, "lease", lambda exclude=None: None)
    monkeypatch.setattr(CC, "api_key", (lambda: "sk-ant-key") if has_key else (lambda: None))

    called: dict = {}

    async def fake_api(self, *a, **k):
        called["path"] = "api"
        return CC.EngineResult(text="api-ran")

    monkeypatch.setattr(ClaudeCodeEngine, "_run_api", fake_api)

    _, emit = _emit_sink()
    e = ClaudeCodeEngine()
    res = asyncio.run(e._run("staff-1", _cfg(auth), "SYSTEM", "prompt", None, emit, 30, lambda s: None, None))
    return called, res


def test_auto_and_pool_spill_to_api_when_pool_empty_and_key_present(monkeypatch, tmp_path):
    """An empty pool + a key present spills to _run_api in BOTH pure pool mode and auto mode."""
    called, res = _drive_run(monkeypatch, tmp_path, auth="pool", has_key=True)
    assert called.get("path") == "api", f"pure pool mode must spill to the API key: {called}"
    assert res.text == "api-ran", res

    called, res = _drive_run(monkeypatch, tmp_path, auth="auto", has_key=True)
    assert called.get("path") == "api", f"auto mode must spill to the API key: {called}"
    assert res.text == "api-ran", res


def _make_task(attempts: int) -> tuple[str, int]:
    """Create a queued Task owned by a fresh Staff; return (task_id, pre_dispatch_attempts)."""
    sid = "pw-staff"
    with session_scope() as db:
        if db.get(Staff, sid) is None:
            db.add(Staff(id=sid, name="Pool Wait", engine={"type": "claude-code", "auth": "pool"}))
        t = Task(staff_id=sid, origin="manual", brief="waiting on the pool", status="queued", attempts=attempts)
        db.add(t)
        db.commit()
        return t.id, attempts


def test_pool_defer_does_not_consume_attempt(owner, monkeypatch, tmp_path):
    # engine side: empty pool + no key -> defer
    called, res = _drive_run(monkeypatch, tmp_path, auth="pool", has_key=False)
    assert called.get("path") is None, f"no API spill without a key: {called}"
    assert res.defer is True, f"expected defer=True, got {res}"
    assert res.error, "defer still carries the user-facing error text"

    # worker side: a task that already consumed a dispatch-time attempt increment
    pre = 1
    task_id, _ = _make_task(attempts=pre)
    with session_scope() as db:  # mimic dispatch_tasks: status->running, attempts+1
        t = db.get(Task, task_id)
        t.status, t.attempts = "running", t.attempts + 1
        db.commit()

    w = Worker()
    w._finish(task_id, EngineResult(defer=True, error="No Claude Code account is free right now..."), {})

    with session_scope() as db:
        t = db.get(Task, task_id)
        assert t.status == "queued", f"a deferred task goes back to queued, not failed: {t.status}"
        assert t.attempts == pre, f"the dispatch-time increment must be undone: {t.attempts} != {pre}"
    import time as _t

    assert w.retry_at[task_id] > _t.monotonic(), "retry_at must be in the future (backoff)"
    assert task_id in w._deferred_since, "the capacity-wait clock must be started"


def test_pool_defer_surfaces_after_cap(owner, monkeypatch):
    import time as _t

    task_id, _ = _make_task(attempts=0)
    with session_scope() as db:
        t = db.get(Task, task_id)
        t.status, t.attempts = "running", t.attempts + 1
        db.commit()

    w = Worker()
    # pre-seed the wait clock to older than the cap
    w._deferred_since[task_id] = _t.monotonic() - (H.POOL_WAIT_CAP_S + 1)
    w._finish(task_id, EngineResult(defer=True, error="No Claude Code account is free right now..."), {})

    with session_scope() as db:
        t = db.get(Task, task_id)
        assert t.status == "failed", f"after the cap the task surfaces as failed: {t.status}"
        items = db.scalars(select(InboxItem).where(InboxItem.task_id == task_id)).all()
        assert items, "an InboxItem must surface the stuck job to the owner"
    assert task_id not in w._deferred_since, "the wait clock is cleared once surfaced"
