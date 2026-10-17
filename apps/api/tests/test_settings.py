"""Settings: the activity log is paged and filtered by group, helper or text, and exports as CSV; the owner can rename
themselves, change the password (other browsers are signed out) and see sessions; system info shows Postgres and Redis."""
import httpx


def test_activity_log_pages_and_filters(owner):
    for i in range(30):
        owner.post("/api/system", json={"max_concurrent_tasks": 3 + (i % 2)})
    first = owner.get("/api/audit", params={"per_page": 10}).json()
    assert first["page"] == 1 and len(first["items"]) == 10 and first["total"] >= 30 and first["pages"] >= 3
    second = owner.get("/api/audit", params={"per_page": 10, "page": 2}).json()
    assert {x["id"] for x in first["items"]}.isdisjoint({x["id"] for x in second["items"]})
    s = owner.get("/api/audit", params={"category": "settings", "actor": "owner", "per_page": 5}).json()
    assert s["items"] and all(x["category"] == "settings" and x["who"]["kind"] == "owner" for x in s["items"])
    assert s["items"][0]["what"] == "changed a setting"
    assert any(c["id"] == "settings" and c["count_30d"] >= 30 for c in s["categories"])
    found = owner.get("/api/audit", params={"q": "max_concurrent"}).json()
    assert found["total"] >= 30
    csv = owner.get("/api/audit/export", params={"category": "settings"})
    assert csv.status_code == 200 and csv.text.startswith("when,who,category,what")


def test_account_password_and_sessions(owner, base_url):
    me = owner.patch("/api/auth/me", json={"name": "Dede"}).json()
    assert me["name"] == "Dede"
    other = httpx.Client(base_url=base_url, timeout=20)
    assert other.post("/api/auth/login", json={"email": "owner@example.com", "password": "correct-horse-1"}).status_code == 200
    assert other.get("/api/auth/me").status_code == 200
    sess = owner.get("/api/auth/sessions").json()
    assert any(s["current"] for s in sess) and any(s["kind"] == "session" for s in sess)
    assert owner.post("/api/auth/password", json={"current": "wrong-password", "new": "another-horse-22"}).status_code == 400
    r = owner.post("/api/auth/password", json={"current": "correct-horse-1", "new": "another-horse-22"}).json()
    assert r["signed_out"] >= 1
    assert other.get("/api/auth/me").status_code == 401, "other browsers sign in again"
    assert owner.get("/api/auth/me").status_code == 200, "this one stays signed in"
    owner.post("/api/auth/password", json={"current": "another-horse-22", "new": "correct-horse-1"})


def test_system_info(owner):
    info = owner.get("/api/system/info").json()
    assert info["database"]["ok"] and info["database"]["pgvector"] and info["database"]["schema"] == "co_main"
    assert info["redis"]["ok"] and info["redis"]["version"]
