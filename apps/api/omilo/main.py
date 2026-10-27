import uvicorn
from fastapi import FastAPI

from omilo.api.approvals import router as approvals_router
from omilo.api.channels import router as channels_router
from omilo.api.chat_write import router as chat_write_router
from omilo.api.folders import router as folders_router
from omilo.api.goals import router as goals_router
from omilo.api.health import router as health_router
from omilo.api.inbox import router as inbox_router
from omilo.api.sessions import router as sessions_router
from omilo.auth.router import me_router, router as auth_router
from omilo.realtime.ws import router as ws_router


def create_app() -> FastAPI:
    app = FastAPI(title="Omilo API", version="0.1.0")

    app.include_router(health_router, prefix="/v1")
    app.include_router(auth_router, prefix="/v1")
    app.include_router(me_router, prefix="/v1")
    # Repos-parity read endpoints (Task 7)
    app.include_router(channels_router, prefix="/v1")
    app.include_router(chat_write_router, prefix="/v1")
    app.include_router(folders_router, prefix="/v1")
    app.include_router(goals_router, prefix="/v1")
    app.include_router(sessions_router, prefix="/v1")
    app.include_router(inbox_router, prefix="/v1")
    # Approvals write path (Task 7 P1)
    app.include_router(approvals_router, prefix="/v1")
    # Realtime (Task 6)
    app.include_router(ws_router, prefix="/v1")

    return app


def run() -> None:
    uvicorn.run(
        "omilo.main:create_app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        factory=True,
    )


if __name__ == "__main__":
    run()
