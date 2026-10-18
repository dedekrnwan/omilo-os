"""Team chats: the Chief of Staff answers when no one is named, @mentions bring helpers in (here and in 1:1 chats),
and a helper that names a teammate hands over."""
from conftest import wait_for


def _msgs(owner, tid):
    return owner.get(f"/api/threads/{tid}").json()


def _done(owner, tid):
    th = _msgs(owner, tid)
    return th if not th["awaiting_reply"] else None


def test_mentions_parse(owner):
    from omilo_api import teamchat as TC
    from omilo_api.db import session_scope

    with session_scope() as db:
        assert TC.mentions(db, "hey @Marketing and @sales, also @chief of staff?") == ["marketing", "sales", "chief-of-staff"]
        assert TC.mentions(db, "email me@marketing.com or @@sales") == []
        assert TC.mentions(db, "no one", ["support", "nobody"]) == ["support"]


def test_general_chat_routes_by_mention(owner):
    g = owner.post("/api/threads", json={"scope": "group"}).json()
    assert g["scope"] == "group" and g["title"] == "General" and g["ref_id"] == "general"
    assert owner.post("/api/threads", json={"scope": "group", "ref_id": "general"}).json()["id"] == g["id"], "one General"

    # nobody named: the Chief of Staff answers
    owner.post(f"/api/threads/{g['id']}/messages", json={"text": "Morning team, what's on today?"})
    th = wait_for(lambda: _done(owner, g["id"]), timeout=20)
    assert [m["author"] for m in th["messages"] if m["role"] == "agent"] == ["chief-of-staff"]

    # two helpers named: both answer, in order, and the chief stays quiet
    r = owner.post(f"/api/threads/{g['id']}/messages", json={"text": "@Marketing draft a post and @Sales check the leads"}).json()
    assert r["pending"] == ["marketing", "sales"]
    owner_msg = [m for m in r["messages"] if m["role"] == "owner"][-1]
    assert {"type": "mentions", "ids": ["marketing", "sales"]} in owner_msg["blocks"]
    th = wait_for(lambda: _done(owner, g["id"]), timeout=30)
    after = th["messages"][th["messages"].index(next(m for m in th["messages"] if m["id"] == owner_msg["id"])) + 1:]
    assert [m["author"] for m in after if m["role"] == "agent"] == ["marketing", "sales"]
    assert "team chat" in after[0]["text"] and "brought in by name" in after[0]["text"], "the fake engine echoes the room note"
    assert th["pending"] == []

    # the composer's picked ids count too
    owner.post(f"/api/threads/{g['id']}/messages", json={"text": "your turn", "mentions": ["finance"]})
    th = wait_for(lambda: _done(owner, g["id"]), timeout=20)
    assert th["messages"][-1]["author"] == "finance"


def test_mention_in_a_one_to_one_chat_and_group_admin(owner):
    th = owner.post("/api/threads", json={"scope": "staff", "staff_id": "support"}).json()
    owner.post(f"/api/threads/{th['id']}/messages", json={"text": "Customer asks for a refund, @Finance can we?"})
    done = wait_for(lambda: _done(owner, th["id"]), timeout=30)
    tail = [m["author"] for m in done["messages"] if m["role"] == "agent"][-2:]
    assert tail == ["support", "finance"], "the helper you're talking to answers, then the one you named"

    # make, rename and delete a team chat; General can't be deleted
    c = owner.post("/api/threads", json={"scope": "group", "title": "  Launch   week "}).json()
    assert c["title"] == "Launch week" and c["ref_id"].startswith("grp_")
    assert owner.patch(f"/api/threads/{c['id']}", json={"title": "Launch"}).json()["title"] == "Launch"
    assert owner.patch(f"/api/threads/{th['id']}", json={"title": "x"}).status_code == 409
    g = owner.post("/api/threads", json={"scope": "group"}).json()
    assert owner.delete(f"/api/threads/{g['id']}").status_code == 409
    assert owner.delete(f"/api/threads/{c['id']}").json() == {"ok": True}
    assert owner.get(f"/api/threads/{c['id']}").status_code == 404


def test_history_tags_the_founders_latest_message(owner):
    """A brought-in helper must answer the founder's latest message, not a founder-directed question a
    teammate left in the same (merged) user turn. history() tags the latest founder message distinctly."""
    from sqlalchemy import select

    from omilo_api import teamchat as TC
    from omilo_api.db import session_scope
    from omilo_api.models import Message, Staff, Thread

    with session_scope() as db:
        th = db.get(Thread, owner.post("/api/threads", json={"scope": "group"}).json()["id"])
        me = db.scalar(select(Staff).where(Staff.id == "marketing"))
        assert me is not None, "marketing helper must exist in the test team"
        msgs = [
            Message(id="m1", thread_id=th.id, role="owner", author="owner", text="first ask", blocks=[]),
            Message(id="m2", thread_id=th.id, role="agent", author="chief-of-staff", text="Keputusan Anda: A or B?", blocks=[]),
            Message(id="m3", thread_id=th.id, role="owner", author="owner", text="go with A, and @Marketing draft it", blocks=[]),
        ]
        h = TC.history(db, th, me, msgs)

    joined = "\n".join(x["text"] for x in h)
    # The latest founder message (m3) is the cue; the earlier one (m1) is not.
    assert "[The founder's latest message — this is what to answer]\ngo with A" in joined
    assert "[The founder wrote]\nfirst ask" in joined
    assert "this is what to answer]\nfirst ask" not in joined
    # The chief's founder-directed question is framed as a teammate, not as the answer cue.
    assert "[Chief of Staff, your teammate, wrote]\nKeputusan Anda" in joined


def test_helper_hands_over_by_naming_a_teammate(owner):
    from omilo_api import teamchat as TC
    from omilo_api.db import session_scope
    from omilo_api.models import Thread

    with session_scope() as db:
        th = db.get(Thread, owner.post("/api/threads", json={"scope": "group"}).json()["id"])
        assert TC.handover(db, th, "chief-of-staff", "Over to @Marketing for this one", ["chief-of-staff"]) == ["marketing"]
        assert TC.handover(db, th, "marketing", "I'll ask @Marketing myself", ["marketing"]) == [], "not yourself"
        assert TC.handover(db, th, "sales", "@Marketing again", ["chief-of-staff", "marketing", "sales", "ops"]) == [], "capped"
