"""External MCP servers (sweep/control).

Register MCP servers the company's helpers can use:

  GET    /v1/mcp-servers                    → McpServer[]
  POST   /v1/mcp-servers {name, url, auth_type?, token?}
                                            → probe the server (JSON-RPC tools/list) and save
  POST   /v1/mcp-servers/from-openapi {name, spec | spec_url}
                                            → build a tool list from an OpenAPI document
  POST   /v1/mcp-servers/{id}/refresh       → re-probe (remote) and refresh tools
  PATCH  /v1/mcp-servers/{id} {enabled?}    → turn on/off
  DELETE /v1/mcp-servers/{id}               → 204

Tool levels mirror the UI chips: ``read`` (read-only), ``ask`` (asks first),
``blocked`` (destructive).  Registration + discovery is real; calling these
tools from the agent runtime is not wired yet (the runtime only dispatches
native + marketplace connector tools — see omilo/mcp/tools.py).
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.models.base import prefixed_id
from omilo.models.control import McpServer
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["mcp-servers"])
logger = logging.getLogger(__name__)

PROBE_TIMEOUT_S = 6.0
MAX_TOOLS = 200


class CreateMcpServerBody(BaseModel):
    name: str
    url: str
    auth_type: str = "none"  # none | bearer
    token: str | None = None


class OpenApiBody(BaseModel):
    name: str
    spec: str | dict | None = None
    spec_url: str | None = None


class PatchMcpServerBody(BaseModel):
    enabled: bool | None = None
    name: str | None = None


def _require_admin(ctx: RequestContext) -> None:
    if ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only owners and admins can manage MCP servers.")


def _hint(token: str | None) -> str | None:
    if not token:
        return None
    t = token.strip()
    return f"{t[:4]}…{t[-4:]}" if len(t) > 10 else "••••"


def _server_dict(s: McpServer) -> dict[str, Any]:
    return {
        "id": s.id,
        "name": s.name,
        "kind": s.kind,
        "url": s.url,
        "auth_type": s.auth_type,
        "token_hint": s.token_hint,
        "status": s.status,
        "error": s.error,
        "tools": s.tools or [],
        "enabled": s.enabled,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _level_from_annotations(tool: dict) -> str:
    ann = tool.get("annotations") or {}
    if ann.get("destructiveHint"):
        return "blocked"
    if ann.get("readOnlyHint"):
        return "read"
    name = str(tool.get("name", "")).lower()
    if re.match(r"^(get|list|find|search|read|fetch|lookup)[_\-]", name):
        return "read"
    if re.match(r"^(delete|remove|drop|destroy)[_\-]", name):
        return "blocked"
    return "ask"


def probe_remote(url: str, token: str | None) -> list[dict[str, Any]]:
    """Call ``tools/list`` on a streamable-HTTP MCP server. Raises on failure."""
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    with httpx.Client(timeout=PROBE_TIMEOUT_S, follow_redirects=True) as client:
        resp = client.post(url, json=payload, headers=headers)
    if resp.status_code in (401, 403):
        raise ValueError("The server refused the token (HTTP %d)." % resp.status_code)
    if resp.status_code >= 400:
        raise ValueError(f"The server answered HTTP {resp.status_code}.")
    body_text = resp.text
    data: Any
    if resp.headers.get("content-type", "").startswith("text/event-stream"):
        # Take the first `data:` frame.
        frames = [ln[5:].strip() for ln in body_text.splitlines() if ln.startswith("data:")]
        data = json.loads(frames[0]) if frames else {}
    else:
        data = resp.json()
    if isinstance(data, dict) and data.get("error"):
        raise ValueError(str(data["error"].get("message") or data["error"]))
    tools = ((data or {}).get("result") or {}).get("tools")
    if not isinstance(tools, list):
        raise ValueError("That URL didn't answer like an MCP server (no tools/list result).")
    out = []
    for t in tools[:MAX_TOOLS]:
        if not isinstance(t, dict) or not t.get("name"):
            continue
        out.append(
            {
                "name": str(t["name"]),
                "description": str(t.get("description") or "")[:300],
                "level": _level_from_annotations(t),
            }
        )
    return out


def tools_from_openapi(doc: dict[str, Any]) -> tuple[list[dict[str, Any]], str | None]:
    """Return (tools, base_url) from an OpenAPI 3 / Swagger 2 document."""
    if not isinstance(doc, dict) or not isinstance(doc.get("paths"), dict):
        raise ValueError("That isn't an OpenAPI document (no `paths`).")
    base = None
    servers = doc.get("servers")
    if isinstance(servers, list) and servers and isinstance(servers[0], dict):
        base = servers[0].get("url")
    elif doc.get("host"):
        base = f"{(doc.get('schemes') or ['https'])[0]}://{doc['host']}{doc.get('basePath', '')}"
    tools: list[dict[str, Any]] = []
    for path, ops in doc["paths"].items():
        if not isinstance(ops, dict):
            continue
        for method, op in ops.items():
            m = method.lower()
            if m not in ("get", "post", "put", "patch", "delete") or not isinstance(op, dict):
                continue
            slug = re.sub(r"[^a-zA-Z0-9]+", "_", path).strip("_").lower()
            name = op.get("operationId") or f"{m}_{slug}" or m
            level = "read" if m == "get" else "blocked" if m == "delete" else "ask"
            tools.append(
                {
                    "name": str(name)[:80],
                    "description": str(op.get("summary") or op.get("description") or f"{m.upper()} {path}")[:300],
                    "level": level,
                    "method": m.upper(),
                    "path": path,
                }
            )
            if len(tools) >= MAX_TOOLS:
                return tools, base
    if not tools:
        raise ValueError("The OpenAPI document has no operations.")
    return tools, base


def _parse_spec(spec: str | dict) -> dict[str, Any]:
    if isinstance(spec, dict):
        return spec
    try:
        return json.loads(spec)
    except (ValueError, TypeError):
        import yaml

        try:
            loaded = yaml.safe_load(spec)
        except yaml.YAMLError as exc:
            raise ValueError(f"Couldn't read the spec: {exc}") from exc
        if not isinstance(loaded, dict):
            raise ValueError("Couldn't read the spec as JSON or YAML.")
        return loaded


@router.get("/mcp-servers")
def list_mcp_servers(
    db: Session = Depends(get_tenant_db),
    _ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    rows = db.query(McpServer).order_by(McpServer.created_at.desc()).all()
    return [_server_dict(r) for r in rows]


@router.post("/mcp-servers", status_code=status.HTTP_201_CREATED)
def create_mcp_server(
    body: CreateMcpServerBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    _require_admin(ctx)
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Give the server a name.")
    if not re.match(r"^https?://", body.url.strip()):
        raise HTTPException(status_code=422, detail="The server URL must start with https://")
    from omilo.api.connectors import _encrypt_field

    token = (body.token or "").strip() or None
    server = McpServer(
        id=prefixed_id("mcs"),
        company_id=ctx.company_id,
        name=body.name.strip(),
        kind="remote",
        url=body.url.strip(),
        auth_type="bearer" if token else "none",
        token_enc=_encrypt_field(token) if token else None,
        token_hint=_hint(token),
        status="pending",
        tools=[],
        enabled=True,
    )
    try:
        server.tools = probe_remote(server.url or "", token)
        server.status = "connected"
    except Exception as exc:
        server.status = "error"
        server.error = str(exc)[:500] or "Could not reach the server."
    db.add(server)
    db.flush()
    from omilo import audit

    audit.record_ctx(ctx, type="connectors", action="added MCP server", target=server.name)
    return _server_dict(server)


@router.post("/mcp-servers/from-openapi", status_code=status.HTTP_201_CREATED)
def create_from_openapi(
    body: OpenApiBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    _require_admin(ctx)
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="Give the server a name.")
    spec: Any = body.spec
    if spec is None and body.spec_url:
        try:
            with httpx.Client(timeout=PROBE_TIMEOUT_S, follow_redirects=True) as client:
                r = client.get(body.spec_url)
                r.raise_for_status()
                spec = r.text
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Couldn't download the spec: {exc}")
    if spec is None:
        raise HTTPException(status_code=422, detail="Paste an OpenAPI spec or give its URL.")
    try:
        doc = _parse_spec(spec)
        tools, base = tools_from_openapi(doc)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    server = McpServer(
        id=prefixed_id("mcs"),
        company_id=ctx.company_id,
        name=body.name.strip(),
        kind="openapi",
        url=base,
        auth_type="none",
        status="connected",
        tools=tools,
        spec=doc,
        enabled=True,
    )
    db.add(server)
    db.flush()
    from omilo import audit

    audit.record_ctx(ctx, type="connectors", action="built MCP server from OpenAPI", target=server.name)
    return _server_dict(server)


def _get(db: Session, server_id: str) -> McpServer:
    row = db.get(McpServer, server_id)
    if row is None:
        raise HTTPException(status_code=404, detail="MCP server not found.")
    return row


@router.post("/mcp-servers/{server_id}/refresh")
def refresh_mcp_server(
    server_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    _require_admin(ctx)
    row = _get(db, server_id)
    if row.kind == "remote":
        token = None
        if row.token_enc:
            try:
                token = bytes.fromhex(json.loads(row.token_enc)["enc"]).decode()
            except Exception:
                token = None
        try:
            row.tools = probe_remote(row.url or "", token)
            row.status, row.error = "connected", None
        except Exception as exc:
            row.status, row.error = "error", str(exc)[:500]
    db.flush()
    return _server_dict(row)


@router.patch("/mcp-servers/{server_id}")
def patch_mcp_server(
    server_id: str,
    body: PatchMcpServerBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    _require_admin(ctx)
    row = _get(db, server_id)
    if body.enabled is not None:
        row.enabled = body.enabled
    if body.name is not None and body.name.strip():
        row.name = body.name.strip()
    db.flush()
    return _server_dict(row)


@router.delete("/mcp-servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mcp_server(
    server_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> None:
    _require_admin(ctx)
    row = _get(db, server_id)
    name = row.name
    db.delete(row)
    db.flush()
    from omilo import audit

    audit.record_ctx(ctx, type="connectors", action="removed MCP server", target=name)
