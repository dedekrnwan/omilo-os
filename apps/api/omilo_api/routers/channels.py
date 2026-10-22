"""Telegram (and future) channel webhook ingress + connect routes.

Routes
------
POST /api/channels/telegram/hook/{webhook_token}
    Telegram webhook: no auth — the secret header + webhook_token in path are the keys.
    Tenant is resolved from the /co/<id>/ path prefix by CompanyMiddleware (same as
    /api/hooks/{token} in routers/workflows.py).

POST /api/channels/telegram/connect
    Authenticated: registers a Telegram bot and stores the ChannelConnection.

Dedup note
----------
update_id dedup uses a per-connection in-process set {connection_id: set[update_id]}.
LIMITATION: does not survive restarts; not safe in multi-replica deployments.
A future iteration should use Redis (SETNX with short TTL) or a DB unique constraint.
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import services as S
from ..channels import registry
from ..db import get_db
from ..models import ChannelConnection, ChannelIdentity
from ..security import current_user, encrypt

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/channels", tags=["channels"])

# ---------------------------------------------------------------------------
# In-process dedup store: {connection_id -> set[update_id]}
# LIMITATION: single-process, in-memory only. See module docstring.
# ---------------------------------------------------------------------------
_SEEN_UPDATES: dict[str, set[int]] = {}


def _already_seen(connection_id: str, update_id: int) -> bool:
    seen = _SEEN_UPDATES.setdefault(connection_id, set())
    if update_id in seen:
        return True
    seen.add(update_id)
    return False


# ---------------------------------------------------------------------------
# Telegram webhook ingress
# ---------------------------------------------------------------------------

@router.post("/telegram/hook/{webhook_token}")
async def telegram_hook(
    webhook_token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Telegram webhook — no auth required (webhook_token + secret header are the gate).

    Always returns {"ok": true} / 200 (except 404/403) so Telegram does not retry.
    """
    # 1. Resolve the ChannelConnection
    conn = db.scalar(
        select(ChannelConnection).where(ChannelConnection.webhook_token == webhook_token)
    )
    if conn is None:
        raise HTTPException(404, "no such connection")

    # 2. Verify the shared secret header (constant-time)
    adapter = registry.adapter_for(conn.kind)
    if adapter is None:
        # Adapter not registered — treat as config error; still 403 to Telegram
        raise HTTPException(403, "adapter not available")

    if not adapter.verify_inbound(conn, dict(request.headers)):
        raise HTTPException(403, "bad secret")

    # 3. Parse the update (best-effort; ignore malformed)
    try:
        raw: dict = await request.json()
    except Exception:  # noqa: BLE001
        return {"ok": True}

    update_id: int = raw.get("update_id", 0)

    # 4. Dedup by update_id (per connection, in-process)
    if _already_seen(conn.id, update_id):
        return {"ok": True}

    # 5. Normalize → list of InboundEvent
    events = adapter.normalize_inbound(conn, raw)

    for event in events:
        text = event.text or ""
        platform_user_id = event.platform_user_id

        # 5a. /start <code> — pairing handshake
        if text.startswith("/start "):
            code = text[len("/start "):].strip()
            if code:
                # Look up the owner identity to get omilo_user_id (may not exist yet)
                identity = db.scalar(
                    select(ChannelIdentity).where(
                        ChannelIdentity.connection_id == conn.id,
                        ChannelIdentity.role == "owner",
                    )
                )
                # Use whatever omilo_user_id is available; fall back to platform_user_id
                omilo_user_id = identity.omilo_user_id if identity else platform_user_id
                adapter.consume_pairing(
                    db,
                    code,
                    platform_user_id=platform_user_id,
                    omilo_user_id=omilo_user_id,
                    connection_id=conn.id,
                )
            continue

        # 5b. Classify sender: owner or not
        is_owner = _classify_owner(db, conn, platform_user_id)

        if not is_owner:
            # Strangers are silently ignored (no write)
            continue

        # 5c. Owner message → post to the staff thread + set channel=telegram + awaiting_reply
        identity = db.scalar(
            select(ChannelIdentity).where(
                ChannelIdentity.connection_id == conn.id,
                ChannelIdentity.platform_user_id == platform_user_id,
                ChannelIdentity.role == "owner",
            )
        )
        omilo_user_id = identity.omilo_user_id if identity else platform_user_id

        th = S.get_or_create_thread(db, "staff", None, conn.staff_id)
        # Set channel so deliver_outbound (Task 3) routes the reply back via Telegram
        th.channel = "telegram"
        db.commit()

        S.post_message(
            db,
            th,
            role="owner",
            author=omilo_user_id,
            text=text,
            channel="telegram",
            awaiting_reply=True,
        )

    return {"ok": True}


def _classify_owner(db: Session, conn: ChannelConnection, platform_user_id: str) -> bool:
    """Return True if the platform_user_id has role=owner for this connection."""
    identity = db.scalar(
        select(ChannelIdentity).where(
            ChannelIdentity.connection_id == conn.id,
            ChannelIdentity.platform_user_id == platform_user_id,
            ChannelIdentity.role == "owner",
        )
    )
    return identity is not None


# ---------------------------------------------------------------------------
# Telegram connect (authenticated)
# ---------------------------------------------------------------------------

class TelegramConnectIn(BaseModel):
    bot_token: str
    staff_id: str


@router.post("/telegram/connect")
def telegram_connect(
    body: TelegramConnectIn,
    db: Session = Depends(get_db),
    user=Depends(current_user),
):
    """Register a Telegram bot and create a ChannelConnection.

    Returns {pairing_code, deep_link} for the owner to tap.
    """
    adapter = registry.adapter_for("telegram")
    if adapter is None:
        raise HTTPException(500, "telegram adapter not registered")

    try:
        result = adapter.connect({
            "bot_token": body.bot_token,
            "mode": "control",
            "staff_id": body.staff_id,
        })
    except RuntimeError as e:
        raise HTTPException(502, str(e)) from None

    secrets_enc = encrypt(json.dumps(result["secrets"]))

    conn = ChannelConnection(
        kind="telegram",
        mode="control",
        staff_id=body.staff_id,
        webhook_token=result["webhook_token"],
        secrets_enc=secrets_enc,
        enabled=True,
    )
    db.add(conn)
    db.commit()

    return {
        "pairing_code": result["pairing_code"],
        "deep_link": result["deep_link"],
    }
