"""Saga OS gateway: REST API (/api), MCP endpoint (/mcp), and the web app (/), optionally under a base path."""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse

from .company import CompanyMiddleware
from .config import get_settings
from .db import init_db
from .mcp_server import router as mcp_router
from .routers import api, auth, companies
from .worker import Worker

log = logging.getLogger("saga")


_NO_CACHE = {"Cache-Control": "no-cache"}  # pages: always check for a new build (cheap 304s)


def _cache_headers(path: str, file: Path) -> dict:
    """Hashed build files never change, so browsers keep them a year; pages revalidate; fonts and icons a day."""
    if path.startswith("_next/static/"):
        return {"Cache-Control": "public, max-age=31536000, immutable"}
    if path == "sw.js" or file.suffix in (".html", ".txt", ".webmanifest"):
        return _NO_CACHE
    return {"Cache-Control": "public, max-age=86400"}


def _web_dir() -> Path | None:
    for cand in (os.environ.get("SAGA_WEB_DIR"), Path(__file__).resolve().parents[2] / "web" / "out", "/app/web"):
        if cand and Path(cand, "index.html").exists():
            return Path(cand)
    return None


def build_app() -> FastAPI:
    cfg = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        init_db()
        worker, task = None, None
        if cfg.embedded_worker:
            worker = Worker()
            task = asyncio.create_task(worker.run_forever())
            log.info("embedded worker started")
        yield
        if worker:
            await worker.stop()
            task.cancel()

    inner = FastAPI(title="Saga OS", version="0.3.0", lifespan=lifespan,
                    docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    inner.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)  # event streams are left alone
    if cfg.cors_origins:
        inner.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in cfg.cors_origins.split(",")],
                             allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    inner.include_router(auth.router)
    inner.include_router(companies.router)
    inner.include_router(api.router)
    inner.include_router(mcp_router)

    @inner.get("/healthz")
    def healthz():
        return {"ok": True}

    web = _web_dir()

    @inner.get("/{path:path}", include_in_schema=False)
    def web_app(path: str, request: Request):
        if path.startswith(("api/", "mcp")):
            return JSONResponse({"detail": "not found"}, status_code=404)
        if web is None:
            return PlainTextResponse("Saga OS API is running. The web app is not built (apps/web: npm run build).")
        target = (web / path).resolve()
        if web in target.parents or target == web:
            for cand in (target, target / "index.html", Path(str(target) + ".html")):
                if cand.is_file():
                    return FileResponse(cand, headers=_cache_headers(path, cand))
        return FileResponse(web / "index.html", headers=_NO_CACHE)

    inner.add_middleware(CompanyMiddleware)  # outermost: every request knows its company
    if cfg.base_path:
        outer = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
        outer.mount(cfg.base_path.rstrip("/"), inner)
        return outer
    return inner


app = build_app()


def run():  # `saga-api`
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    uvicorn.run("saga_api.main:app", host=os.environ.get("SAGA_HOST", "127.0.0.1"),
                port=int(os.environ.get("SAGA_PORT", "7700")), proxy_headers=True, forwarded_allow_ips="*")
