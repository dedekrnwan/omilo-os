"""The shared state carried through the LangGraph brain.

A single ``GraphState`` flows supervisor → worker → review and back. LangGraph
merges each node's returned partial dict into this state between steps, so a node
only returns the keys it changes.

Phase-1 keys (kept deliberately small — the gate/human-escalation keys like
``pending_action``/``risk`` exist now so Task 4 can populate them without a state
migration):

- ``task_id``       — the task this run is for (also the checkpoint thread key later).
- ``brief``         — what the owner asked for.
- ``messages``      — running transcript / scratch notes (append-only, Phase 1 light use).
- ``plan``          — the supervisor's current step list.
- ``worker_output`` — the underlying engine's last ``EngineResult.text``.
- ``pending_action``— a structured action awaiting the gate (Task 4); ``None`` in Phase 1.
- ``risk``          — the re-derived risk level for ``pending_action`` (Task 4).
- ``step``          — supervisor↔worker loop counter; bounded by ``MAX_GRAPH_STEPS``.
- ``done``          — review sets this True once the worker produced usable output.
- ``result_text``   — the text the run returns to the worker as its ``EngineResult``.
"""
from __future__ import annotations

from typing import TypedDict


class GraphState(TypedDict):
    task_id: str
    brief: str
    messages: list
    plan: list
    worker_output: str
    pending_action: dict | None
    risk: str
    step: int
    done: bool
    result_text: str
