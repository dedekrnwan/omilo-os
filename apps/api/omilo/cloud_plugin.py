"""Optional cloud plugin — the commercial side of Omilo Cloud lives outside this repo.

Omilo runs fully without it: self-hosted / local mode is free and unlimited.
A hosted Omilo Cloud loads a private plugin that supplies what is business, not
product:

    plans           the plan catalog sold on Omilo Cloud (prices, storage, bullets)
    packs           prepaid AI credit packs (only when pooled AI is offered)
    trial_plan_id   the plan a new cloud company trials
    idr_per_credit  internal rate for AI-spend caps
    payment         a payment-provider factory (hosted checkout gateway)
    routers         extra FastAPI routers (e.g. the gateway's webhook)
    on_startup      called once when the API starts

How it is found (first match wins):

    OMILO_CLOUD_PLUGIN=<module>              e.g. ``omilo_cloud``
    entry point group ``omilo.cloud``        (``pip install omilo-cloud``)

The module exposes ``plugin() -> CloudPlugin``. Without a plugin the catalog
holds only the self-hosted plan, nothing is sold, and storage has no limit.
"""
from __future__ import annotations

import importlib
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Callable

log = logging.getLogger(__name__)


@dataclass
class CloudPlugin:
    name: str
    plans: list[dict[str, Any]] = field(default_factory=list)
    packs: list[dict[str, Any]] = field(default_factory=list)
    trial_plan_id: str | None = None
    idr_per_credit: int = 50
    plan_aliases: dict[str, str] = field(default_factory=dict)
    pack_aliases: dict[str, str] = field(default_factory=dict)
    # () -> PaymentProvider | None; return None to fall back to the built-in providers.
    payment: Callable[[], Any] | None = None
    routers: list[Any] = field(default_factory=list)
    on_startup: Callable[[], None] | None = None


_loaded: CloudPlugin | None = None
_resolved = False


def _from_entry_point() -> Any | None:
    try:
        from importlib.metadata import entry_points

        eps = entry_points(group="omilo.cloud")
    except Exception:  # noqa: BLE001
        return None
    for ep in eps:
        return ep.load()
    return None


def get() -> CloudPlugin | None:
    """The installed cloud plugin, or None (open-source / self-hosted)."""
    global _loaded, _resolved
    if _resolved:
        return _loaded
    _resolved = True
    name = os.environ.get("OMILO_CLOUD_PLUGIN", "").strip()
    factory: Any = None
    if name and name.lower() not in ("0", "none", "off"):
        mod = importlib.import_module(name)
        factory = getattr(mod, "plugin")
    elif not name:
        factory = _from_entry_point()
    if factory is not None:
        _loaded = factory() if callable(factory) else factory
        log.info("Omilo cloud plugin loaded: %s", getattr(_loaded, "name", "?"))
    return _loaded


def reset() -> None:
    """Forget the cached plugin (tests)."""
    global _loaded, _resolved
    _loaded, _resolved = None, False
