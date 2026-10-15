"""Database tables. Names follow the spec's data model (docs/SPEC.md)."""
import datetime as dt
import secrets

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


class User(Base):
    __tablename__ = "user"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("usr"))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="owner")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuthToken(Base):
    """Browser sessions and personal API tokens (CLI). Only the SHA-256 of the token is stored."""

    __tablename__ = "auth_token"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("tok"))
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))  # session | api
    name: Mapped[str] = mapped_column(String(255), default="")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Setting(Base):
    """Key/value settings changed from the UI (pause switch, company name, ...)."""

    __tablename__ = "setting"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict | list | str | int | float | bool | None] = mapped_column(JSON)


class Staff(Base):
    __tablename__ = "staff"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # slug, e.g. "marketing"
    name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(64), default="")  # template it came from
    is_chief: Mapped[bool] = mapped_column(Boolean, default=False)
    job: Mapped[str] = mapped_column(Text, default="")
    engine: Mapped[dict] = mapped_column(JSON, default=dict)  # {"type": "hermes"|"fake", "base_url", "model", "api_key_env"}
    permissions: Mapped[dict] = mapped_column(JSON, default=dict)  # {"actions": {"content.publish": 1, ...}}
    budget_usd_month: Mapped[float] = mapped_column(Float, default=0)
    max_task_minutes: Mapped[int] = mapped_column(Integer, default=30)
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | paused
    mcp_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    mcp_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)  # encrypted, so the worker can hand it to the engine
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    shifts: Mapped[list["Shift"]] = relationship(back_populates="staff", cascade="all, delete-orphan")


class Shift(Base):
    __tablename__ = "shift"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("sh"))
    staff_id: Mapped[str] = mapped_column(ForeignKey("staff.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(128))
    cron: Mapped[str] = mapped_column(String(64))
    brief: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    next_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    staff: Mapped[Staff] = relationship(back_populates="shifts")


class Task(Base):
    __tablename__ = "task"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("tsk"))
    staff_id: Mapped[str] = mapped_column(ForeignKey("staff.id", ondelete="CASCADE"), index=True)
    origin: Mapped[str] = mapped_column(String(16))  # shift | manual | chat | delegation | execution
    brief: Mapped[str] = mapped_column(Text, default="")
    founder_note: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)  # queued|running|done|failed|cancelled
    parent_task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    proposal_id: Mapped[str | None] = mapped_column(String(32), nullable=True)  # for execution tasks
    shift_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, default=0)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    result_text: Mapped[str] = mapped_column(Text, default="")
    engine_type: Mapped[str] = mapped_column(String(32), default="")


class Checkpoint(Base):
    __tablename__ = "checkpoint"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("ckp"))
    task_id: Mapped[str] = mapped_column(ForeignKey("task.id", ondelete="CASCADE"), index=True)
    plan: Mapped[list | dict] = mapped_column(JSON, default=list)
    done: Mapped[str] = mapped_column(Text, default="")
    next: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)


class Report(Base):
    __tablename__ = "report"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("rpt"))
    task_id: Mapped[str] = mapped_column(ForeignKey("task.id", ondelete="CASCADE"), unique=True)
    staff_id: Mapped[str] = mapped_column(String(64), index=True)
    headline: Mapped[str] = mapped_column(String(300))
    body_md: Mapped[str] = mapped_column(Text, default="")
    kpis: Mapped[dict] = mapped_column(JSON, default=dict)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)


class Proposal(Base):
    __tablename__ = "proposal"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("prp"))
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    staff_id: Mapped[str] = mapped_column(String(64), index=True)
    type: Mapped[str] = mapped_column(String(64), default="other")  # action type, e.g. content.publish
    risk: Mapped[str] = mapped_column(String(8), default="medium")
    title: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    # pending | approved | rejected | changes_requested | executing | done | failed
    current_revision: Mapped[int] = mapped_column(Integer, default=1)
    decision_note: Mapped[str] = mapped_column(Text, default="")
    decided_by: Mapped[str] = mapped_column(String(64), default="")
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    execution_task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    result: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)

    revisions: Mapped[list["ProposalRevision"]] = relationship(
        back_populates="proposal", cascade="all, delete-orphan", order_by="ProposalRevision.n"
    )


class ProposalRevision(Base):
    __tablename__ = "proposal_revision"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("rev"))
    proposal_id: Mapped[str] = mapped_column(ForeignKey("proposal.id", ondelete="CASCADE"), index=True)
    n: Mapped[int] = mapped_column(Integer)
    body_md: Mapped[str] = mapped_column(Text)
    author: Mapped[str] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(Text, default="")
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)

    proposal: Mapped[Proposal] = relationship(back_populates="revisions")


class InboxItem(Base):
    __tablename__ = "inbox_item"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("inb"))
    kind: Mapped[str] = mapped_column(String(16))  # proposal | question | alert
    ref_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    staff_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str] = mapped_column(Text, default="")
    level: Mapped[str] = mapped_column(String(16), default="decision")  # critical | decision | fyi
    blocking: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)  # open | done | snoozed
    answer: Mapped[str] = mapped_column(Text, default="")
    snooze_until: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Thread(Base):
    __tablename__ = "thread"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("thr"))
    scope: Mapped[str] = mapped_column(String(16))  # master | staff | task | proposal
    ref_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    staff_id: Mapped[str] = mapped_column(String(64))  # who answers in this thread
    title: Mapped[str] = mapped_column(String(300), default="")
    awaiting_reply: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    engine_session: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Message(Base):
    __tablename__ = "message"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("msg"))
    thread_id: Mapped[str] = mapped_column(ForeignKey("thread.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # owner | agent | system
    author: Mapped[str] = mapped_column(String(64))
    text: Mapped[str] = mapped_column(Text, default="")
    blocks: Mapped[list] = mapped_column(JSON, default=list)  # typed blocks (see docs/SPEC.md "Rich messages")
    channel: Mapped[str] = mapped_column(String(16), default="web")
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class KpiValue(Base):
    __tablename__ = "kpi_value"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("kpi"))
    name: Mapped[str] = mapped_column(String(64), index=True)
    value: Mapped[float] = mapped_column(Float)
    period: Mapped[str] = mapped_column(String(32), default="")
    source: Mapped[str] = mapped_column(Text, default="")
    staff_id: Mapped[str] = mapped_column(String(64), default="")
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuditEvent(Base):
    __tablename__ = "audit_event"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    actor: Mapped[str] = mapped_column(String(64))  # user id | staff:<id> | system
    action: Mapped[str] = mapped_column(String(64))
    ref: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[dict] = mapped_column(JSON, default=dict)


class ToolCall(Base):
    __tablename__ = "tool_call"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    staff_id: Mapped[str] = mapped_column(String(64), index=True)
    task_id: Mapped[str] = mapped_column(String(32), default="")
    tool: Mapped[str] = mapped_column(String(64))
    decision: Mapped[str] = mapped_column(String(16))  # allowed | proposal | refused | error
    detail: Mapped[str] = mapped_column(Text, default="")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)


class RunEvent(Base):
    """What an agent is doing right now, for the live view: status, reasoning, text, tool calls, sources, usage."""
    __tablename__ = "run_event"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    staff_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    thread_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(16))  # status | thinking | text | tool | sources | usage | browser | session
    data: Mapped[dict] = mapped_column(JSON, default=dict)


class HarnessAccount(Base):
    """One Claude Code subscription in the harness pool (long-lived token from `claude setup-token`)."""
    __tablename__ = "harness_account"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("hac"))
    label: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(32), default="claude-code")
    token_enc: Mapped[str] = mapped_column(Text)
    token_hint: Mapped[str] = mapped_column(String(16), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(16), default="new")  # new | ready | cooling | error
    cooldown_until: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="")
    runs: Mapped[int] = mapped_column(Integer, default=0)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
