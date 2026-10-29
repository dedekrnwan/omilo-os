"""omilo.worker — Worker-side compute harness package.

Public API (re-exported for convenience):
    JobContext   — input context passed to every Executor.run() call
    ExecEvent    — tuple type emitted by Executor.run()
    Executor     — abstract async-generator base class (seam for Plan #2)
    StubExecutor — local stub implementation for testing and dev
"""
from __future__ import annotations

from omilo.worker.executor import Executor, ExecEvent, JobContext, StubExecutor

__all__ = ["Executor", "ExecEvent", "JobContext", "StubExecutor"]
