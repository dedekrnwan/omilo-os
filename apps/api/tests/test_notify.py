"""Real-time notices: written automatically, streamed to open tabs, pushed when no tab is open."""
import json
import threading
import time

import httpx
import pywebpush
from conftest import wait_for


def test_notices_stream_and_push(owner, base_url, monkeypatch):
    sent = []
    monkeypatch.setattr(pywebpush, "webpush", lambda sub, data, **kw: sent.append((sub["endpoint"], json.loads(data), kw)))

    owner.put("/api/notify/prefs", json={"quiet": {"on": False}})  # tests run at any hour
    from omilo_api.db import session_scope
    from omilo_api.models import Setting

    with session_scope() as db:  # an earlier test's open stream would count as a tab open (and keep push quiet)
        for s in db.query(Setting).filter(Setting.key.like("presence:%")):
            db.delete(s)
    cfg = owner.get("/api/notify").json()
    assert cfg["push"] and len(cfg["vapid_public_key"]) == 87 and cfg["prefs"]["kinds"]["inbox"]["push"] and not cfg["prefs"]["kinds"]["job_done"]["push"]
    assert owner.post("/api/notify/subscribe", json={"endpoint": "http://evil/x", "keys": {"p256dh": "a", "auth": "b"}}).status_code == 400
    assert owner.post("/api/notify/subscribe", json={"endpoint": "https://push.example/abc", "keys": {"p256dh": "k", "auth": "a"}}).status_code == 200

    # no tab open: a test notice goes out as Web Push
    owner.post("/api/notify/test")
    wait_for(lambda: any(d["title"] == "Notifications work" for _, d, _ in sent), timeout=15)
    ep, data, kw = [s for s in sent if s[1]["title"] == "Notifications work"][0]
    assert ep == "https://push.example/abc" and data["url"] == "/settings/" and kw["vapid_claims"]["sub"].startswith("mailto:")

    # a tab is open (the stream): notices arrive live, and push stays quiet
    got: list[dict] = []

    def listen():
        with httpx.Client(base_url=base_url, headers=owner.headers, timeout=None) as c, c.stream("GET", "/api/stream") as r:
            ev = None
            for line in r.iter_lines():
                if line.startswith("event: "):
                    ev = line[7:]
                elif line.startswith("data: ") and ev == "notice":
                    got.append(json.loads(line[6:]))
                    if len(got) >= 2:
                        return

    th = threading.Thread(target=listen, daemon=True)
    th.start()
    time.sleep(1.5)
    n_before = len(sent)
    master = owner.post("/api/threads", json={"scope": "master"}).json()
    owner.post(f"/api/threads/{master['id']}/messages", json={"text": "Anything for me?"})
    wait_for(lambda: len(got) >= 1 and any(g["kind"] == "reply" for g in got), timeout=20)
    reply = [g for g in got if g["kind"] == "reply"][0]
    assert reply["url"] == f"/chat/?thread={master['id']}" and "replied" in reply["title"]
    time.sleep(4)
    assert not any(s[1]["kind"] == "reply" for s in sent[n_before:]), "push must stay quiet while a tab is open"

    # an inbox item also becomes a notice
    tok = owner.mcp_tokens["support"]
    t = owner.post("/api/tasks", json={"staff_id": "support", "brief": "Need a decision"}).json()
    httpx.post(f"{base_url}/mcp", headers={"Authorization": f"Bearer {tok}"}, json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": "ask_founder", "arguments": {"task_id": t["id"], "question": "Which price?"}}})
    recent = wait_for(lambda: [n for n in owner.get("/api/notices").json() if n["kind"] == "inbox" and "question" in n["title"]], timeout=10)
    assert recent[0]["body"].startswith("Which price")

    # preferences
    assert owner.put("/api/notify/prefs", json={"job_done": True, "bogus": True}).json()["kinds"]["job_done"]["push"] is True
    assert "bogus" not in owner.get("/api/notify").json()["prefs"]["kinds"]
    owner.post("/api/notify/unsubscribe", json={"endpoint": "https://push.example/abc"})  # later tests must not push to it for real
