"""Model mixins: id (text PK) and created_at (timestamptz).

`prefixed_id(prefix)` is a runtime helper for generating prefixed IDs at seed /
application time. The ID column itself is a plain `text` PK — the prefix scheme
is naming convention, not enforced by the DB type.
"""
from __future__ import annotations

import secrets
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, text
from sqlalchemy.orm import Mapped, mapped_column


# ---------------------------------------------------------------------------
# Runtime ID factory
# ---------------------------------------------------------------------------

def prefixed_id(prefix: str) -> str:
    """Return a new prefixed pseudo-ULID: e.g. ``cmp_01HX...``.

    Uses time (ms) + random bytes for sortability and uniqueness without
    requiring the external ``python-ulid`` library.  Format::

        {prefix}_{base32_crockford_26_chars}

    Suitable for seeding; real IDs from the live service will follow the
    same scheme.
    """
    # 10-byte timestamp (ms) + 16 random bytes → 26-char Crockford base32
    ts_ms = int(time.time() * 1000)
    rand = secrets.token_bytes(10)
    combined = ts_ms.to_bytes(6, "big") + rand  # 16 bytes total
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    num = int.from_bytes(combined, "big")
    chars: list[str] = []
    for _ in range(26):
        num, remainder = divmod(num, 32)
        chars.append(alphabet[remainder])
    return f"{prefix}_{(''.join(reversed(chars))).lower()}"


# ---------------------------------------------------------------------------
# Mixins
# ---------------------------------------------------------------------------

class IdMixin:
    """Text primary key column (``id text PK``)."""

    id: Mapped[str] = mapped_column(primary_key=True)


class TimestampMixin:
    """``created_at`` timestamptz column, defaulting to now (server-side)."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
        nullable=False,
    )
