"""Channel adapter registry — keyed by adapter.kind."""
from __future__ import annotations

from omilo_api.channels.base import ChannelAdapter

_ADAPTERS: dict[str, ChannelAdapter] = {}


def register(adapter: ChannelAdapter) -> None:
    """Store *adapter* in the registry under its .kind key."""
    _ADAPTERS[adapter.kind] = adapter


def adapter_for(kind: str) -> ChannelAdapter | None:
    """Return the adapter registered for *kind*, or None if unknown."""
    return _ADAPTERS.get(kind)
