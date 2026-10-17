"""A deterministic engine for demos and tests.

It behaves like a well-mannered agent and uses the real saga-os MCP endpoint over HTTP,
so the whole path (token, policy, tool log, inbox) is exercised without any LLM.
"""
import json

import httpx

from . import ChatContext, Engine, EngineResult, TaskContext


class MCPClient:
    def __init__(self, url: str, token: str, timeout: float = 30):
        self.url, self.token, self.timeout, self._id = url, token, timeout, 0

    async def __aenter__(self):
        self.http = httpx.AsyncClient(timeout=self.timeout, headers={
            "Authorization": f"Bearer {self.token}", "Accept": "application/json, text/event-stream"})
        await self._rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                       "clientInfo": {"name": "saga-fake-engine", "version": "1"}})
        await self.http.post(self.url, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
        return self

    async def __aexit__(self, *a):
        await self.http.aclose()

    async def _rpc(self, method: str, params: dict):
        self._id += 1
        r = await self.http.post(self.url, json={"jsonrpc": "2.0", "id": self._id, "method": method, "params": params})
        r.raise_for_status()
        data = r.json()
        if "error" in data:
            raise RuntimeError(data["error"]["message"])
        return data["result"]

    async def list_tools(self) -> list[dict]:
        return (await self._rpc("tools/list", {}))["tools"]

    async def call_raw(self, name: str, args: dict) -> tuple[str, bool]:
        """Call a tool and return (text, is_error) without raising, for model tool loops."""
        try:
            res = await self._rpc("tools/call", {"name": name, "arguments": args})
        except Exception as e:  # noqa: BLE001 - surface any failure to the model
            return json.dumps({"error": str(e)}), True
        text = res["content"][0]["text"] if res.get("content") else json.dumps(res.get("structuredContent") or {})
        return text, bool(res.get("isError"))

    async def call(self, name: str, **args) -> dict:
        res = await self._rpc("tools/call", {"name": name, "arguments": args})
        payload = res.get("structuredContent") or json.loads(res["content"][0]["text"])
        if res.get("isError"):
            raise RuntimeError(payload.get("error", "tool error"))
        return payload


class FakeEngine(Engine):
    type = "fake"

    async def run_task(self, ctx: TaskContext) -> EngineResult:
        if not ctx.mcp_token:
            return EngineResult(error="no MCP token for this staff agent: rotate it in Staff")
        async with MCPClient(ctx.mcp_url, ctx.mcp_token) as m:
            task = await m.call("get_task", task_id=ctx.task_id)
            if ctx.origin == "execution":
                p = task.get("proposal") or {}
                await m.call("mark_executed", proposal_id=p["id"], ok=True,
                             result=f"(fake engine) executed exactly the approved text ({len(p.get('approved_text', ''))} chars).")
                await m.call("report", task_id=ctx.task_id, headline=f"Executed: {p.get('title', '')}",
                             body="## Summary\n- Executed the approved proposal as written.\n\n## Done\n- mark_executed called\n\n## Needs founder\nnothing\n\n## Handoffs\nnone")
                return EngineResult(text="executed")
            if ctx.origin == "revision":
                p = task.get("proposal") or {}
                new = f"{p.get('approved_text', '')}\n\n_Revised as asked: {ctx.founder_note}_"
                await m.call("revise_proposal", proposal_id=p["id"], body=new, summary=f"applied: {ctx.founder_note[:80]}")
                await m.call("report", task_id=ctx.task_id, headline=f"Revised proposal: {p.get('title', '')}",
                             body="## Summary\n- Applied the founder's note and resubmitted.\n\n## Needs founder\nreview the new version")
                return EngineResult(text="revised")
            if "propose_workflow" in ctx.brief:  # "build me a workflow": a small demo one (a real engine designs it)
                what = (ctx.brief.split("\n\n")[1] if "\n\n" in ctx.brief else ctx.brief)[:100]
                graph = {"nodes": [
                    {"id": "start", "type": "trigger.schedule", "label": "Weekdays 9:00", "config": {"cron": "0 9 * * 1-5"}, "x": 0, "y": 0},
                    {"id": "job", "type": "ai.helper", "label": "Do the thinking part", "config": {"staff_id": ctx.staff_id, "brief": what}, "x": 0, "y": 150},
                    {"id": "ok", "type": "logic.approval", "label": "Ask me", "config": {"title": "Use this result?", "body": "{{ steps.job.output.result }}"}, "x": 0, "y": 300},
                    {"id": "save", "type": "saga.doc", "label": "Save to Docs", "config": {"path": "Workflows/Results", "content": "- {{ now }}: {{ steps.job.output.result }}"}, "x": 0, "y": 450}],
                    "edges": [{"from": "start", "to": "job"}, {"from": "job", "to": "ok"}, {"from": "ok", "port": "approved", "to": "save"}]}
                text, err = await m.call_raw("propose_workflow", {"task_id": ctx.task_id, "name": what[:60] or "New workflow", "description": what,
                                                                  "reason": "(demo engine) You asked for this workflow.", "graph": graph})
                if err:
                    return EngineResult(error=text[:300])
                wf = json.loads(text)
                await m.call("report", task_id=ctx.task_id, headline=f"Proposed a workflow ({wf.get('workflow_id')})",
                             body="## Summary\n- Designed a workflow and put it in your Inbox.\n\n## Needs founder\napprove or open it to change it")
                return EngineResult(text="ok")
            context = await m.call("get_context")
            await m.call("checkpoint", task_id=ctx.task_id, plan=["read context", "draft", "propose", "report"],
                         done="read context", next="draft and propose")
            ptype = ctx.engine_config.get("fake_propose_type", "content.publish")
            first_line = next((ln.strip("# ").strip() for ln in context["context"].splitlines() if ln.strip()), "the company")
            prop = await m.call("propose", task_id=ctx.task_id, title=f"Draft from {ctx.staff_name}: {ctx.brief[:60]}",
                                type=ptype, risk="low",
                                body=f"**Draft** for: {ctx.brief}\n\nBased on company context ({first_line}).\n\n- point one\n- point two"
                                + (f"\n\nFounder note applied: {ctx.founder_note}" if ctx.founder_note else ""))
            await m.call("report", task_id=ctx.task_id, headline=f"1 draft waiting for approval ({prop['proposal_id']})",
                         body=f"## Summary\n- Read the company context\n- Drafted and filed {prop['proposal_id']}\n\n## Done\n- proposal filed\n\n## Needs founder\napprove or reject {prop['proposal_id']}\n\n## Handoffs\nnone")
        return EngineResult(text="ok", tokens=0)

    async def chat(self, ctx: ChatContext) -> EngineResult:
        last = ctx.history[-1]["text"] if ctx.history else ""
        return EngineResult(text=f"_{ctx.staff_name}, demo engine (no AI connected)._ You said: **{last[:200]}**\n\n{ctx.context_note[:400]}")

    async def health(self, cfg: dict) -> dict:
        return {"ok": True, "detail": "fake engine (no LLM)"}
