"""Guided onboarding: plain answers -> knowledge files, recommended team, schedules in words."""
from conftest import wait_for

from saga_api import onboarding as OB

ANSWERS = {
    "company_name": "Warung Bu Sri",
    "one_liner": "Home-cooked Javanese lunch boxes delivered to offices in South Jakarta.",
    "industry": "food", "location": "South Jakarta", "stage": "started", "team_size": "small",
    "customers": "Office workers and HR teams ordering for meetings.",
    "offers": [{"name": "Nasi box", "price": "Rp 35.000", "note": "min. 10 boxes"}, {"name": "", "price": ""}],
    "not_yet": "Catering for weddings",
    "goals": ["more_customers", "support", "product"], "goal_notes": {"more_customers": "20 new offices by March"},
    "languages": ["id", "en"], "tones": ["warm", "friendly"],
    "tools": ["whatsapp", "instagram"], "rules": ["no_promises", "no_invention"], "rules_other": "No pork, ever.",
    "has_software": False, "team_style": "small",
}


def test_describe_cron():
    assert OB.describe_cron("30 7 * * *") == "Every day at 07:30"
    assert OB.describe_cron("0 8 * * 1") == "Every Monday at 08:00"
    assert OB.describe_cron("0 9 * * 2,4") == "Every Tuesday and Thursday at 09:00"
    assert OB.describe_cron("0 1,13 * * *") == "Every day at 01:00 and 13:00"
    assert OB.describe_cron("5 * * * *") == "Every hour at :05"
    assert OB.describe_cron("0 9 * * 1-5") == "Every weekday at 09:00"
    assert OB.describe_cron("0 9 1 * *").startswith("Custom schedule")


def test_recommend_skips_software_roles_for_non_software_business():
    rec = OB.recommend(ANSWERS)
    assert rec["roles"] == ["chief-of-staff", "grower"], rec  # no builder: the warung has no app
    full = OB.recommend({**ANSWERS, "team_style": "full", "has_software": True})
    assert full["roles"] == ["chief-of-staff", "marketing", "sales", "support", "dev"]
    assert OB.recommend({})["roles"] == ["chief-of-staff", "grower"]


def test_render_turns_answers_into_files():
    files = OB.render(ANSWERS)
    assert set(files) == {"company.md", "goals.md", "customers.md", "offer.md", "voice.md", "systems.md", "rules.md"}
    assert files["company.md"].startswith("# Warung Bu Sri")
    assert "| Nasi box | Rp 35.000 | min. 10 boxes |" in files["offer.md"]
    assert "Catering for weddings" in files["offer.md"]
    assert "Get more customers: 20 new offices by March" in files["goals.md"]
    assert "Bahasa Indonesia, English" in files["voice.md"] and "Warm, Friendly" in files["voice.md"]
    assert "No pork, ever." in files["rules.md"]
    assert OB.MISSING in files["customers.md"]  # unanswered questions tell agents to ask
    c = OB.completeness(ANSWERS)
    assert 0 < c["score"] <= 100 and c["items"]["What you sell"] is True


def test_guided_onboarding_end_to_end(owner):
    st = owner.get("/api/onboarding").json()
    assert "goals" in st["options"] and st["roles"]["grower"]["schedule"] == ["Every Monday at 08:00"]

    assert owner.put("/api/onboarding", json={"answers": ANSWERS, "step": 3}).json()["ok"]
    assert owner.get("/api/onboarding").json()["step"] == 3

    prev = owner.post("/api/onboarding/preview", json={"answers": ANSWERS}).json()
    assert prev["recommended"]["roles"] == ["chief-of-staff", "grower"]

    r = owner.post("/api/onboarding/finish", json={"answers": ANSWERS, "roles": ["grower"], "approval_mode": "balanced",
                                                   "timezone": "Asia/Jakarta", "engine": {"type": "fake"}})
    assert r.status_code == 200, r.text
    out = r.json()
    assert "grower" in out["created"] and out["mcp_tokens"] == {}  # practice mode: nothing to copy
    assert owner.get("/api/knowledge/company.md").json()["content"].startswith("# Warung Bu Sri")
    ov = owner.get("/api/overview").json()
    assert ov["timezone"] == "Asia/Jakarta" and ov["strict_mode"] is False
    shifts = owner.get("/api/staff/grower").json()["shifts"]
    assert shifts[0]["when"] == "Every Monday at 08:00"

    # the practice task produces a proposal in the Inbox, so the owner learns approvals right away
    tid = out["practice"]["task_id"]
    done = wait_for(lambda: (x := owner.get(f"/api/tasks/{tid}").json())["status"] in ("done", "failed") and x)
    assert done["status"] == "done"
    assert any(i.get("staff_id") == "grower" for i in owner.get("/api/inbox").json())

    bad = owner.post("/api/onboarding/finish", json={"answers": {**ANSWERS, "company_name": ""}, "roles": []})
    assert bad.status_code == 400
