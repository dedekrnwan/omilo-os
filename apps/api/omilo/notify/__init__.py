"""Notification emails — the triggers behind the pen "Email Templates".

  hooks.install()     ORM commit hooks: approval, alert, welcome
  senders             build + deliver each event email
  digest              weekly digest (Monday 08:00 local), ``omilo-notify`` CLI
  start_loop()        background digest loop started with the API
"""
from __future__ import annotations

import logging
import threading
import time

log = logging.getLogger("omilo.notify")

LOOP_INTERVAL_S = 300
_loop: threading.Thread | None = None


def start_loop() -> None:
    """Run due digests every 5 minutes in a daemon thread (once per process).

    Skipped when email isn't configured (no SMTP_HOST) or NOTIFY_LOOP=false —
    run ``omilo-notify`` from cron instead if you prefer.
    """
    global _loop
    from omilo.config import get_settings

    s = get_settings()
    if _loop is not None or not s.notify_enabled or not s.notify_loop or not s.smtp_host:
        return

    def _run() -> None:
        from omilo.notify.digest import run_due_digests

        while True:
            try:
                run_due_digests()
            except Exception:
                log.exception("digest loop tick failed")
            time.sleep(LOOP_INTERVAL_S)

    _loop = threading.Thread(target=_run, name="omilo-digest-loop", daemon=True)
    _loop.start()
