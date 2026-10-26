"""RequestContext — the resolved identity for a single request or worker task.

Populated by the auth dependency (Task 5).  Every downstream component
(get_db, authorization checks, audit logging) reads from this dataclass.
"""
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RequestContext:
    """Immutable per-request identity."""

    user_id: str
    company_id: str
    role: str  # MemberRole: "owner" | "admin" | "member"
