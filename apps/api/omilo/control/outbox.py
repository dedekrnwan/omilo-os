"""omilo.control.outbox — In-memory usage outbox (unreported-usage queue).

UsageOutbox is a FIFO queue of UsageEvents that failed to be reported to the
cloud control plane (e.g. due to a transport error).  On reconnect the
runtime calls ``flush(report_fn)`` to re-post each event idempotently.

Properties
----------
- In-memory (P6).  Events are lost on process restart.  A persistent
  (sqlite/file-backed) implementation would survive restarts; this is noted
  as a P7 enhancement.
- Deduplication by ``(company_id, job_id)``: enqueuing the same event twice
  is a no-op (cloud usage is already idempotent, but this prevents wasteful
  double-flushes).
- ``flush`` is ordered (FIFO) and stops on the first failure so that events
  are retried in order and a transient error doesn't skip events.

Thread safety: the queue is protected by a threading.Lock.
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Callable

from omilo.control import UsageEvent, UsageResult


class UsageOutbox:
    """FIFO queue of unreported UsageEvents, deduped by (company_id, job_id).

    Usage::

        outbox = UsageOutbox()
        outbox.enqueue(ev)         # add an event (deduped)
        outbox.flush(report_fn)    # try to re-post each event; clears on success
        outbox.size()              # number of pending events
    """

    def __init__(self) -> None:
        # Ordered dict keyed by (company_id, job_id) → UsageEvent; preserves FIFO.
        self._queue: OrderedDict[tuple[str, str], UsageEvent] = OrderedDict()
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def enqueue(self, ev: UsageEvent) -> None:
        """Add a UsageEvent to the outbox.

        If an event with the same (company_id, job_id) is already queued,
        this is a no-op (idempotent deduplication).

        Args:
            ev: The UsageEvent to queue.
        """
        key = (ev.company_id, ev.job_id)
        with self._lock:
            if key not in self._queue:
                self._queue[key] = ev

    def flush(self, report_fn: Callable[[UsageEvent], UsageResult]) -> None:
        """Attempt to re-post all queued events in FIFO order.

        For each event:
        - Call ``report_fn(ev)``.  On success (no exception) the event is
          removed from the queue.
        - On any exception: stop flushing and leave the remaining events
          (including the failed one) in the queue for the next flush.

        This guarantees that events are retried in order and a transient
        failure does not skip events.

        Args:
            report_fn: A callable that posts a UsageEvent and returns
                       UsageResult.  Should raise on failure.
        """
        with self._lock:
            keys = list(self._queue.keys())

        for key in keys:
            with self._lock:
                ev = self._queue.get(key)
            if ev is None:
                continue  # already removed by a concurrent flush (rare)

            try:
                report_fn(ev)
            except Exception:
                # Stop on first failure — remaining events stay queued.
                break

            with self._lock:
                self._queue.pop(key, None)

    def size(self) -> int:
        """Return the number of pending events in the outbox."""
        with self._lock:
            return len(self._queue)
