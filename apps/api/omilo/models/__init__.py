"""ORM model registry — import all models so Base.metadata is complete.

Alembic's env.py imports ``omilo.db.Base``; importing this module registers
all tables onto that metadata so autogenerate / upgrade sees them.
"""
from omilo.models.tenancy import Company, Member, User  # noqa: F401
from omilo.models.workspace import Channel, Folder, Goal  # noqa: F401
from omilo.models.chat import ChatSession, Message  # noqa: F401
from omilo.models.inbox import InboxItem  # noqa: F401
from omilo.models.agents import Helper  # noqa: F401
from omilo.models.execution import Job, Report, RunEvent  # noqa: F401
from omilo.models.approvals import Proposal, ProposalRevision, SafetyLimit  # noqa: F401
from omilo.models.routines import Routine, RoutineRun  # noqa: F401
from omilo.models.flows import Flow, FlowRun  # noqa: F401
from omilo.models.toolcall import ToolCall  # noqa: F401
from omilo.models.knowledge import KbSource, KbChunk  # noqa: F401
from omilo.models.memory import MemoryDoc  # noqa: F401
from omilo.models.skills import Skill  # noqa: F401
from omilo.models.improvement import Improvement  # noqa: F401
from omilo.models.billing import Plan, CreditLedger, Subscription, Invoice  # noqa: F401
from omilo.models.accounts import HarnessAccount, ProviderKey  # noqa: F401
from omilo.models.pieces import Piece  # noqa: F401
from omilo.models.connectors import Connector  # noqa: F401
from omilo.models.helper_access import HelperAccess  # noqa: F401

__all__ = [
    "Company",
    "User",
    "Member",
    "Channel",
    "Folder",
    "Goal",
    "ChatSession",
    "Message",
    "InboxItem",
    "Helper",
    "Job",
    "Report",
    "RunEvent",
    "Proposal",
    "ProposalRevision",
    "SafetyLimit",
    "Routine",
    "RoutineRun",
    "Flow",
    "FlowRun",
    "ToolCall",
    "KbSource",
    "KbChunk",
    "MemoryDoc",
    "Skill",
    "Improvement",
    "Plan",
    "CreditLedger",
    "Subscription",
    "Invoice",
    "HarnessAccount",
    "ProviderKey",
    "Piece",
    "Connector",
    "HelperAccess",
]
