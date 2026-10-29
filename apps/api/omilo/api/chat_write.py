"""POST /v1/sessions — Create sessions and post operator messages.

Endpoints:
  POST /sessions                → SessionDTO  (create a new chat session)
  POST /sessions/{id}/messages  → {message: MessageDTO, job_id: str}
                                   Persists the operator message, runs the
                                   Helper turn inline (fake engine in P1),
                                   persists the assistant message, and returns.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.loop.runner import start_job
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.chat import ChatSession, Message
from omilo.models.execution import Job, Report
from omilo.schemas.read import MessageDTO, SessionDTO
from omilo.schemas.read import SessionOutDTO  # sweep/chat
from omilo.models.workspace import Folder, Goal  # sweep/chat
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["chat-write"])


# ── Request schemas ───────────────────────────────────────────────────────────


class CreateSessionBody(BaseModel):
    channel_id: Optional[str] = None
    goal_id: Optional[str] = None
    title: Optional[str] = None
    scope: Optional[str] = "chat"
    # ── sweep/chat ──
    folder_id: Optional[str] = None
    model: Optional[str] = None
    kind: Optional[str] = "chat"  # 'chat' | 'chief_private'


class PostMessageBody(BaseModel):
    content: str
    model: Optional[str] = None
    think_level: Optional[str] = None


# ── Response schema ───────────────────────────────────────────────────────────


class PostMessageResponse(BaseModel):
    message: dict[str, Any]  # MessageDTO (by_alias=True)
    job_id: str


# ── Helpers ───────────────────────────────────────────────────────────────────


def _session_dto(row: ChatSession, user_id: str | None = None) -> dict:
    from omilo.api.chat_workspace import session_out  # sweep/chat

    return session_out(row, user_id)


def _message_dto(row: Message) -> dict:
    return MessageDTO.model_validate(row, from_attributes=True).model_dump(
        by_alias=True, exclude_none=True
    )


def _pick_helper(db: Session, session: ChatSession, company_id: str) -> Helper:
    """Return the Helper for this session.

    Resolution order:
    1. If the session has a channel, look for a helper whose channel_ids
       contains it (first match).
    2. Fall back to the company's Chief (is_chief=True, status=active).
    3. 409 if no helper is found.

    Private Chief threads (kind='chief_private') always go to the Chief.
    """
    if session.channel_id and getattr(session, "kind", "chat") != "chief_private":
        # JSONB contains operator: use Python-side filter (RLS scopes to company)
        candidates = (
            db.query(Helper)
            .filter(Helper.status == "active")
            .all()
        )
        for h in candidates:
            if session.channel_id in (h.channel_ids or []):
                return h

    # Chief fallback
    chief = (
        db.query(Helper)
        .filter(Helper.is_chief.is_(True), Helper.status == "active")
        .first()
    )
    if chief is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "No Helper is configured for this company. "
                "Create a Chief Helper (is_chief=true) to enable chat turns."
            ),
        )
    return chief


def _persist_assistant_message(
    db: Session,
    *,
    company_id: str,
    session_id: str,
    helper: Helper,
    job: Job,
) -> Message | None:
    """Persist the assistant Message after the job completes.

    - done job  → use job.result_text (or Report headline/body if present).
    - waiting job → persist a short "awaiting approval" note.
    - failed job → persist a short error note.
    Returns the persisted Message or None if nothing to write.
    """
    now = datetime.now(timezone.utc)
    author = {
        "kind": "helper",
        "name": helper.name,
        "area": helper.area,
    }

    if job.status == "done":
        content = job.result_text or "(no output)"
        # If a Report was written, prefer its body_md
        report = (
            db.query(Report)
            .filter(Report.job_id == job.id)
            .first()
        )
        if report and report.body_md:
            content = report.body_md

    elif job.status == "waiting":
        content = (
            "I've proposed an action for your approval. "
            "Please review the request in your inbox."
        )

    else:  # failed
        content = f"I was unable to complete that request. ({job.error or 'unknown error'})"

    msg = Message(
        id=prefixed_id("msg"),
        company_id=company_id,
        session_id=session_id,
        author=author,
        content=content,
        created_at=now,
    )
    db.add(msg)
    db.flush()
    return msg


# ── Routes ────────────────────────────────────────────────────────────────────


@router.post(
    "/sessions",
    response_model=SessionOutDTO,
    response_model_by_alias=True,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def create_session(
    body: CreateSessionBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    """Create a new chat session for the authenticated company."""
    kind = body.kind or "chat"
    if kind not in ("chat", "chief_private"):
        raise HTTPException(status_code=422, detail="kind must be 'chat' or 'chief_private'.")
    channel_id = body.channel_id
    folder_id = body.folder_id
    if folder_id:
        folder = db.query(Folder).filter(Folder.id == folder_id).first()
        if folder is None:
            raise HTTPException(status_code=422, detail="Unknown folder.")
        channel_id = channel_id or folder.channel_id
    goal_label = None
    if body.goal_id:
        goal = db.query(Goal).filter(Goal.id == body.goal_id).first()
        if goal is None:
            raise HTTPException(status_code=422, detail="Unknown goal.")
        goal_label = goal.title
    if kind == "chief_private":
        # Private Chief threads live outside every area/folder.
        channel_id = None
        folder_id = None
    session = ChatSession(
        id=prefixed_id("ses"),
        company_id=ctx.company_id,
        title=body.title or "New chat",
        channel_id=channel_id,
        folder_id=folder_id,
        goal_id=body.goal_id if goal_label else None,
        goal=goal_label,
        model=body.model,
        kind=kind,
        owner_user_id=ctx.user_id,
        updated="now",
    )
    db.add(session)
    db.flush()
    return _session_dto(session, ctx.user_id)


@router.post(
    "/sessions/{session_id}/messages",
    status_code=status.HTTP_200_OK,
)
def post_message(
    session_id: str,
    body: PostMessageBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    """Post an operator message to a session and run the Helper turn.

    Steps:
    a. Load + 404-guard the session (RLS enforces company scoping).
    b. Persist the operator Message (role='you').
    c. Pick the Helper (channel helper → Chief → 409).
    d. start_job → run the Helper turn inline.
    e. Persist the assistant Message.
    f. Return {message: <operator MessageDTO>, job_id: <job.id>}.
    """
    # ── a. Load session (RLS already scopes to ctx.company_id) ───────────────
    from omilo.api.chat_workspace import load_visible_session  # sweep/chat

    session = load_visible_session(db, ctx, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    if body.model:
        session.model = body.model

    # ── b. Persist operator message ───────────────────────────────────────────
    now = datetime.now(timezone.utc)
    op_msg = Message(
        id=prefixed_id("msg"),
        company_id=ctx.company_id,
        session_id=session_id,
        author={"kind": "you", "name": "You"},
        content=body.content,
        created_at=now,
    )
    db.add(op_msg)
    db.flush()

    # ── c. Pick helper ────────────────────────────────────────────────────────
    helper = _pick_helper(db, session, ctx.company_id)

    # ── d. Run the Helper turn ────────────────────────────────────────────────
    job = start_job(
        db,
        company_id=ctx.company_id,
        helper_id=helper.id,
        origin="chat",
        brief=body.content,
        session_id=session_id,
    )

    # ── e. Persist assistant message ──────────────────────────────────────────
    _persist_assistant_message(
        db,
        company_id=ctx.company_id,
        session_id=session_id,
        helper=helper,
        job=job,
    )

    # ── f. Return operator message DTO + job_id ───────────────────────────────
    return {
        "message": _message_dto(op_msg),
        "job_id": job.id,
    }
