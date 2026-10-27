"""omilo.loop — Agent loop runtime.

Public API:
    make_emitter   (emit.py)    — RunEvent writer + publish hook
    start_job      (runner.py)  — create a queued Job and run it inline
    run_job        (runner.py)  — execute one Helper turn
"""
from omilo.loop.emit import make_emitter
from omilo.loop.runner import start_job, run_job

__all__ = ["make_emitter", "start_job", "run_job"]
