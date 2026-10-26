import uvicorn
from fastapi import FastAPI

from omilo.api.health import router as health_router
from omilo.api.probe import router as probe_router
from omilo.auth.router import me_router, router as auth_router


def create_app() -> FastAPI:
    app = FastAPI(title="Omilo API", version="0.1.0")

    app.include_router(health_router, prefix="/v1")
    app.include_router(auth_router, prefix="/v1")
    app.include_router(me_router, prefix="/v1")
    # Temporary probe route (Task 5 isolation test; removed in Task 7)
    app.include_router(probe_router, prefix="/v1")

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
