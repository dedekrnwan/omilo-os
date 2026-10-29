"""omilo.compute — Compute control-plane package.

Public API (re-exported for convenience):
    Frame       — discriminated union of all relay frame types
    encode      — serialize a Frame to a JSON string
    decode      — deserialize a JSON string to a Frame
"""
from __future__ import annotations

from omilo.compute.protocol import Frame, encode, decode

__all__ = ["Frame", "encode", "decode"]
