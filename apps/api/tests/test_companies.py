"""Several companies, fully separate: their own helpers, jobs, inbox, docs and MCP endpoint; one shared login."""
import httpx
from conftest import wait_for


def _rpc(url, token, method, params=None):
    return httpx.post(url, headers={"Authorization": f"Bearer {token}"},
                      json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}, timeout=20)


def test_companies_are_separate(base_url, owner):
    first = owner.get("/api/companies").json()
    assert first["current"] == "main" and [c["id"] for c in first["companies"]] == ["main"]
    assert first["companies"][0]["name"] == "Acme"

    new = owner.post("/api/companies", json={"name": "Warung Kopi"}).json()
    cid = new["id"]
    assert owner.cookies.get("saga_co") == cid, "creating a company switches to it"
    owner.cookies.clear()  # this client stays on Acme; `co` works on the new company
    assert cid.startswith("warung-kopi") and not new["onboarded"]
    co = httpx.Client(base_url=base_url, timeout=20, headers={**owner.headers, "X-Saga-Company": cid})

    # same login, nothing from Acme
    assert co.get("/api/auth/me").json()["email"] == "owner@example.com"
    assert co.get("/api/staff").json() == []
    assert co.get("/api/setup").json()["company_name"] == "Warung Kopi"
    assert owner.get("/api/setup").json()["company_name"] == "Acme"

    # its own team, jobs and docs
    co.post("/api/onboarding/company", json={"company_name": "Warung Kopi", "files": {"company.md": "# Warung Kopi\n\nCoffee in Bandung."}})
    team = co.post("/api/team/apply", json={"preset": "small", "engine": {"type": "fake"}}).json()
    assert {s["id"] for s in co.get("/api/staff").json()} >= {"chief-of-staff"}
    t = co.post("/api/tasks", json={"staff_id": "chief-of-staff", "brief": "Plan the opening week"}).json()
    assert wait_for(lambda: (x := co.get(f"/api/tasks/{t['id']}").json())["status"] in ("done", "failed") and x, timeout=20)["status"] == "done"
    assert owner.get(f"/api/tasks/{t['id']}").status_code == 404, "Acme can't see the other company's job"
    co.put("/api/vault/write", json={"path": "Menu", "content": "# Menu\nKopi susu"})
    assert any(d["path"] == "Menu.md" for d in co.get("/api/vault").json()["docs"])
    assert not any(d["path"] == "Menu.md" for d in owner.get("/api/vault").json()["docs"])

    # helpers of the new company reach their own MCP endpoint; an Acme token is useless there
    tok = team["mcp_tokens"]["chief-of-staff"]
    assert _rpc(f"{base_url}/co/{cid}/mcp", tok, "tools/list").status_code == 200
    assert _rpc(f"{base_url}/mcp", tok, "tools/list").status_code == 401
    assert _rpc(f"{base_url}/co/{cid}/mcp", owner.mcp_tokens["marketing"], "tools/list").status_code == 401
    assert httpx.get(f"{base_url}/co/nope/api/staff").status_code == 404

    # the cookie picks the company for browsers
    r = owner.post("/api/companies/switch", json={"id": cid})
    assert r.status_code == 200 and "saga_co=" + cid in r.headers["set-cookie"]
    assert owner.get("/api/setup").json()["company_name"] == "Warung Kopi"
    owner.cookies.clear()

    # archive and bring back
    assert owner.patch("/api/companies/main", json={"archived": True}).status_code == 400
    assert owner.patch(f"/api/companies/{cid}", json={"archived": True}).json()["archived"]
    assert [c["id"] for c in owner.get("/api/companies").json()["companies"]] == ["main"]
    assert co.get("/api/setup").json()["company_name"] == "Acme", "an archived company is no longer chosen"
    assert httpx.post(f"{base_url}/co/{cid}/mcp", json={}).status_code == 404
    owner.patch(f"/api/companies/{cid}", json={"archived": False, "name": "Warung Kopi Bandung"})
    assert any(c["name"] == "Warung Kopi Bandung" for c in owner.get("/api/companies").json()["companies"])
    owner.cookies.clear()
    owner.patch(f"/api/companies/{cid}", json={"archived": True})  # leave the other tests one company
