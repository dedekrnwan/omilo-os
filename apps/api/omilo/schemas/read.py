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

from pydantic import BaseModel, ConfigDict, Field, field_serializer
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
    """TS: Goal{id,channelId,title,progress}."""

    model_config = _CFG

    id: str
    channel_id: str  # → channelId
    title: str
    progress: int    # required — 0 must survive exclude_none


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

    @field_serializer("created_at")
    def serialize_created_at(self, value: datetime, _info: Any) -> str:
        return value.isoformat()
