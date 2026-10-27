"""compile_tools — compile a Piece's actions into MCP tool specs.

Pure function; no I/O, no DB. Given an installed Connector and its Piece,
produce a list of MCP tool spec dicts ready to be merged into the tool
catalog served to a Helper.

Tool name format: "{piece.id}.{action['name']}" (e.g. "gmail.send-email").

side_effecting is True when approval != "auto" and approval != "read":
  - approval == "ask"  → side_effecting True  (write; routes through gate → Proposal)
  - approval == "auto" → side_effecting False  (read; allowed within gate)
  - anything else      → side_effecting True   (conservative default)

Spec: docs/technical/11-marketplace-connectors-mcp.md §2.3, §5.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from omilo.models.connectors import Connector
    from omilo.models.pieces import Piece


def compile_tools(connector: "Connector", piece: "Piece") -> list[dict[str, Any]]:
    """Return a list of MCP tool spec dicts for each action in piece.actions.

    Each dict shape:
        {
            "name":          str   — "{piece.id}.{action['name']}" (namespaced)
            "description":   str   — action['label'] (falls back to action['name'])
            "inputSchema":   dict  — {"type": "object", "properties": {...}, "required": [...]}
            "approval":      str   — action['approval'] ("ask" | "auto")
            "side_effecting": bool — True if approval not in ("auto", "read")
            "connector_id":  str   — connector.id (for dispatch back to the connector)
            "piece_id":      str   — piece.id
            "action_name":   str   — action['name'] (original, un-namespaced)
        }

    If piece.actions is empty or None, returns [].
    """
    actions: list[dict] = piece.actions or []
    tools: list[dict[str, Any]] = []

    for action in actions:
        action_name: str = action.get("name", "")
        if not action_name:
            continue

        approval: str = action.get("approval", "ask")
        side_effecting: bool = approval not in ("auto", "read")

        # Build inputSchema from action['inputs']
        inputs: list[dict] = action.get("inputs") or []
        properties: dict[str, Any] = {}
        required: list[str] = []
        for inp in inputs:
            inp_name = inp.get("name", "")
            if not inp_name:
                continue
            inp_type = inp.get("type", "string")
            properties[inp_name] = {"type": inp_type}
            if inp.get("required", False):
                required.append(inp_name)

        input_schema: dict[str, Any] = {
            "type": "object",
            "properties": properties,
        }
        if required:
            input_schema["required"] = required

        tool: dict[str, Any] = {
            "name": f"{piece.id}.{action_name}",
            "description": action.get("label") or action_name,
            "inputSchema": input_schema,
            "approval": approval,
            "side_effecting": side_effecting,
            "connector_id": connector.id,
            "piece_id": piece.id,
            "action_name": action_name,
        }
        tools.append(tool)

    return tools
