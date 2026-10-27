"""omilo.realtime.events — In-process async pub/sub broker.

Module-level singleton ``broker`` provides per-company event fan-out:

    from omilo.realtime.events import broker

    # In an async context (SSE endpoint):
    async for event in broker.subscribe("cmp_abc"):
        yield event  # dict: {type, id, data}

    # In a sync/threadpool context (loop runner):
    broker.publish("cmp_abc", {"type": "job.done", "id": job.id, "data": {...}})

Design:
- Each call to ``subscribe(company_id)`` registers an ``asyncio.Queue`` under
  that company and returns an ``AsyncGenerator`` that yields events as they
  arrive and unregisters on cancel/close.
- ``publish(company_id, event)`` delivers the event to ONLY the queues
  registered under that company (company isolation is the core invariant).
- ``publish`` is safe to call from a worker thread (the loop runs via
  ``run_in_threadpool``): it uses ``loop.call_soon_threadsafe`` to inject
  events into asyncio queues without race conditions.
- If no event loop is running or no subscribers exist, publish is a cheap
  no-op that never raises.

Redis fan-out is deferred to a later phase (P2).
"""
from __future__ import annotations

import asyncio
import collections
import logging
from collections.abc import AsyncGenerator
from typing import Any

logger = logging.getLogger(__name__)


class Broker:
    """Per-company in-process pub/sub broker."""

    def __init__(self) -> None:
        # company_id → set of asyncio.Queue
        self._queues: dict[str, set[asyncio.Queue]] = collections.defaultdict(set)
        # The running asyncio event loop — captured lazily on first subscribe.
        self._loop: asyncio.AbstractEventLoop | None = None

    # ------------------------------------------------------------------
    # subscribe
    # ------------------------------------------------------------------

    def subscribe(self, company_id: str) -> AsyncGenerator[dict[str, Any], None]:
        """Register a queue for *company_id* and yield events as they arrive.

        Usage::

            async for event in broker.subscribe("cmp_abc"):
                ...

        The generator unregisters itself when cancelled or closed (via
        ``GeneratorExit`` / ``asyncio.CancelledError``).
        """
        return self._subscribe(company_id)

    async def _subscribe(
        self, company_id: str
    ) -> AsyncGenerator[dict[str, Any], None]:
        queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

        # Capture the running loop so publish (called from threads) can use it.
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            pass  # No running loop yet — will be captured on first publish attempt.

        self._queues[company_id].add(queue)
        try:
            while True:
                item = await queue.get()
                if item is None:
                    # Sentinel: broker is shutting down (not used in P1 but
                    # included for clean shutdown support).
                    break
                yield item
        except (GeneratorExit, asyncio.CancelledError):
            pass
        finally:
            # Unregister this subscriber
            queues = self._queues.get(company_id)
            if queues is not None:
                queues.discard(queue)
                if not queues:
                    del self._queues[company_id]

    # ------------------------------------------------------------------
    # publish
    # ------------------------------------------------------------------

    def publish(self, company_id: str, event: dict[str, Any]) -> None:
        """Deliver *event* to every subscriber registered under *company_id*.

        Safe to call from any thread (sync or asyncio worker):
        - From an asyncio coroutine: the event loop is already running; we use
          ``loop.call_soon_threadsafe`` to schedule the puts (safe from both
          same-thread and cross-thread callers).
        - From a worker thread (``run_in_threadpool``): same path works because
          ``call_soon_threadsafe`` is the only thread-safe way to schedule onto
          an asyncio loop.

        Company isolation: only queues registered under *company_id* receive
        the event.  A subscriber for company B NEVER receives an event published
        for company A.

        A publish failure (no loop, no subscribers, queue errors) is always
        swallowed — it must never break a job or approval.
        """
        try:
            loop = self._loop
            if loop is None:
                # No subscriber has registered yet → nothing to do.
                return

            queues = self._queues.get(company_id)
            if not queues:
                return

            for q in list(queues):
                loop.call_soon_threadsafe(q.put_nowait, event)

        except Exception:
            logger.exception(
                "broker.publish(%r) failed — swallowing to protect hot path",
                company_id,
            )


# Module-level singleton
broker = Broker()
