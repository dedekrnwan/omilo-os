"""omilo.worker.runtime — WorkerRuntime: dials the relay, registers, runs jobs.

Overview
--------
``WorkerRuntime`` is the long-running process that sits on a worker machine.
It:

1. Connects to the cloud relay via WebSocket (``ws[s]://<relay>?token=<token>``).
2. Sends a ``register`` frame (role="worker") with its identity.
3. Answers ``ping`` frames with ``pong``.
4. On receiving a ``start_job`` frame, immediately acknowledges with
   ``job_accepted``, then runs the configured :class:`Executor`, mapping each
   :data:`ExecEvent` to the appropriate wire frame.
5. On disconnect (clean or error) reconnects with **capped exponential backoff**
   (1 → 2 → 4 → 8 s, cap 10 s) using an **injectable backoff generator** so
   tests never sleep.

Public API
~~~~~~~~~~
``WorkerRuntime(relay_url, token, company_id, worker_id, capacity, executor,
                 backoff)``
    Constructor.  All args are positional-or-keyword.

    relay_url:
        Base WebSocket URL of the relay (e.g. ``"ws://127.0.0.1:8765"``).
        The token is appended as ``?token=<token>``.
    token:
        Worker authentication token (opaque string issued by the pairing API).
    company_id:
        Tenant identifier; included in the ``register`` frame.
    worker_id:
        Persistent worker identifier learned at pairing time.
    capacity:
        Number of concurrent jobs this worker can accept.
    executor:
        :class:`~omilo.worker.executor.Executor` instance (default:
        :class:`~omilo.worker.executor.StubExecutor`).
    backoff:
        Optional async generator that yields delay (float, seconds) before
        each reconnect attempt.  Defaults to the production capped exponential
        schedule (1→2→4→8→10→10→…).  Inject ``_zero_backoff()`` in tests to
        avoid real sleeps.

``async run()``
    Connect, register, and serve until cancelled.  Reconnects transparently on
    disconnect.
"""
from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path
from typing import AsyncGenerator, Optional

from omilo.compute.protocol import (
    JobAcceptedFrame,
    JobDoneFrame,
    JobErrorFrame,
    JobStepFrame,
    JobStatusFrame,
    PongFrame,
    RegisterFrame,
    StartJobFrame,
    decode,
    encode,
)
from omilo.worker.executor import Executor, JobContext, StubExecutor

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Default backoff generator
# ---------------------------------------------------------------------------


async def _default_backoff() -> AsyncGenerator[float, None]:
    """Capped exponential backoff: 1 → 2 → 4 → 8 → 10 → 10 → …"""
    delay = 1.0
    cap = 10.0
    while True:
        yield delay
        delay = min(delay * 2, cap)


# ---------------------------------------------------------------------------
# WorkerRuntime
# ---------------------------------------------------------------------------


class WorkerRuntime:
    """Long-running worker process that connects to the Omilo compute relay.

    Parameters
    ----------
    relay_url:
        Base WebSocket URL (without query string).
    token:
        Authentication token appended as ``?token=<token>``.
    company_id:
        Tenant identifier for this worker.
    worker_id:
        Persistent worker ID (received at pairing time).
    capacity:
        Max concurrent jobs this worker can accept.
    executor:
        Job executor; defaults to :class:`StubExecutor`.
    backoff:
        Async generator yielding float seconds to wait before each reconnect.
        Defaults to the production capped exponential schedule.  Inject a
        zero-delay generator in tests.
    volume_base:
        Base directory for per-job temp volumes.  Defaults to the system
        temp dir.  Each job gets its own sub-directory.
    """

    def __init__(
        self,
        relay_url: str,
        token: str,
        company_id: str,
        worker_id: str,
        capacity: int,
        executor: Optional[Executor] = None,
        *,
        backoff: Optional[AsyncGenerator[float, None]] = None,
        volume_base: Optional[str] = None,
    ) -> None:
        self.relay_url = relay_url
        self.token = token
        self.company_id = company_id
        self.worker_id = worker_id
        self.capacity = capacity
        self.executor = executor if executor is not None else StubExecutor()
        self._backoff = backoff
        self.volume_base = volume_base or tempfile.gettempdir()
        # Tracks in-flight job tasks so Python doesn't warn about abandoned tasks
        # on loop teardown.  Each task removes itself via add_done_callback.
        self._jobs: set[asyncio.Task] = set()

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    async def run(self) -> None:
        """Connect, register, and serve forever; reconnect on disconnect."""
        # Build (or reuse) the backoff generator
        backoff_gen = self._backoff if self._backoff is not None else _default_backoff()

        url = f"{self.relay_url}?token={self.token}"

        # First attempt has no delay
        first = True
        async for delay in backoff_gen:  # type: ignore[union-attr]
            if not first:
                if delay > 0:
                    await asyncio.sleep(delay)
            first = False

            try:
                await self._connect_and_serve(url)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning(
                    "WorkerRuntime: disconnected (%s: %s), will retry in %.1fs",
                    type(exc).__name__,
                    exc,
                    delay,
                )
                # Loop continues — next iteration sleeps then reconnects

    # ------------------------------------------------------------------
    # Per-connection logic
    # ------------------------------------------------------------------

    async def _connect_and_serve(self, url: str) -> None:
        """Dial the relay, register, and handle frames until disconnect."""
        import websockets.asyncio.client as _wsclient

        logger.info("WorkerRuntime: connecting to %s", url)
        async with _wsclient.connect(
            url,
            ping_interval=None,   # we handle ping/pong ourselves
            ping_timeout=None,
            open_timeout=10,
        ) as ws:
            logger.info("WorkerRuntime: connected; sending register")
            await ws.send(
                encode(
                    RegisterFrame(
                        role="worker",
                        worker_id=self.worker_id,
                        company_id=self.company_id,
                        capacity=self.capacity,
                    )
                )
            )

            # Message loop
            async for raw in ws:
                await self._handle_frame(ws, raw)

    # ------------------------------------------------------------------
    # Frame dispatch
    # ------------------------------------------------------------------

    async def _handle_frame(self, ws, raw: str) -> None:
        try:
            frame = decode(raw)
        except (ValueError, Exception) as exc:
            logger.warning("WorkerRuntime: failed to decode frame: %s", exc)
            return

        if hasattr(frame, "type"):
            ftype = frame.type
        else:
            return

        if ftype == "ping":
            await ws.send(encode(PongFrame()))

        elif ftype == "start_job":
            if not isinstance(frame, StartJobFrame):
                logger.warning("WorkerRuntime: got start_job frame of unexpected type %s", type(frame))
                return
            task = asyncio.create_task(self._run_job(ws, frame))
            self._jobs.add(task)
            task.add_done_callback(self._jobs.discard)

        else:
            logger.debug("WorkerRuntime: ignoring frame type=%s", ftype)

    # ------------------------------------------------------------------
    # Job execution
    # ------------------------------------------------------------------

    async def _run_job(self, ws, frame: StartJobFrame) -> None:
        job_id = frame.job_id
        logger.info("WorkerRuntime: accepted job %s", job_id)

        # 1. Acknowledge immediately
        await ws.send(encode(JobAcceptedFrame(job_id=job_id, worker_id=self.worker_id)))

        # 2. Build a per-job volume path under volume_base
        volume_path = str(Path(self.volume_base) / f"omilo-job-{job_id}")

        ctx = JobContext(
            job_id=job_id,
            company_id=frame.company_id,
            volume_path=volume_path,
            spec=frame.spec,
            secrets=frame.secrets,
        )

        # 3. Run executor and map events to frames
        try:
            async for kind, data in self.executor.run(ctx):
                if kind == "status":
                    await ws.send(
                        encode(
                            JobStatusFrame(
                                job_id=job_id,
                                state=data["state"],
                                detail=data.get("detail"),
                            )
                        )
                    )
                elif kind == "step":
                    await ws.send(
                        encode(
                            JobStepFrame(
                                job_id=job_id,
                                seq=data["seq"],
                                stream=data["stream"],
                                line=data["line"],
                            )
                        )
                    )
                elif kind == "done":
                    await ws.send(
                        encode(
                            JobDoneFrame(
                                job_id=job_id,
                                ok=data["ok"],
                                result=data.get("result"),
                                artifact=data.get("artifact"),
                            )
                        )
                    )
                    # done is terminal — stop iterating
                    break

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("WorkerRuntime: job %s raised: %s", job_id, exc)
            try:
                await ws.send(
                    encode(JobErrorFrame(job_id=job_id, error=str(exc)))
                )
            except Exception:
                # Socket already closed (mid-job drop).  The relay will detect
                # the disconnect via heartbeat-drop + lease-reap and handle it.
                pass
