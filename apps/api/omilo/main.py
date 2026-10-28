import os

import uvicorn
from fastapi import FastAPI

from omilo.api.ai_accounts import router as ai_accounts_router
from omilo.api.webhooks import router as webhooks_router
from omilo.api.marketplace import router as marketplace_router
from omilo.api.connectors import router as connectors_router
from omilo.api.approvals import router as approvals_router
from omilo.api.company import router as company_router
from omilo.api.members import router as members_router
from omilo.api.mcp_tokens import router as mcp_tokens_router
from omilo.api.billing import router as billing_router
from omilo.api.wallet import router as wallet_router
from omilo.api.retro import router as retro_router
from omilo.api.channels import router as channels_router
from omilo.mcp.server import router as mcp_router
from omilo.mcp.external import router as mcp_external_router
from omilo.api.chat_write import router as chat_write_router
from omilo.api.folders import router as folders_router
from omilo.api.goals import router as goals_router
from omilo.api.goals_write import router as goals_write_router
from omilo.api.flows_write import router as flows_write_router
from omilo.api.helpers import router as helpers_router
from omilo.api.analytics import router as analytics_router
from omilo.api.knowledge import router as knowledge_router
from omilo.api.memory import router as memory_router
from omilo.api.skills import router as skills_router
from omilo.api.routines_write import router as routines_write_router
from omilo.api.health import router as health_router
from omilo.api.inbox import router as inbox_router
from omilo.api.sessions import router as sessions_router
from omilo.api.public_config import router as public_config_router
from omilo.api.telemetry_config import router as telemetry_config_router
from omilo.auth.router import me_router, router as auth_router
from omilo.auth.google import router as google_auth_router
from omilo.realtime.sse import router as sse_router
from omilo.realtime.ws import router as ws_router


def create_app() -> FastAPI:
    from omilo.config import get_settings
    from fastapi.middleware.cors import CORSMiddleware

    app = FastAPI(title="Omilo API", version="0.1.0")

    # CORS — allow the configured browser origins. Without this, a trailing-slash
    # redirect (e.g. /v1/channels/ → /v1/channels) resolves to the API's absolute
    # origin and escapes the Vite dev proxy, so the browser blocks it. Credentials
    # are not used (auth is a Bearer header), so this stays safe with explicit origins.
    _origins = [o.strip() for o in (get_settings().cors_origins or "").split(",") if o.strip()]
    if _origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(health_router, prefix="/v1")
    # Public pre-auth config: GET /v1/public-config (P9 T1) — NO auth required
    app.include_router(public_config_router, prefix="/v1")
    app.include_router(auth_router, prefix="/v1")
    app.include_router(google_auth_router, prefix="/v1")
    app.include_router(me_router, prefix="/v1")
    # Company profile: GET + PATCH /v1/company (P5d Task 1b)
    app.include_router(company_router, prefix="/v1")
    # Members list: GET /v1/members (P13)
    app.include_router(members_router, prefix="/v1")
    # Telemetry config: GET + POST /v1/telemetry-config (P7 Task 3)
    app.include_router(telemetry_config_router, prefix="/v1")
    # Repos-parity read endpoints (Task 7)
    app.include_router(channels_router, prefix="/v1")
    app.include_router(chat_write_router, prefix="/v1")
    app.include_router(folders_router, prefix="/v1")
    app.include_router(goals_router, prefix="/v1")
    app.include_router(goals_write_router, prefix="/v1")
    app.include_router(flows_write_router, prefix="/v1")
    app.include_router(routines_write_router, prefix="/v1")
    # Helpers + Analytics (Task 8 P2)
    app.include_router(helpers_router, prefix="/v1")
    app.include_router(analytics_router, prefix="/v1")
    # KB ingestion + recall (Task 3 P3)
    app.include_router(knowledge_router, prefix="/v1")
    # Memory docs (Task 4 P3)
    app.include_router(memory_router, prefix="/v1")
    # Skills CRUD + publish (Task 5 P3)
    app.include_router(skills_router, prefix="/v1")
    app.include_router(sessions_router, prefix="/v1")
    app.include_router(inbox_router, prefix="/v1")
    # Billing + payment provider (Task 4 P4)
    app.include_router(billing_router, prefix="/v1")
    # Wallet settings + payment history (Task 4 P5a)
    app.include_router(wallet_router, prefix="/v1")
    # AI accounts pool (Task 5 P4)
    app.include_router(ai_accounts_router, prefix="/v1")
    # Marketplace catalog + install (Task 6 P4)
    app.include_router(marketplace_router, prefix="/v1")
    # Connectors manage (Task 7 P4)
    app.include_router(connectors_router, prefix="/v1")
    # Approvals write path (Task 7 P1)
    app.include_router(approvals_router, prefix="/v1")
    # Retro / scorecard + Improvement (Task 7 P3)
    app.include_router(retro_router, prefix="/v1")
    # MCP server (Task 7 P2: Role-2 per-agent native platform tools)
    app.include_router(mcp_router, prefix="/v1")
    # MCP access tokens: mint / list / revoke (P5b Task-2 Role-3)
    app.include_router(mcp_tokens_router, prefix="/v1")
    # External MCP endpoint (P5b Task-3 Role-3: scoped external client access)
    app.include_router(mcp_external_router, prefix="/v1")
    # Realtime (Task 6)
    app.include_router(ws_router, prefix="/v1")
    # SSE event bus (Task 8)
    app.include_router(sse_router, prefix="/v1")
    # Doit payment gateway webhooks (Task 3 P5a)
    app.include_router(webhooks_router, prefix="/v1")

    # /control/* federation endpoints — cloud + local mode (P6 Task 2, P6b).
    # Not mounted in hybrid/runtime mode (runtime delegates to the cloud /control).
    # local mode owns everything in-process (LocalControlPlane), so /control is
    # available but not required (harmless to mount; avoids breaking callers).
    from omilo.control.factory import _normalize_mode

    settings = get_settings()
    normalized_mode = _normalize_mode(getattr(settings, "omilo_mode", "cloud") or "cloud")
    if normalized_mode != "hybrid":
        from omilo.api.control import router as control_router
        app.include_router(control_router)

    return app


def run() -> None:
    # Watch only the source package for reloads — not tests/ or other sibling
    # dirs, so running pytest (or editing tests) doesn't bounce the server.
    pkg_dir = os.path.dirname(__file__)
    uvicorn.run(
        "omilo.main:create_app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=[pkg_dir],
        factory=True,
    )


if __name__ == "__main__":
    run()
