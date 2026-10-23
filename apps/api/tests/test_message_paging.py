"""Chat message pagination: the thread loads only the newest page; older messages come on scroll-up.

Run with:
    cd apps/api && .venv/bin/pytest -q tests/test_message_paging.py
"""
import datetime as dt

from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.models import Message, Staff, Thread


def _seed(n: int, key: str) -> str:
    """A staff thread with n messages, 1 minute apart, oldest first. Returns the thread id.
    `key` keeps the staff id unique across tests, which share one database in a session."""
    base = dt.datetime(2026, 1, 1, 12, 0, 0, tzinfo=dt.UTC)
    with session_scope() as db:
        st = Staff(id=f"mp_staff_{key}", name="MP Staff", role="tester", is_chief=False, status="active")
        db.add(st)
        th = Thread(staff_id=st.id, scope="staff", title="Paging thread")
        db.add(th)
        db.flush()
        for i in range(n):
            db.add(Message(thread_id=th.id, role="owner" if i % 2 == 0 else "agent", author=st.id,
                           text=f"message {i:03d}", blocks=[{"type": "text", "text": f"message {i:03d}"}],
                           at=base + dt.timedelta(minutes=i)))
        return th.id


def test_detail_returns_newest_page_with_has_more(owner):
    tid = _seed(70, "page")  # > one PAGE (40)
    d = owner.get(f"/api/threads/{tid}").json()
    texts = [m["text"] for m in d["messages"]]
    assert len(texts) == S.PAGE                        # only the newest page
    assert texts[0] == "message 030" and texts[-1] == "message 069"  # oldest→newest, newest 40
    assert d["has_more"] is True                       # 30 older remain


def test_scroll_up_loads_older_then_stops(owner):
    tid = _seed(70, "a")
    first = owner.get(f"/api/threads/{tid}").json()
    oldest_at = first["messages"][0]["at"]             # cursor = oldest message we have
    page = owner.get(f"/api/threads/{tid}/messages", params={"before": oldest_at, "limit": 40}).json()
    texts = [m["text"] for m in page["messages"]]
    assert len(texts) == 30                            # the remaining older 30
    assert texts[0] == "message 000" and texts[-1] == "message 029"  # oldest→newest, strictly older
    assert page["has_more"] is False                   # nothing older than message 000
    # no overlap with the first page
    assert set(texts).isdisjoint({m["text"] for m in first["messages"]})


def test_short_thread_has_no_more(owner):
    tid = _seed(5, "c")
    d = owner.get(f"/api/threads/{tid}").json()
    assert len(d["messages"]) == 5 and d["has_more"] is False


def test_bad_before_is_rejected(owner):
    tid = _seed(3, "d")
    r = owner.get(f"/api/threads/{tid}/messages", params={"before": "not-a-date"})
    assert r.status_code == 400
