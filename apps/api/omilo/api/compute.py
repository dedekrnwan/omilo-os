"""Compute control-plane REST endpoints — worker pairing + job creation.

Endpoints:
  POST /v1/compute/workers/pair  → create a ComputeWorker (owner/admin only)
                                    returns {worker_id, token} — raw token once
  POST /v1/compute/jobs          → create a ComputeJob (status queued)
                                    returns the job; requires spec to be a dict

Helper (used by Task 4 WebSocket auth):
  verify_worker_token(token) -> ComputeWorker | None
    Looks up a worker by sha256(token) via a privileged (RLS-bypassing)
    SessionLocal.  The worker presents only a token — no company context —
    so this must bypass RLS.  Returns None if no matching row.

Token security (mirrors mcp_tokens.py exactly):
  raw  = secrets.token_urlsafe(32)
  hash = hashlib.sha256(raw.encode()).hexdigest()
  Raw token returned ONCE; never stored; never returned again.

Role guard (mirrors company.py PATCH pattern):
  Depends(require_role("owner", "admin"))

Router mount (mirrors members_router in main.py):
  app.include_router(compute_router, prefix="/v1")
"""
from __future__ import annotations

import hashlib
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.compute import ComputeJob, ComputeWorker
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db, require_role

router = APIRouter(tags=["compute"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class PairWorkerBody(BaseModel):
    """Body for POST /v1/compute/workers/pair."""

    capacity: int = 1


class CreateJobBody(BaseModel):
    """Body for POST /v1/compute/jobs."""

    spec: Any  # validated as dict below — pydantic Any accepts everything


# ---------------------------------------------------------------------------
# POST /v1/compute/workers/pair — register a new worker
# ---------------------------------------------------------------------------


@router.post("/compute/workers/pair")
def pair_worker(
    body: PairWorkerBody,
    _: None = Depends(require_role("owner", "admin")),
    ctx: RequestContext = Depends(get_context),
    db: Session = Depends(get_tenant_db),
) -> dict[str, Any]:
    """Register a new ComputeWorker for the active company.

    Requires owner or admin role (require_role guard).
    Generates a registration secret (secrets.token_urlsafe(32)), stores only
    the sha256 hex digest, and returns the raw token ONCE — it is never stored
    or returned again.

    The worker starts with status='offline', in_use=0, and capacity from the
    request body (default 1).
    """
    raw_secret = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_secret.encode()).hexdigest()

    worker = ComputeWorker(
        id=prefixed_id("cwk"),
        company_id=ctx.company_id,
        status="offline",
        capacity=body.capacity,
        in_use=0,
        token_hash=token_hash,
    )
    db.add(worker)
    db.flush()

    return {"worker_id": worker.id, "token": raw_secret}


# ---------------------------------------------------------------------------
# POST /v1/compute/jobs — enqueue a new job
# ---------------------------------------------------------------------------


@router.post("/compute/jobs")
async def create_job(
    body: CreateJobBody,
    ctx: RequestContext = Depends(get_context),
    db: Session = Depends(get_tenant_db),
) -> dict[str, Any]:
    """Create a ComputeJob with status='queued' and attempt immediate dispatch.

    Any authenticated user (not just owner/admin) can submit a job.
    ``spec`` must be a dict (JSONB); a 400 is returned otherwise since the DB
    JSONB column does not enforce the dict constraint at the application level.

    After creating the job, dispatch() is called to assign it to a free same-
    company worker (if one is available).  The response reflects the final
    status — either 'dispatched' (worker assigned) or 'queued' (no worker).
    """
    if not isinstance(body.spec, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="spec must be a JSON object (dict).",
        )

    job_id = prefixed_id("cjb")
    company_id = ctx.company_id

    # Commit the job row on a DEDICATED session so it is immediately visible
    # (READ COMMITTED) to the separate SessionLocal connection that
    # dispatch → _db_pick_and_reserve opens.  We cannot call db.commit() here
    # because the get_tenant_db session is already inside a with session.begin()
    # context manager — committing inside that block closes the managed
    # transaction and makes subsequent db.refresh() / db.query() calls fail.
    with SessionLocal() as _sess:
        with _sess.begin():
            _job = ComputeJob(
                id=job_id,
                company_id=company_id,
                status="queued",
                spec=body.spec,
            )
            _sess.add(_job)
            _sess.flush()
            _sess.expunge(_job)
        # _sess.begin().__exit__ commits here → row is now durably visible

    # Build a lightweight stub so dispatch() can read .id / .company_id / .spec
    # without needing an active session; _db_pick_and_reserve re-fetches by PK.
    import types as _types
    job_stub = _types.SimpleNamespace(
        id=job_id,
        company_id=company_id,
        spec=body.spec,
    )

    # Attempt immediate dispatch — fire-and-forget the result; if no worker is
    # available the job remains 'queued' and will be picked up when a worker
    # comes online.
    try:
        from omilo.compute.dispatch import dispatch as _dispatch

        await _dispatch(job_stub)  # type: ignore[arg-type]
    except Exception as exc:
        # Dispatch errors are non-fatal — the job stays queued and will be
        # picked up when a worker comes online.
        import logging as _logging
        _logging.getLogger(__name__).warning(
            "create_job: dispatch attempt failed for job %s: %s", job_id, exc
        )

    # Read the final state via the request session (RLS-scoped, same company).
    job = db.get(ComputeJob, job_id)
    if job is None:
        # Should not happen — we just committed it above.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Job row disappeared after creation.",
        )

    return {
        "id": job.id,
        "company_id": job.company_id,
        "status": job.status,
        "spec": job.spec,
        "worker_id": job.worker_id,
        "lease_expires_at": (
            job.lease_expires_at.isoformat() if job.lease_expires_at else None
        ),
        "result": job.result,
        "artifact": job.artifact,
        "error": job.error,
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }


# ---------------------------------------------------------------------------
# verify_worker_token — privileged lookup (used by Task 4 WS auth)
# ---------------------------------------------------------------------------


def verify_worker_token(token: str) -> ComputeWorker | None:
    """Look up a ComputeWorker by sha256(token) using a privileged session.

    The worker presents only a bearer token during WebSocket auth — there is no
    company context available at that point.  We therefore bypass RLS by using
    SessionLocal directly (the superuser `omilo` role, no SET LOCAL ROLE).
    The company_id is read from the returned row.

    Returns the ComputeWorker ORM row (detached, with scalars preloaded), or
    None if no matching row is found. Scalar columns (id, company_id, etc.) are
    safe to read after the session is closed; do NOT access relationships.
    """
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with SessionLocal() as session:
        worker = (
            session.query(ComputeWorker)
            .filter_by(token_hash=token_hash)
            .first()
        )
        if worker is not None:
            session.expunge(worker)
        return worker
