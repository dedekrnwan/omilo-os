"""Shared test utilities for the omilo API test suite."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

# Absolute path to the apps/api directory — used as cwd for alembic invocations.
API_DIR = Path(__file__).parent.parent


def run_alembic(*args: str) -> subprocess.CompletedProcess:
    """Invoke alembic with the given arguments from the apps/api directory.

    Returns the CompletedProcess; callers are responsible for checking
    returncode and surfacing stdout/stderr on failure.
    """
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=API_DIR,
        capture_output=True,
        text=True,
    )
