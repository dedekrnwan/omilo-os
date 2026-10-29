"""RealEngine — runs a job on the AI the company connected (omilo.ai).

Satisfies the Engine protocol (``run(ctx) -> EngineResult``) used by the job
runner. The model gets the helper's standing instructions, the company context
and the brief, can search the web (Claude), and asks for approval of anything
with a side effect through ``request_action`` — which becomes the runner's
``pending_action`` → Proposal + Inbox decision, exactly like before.
"""
from __future__ import annotations

import math
from typing import Any

from omilo.ai import AiConfig, AiError, converse, run_sync
from omilo.ai.prompts import REQUEST_ACTION_TOOL, task_system
from omilo.engine.context import EngineResult, TaskContext

USD_TO_IDR = 16_000  # for the credit estimate shown in analytics (BYO keys are not billed by Omilo)


def usd_to_credits(usd: float) -> int:
    from omilo.billing.catalog import IDR_PER_CREDIT

    return int(math.ceil(max(0.0, usd) * USD_TO_IDR / IDR_PER_CREDIT)) if usd > 0 else 0


ENGINE_TYPE = {"anthropic": "anthropic", "openai_compat": "openai", "cli": "claude_code"}


class RealEngine:
    def __init__(self, cfg: AiConfig, *, helper: Any = None, company: Any = None) -> None:
        self.cfg = cfg
        self.helper = helper
        self.company = company

    @property
    def engine_type(self) -> str:
        return ENGINE_TYPE.get(self.cfg.provider, self.cfg.provider)

    def run(self, ctx: TaskContext) -> EngineResult:
        try:
            return run_sync(lambda: self._run(ctx))
        except AiError as e:
            ctx.emit({"kind": "error", "data": {"text": str(e)}})
            return EngineResult(error=str(e))

    async def _run(self, ctx: TaskContext) -> EngineResult:
        action: dict[str, Any] = {}

        async def on_call(name: str, args: dict) -> str:
            if name == "request_action" and not action:
                details = str(args.get("details") or "").strip()
                kind = str(args.get("type") or "other")
                payload: dict[str, Any] = {"text": details}
                if args.get("amount"):
                    payload["amount"] = str(args["amount"])
                action.update({
                    "type": kind,
                    "risk": str(args.get("risk") or ("high" if kind in ("spend", "deploy") else "medium")),
                    "title": str(args.get("title") or "").strip()[:200],
                    "payload": payload,
                })
                return "Sent to the owner for approval. Do not do it yourself; finish your short report now."
            return "Only one approval request per job; finish your report."

        brief = ctx.brief.strip()
        if ctx.operator_note:
            brief += f"\n\nOwner note (follow it): {ctx.operator_note}"
        if ctx.memory:
            brief += f"\n\n{ctx.memory}"
        system = task_system(self.helper or _NameOnly(ctx), self.company, instructions=ctx.instructions)
        done: dict = {}
        async for ev in converse(self.cfg, system, [{"role": "user", "content": brief}],
                                 tools=[REQUEST_ACTION_TOOL], on_call=on_call, web=True, max_turns=8,
                                 max_tokens=4096, timeout=600):
            if ev["type"] == "activity":
                ctx.emit({"kind": "tool", "data": {"label": ev["label"]}})
            elif ev["type"] == "sources":
                ctx.emit({"kind": "sources", "data": {"items": ev["items"]}})
            elif ev["type"] == "done":
                done = ev
        text = str(done.get("text") or "").strip()
        if text:
            ctx.emit({"kind": "text", "data": {"text": text}})
        return EngineResult(
            text=text or ("Prepared a request for your approval." if action else "(no output)"),
            pending_action=action or None,
            cost_credits=usd_to_credits(float(done.get("cost_usd") or 0)),
            tokens_in=int(done.get("tokens_in") or 0),
            tokens_out=int(done.get("tokens_out") or 0),
        )


class _NameOnly:
    def __init__(self, ctx: TaskContext) -> None:
        self.name = ctx.helper_name
        self.is_chief = ctx.is_chief
