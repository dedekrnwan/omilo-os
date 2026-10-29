"""omilo.worker.executor — Executor interface and StubExecutor.

Overview
--------
This module defines the *seam* between the compute control-plane (Plan #1)
and any concrete harness implementation (Plan #2: GvisorExecutor).

Public types
~~~~~~~~~~~~
JobContext
    Input context carried from the control-plane dispatch layer to the
    executor.  Immutable after construction.

ExecEvent
    A 2-tuple ``(kind, payload)`` where ``kind`` is one of:
    * ``"status"``  — informational progress update (zero or more per run)
    * ``"step"``    — one line of harness output (zero or more per run)
    * ``"done"``    — terminal event; **exactly one** per run, always last

Executor
    Abstract base class.  Subclasses implement ``run(ctx)`` as an async
    generator that yields ``ExecEvent`` values.

    **Contract (Plan #2 depends on this):**

    1. ``run`` is an async generator — callers iterate with ``async for``.
    2. Zero or more ``("status", …)`` / ``("step", …)`` events may appear in
       any order before the terminal event.
    3. The generator MUST end with **exactly one** ``("done", payload)`` event
       where ``payload`` satisfies::

           {
               "ok":      bool,           # True = success, False = failure
               "result":  dict,           # arbitrary harness-defined output
               "artifact": str | None,    # abs path to output file, or None
           }
    4. No event may follow the ``"done"`` event.
    5. Callers MUST NOT assume any particular order of ``"step"`` events
       relative to ``"status"`` events.

StubExecutor
    A local, no-sandbox implementation for development and CI.  It:
    * Reads ``ctx.spec["steps"]`` (list of strings); if absent, two synthetic
      steps are used so callers always receive at least one step event.
    * Yields each step as ``("step", {"seq": i, "stream": "stdout",
      "line": <text>})``.
    * Creates ``ctx.volume_path`` on disk if it does not already exist.
    * Writes ``artifact-<job_id>.json`` into ``ctx.volume_path``.
    * Yields a final ``("done", {"ok": True, "result": {…},
      "artifact": <abs_path>})`` event.

    The volume directory is intentionally NOT cleared between runs — callers
    may run multiple jobs against the same volume to simulate persistence
    (e.g. incremental coding sessions).
"""
from __future__ import annotations

import json
import pathlib
from dataclasses import dataclass, field
from typing import AsyncIterator

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class JobContext:
    """Input context for a single compute job execution.

    Attributes
    ----------
    job_id:
        Globally unique identifier for this job (e.g. ``"job_abc123"``).
    company_id:
        The tenant/company that owns this job.
    volume_path:
        Absolute path to the per-company persistent volume directory.
        Executors are responsible for creating it if it does not exist.
    spec:
        Free-form job specification dict.  Concrete executors interpret this;
        the control-plane treats it as opaque.
    secrets:
        Key/value map of runtime secrets (e.g. API keys).  Never logged.
    """

    job_id: str
    company_id: str
    volume_path: str
    spec: dict = field(default_factory=dict)
    secrets: dict = field(default_factory=dict)


# ExecEvent is a discriminated 2-tuple.  Using a type alias rather than a
# class keeps it lightweight and avoids ABC coupling in Plan #2.
type ExecEvent = tuple[str, dict]


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class Executor:
    """Abstract base class for compute harness executors.

    Subclasses implement ``run`` as an **async generator** that yields
    :data:`ExecEvent` tuples.

    See module docstring for the full ``run`` contract.
    """

    async def run(self, ctx: JobContext) -> AsyncIterator[ExecEvent]:  # type: ignore[override]
        """Execute the job described by *ctx* and stream events to the caller.

        Parameters
        ----------
        ctx:
            Job context; see :class:`JobContext`.

        Yields
        ------
        ExecEvent
            A ``("status" | "step", dict)`` event for progress, followed by
            exactly one ``("done", {"ok": bool, "result": dict,
            "artifact": str | None})`` terminal event.

        Notes
        -----
        The base implementation raises :exc:`NotImplementedError`.  Subclasses
        (including Plan #2's ``GvisorExecutor``) MUST override this method and
        honour the contract above.
        """
        raise NotImplementedError  # pragma: no cover
        # Make this a valid async generator in the type system.
        yield  # type: ignore[misc]


# ---------------------------------------------------------------------------
# StubExecutor
# ---------------------------------------------------------------------------

_FALLBACK_STEPS = [
    "echo 'stub: step 1 — preparing workspace'",
    "echo 'stub: step 2 — running harness'",
]


class StubExecutor(Executor):
    """No-sandbox stub executor for development and testing.

    Behaviour
    ---------
    * Reads ``ctx.spec["steps"]`` (list of strings).  Falls back to two
      synthetic steps when the key is absent or the list is empty.
    * Yields ``("step", {"seq": i, "stream": "stdout", "line": <text>})``
      for each step.
    * Creates ``ctx.volume_path`` on disk if it does not exist.
    * Writes ``artifact-<job_id>.json`` into the volume directory.
    * Yields a terminal ``("done", {"ok": True, "result": {...},
      "artifact": <abs_path>})`` event.

    The volume is never cleared between runs — both artifacts coexist so that
    multi-run persistence scenarios can be tested.
    """

    async def run(self, ctx: JobContext) -> AsyncIterator[ExecEvent]:  # type: ignore[override]
        """Run the stub executor for *ctx* and yield events.

        Yields
        ------
        ExecEvent
            Zero or more ``("step", …)`` events, then exactly one
            ``("done", …)`` event.
        """
        steps: list[str] = ctx.spec.get("steps") or _FALLBACK_STEPS

        # Emit one step event per entry in the steps list.
        for seq, line in enumerate(steps):
            yield ("step", {"seq": seq, "stream": "stdout", "line": str(line)})

        # Ensure the volume directory exists (create if absent).
        volume = pathlib.Path(ctx.volume_path)
        volume.mkdir(parents=True, exist_ok=True)

        # Write the artifact file.
        artifact_filename = f"artifact-{ctx.job_id}.json"
        artifact_path = volume / artifact_filename
        artifact_data = {
            "job_id": ctx.job_id,
            "company_id": ctx.company_id,
            "steps": steps,
        }
        artifact_path.write_text(json.dumps(artifact_data, indent=2))

        # Emit the terminal done event.
        yield (
            "done",
            {
                "ok": True,
                "result": {
                    "step_count": len(steps),
                    "volume_path": str(volume),
                },
                "artifact": str(artifact_path.resolve()),
            },
        )
