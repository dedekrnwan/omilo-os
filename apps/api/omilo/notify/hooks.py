"""Commit-time triggers for notification emails.

Proposals are created in half a dozen places (runner, MCP tools, flows,
skills…), jobs fail in several more, so instead of sprinkling calls we watch
the ORM: ``after_flush`` notes interesting changes on the session, and
``after_commit`` dispatches them — a rolled-back transaction sends nothing.

  new Proposal (pending)                        → approval email
  Job.status → failed                           → alert (if it's a connector-auth failure)
  Connector.status connected → needs_auth/error → alert
  Company.onboarded_at None → set               → welcome email
"""
from __future__ import annotations

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from omilo.models.approvals import Proposal
from omilo.models.connectors import Connector
from omilo.models.execution import Job
from omilo.models.tenancy import Company

_KEY = "omilo_notify"
_installed = False


def _changed_to(obj, attr: str) -> tuple[list, list]:
    h = inspect(obj).attrs[attr].history
    return list(h.added or ()), list(h.deleted or ())


def _collect(session: Session, _ctx) -> None:
    out = session.info.setdefault(_KEY, [])
    for obj in session.new:
        if isinstance(obj, Proposal) and (obj.status or "pending") == "pending":
            out.append(("approval", obj.id))
        elif isinstance(obj, Job) and obj.status == "failed":
            out.append(("job_failed", obj.id))
    for obj in session.dirty:
        if isinstance(obj, Job):
            added, _ = _changed_to(obj, "status")
            if "failed" in added:
                out.append(("job_failed", obj.id))
        elif isinstance(obj, Connector):
            added, deleted = _changed_to(obj, "status")
            if "connected" in deleted and set(added) & {"needs_auth", "error"}:
                out.append(("connector_down", obj.id))
        elif isinstance(obj, Company):
            added, deleted = _changed_to(obj, "onboarded_at")
            if added and added[0] is not None and (not deleted or deleted[0] is None):
                out.append(("welcome", obj.id))


def _fire(session: Session) -> None:
    items = session.info.pop(_KEY, None)
    if not items:
        return
    from omilo.config import get_settings
    from omilo.notify import core, senders

    if not get_settings().notify_enabled:
        return
    handlers = {
        "approval": senders.send_approval,
        "job_failed": senders.send_job_alert,
        "connector_down": senders.send_connector_alert,
        "welcome": senders.send_welcome,
    }
    for kind, obj_id in dict.fromkeys(items):
        core.dispatch(handlers[kind], obj_id)


def _drop(session: Session, *_a) -> None:
    session.info.pop(_KEY, None)


def install() -> None:
    """Register the session listeners once per process."""
    global _installed
    if _installed:
        return
    event.listen(Session, "after_flush", _collect)
    event.listen(Session, "after_commit", _fire)
    event.listen(Session, "after_rollback", _drop)
    _installed = True
