"""Streaming mock of the Anthropic Messages API, enough for a real Hermes to run a Saga OS task."""
import io
import json
import re

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()
LOG = io.StringIO()

@app.get("/v1/models")
def models():
    return {"data": [{"id": "claude-sonnet-5-5", "display_name": "Claude Sonnet 5.5"}]}

def find(tools, key):
    for t in tools:
        if t["name"].endswith(key) or t["name"] == key:
            return t["name"]

def sse(msg):
    def ev(t, d):
        return f"event: {t}\ndata: {json.dumps({'type': t, **d})}\n\n"
    out = [ev("message_start", {"message": {**{k: msg[k] for k in ("id", "type", "role", "model")}, "content": [], "stop_reason": None,
                                            "stop_sequence": None, "usage": {"input_tokens": 50, "output_tokens": 1}}})]
    for i, b in enumerate(msg["content"]):
        if b["type"] == "text":
            out.append(ev("content_block_start", {"index": i, "content_block": {"type": "text", "text": ""}}))
            out.append(ev("content_block_delta", {"index": i, "delta": {"type": "text_delta", "text": b["text"]}}))
        else:
            out.append(ev("content_block_start", {"index": i, "content_block": {"type": "tool_use", "id": b["id"], "name": b["name"], "input": {}}}))
            out.append(ev("content_block_delta", {"index": i, "delta": {"type": "input_json_delta", "partial_json": json.dumps(b["input"])}}))
        out.append(ev("content_block_stop", {"index": i}))
    out.append(ev("message_delta", {"delta": {"stop_reason": msg["stop_reason"], "stop_sequence": None}, "usage": {"output_tokens": 10}}))
    out.append(ev("message_stop", {}))
    return StreamingResponse(iter(out), media_type="text/event-stream")


@app.post("/v1/messages")
async def messages(request: Request):
    body = await request.json()
    msg = await _messages(body)
    return sse(msg) if body.get("stream") else msg


async def _messages(body):
    tools = body.get("tools", [])
    names = [t.get("name") for t in tools]
    msgs = body["messages"]
    LOG.write(json.dumps({"model": body.get("model"), "n_msgs": len(msgs), "tools": names, "stream": body.get("stream")}) + "\n")
    text_all = json.dumps(msgs)
    m = re.search(r"Task (tsk_[0-9a-f]+)", text_all)
    usage = {"input_tokens": 50, "output_tokens": 10}
    if m:
        tid = m.group(1)
        done = [k for k in ("get_task", "checkpoint", "report") if f'"name": "{find(tools, k)}"' in text_all or f'"name":"{find(tools, k)}"' in text_all]
        plan = [("get_task", {"task_id": tid}), ("checkpoint", {"task_id": tid, "next": "report"}),
                ("report", {"task_id": tid, "headline": "Hermes+Claude did it", "body": "## Summary\n- via Hermes"})]
        for k, args in plan:
            if k not in done and find(tools, k):
                return {"id": "msg_x", "type": "message", "role": "assistant", "model": body["model"],
                        "content": [{"type": "tool_use", "id": f"tu_{k}", "name": find(tools, k), "input": args}],
                        "stop_reason": "tool_use", "stop_sequence": None, "usage": usage}
        return {"id": "msg_y", "type": "message", "role": "assistant", "model": body["model"],
                "content": [{"type": "text", "text": "finished"}], "stop_reason": "end_turn", "stop_sequence": None, "usage": usage}
    return {"id": "msg_z", "type": "message", "role": "assistant", "model": body["model"],
            "content": [{"type": "text", "text": f"Hermes-Claude here ({len(names)} tools)"}], "stop_reason": "end_turn", "stop_sequence": None, "usage": usage}
