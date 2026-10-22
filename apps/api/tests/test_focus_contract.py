"""TDD contract test: GET /api/threads/{id}/focus — files[] must include url.

Step 1 (RED): files dict in focus() omits "url", so f["url"] will be missing.
Step 3 (GREEN): after adding "url": k.url to the dict, the assert passes.

Run with:
    cd apps/api && uv run pytest tests/test_focus_contract.py -v
"""
import datetime as dt

import pytest

from omilo_api.db import session_scope
from omilo_api.models import KbSource, Staff, Task, Thread


# ---------------------------------------------------------------------------
# Seed helpers (mirror test_team_board.py pattern)
# ---------------------------------------------------------------------------

def _staff(suffix: str) -> Staff:
    return Staff(
        id=f"fc_staff_{suffix}",
        name=f"FC Staff {suffix}",
        role="tester",
        is_chief=False,
        status="active",
    )


def _task(staff_id: str) -> Task:
    return Task(
        staff_id=staff_id,
        origin="chat",
        brief="Contract test task",
        status="done",
        cost_usd=0.01,
        tokens=100,
        started_at=dt.datetime.now(dt.UTC) - dt.timedelta(minutes=5),
        ended_at=dt.datetime.now(dt.UTC),
    )


def _thread(staff_id: str, task_id: str) -> Thread:
    return Thread(
        staff_id=staff_id,
        scope="task",
        ref_id=task_id,
        title="Contract test thread",
        awaiting_reply=False,
        updated_at=dt.datetime.now(dt.UTC),
    )


# ---------------------------------------------------------------------------
# The contract test
# ---------------------------------------------------------------------------

def test_focus_files_include_url(owner):
    """files[0] returned by GET /api/threads/{id}/focus must carry title, url, and kind.

    RED before fix (url missing from files dict in thread_extras.focus()).
    GREEN after adding "url": k.url to the dict.
    """
    with session_scope() as db:
        s = _staff("url_contract")
        db.add(s)
        db.flush()

        task = _task(s.id)
        db.add(task)
        db.flush()
        task_id = task.id

        th = _thread(s.id, task_id)
        db.add(th)
        db.flush()
        thread_id = th.id

        # Seed a KbSource with a real URL scoped to the task
        kb = KbSource(
            kind="pr",
            ref=task_id,
            title="PR #4",
            url="https://github.com/acme/repo/pull/4",
        )
        db.add(kb)
        db.commit()

    resp = owner.get(f"/api/threads/{thread_id}/focus")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert "files" in data, "response must have 'files' key"
    assert len(data["files"]) >= 1, "at least one file must be present"

    f = next((x for x in data["files"] if x.get("kind") == "pr"), None)
    assert f is not None, "no 'pr' file found in response"

    # Core contract assertions
    assert f["title"] == "PR #4", f"expected title='PR #4', got {f.get('title')!r}"
    assert f["url"] == "https://github.com/acme/repo/pull/4", (
        f"expected url='https://github.com/acme/repo/pull/4', got {f.get('url')!r}"
    )
    assert f["kind"] == "pr", f"expected kind='pr', got {f.get('kind')!r}"
