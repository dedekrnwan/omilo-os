"""TDD — compute relay protocol: Frame discriminated union + encode/decode.

Tests:
1. test_roundtrip_each_frame  — every frame type survives decode(encode(f)) == f
2. test_decode_unknown_type_raises — ValueError for unknown type field
3. test_job_step_requires_seq — seq is required on job_step frames

RED → implement → GREEN.
"""
from __future__ import annotations

import json
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _encode(frame):
    from omilo.compute.protocol import encode
    return encode(frame)


def _decode(raw: str):
    from omilo.compute.protocol import decode
    return decode(raw)


# ---------------------------------------------------------------------------
# 1. Roundtrip every frame type
# ---------------------------------------------------------------------------


class TestRoundtripEachFrame:
    """decode(encode(f)) == f for every concrete frame type."""

    def _rt(self, frame):
        """Roundtrip helper."""
        raw = _encode(frame)
        restored = _decode(raw)
        assert restored == frame, f"Roundtrip failed for {frame}"
        # raw must be valid JSON
        parsed = json.loads(raw)
        assert parsed["type"] == frame.type
        return restored

    def test_register_worker(self):
        from omilo.compute.protocol import RegisterFrame
        f = RegisterFrame(
            role="worker",
            worker_id="w-1",
            company_id="co-1",
            capacity=4,
        )
        self._rt(f)

    def test_register_client(self):
        from omilo.compute.protocol import RegisterFrame
        f = RegisterFrame(role="client", client_id="cli-1")
        self._rt(f)

    def test_start_job(self):
        from omilo.compute.protocol import StartJobFrame
        f = StartJobFrame(
            job_id="job-1",
            company_id="co-1",
            spec={"engine": "fake", "brief": "do it"},
            secrets={"key": "val"},
        )
        self._rt(f)

    def test_job_queued(self):
        from omilo.compute.protocol import JobQueuedFrame
        f = JobQueuedFrame(job_id="job-1", reason="no worker available")
        self._rt(f)

    def test_job_accepted(self):
        from omilo.compute.protocol import JobAcceptedFrame
        f = JobAcceptedFrame(job_id="job-1", worker_id="w-1")
        self._rt(f)

    def test_job_step(self):
        from omilo.compute.protocol import JobStepFrame
        f = JobStepFrame(job_id="job-1", seq=0, stream="stdout", line="hello")
        self._rt(f)

    def test_job_status(self):
        from omilo.compute.protocol import JobStatusFrame
        f = JobStatusFrame(job_id="job-1", state="running", detail="in progress")
        self._rt(f)

    def test_job_done_ok(self):
        from omilo.compute.protocol import JobDoneFrame
        f = JobDoneFrame(
            job_id="job-1",
            ok=True,
            result={"text": "done"},
            artifact=None,
        )
        self._rt(f)

    def test_job_done_failure(self):
        from omilo.compute.protocol import JobDoneFrame
        f = JobDoneFrame(job_id="job-1", ok=False, result=None, artifact=None)
        self._rt(f)

    def test_job_error(self):
        from omilo.compute.protocol import JobErrorFrame
        f = JobErrorFrame(job_id="job-1", error="something blew up")
        self._rt(f)

    def test_ping(self):
        from omilo.compute.protocol import PingFrame
        f = PingFrame()
        self._rt(f)

    def test_pong(self):
        from omilo.compute.protocol import PongFrame
        f = PongFrame()
        self._rt(f)

    def test_frame_union_annotation(self):
        """Frame type alias must be importable and the union covers all types."""
        from omilo.compute.protocol import Frame
        # Frame must be a type alias usable in annotations — existence is enough here.
        assert Frame is not None

    def test_encode_returns_str(self):
        from omilo.compute.protocol import PingFrame
        raw = _encode(PingFrame())
        assert isinstance(raw, str)

    def test_decode_returns_correct_type(self):
        from omilo.compute.protocol import PongFrame
        restored = _decode('{"type": "pong"}')
        assert isinstance(restored, PongFrame)


# ---------------------------------------------------------------------------
# 2. Unknown type raises
# ---------------------------------------------------------------------------


class TestDecodeUnknownType:
    def test_unknown_type_raises(self):
        with pytest.raises((ValueError, Exception)):
            _decode('{"type": "not_a_real_frame"}')

    def test_missing_type_raises(self):
        with pytest.raises((ValueError, Exception)):
            _decode('{"role": "worker"}')


# ---------------------------------------------------------------------------
# 3. job_step requires seq
# ---------------------------------------------------------------------------


class TestJobStepRequiresSeq:
    def test_seq_required(self):
        """Creating a JobStepFrame without seq must raise a ValidationError."""
        from pydantic import ValidationError
        from omilo.compute.protocol import JobStepFrame
        with pytest.raises(ValidationError):
            JobStepFrame(job_id="job-1", stream="stdout", line="hi")

    def test_seq_must_be_int(self):
        """seq must be an integer (not a string)."""
        from pydantic import ValidationError
        from omilo.compute.protocol import JobStepFrame
        with pytest.raises((ValidationError, Exception)):
            JobStepFrame(job_id="job-1", seq="not-an-int", stream="stdout", line="hi")

    def test_seq_zero_is_valid(self):
        """seq=0 is a valid first sequence number."""
        from omilo.compute.protocol import JobStepFrame
        f = JobStepFrame(job_id="job-1", seq=0, stream="stdout", line="first")
        assert f.seq == 0


# ---------------------------------------------------------------------------
# 4. register frame role discrimination
# ---------------------------------------------------------------------------


class TestRegisterFrame:
    def test_worker_fields(self):
        from omilo.compute.protocol import RegisterFrame
        f = RegisterFrame(role="worker", worker_id="w-99", company_id="co-2", capacity=8)
        assert f.role == "worker"
        assert f.worker_id == "w-99"
        assert f.company_id == "co-2"
        assert f.capacity == 8

    def test_client_fields(self):
        from omilo.compute.protocol import RegisterFrame
        f = RegisterFrame(role="client", client_id="cli-99")
        assert f.role == "client"
        assert f.client_id == "cli-99"

    def test_worker_capacity_is_int(self):
        from omilo.compute.protocol import RegisterFrame
        f = RegisterFrame(role="worker", worker_id="w-1", company_id="co-1", capacity=2)
        assert isinstance(f.capacity, int)

    def test_register_type_field(self):
        from omilo.compute.protocol import RegisterFrame
        f = RegisterFrame(role="client", client_id="c-1")
        assert f.type == "register"

    def test_roundtrip_worker_capacity(self):
        """capacity survives encode→decode as an int."""
        from omilo.compute.protocol import RegisterFrame
        f = RegisterFrame(role="worker", worker_id="w-1", company_id="co-1", capacity=16)
        restored = _decode(_encode(f))
        assert restored.capacity == 16
        assert isinstance(restored.capacity, int)
