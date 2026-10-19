"""Self-tuning harness: settings, data collection, and automated prompt improvement."""
import omilo_api.tune as T


def test_self_tuning_setting_defaults_off_and_toggles(owner):
    assert owner.get("/api/system").json()["self_tuning"] is False
    owner.post("/api/system", json={"self_tuning": True})
    assert owner.get("/api/system").json()["self_tuning"] is True
    owner.post("/api/system", json={"self_tuning": False})  # restore shared state for later tests
    assert owner.get("/api/system").json()["self_tuning"] is False


async def test_propose_returns_k_candidates(owner, monkeypatch):
    from omilo_api.db import session_scope
    from omilo_api.models import Staff
    async def fake_ask(db, staff, system, user):
        return {"candidates": ["JOB A", "JOB B", "JOB C"]}
    monkeypatch.setattr(T, "_ask_json", fake_ask)
    with session_scope() as db:
        st = db.get(Staff, "sales")
        out = await T.propose(db, st, k=2)
    assert out == ["JOB A", "JOB B"]


async def test_probe_runs_once_per_job(owner, base_url):
    from omilo_api.db import session_scope
    from omilo_api.models import Staff
    import omilo_api.tune as T
    with session_scope() as db:
        st = db.get(Staff, "sales")
        st.mcp_token_enc = __import__("omilo_api.security", fromlist=["encrypt"]).encrypt(owner.mcp_tokens["sales"])
        res = await T.probe(db, st, "Find 3 catering leads", ["JOB ONE", "JOB TWO"])
    assert len(res) == 2 and all(r.text and not r.error for r in res)
