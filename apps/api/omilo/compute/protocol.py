"""omilo.compute.protocol — Wire protocol for the worker↔cloud relay.

Every WebSocket frame is one JSON object discriminated by a ``type`` field.

Frame types
-----------
register        Worker or client announces itself.
start_job       Cloud → worker: run this job.
job_queued      Cloud → client: job is queued (no worker available yet).
job_accepted    Worker → cloud: I will run this job.
job_step        Worker → cloud: one line of streaming output.
job_status      Worker → cloud: state change (running / paused / …).
job_done        Worker → cloud: job finished.
job_error       Worker → cloud: job failed with an error.
ping            Either side: keepalive request.
pong            Either side: keepalive reply.

Usage::

    from omilo.compute.protocol import encode, decode, PingFrame

    raw = encode(PingFrame())           # '{"type": "ping"}'
    frame = decode(raw)                 # PingFrame()
    assert frame == PingFrame()
"""
from __future__ import annotations

import json
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, Field, ValidationError


# ── Base config ──────────────────────────────────────────────────────────────

class _FrameBase(BaseModel):
    """Shared Pydantic config for all frame models."""

    model_config = {"extra": "ignore"}


# ── register ─────────────────────────────────────────────────────────────────

class RegisterFrame(_FrameBase):
    """Worker or client announces itself on connection.

    Worker registers with: role="worker", worker_id, company_id, capacity.
    Client registers with: role="client", client_id.
    """

    type: Literal["register"] = "register"
    role: Literal["worker", "client"]

    # Worker-only fields (None for client)
    worker_id: Optional[str] = None
    company_id: Optional[str] = None
    capacity: Optional[int] = None

    # Client-only fields (None for worker)
    client_id: Optional[str] = None


# ── start_job ────────────────────────────────────────────────────────────────

class StartJobFrame(_FrameBase):
    """Cloud → worker: run this job.

    ``spec`` is an arbitrary dict (engine type, brief, etc.).
    ``secrets`` carries BYO credentials forwarded to the worker.
    """

    type: Literal["start_job"] = "start_job"
    job_id: str
    company_id: str
    spec: dict[str, Any]
    secrets: dict[str, Any]


# ── job_queued ───────────────────────────────────────────────────────────────

class JobQueuedFrame(_FrameBase):
    """Cloud → client: job is queued (no worker available yet)."""

    type: Literal["job_queued"] = "job_queued"
    job_id: str
    reason: str


# ── job_accepted ─────────────────────────────────────────────────────────────

class JobAcceptedFrame(_FrameBase):
    """Worker → cloud: I will run this job."""

    type: Literal["job_accepted"] = "job_accepted"
    job_id: str
    worker_id: str


# ── job_step ─────────────────────────────────────────────────────────────────

class JobStepFrame(_FrameBase):
    """Worker → cloud: one line of streaming output.

    ``seq`` is a monotonically increasing sequence number (required, starts at 0).
    ``stream`` identifies the output stream: "stdout" or "stderr".
    ``line`` is the raw text line.
    """

    type: Literal["job_step"] = "job_step"
    job_id: str
    seq: int  # required — no default
    stream: str
    line: str


# ── job_status ───────────────────────────────────────────────────────────────

class JobStatusFrame(_FrameBase):
    """Worker → cloud: state change notification."""

    type: Literal["job_status"] = "job_status"
    job_id: str
    state: str
    detail: Optional[str] = None


# ── job_done ─────────────────────────────────────────────────────────────────

class JobDoneFrame(_FrameBase):
    """Worker → cloud: job finished (successfully or not).

    ``ok``       True if the job completed without error.
    ``result``   Arbitrary dict with the engine's output (may be None on failure).
    ``artifact`` Optional artifact reference (e.g. a file path or URL).
    """

    type: Literal["job_done"] = "job_done"
    job_id: str
    ok: bool
    result: Optional[dict[str, Any]] = None
    artifact: Optional[str] = None


# ── job_error ────────────────────────────────────────────────────────────────

class JobErrorFrame(_FrameBase):
    """Worker → cloud: job failed with an error message."""

    type: Literal["job_error"] = "job_error"
    job_id: str
    error: str


# ── ping / pong ──────────────────────────────────────────────────────────────

class PingFrame(_FrameBase):
    """Keepalive request — either side may send this."""

    type: Literal["ping"] = "ping"


class PongFrame(_FrameBase):
    """Keepalive reply — either side may send this."""

    type: Literal["pong"] = "pong"


# ── Discriminated union ──────────────────────────────────────────────────────

Frame = Annotated[
    Union[
        RegisterFrame,
        StartJobFrame,
        JobQueuedFrame,
        JobAcceptedFrame,
        JobStepFrame,
        JobStatusFrame,
        JobDoneFrame,
        JobErrorFrame,
        PingFrame,
        PongFrame,
    ],
    Field(discriminator="type"),
]

# Pydantic v2 adapter for the top-level discriminated union
from pydantic import TypeAdapter as _TypeAdapter

_frame_adapter: _TypeAdapter[Frame] = _TypeAdapter(Frame)  # type: ignore[valid-type]


# ── Public API ───────────────────────────────────────────────────────────────

def encode(frame: _FrameBase) -> str:
    """Serialize a Frame to a compact JSON string.

    Uses Pydantic's model serialization so field defaults are included and
    the ``type`` discriminator is always present.
    """
    return frame.model_dump_json()


def decode(raw: str) -> Frame:  # type: ignore[valid-type]
    """Deserialize a JSON string to the appropriate Frame subtype.

    Raises:
        ValueError  if the JSON is missing a ``type`` field or the type value
                    is not one of the known frame types.
        pydantic.ValidationError  if field validation fails.
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc

    if "type" not in data:
        raise ValueError(
            f"Frame JSON missing required 'type' field. Got keys: {list(data.keys())}"
        )

    try:
        return _frame_adapter.validate_python(data)
    except ValidationError:
        # Re-raise with a cleaner message for unknown types
        frame_type = data.get("type", "<missing>")
        known = {
            "register", "start_job", "job_queued", "job_accepted",
            "job_step", "job_status", "job_done", "job_error",
            "ping", "pong",
        }
        if frame_type not in known:
            raise ValueError(
                f"Unknown frame type '{frame_type}'. "
                f"Known types: {sorted(known)}"
            )
        raise
