"""Hermes' streaming quirks: tool progress events, and failures reported in the final chunk (not as HTTP errors)."""
import asyncio
import json

import httpx

from saga_api.engines.hermes import HermesEngine


def _sse(*events: str) -> bytes:
    return "".join(events).encode()


def _chunk(delta=None, finish=None, **extra) -> str:
    return "data: " + json.dumps({"choices": [{"index": 0, "delta": delta or {}, "finish_reason": finish}], **extra}) + "\n\n"


def _run(body: bytes):
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    eng = HermesEngine()
    eng._client = lambda cfg, timeout: (httpx.AsyncClient(base_url="http://h/v1", transport=httpx.MockTransport(handler)), "m")
    events = []
    res = asyncio.run(eng._complete({}, [{"role": "user", "content": "hi"}], 10, "s", emit=lambda k, **d: events.append((k, d))))
    return res, events


def test_error_in_final_chunk_is_reported():
    res, _ = _run(_sse(_chunk({"role": "assistant"}),
                       _chunk(finish="error", error={"message": "messages.1: text content blocks must be non-empty"}, usage={"total_tokens": 0}),
                       "data: [DONE]\n\n"))
    assert res.error.startswith("Hermes stopped:") and "non-empty" in res.error


def test_empty_answer_is_an_error_and_tools_are_shown():
    res, events = _run(_sse(
        'event: hermes.tool.progress\ndata: {"tool": "browser_navigate", "label": "pen.dev", "toolCallId": "c1", "status": "running"}\n\n',
        'event: hermes.tool.progress\ndata: {"tool": "browser_navigate", "toolCallId": "c1", "status": "completed"}\n\n',
        _chunk(finish="stop", usage={"total_tokens": 12}), "data: [DONE]\n\n"))
    assert res.error.startswith("Hermes finished without an answer")
    tools = [d for k, d in events if k == "tool"]
    assert [t["state"] for t in tools] == ["running", "done"] and tools[0]["name"] == "browser_navigate"
    assert tools[0]["input"] == {"preview": "pen.dev"}


def test_normal_answer():
    res, _ = _run(_sse(_chunk({"content": "Yes, "}), _chunk({"content": "I can open pen.dev."}), _chunk(finish="stop"), "data: [DONE]\n\n"))
    assert res.text == "Yes, I can open pen.dev." and not res.error
