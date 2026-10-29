"""Pydantic v2 read DTOs — exact key parity with src/core/domain/types.ts.

All DTOs use:
  - alias_generator=to_camel  → snake_case Python fields → camelCase JSON keys
  - populate_by_name=True     → can be built by snake_case name too
  - from_attributes=True      → model_validate(orm_obj) works

Dump with: model_dump(by_alias=True, exclude_none=True)

Server-only columns (company_id, raw created_at on Channel/Folder/Goal/Session)
must NOT appear in the output. Message and InboxItem DO expose createdAt as an
ISO-8601 string (it is declared in types.ts).

Required fields that may be falsy (progress=0, count=0, open_items=0, etc.)
are typed without Optional so exclude_none=True will never drop them.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator, model_validator
from pydantic.alias_generators import to_camel


# ── shared config ────────────────────────────────────────────────────────────

_CFG = ConfigDict(
    alias_generator=to_camel,
    populate_by_name=True,
    from_attributes=True,
)


# ────────────────────────────────────────────────────────────────────────────
# Channel
# ────────────────────────────────────────────────────────────────────────────

class ChannelDTO(BaseModel):
    """TS: Channel{id,name,accent,isDefault?,agentCount,chatCount,openItems,
    icon?,purpose?,contextScope}."""

    model_config = _CFG

    id: str
    name: str
    accent: str
    is_default: Optional[bool] = None  # optional in TS; omitted when None
    agent_count: int  # required — 0 must survive exclude_none
    chat_count: int   # required
    open_items: int   # required
    # P5d additions — area context (icon/purpose/contextScope)
    icon: Optional[str] = None          # → icon?  (lucide icon name)
    purpose: Optional[str] = None       # → purpose?
    context_scope: str = "isolated"     # → contextScope  (never None)


# ────────────────────────────────────────────────────────────────────────────
# Folder
# ────────────────────────────────────────────────────────────────────────────

class FolderDTO(BaseModel):
    """TS: Folder{id,channelId,name,count}."""

    model_config = _CFG

    id: str
    channel_id: str  # → channelId
    name: str
    count: int  # required — 0 must survive exclude_none


# ────────────────────────────────────────────────────────────────────────────
# Goal
# ────────────────────────────────────────────────────────────────────────────

class GoalDTO(BaseModel):
    """TS: Goal{id,channelId,title,progress,status?,target?,due?,measuredBy?,
    helperIds?,period?,sessionId?,statusSetBy?}."""

    model_config = _CFG

    id: str
    channel_id: str  # → channelId
    title: str
    progress: int    # required — 0 must survive exclude_none
    # sweep/goals-routines — optional; omitted when None
    status: Optional[str] = None          # on_track|at_risk|blocked|needs_you|done
    target: Optional[str] = None
    due: Optional[str] = None
    measured_by: Optional[str] = None     # → measuredBy
    helper_ids: Optional[list[str]] = None  # → helperIds
    period: Optional[str] = None          # e.g. "2026-Q4"
    session_id: Optional[str] = None      # → sessionId
    status_set_by: Optional[str] = None   # → statusSetBy ('user'|'system')


# ────────────────────────────────────────────────────────────────────────────
# Session
# ────────────────────────────────────────────────────────────────────────────

class SessionDTO(BaseModel):
    """TS: Session{id,title,channelId?,folderId?,updated,unread?,goal?,participants?}.

    Note: the class is SessionDTO to avoid clashing with SQLAlchemy Session.
    participants? is [{name, area}] — passed through as list[dict] from JSONB.
    """

    model_config = _CFG

    id: str
    title: str
    channel_id: Optional[str] = None      # → channelId?
    folder_id: Optional[str] = None       # → folderId?
    updated: str                           # required; verbatim relative label
    unread: Optional[bool] = None          # → unread?
    goal: Optional[str] = None             # → goal? (string label)
    participants: Optional[list[Any]] = None  # → participants? [{name,area}]


# ────────────────────────────────────────────────────────────────────────────
# Message
# ────────────────────────────────────────────────────────────────────────────

class MessageDTO(BaseModel):
    """TS: Message{id,sessionId,author,content,createdAt,system?,attachment?,actions?}.

    author: {kind,name,role?,area?} — passed through as dict from JSONB.
    attachment?: {title,meta} — dict or None.
    actions?: [{label,primary?}] — list[dict] or None.
    createdAt: ISO-8601 string serialized from datetime.
    """

    model_config = _CFG

    id: str
    session_id: str           # → sessionId
    author: dict[str, Any]    # {kind,name,role?,area?}
    content: str
    created_at: datetime      # → createdAt (serialized as ISO string below)
    system: Optional[bool] = None          # → system?
    attachment: Optional[dict[str, Any]] = None  # → attachment?
    actions: Optional[list[Any]] = None    # → actions?

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime, _info: Any) -> str:
        return value.isoformat()


# ────────────────────────────────────────────────────────────────────────────
# InboxItem
# ────────────────────────────────────────────────────────────────────────────

class InboxItemDTO(BaseModel):
    """TS: InboxItem{id,title,summary,sessionId,channelId,kind,status,createdAt,
    asker,askerArea,askedAgo?,needsYou?,proposals?,actions?,reassurance?,
    compact?,progress?,meta?}.

    createdAt: ISO-8601 string serialized from datetime.
    proposals?: [{who,area,text,due}] — list[dict] from JSONB.
    actions?:   [{label,primary?,icon?}] — list[dict] from JSONB.
    progress?:  {step,total,elapsed} — dict from JSONB.
    """

    model_config = _CFG

    id: str
    title: str
    summary: str
    session_id: str    # → sessionId
    channel_id: str    # → channelId
    kind: str
    status: str
    created_at: datetime  # → createdAt (ISO string)
    asker: str
    asker_area: str        # → askerArea
    # Optional fields
    asked_ago: Optional[str] = None          # → askedAgo?
    needs_you: Optional[bool] = None         # → needsYou?
    proposals: Optional[list[Any]] = None    # → proposals?
    actions: Optional[list[Any]] = None      # → actions?
    reassurance: Optional[str] = None        # → reassurance?
    compact: Optional[bool] = None           # → compact?
    progress: Optional[dict[str, Any]] = None  # → progress?
    meta: Optional[str] = None               # → meta?
    # ── sweep/inbox-flows ──
    read_at: Optional[datetime] = None       # → readAt?
    updated_at: Optional[datetime] = None    # → updatedAt?

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime, _info: Any) -> str:
        return value.isoformat()


# ── sweep/goals-routines ──
# GoalDTO gained optional fields (status/target/due/measuredBy/helperIds/
# period/sessionId/statusSetBy) — see the Goal section above.
    # ── sweep/inbox-flows ──
    @field_serializer("read_at", "updated_at")
    def serialize_opt_dt(self, value: Optional[datetime], _info: Any) -> Optional[str]:
        return value.isoformat() if value else None

    @field_validator("proposals", mode="before")
    @classmethod
    def _proposals_as_list(cls, value: Any) -> Any:
        # Writers (runner / flows / skills / mcp) store a single dict
        # {proposal_id, type, risk}; the contract is a list.
        if isinstance(value, dict):
            return [value]
        return value

    @model_validator(mode="after")
    def _normalise_proposals(self) -> "InboxItemDTO":
        if self.proposals:
            self.proposals = [
                normalise_inbox_proposal(p, self) for p in self.proposals if isinstance(p, dict)
            ]
        return self


# ── sweep/inbox-flows ──

_PROPOSAL_KEY_MAP = {
    "proposal_id": "proposalId",
    "flow_id": "flowId",
    "flow_run_id": "flowRunId",
    "node_id": "nodeId",
}


def normalise_inbox_proposal(entry: dict[str, Any], item: Any) -> dict[str, Any]:
    """Normalise one ``proposals`` entry to the TS InboxProposal shape.

    Output: {who, area, text, due, proposalId?, type?, risk?, flowId?, flowRunId?, nodeId?}
    — ``who``/``area``/``text`` default to the item's asker / askerArea / title.
    """
    out: dict[str, Any] = {}
    for key, value in entry.items():
        out[_PROPOSAL_KEY_MAP.get(key, key)] = value
    out.setdefault("who", getattr(item, "asker", ""))
    out.setdefault("area", getattr(item, "asker_area", ""))
    out.setdefault("text", getattr(item, "title", ""))
    out.setdefault("due", "")
    return {k: v for k, v in out.items() if v is not None}
# ── sweep/chat ────────────────────────────────────────────────────────────────
# Extended read DTOs for the persisted sidebar (pins/archive/folders/looks).
# Every new key is optional and omitted when None, so the base TS types stay
# valid and existing parity tests keep their exact key sets.


class ChannelOutDTO(ChannelDTO):
    """Channel + custom look colour (TS: Channel.color?)."""

    color: Optional[str] = None


class FolderOutDTO(FolderDTO):
    """Folder + look + instructions (TS: Folder.icon?/color?/instructions?)."""

    icon: Optional[str] = None
    color: Optional[str] = None
    instructions: Optional[str] = None


class SessionOutDTO(SessionDTO):
    """Session + per-user pin, archive state, goal link, model, kind."""

    pinned: Optional[bool] = None
    archived_at: Optional[datetime] = None
    goal_id: Optional[str] = None
    model: Optional[str] = None
    kind: Optional[str] = None

    @field_serializer("archived_at")
    def serialize_archived_at(self, value: Optional[datetime], _info: Any) -> Optional[str]:
