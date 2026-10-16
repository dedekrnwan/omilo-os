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
    engine: Mapped[dict] = mapped_column(JSON, default=dict)  # {"type": "claude-code"|"claude"|"fake", "auth": "api"|None (pool), "model"}
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


class Connector(Base):
    """An MCP server every helper can use (Gmail, Calendar, GitHub, your own systems…)."""
    __tablename__ = "connector"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # slug, used in tool names: mcp__<id>__<tool>
    label: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16), default="http")  # http | stdio
    url: Mapped[str] = mapped_column(Text, default="")
    command: Mapped[str] = mapped_column(Text, default="")
    args: Mapped[list] = mapped_column(JSON, default=list)
    secrets_enc: Mapped[str] = mapped_column(Text, default="")  # encrypted JSON {"headers": {...}, "env": {...}}
    approval: Mapped[str] = mapped_column(String(8), default="ask")  # auto | ask
    default_on: Mapped[bool] = mapped_column(Boolean, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)


class Folder(Base):
    """A folder on this computer that helpers may use."""
    __tablename__ = "folder"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("fld"))
    path: Mapped[str] = mapped_column(Text)
    label: Mapped[str] = mapped_column(String(120), default="")
    access: Mapped[str] = mapped_column(String(8), default="read")  # read | write
    commands: Mapped[bool] = mapped_column(Boolean, default=False)  # may run terminal commands there (development)
    default_on: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)


class ThreadTools(Base):
    """What a chat has switched on: folders, connectors, skills (overrides the defaults)."""
    __tablename__ = "thread_tools"
    thread_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    folders: Mapped[list | None] = mapped_column(JSON, nullable=True)
    connectors: Mapped[list | None] = mapped_column(JSON, nullable=True)
    skills: Mapped[list | None] = mapped_column(JSON, nullable=True)


class Notice(Base):
    """Something the owner may want to hear about right away: an inbox item, a helper's reply, a finished or failed job.
    The web app streams these (/api/stream) and Web Push delivers them when no tab is open."""
    __tablename__ = "notice"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    kind: Mapped[str] = mapped_column(String(16))  # inbox | reply | job_done | job_failed | test
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(String(300), default="/")
    tag: Mapped[str] = mapped_column(String(80), default="")  # same tag replaces the previous notification
    level: Mapped[str] = mapped_column(String(16), default="info")  # critical | decision | info


class PushSub(Base):
    """A browser that accepted Web Push for the owner."""
    __tablename__ = "push_sub"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("psh"))
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    endpoint: Mapped[str] = mapped_column(Text)
    keys: Mapped[dict] = mapped_column(JSON, default=dict)
    agent: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_ok_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class HarnessUsage(Base):
    """Tokens one pool account spent on one run, to estimate its usage in the current 5-hour window."""
    __tablename__ = "harness_usage"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(String(32), index=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)


class HarnessQuota(Base):
    """The latest limit Claude Code reported for an account (rate_limit_event): per window, how much is used and when it resets."""
    __tablename__ = "harness_quota"
    account_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    window: Mapped[str] = mapped_column(String(24), primary_key=True)  # five_hour | seven_day | seven_day_opus | ...
    status: Mapped[str] = mapped_column(String(24), default="allowed")  # allowed | allowed_warning | rejected
    utilization: Mapped[float | None] = mapped_column(Float, nullable=True)  # 0..1 when Claude reports it
    resets_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)


class HarnessLimitHit(Base):
    """When a pool account reached its usage limit (for the pool history on the Monitor page)."""
    __tablename__ = "harness_limit_hit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    account_id: Mapped[str] = mapped_column(String(32), index=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    resets_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DocVersion(Base):
    """One saved version of a doc in the vault (or a helper's suggested change waiting for approval)."""
    __tablename__ = "doc_version"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    path: Mapped[str] = mapped_column(String(400), index=True)
    version: Mapped[int] = mapped_column(Integer, default=0)  # 0 for suggestions
    content: Mapped[str] = mapped_column(Text, default="")
    author: Mapped[str] = mapped_column(String(64), default="")  # user id, staff id, or "outside"
    author_kind: Mapped[str] = mapped_column(String(16), default="owner")  # owner | agent | outside
    summary: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(16), default="saved")  # saved | suggested | rejected | deleted
    proposal_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class Improvement(Base):
    """A change the weekly retro made to a helper (instructions, a schedule, its lessons), measured and reversible."""

    __tablename__ = "improvement"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("imp"))
    by: Mapped[str] = mapped_column(String(64))            # who made it: the Chief of Staff (or "owner")
    staff_id: Mapped[str] = mapped_column(String(64), index=True)  # the helper that was changed
    kind: Mapped[str] = mapped_column(String(24))          # job | shift_brief | shift_schedule | lessons
    ref: Mapped[str] = mapped_column(String(64), default="")  # shift id for shift_* kinds
    before: Mapped[dict] = mapped_column(JSON, default=dict)
    after: Mapped[dict] = mapped_column(JSON, default=dict)
    reason: Mapped[str] = mapped_column(Text, default="")
    baseline: Mapped[dict] = mapped_column(JSON, default=dict)  # scores before the change
    result: Mapped[dict] = mapped_column(JSON, default=dict)    # scores after it, when measured
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)  # active | kept | rolled_back | undone
    task_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    evaluated_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Goal(Base):
    """A goal you set. The Chief of Staff links the work it hands out to a goal, so the Plan shows goal → jobs → sub-jobs."""

    __tablename__ = "goal"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("gol"))
    title: Mapped[str] = mapped_column(String(300))
    target: Mapped[str] = mapped_column(Text, default="")   # what success looks like, with numbers
    due: Mapped[str] = mapped_column(String(32), default="")  # e.g. 2026-12-31
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)  # active | done | dropped
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String(64), default="owner")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=now)


class TaskGoal(Base):
    __tablename__ = "task_goal"
    task_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    goal_id: Mapped[str] = mapped_column(String(32), index=True)


class ShiftGoal(Base):
    """A regular job that serves a goal: every run of it counts toward that goal."""

    __tablename__ = "shift_goal"
    shift_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    goal_id: Mapped[str] = mapped_column(String(32), index=True)
