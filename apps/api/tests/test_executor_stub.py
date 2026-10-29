"""TDD — Task 7: Executor interface + StubExecutor.

Tests:

1. test_stub_yields_steps_then_one_done
   Run StubExecutor with a spec containing explicit steps.  Collect all events.
   Assert: every event before the last is a ("step", …) event; the last event
   is ("done", …) with ok=True; there is exactly one "done" event total.

2. test_stub_writes_artifact_to_volume
   Run StubExecutor with tmp_path as volume_path.  After iteration, verify the
   artifact file exists at the path returned in the "done" event, and that its
   JSON content contains the job_id.

3. test_volume_persists_across_two_runs
   Run StubExecutor twice with the SAME volume_path (tmp_path).  Verify that
   both artifact files coexist inside the directory — the second run does NOT
   clobber the first.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from omilo.worker.executor import JobContext, StubExecutor


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_ctx(tmp_path: pathlib.Path, job_id: str = "job-001", steps=None) -> JobContext:
    spec: dict = {}
    if steps is not None:
        spec["steps"] = steps
    return JobContext(
        job_id=job_id,
        company_id="co-abc",
        volume_path=str(tmp_path),
        spec=spec,
        secrets={},
    )


async def _collect(ctx: JobContext) -> list:
    executor = StubExecutor()
    events = []
    async for event in executor.run(ctx):
        events.append(event)
    return events


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


async def test_stub_yields_steps_then_one_done(tmp_path):
    """All events before the last must be 'step'; last must be 'done' with ok=True.
    There is exactly one 'done' event.
    """
    steps = ["echo hello", "echo world", "echo done"]
    ctx = _make_ctx(tmp_path, job_id="job-steps", steps=steps)

    events = await _collect(ctx)

    assert len(events) >= 2, "Expected at least one step + one done"

    # All events except the last must be 'step' or 'status'
    for kind, payload in events[:-1]:
        assert kind in ("step", "status"), f"Unexpected event kind before done: {kind!r}"

    # At least one step event must exist
    step_events = [(k, p) for k, p in events if k == "step"]
    assert len(step_events) == len(steps), f"Expected {len(steps)} step events, got {len(step_events)}"

    # The last event is done
    last_kind, last_payload = events[-1]
    assert last_kind == "done", f"Expected last event kind 'done', got {last_kind!r}"
    assert last_payload["ok"] is True

    # Exactly one done event total
    done_events = [(k, p) for k, p in events if k == "done"]
    assert len(done_events) == 1, f"Expected exactly 1 done event, got {len(done_events)}"


async def test_stub_yields_steps_then_one_done_no_spec(tmp_path):
    """When spec has no 'steps' key, StubExecutor uses its own fake steps.
    Contract still holds: N step events then exactly one done.
    """
    ctx = _make_ctx(tmp_path, job_id="job-nospec")
    events = await _collect(ctx)

    # There must be at least one step and one done
    step_events = [(k, p) for k, p in events if k == "step"]
    done_events = [(k, p) for k, p in events if k == "done"]

    assert len(step_events) >= 1, "StubExecutor must produce at least 1 step when spec is empty"
    assert len(done_events) == 1, "Exactly one done event required"

    last_kind, last_payload = events[-1]
    assert last_kind == "done"
    assert last_payload["ok"] is True


async def test_stub_writes_artifact_to_volume(tmp_path):
    """Artifact file must exist at the path in done.artifact; must contain job_id."""
    ctx = _make_ctx(tmp_path, job_id="job-artifact", steps=["step-a"])
    events = await _collect(ctx)

    last_kind, last_payload = events[-1]
    assert last_kind == "done"

    artifact_path = last_payload.get("artifact")
    assert artifact_path is not None, "done payload must include 'artifact'"

    artifact_file = pathlib.Path(artifact_path)
    assert artifact_file.exists(), f"Artifact file does not exist: {artifact_path}"
    assert artifact_file.is_file()

    content = json.loads(artifact_file.read_text())
    assert content.get("job_id") == "job-artifact", "artifact JSON must include job_id"


async def test_volume_persists_across_two_runs(tmp_path):
    """Run the stub twice with the SAME volume_path.

    Both artifacts must coexist — proving volume is the persistence substrate
    and the second run does not clobber the first.
    """
    ctx_a = _make_ctx(tmp_path, job_id="job-run-a", steps=["a"])
    ctx_b = _make_ctx(tmp_path, job_id="job-run-b", steps=["b"])

    events_a = await _collect(ctx_a)
    events_b = await _collect(ctx_b)

    _, done_a = events_a[-1]
    _, done_b = events_b[-1]

    path_a = pathlib.Path(done_a["artifact"])
    path_b = pathlib.Path(done_b["artifact"])

    # Both files exist
    assert path_a.exists(), f"First run artifact missing: {path_a}"
    assert path_b.exists(), f"Second run artifact missing: {path_b}"

    # They are different files inside the same directory
    assert path_a != path_b, "Each run must produce a distinct artifact file"
    assert path_a.parent == path_b.parent == tmp_path, "Both artifacts must live in volume_path"

    # Content is correct per run
    content_a = json.loads(path_a.read_text())
    content_b = json.loads(path_b.read_text())
    assert content_a["job_id"] == "job-run-a"
    assert content_b["job_id"] == "job-run-b"
