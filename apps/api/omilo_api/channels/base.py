"""Channel adapter seam — generic, platform-agnostic interfaces.

Nothing in this module is Telegram-specific.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


@dataclass
class InboundEvent:
    """Normalised inbound event from any channel adapter."""

    connection_id: str
    kind: str
    platform_user_id: str
    sender_display: str
    role: str
    thread_key: str
    text: str
    payload: dict = field(default_factory=dict)


@dataclass
class OutMessage:
    """Outbound message to send through a channel adapter."""

    text: str
    buttons: list | None = None


@dataclass
class SendResult:
    """Result of a send operation."""

    ok: bool
    error: str | None = None


@runtime_checkable
class ChannelAdapter(Protocol):
    """Protocol every channel adapter must satisfy."""

    kind: str

    def connect(self, config: dict) -> dict:
        """Initialise a connection from *config* and return a connection handle."""
        ...

    def disconnect(self, conn) -> None:
        """Tear down the connection handle returned by *connect*."""
        ...

    def verify_inbound(self, conn, headers: dict) -> bool:
        """Return True when the inbound request passes authentication."""
        ...

    def normalize_inbound(self, conn, raw: dict) -> list[InboundEvent]:
        """Parse the raw webhook payload into a list of InboundEvents."""
        ...

    def classify_sender(self, conn, platform_user_id: str) -> str:
        """Return the role string for the given platform user."""
        ...

    def send(self, conn, target: str, message: OutMessage) -> SendResult:
        """Deliver *message* to *target* and return the result."""
        ...
