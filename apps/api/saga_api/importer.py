"""Import a v0 prototype (company-os folder) into Saga OS: loops -> staff + shifts, company/ -> knowledge,
runs -> finished tasks with reports, approvals -> proposals. The CLI sends the folder as {relative_path: text}.
"""
import json
import re

from sqlalchemy.orm import Session

from . import catalog
from . import services as S
from .models import InboxItem, Proposal, ProposalRevision, Report, Staff, Task

LOOP_TO_ROLE = {"operations": "ops", "development": "dev", "support": "support", "marketing": "marketing",
                "sales": "sales", "business": "finance", "meta": "chief-of-staff"}
DOW = {"Mon": "1", "Tue": "2", "Wed": "3", "Thu": "4", "Fri": "5", "Sat": "6", "Sun": "0"}


def oncalendar_to_cron(spec: str) -> str | None:
    """The OnCalendar forms the prototype used, e.g. 'Tue,Thu *-*-* 09:00:00 Asia/Jakarta'."""
    parts = spec.split()
    dow = "*"
    if parts and re.match(r"^[A-Z][a-z]{2}(,[A-Z][a-z]{2})*$", parts[0]):
        dow = ",".join(DOW[d] for d in parts[0].split(","))
        parts = parts[1:]
    if len(parts) < 2 or parts[0] != "*-*-*":
        return None
    hh, mm, *_ = parts[1].split(":")
    hour = "*" if hh == "*" else hh
    return f"{int(mm)} {hour} * * {dow}"


def import_prototype(db: Session, files: dict[str, str], actor: str) -> dict:
    out = {"knowledge": 0, "staff": 0, "tasks": 0, "proposals": 0, "skipped": []}
    for path, text in files.items():
        m = re.match(r"^company/([a-z0-9_-]+\.md)$", path)
        if m:
            S.write_knowledge(db, m.group(1), text, actor)
            out["knowledge"] += 1

    loops = {}
    for path, text in files.items():
        m = re.match(r"^loops/([a-z0-9-]+)/loop\.json$", path)
        if m:
            loops[m.group(1)] = json.loads(text)
    for lid, loop in loops.items():
        role = LOOP_TO_ROLE.get(loop.get("function", ""), lid)
        sid = role
        prompt = files.get(f"loops/{lid}/prompt.md", "")
        st = db.get(Staff, sid)
        if st is None:
            st = S.create_staff(db, {"id": sid, "name": (catalog.role(role) or {}).get("name", loop.get("name", sid)),
                                     "role": role, "is_chief": role == "chief-of-staff" and not S.chief(db),
                                     "job": prompt, "engine": {"type": "fake"}, "permissions": {}}, actor)
            out["staff"] += 1
        cron = oncalendar_to_cron(loop.get("schedule", ""))
        if cron and not any(sh.name == lid for sh in st.shifts):
            S.add_shift(db, st, lid, cron, loop.get("description", ""))
        else:
            out["skipped"].append(f"schedule of {lid}: {loop.get('schedule')}")
        if not st.job and prompt:
            st.job = prompt
    db.commit()

    loop_staff = {lid: LOOP_TO_ROLE.get(lp.get("function", ""), lid) for lid, lp in loops.items()}
    for path, text in files.items():
        m = re.match(r"^state/runs/([^/]+)/run\.json$", path)
        if not m:
            continue
        run = json.loads(text)
        sid = loop_staff.get(run.get("loop"))
        if not sid or run.get("status") == "running":
            continue
        t = Task(staff_id=sid, origin="shift", brief=f"(imported) {run['loop']} run", created_by="import",
                 status="done" if run.get("status") == "success" else "failed", error=run.get("error") or "",
                 cost_usd=run.get("cost_usd") or 0)
        db.add(t)
        db.flush()
        report = files.get(f"state/runs/{m.group(1)}/report.md")
        if report:
            head = next((ln[2:] for ln in report.splitlines() if ln.startswith("# ")), run.get("headline") or "imported")
            db.add(Report(task_id=t.id, staff_id=sid, headline=head[:300], body_md=report))
        out["tasks"] += 1

    status_map = {"pending": "pending", "approved": "approved", "rejected": "rejected", "executed": "done"}
    for path, text in files.items():
        if not re.match(r"^state/approvals/[^/]+\.json$", path):
            continue
        a = json.loads(text)
        sid = loop_staff.get(a.get("loop"))
        if not sid:
            continue
        p = Proposal(staff_id=sid, type=a.get("type", "other"), risk=a.get("risk", "medium"), title=a.get("title", "imported"),
                     status=status_map.get(a.get("status"), "pending"), decision_note=a.get("note") or "")
        db.add(p)
        db.flush()
        db.add(ProposalRevision(proposal_id=p.id, n=1, body_md=a.get("body", ""), author="import", summary="imported from v0"))
        if p.status == "pending":
            db.add(InboxItem(kind="proposal", ref_id=p.id, staff_id=sid, title=p.title, body="imported from v0"))
        out["proposals"] += 1
    S.audit(db, actor, "import.prototype", "", **{k: v for k, v in out.items() if k != "skipped"})
    db.commit()
    return out
