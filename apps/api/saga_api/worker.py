"""The worker: turns shifts into tasks, runs tasks on engines (respecting the concurrency limit),
and answers chat threads. Runs inside the API (laptop mode) or as its own process: `saga-worker`.
"""
import asyncio
import logging
import time

from sqlalchemy import func, select

from . import services as S
from .capabilities import resolve
from .config import get_settings
from .db import init_db, session_scope
from .engines import ChatContext, EngineResult, TaskContext, get_engine
from .events import Emitter
from .models import Proposal, Report, Shift, Staff, Task, Thread, now
from .security import decrypt

log = logging.getLogger("saga.worker")


def _mcp_url() -> str:
    return get_settings().mcp_url()


class Worker:
    def __init__(self):
        self.running: dict[str, asyncio.Task] = {}
        self.chatting: dict[str, asyncio.Task] = {}
        self._stop = asyncio.Event()
        from .hermes_manager import Supervisor

        self.hermes = Supervisor()
        self._hermes_checked = 0.0

    # ------------------------------------------------------------ lifecycle
    def recover(self):
        """Tasks left 'running' by a previous process: requeue once, then fail."""
        with session_scope() as db:
            for t in db.scalars(select(Task).where(Task.status == "running")):
                if t.attempts < 2:
                    t.status, t.error = "queued", "requeued after restart"
                else:
                    t.status, t.ended_at, t.error = "failed", now(), "interrupted twice"
            for _th in db.scalars(select(Thread).where(Thread.awaiting_reply.is_(True))):
                pass  # still awaiting: will be picked up

    def weekly_digest(self) -> None:
        from . import digest

        try:
            with session_scope() as db:
                digest.maybe_send(db)
        except Exception:
            log.exception("weekly digest failed")

    def _budget(self, staff_id: str) -> None:
        """Monthly budget: alert at 80%, pause the helper at 100%."""
        from . import budgets

        try:
            with session_scope() as db:
                budgets.check(db, staff_id)
        except Exception:
            log.exception("budget check failed")

    async def push_loop(self):
        """Web Push for notices while no tab is open (every 3 s)."""
        from . import notify

        while not self._stop.is_set():
            try:
                await notify.push_pending(session_scope)
            except Exception:
                log.exception("web push failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=3)
            except TimeoutError:
                pass

    async def run_forever(self):
        self.recover()
        self._push = asyncio.create_task(self.push_loop())
        interval = get_settings().worker_interval_s
        while not self._stop.is_set():
            try:
                await self.tick()
            except Exception:  # never let one bad tick stop the worker
                log.exception("worker tick failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=interval)
            except TimeoutError:
                pass

    async def stop(self):
        self._stop.set()
        await self.hermes.stop_all()
        for t in list(self.running.values()) + list(self.chatting.values()):
            t.cancel()

    # ------------------------------------------------------------ one tick
    async def manage_hermes(self, force: bool = False):
        """Every ~5 s: write managed Hermes profiles and keep their gateways running."""
        import time

        if not force and time.monotonic() - self._hermes_checked < 5:
            return
        self._hermes_checked = time.monotonic()
        with session_scope() as db:
            desired = S.desired_gateways(db)
        await self.hermes.reconcile(desired)

    async def tick(self):
        try:
            await self.manage_hermes()
        except Exception:
            log.exception("managing hermes failed")
        self.schedule_shifts()
        self.weekly_digest()
        self.dispatch_tasks()
        self.dispatch_chats()
        self.running = {k: v for k, v in self.running.items() if not v.done()}
        self.chatting = {k: v for k, v in self.chatting.items() if not v.done()}

    def schedule_shifts(self):
        with session_scope() as db:
            if S.is_paused(db):
                return
            due = db.scalars(select(Shift).where(Shift.enabled.is_(True), Shift.next_at <= now()))
            for sh in due:
                st = db.get(Staff, sh.staff_id)
                sh.last_at = now()
                sh.next_at = S.next_run(sh.cron, db=db)
                if not st or st.status != "active":
                    continue
                busy = db.scalar(select(func.count()).select_from(Task).where(
                    Task.shift_id == sh.id, Task.status.in_(["queued", "running"])))
                if busy:
                    continue  # previous shift still in progress
                db.add(Task(staff_id=st.id, origin="shift", brief=sh.brief or sh.name, created_by="schedule", shift_id=sh.id))
                S.audit(db, "system", "shift.fire", sh.id, staff=st.id)

    def dispatch_tasks(self):
        with session_scope() as db:
            if S.is_paused(db):
                return
            limit = S.max_concurrent(db)
            busy_staff = {t.staff_id for t in db.scalars(select(Task).where(Task.status == "running"))}
            slots = limit - len(busy_staff)
            if slots <= 0:
                return
            queued = db.scalars(select(Task).where(Task.status == "queued").order_by(Task.created_at).limit(50))
            for t in queued:
                if slots <= 0:
                    break
                st = db.get(Staff, t.staff_id)
                if not st or st.status != "active" or t.staff_id in busy_staff:
                    continue
                t.status, t.started_at, t.attempts = "running", now(), t.attempts + 1
                t.engine_type = (st.engine or {}).get("type", "fake")
                if t.proposal_id and t.origin == "execution" and (p := db.get(Proposal, t.proposal_id)) and p.status == "approved":
                    p.status = "executing"
                busy_staff.add(t.staff_id)
                slots -= 1
                db.flush()
                self.running[t.id] = asyncio.create_task(self.run_task(t.id))

    def dispatch_chats(self):
        with session_scope() as db:
            for th in db.scalars(select(Thread).where(Thread.awaiting_reply.is_(True))):
                if th.id not in self.chatting:
                    self.chatting[th.id] = asyncio.create_task(self.answer_thread(th.id))

    # ------------------------------------------------------------ run one task
    def _task_context(self, task_id: str) -> tuple[TaskContext, dict, int]:
        with session_scope() as db:
            t = db.get(Task, task_id)
            st = db.get(Staff, t.staff_id)
            ck = S.latest_checkpoint(db, t.id)
            prop = None
            if t.proposal_id and (p := db.get(Proposal, t.proposal_id)):
                prop = {"id": p.id, "title": p.title, "type": p.type, "approved_text": S.current_body(p)}
            ctx = TaskContext(
                staff_id=st.id, staff_name=st.name, job=st.job, is_chief=st.is_chief, task_id=t.id, origin=t.origin,
                brief=t.brief, founder_note=t.founder_note,
                checkpoint=ck and {"plan": ck.plan, "done": ck.done, "next": ck.next, "notes": ck.notes},
                proposal=prop, mcp_url=_mcp_url(), mcp_token=decrypt(st.mcp_token_enc), engine_config=st.engine or {},
                emit=Emitter(st.id, task_id=t.id), resources=resolve(db, proposal=prop),
            )
            return ctx, dict(st.engine or {}), int(st.max_task_minutes or 30)

    async def run_task(self, task_id: str):
        ctx, engine_cfg, minutes = self._task_context(task_id)
        t0 = time.monotonic()
        ctx.emit("status", state="started", engine=_engine_label(engine_cfg), origin=ctx.origin)
        try:
            engine = get_engine(engine_cfg)
            res = await asyncio.wait_for(engine.run_task(ctx), timeout=min(minutes * 60, get_settings().task_timeout_s))
        except TimeoutError:
            res = EngineResult(error=f"timed out after {minutes} min")
        except asyncio.CancelledError:
            res = EngineResult(error="cancelled")
        except Exception as e:  # engine bug or bad config
            res = EngineResult(error=f"{type(e).__name__}: {e}")
        ctx.emit("usage", tokens=res.tokens, cost_usd=round(res.cost_usd, 4), seconds=round(time.monotonic() - t0, 1))
        self._budget(ctx.staff_id)
        ctx.emit("status", state="failed" if res.error else "done", error=res.error)
        self.finish(task_id, res)

    def finish(self, task_id: str, res: EngineResult):
        with session_scope() as db:
            t = db.get(Task, task_id)
            if t is None or t.status == "cancelled":
                return
            t.cost_usd += res.cost_usd
            t.tokens += res.tokens
            report = db.scalar(select(Report).where(Report.task_id == t.id))
            if res.error:
                S.finish_task(db, t, "failed", error=res.error, result_text=res.text)
                S.alert(db, f"Task failed: {t.brief[:80]}", res.error, t.staff_id, t.id)
            else:
                if report is None:  # agent forgot report(): keep its final answer as the report
                    text = (res.text or "(no output)").strip()
                    db.add(Report(task_id=t.id, staff_id=t.staff_id, headline=text.splitlines()[0][:300], body_md=text))
                S.finish_task(db, t, "done", result_text=res.text)
            if t.proposal_id and t.origin == "execution":
                p = db.get(Proposal, t.proposal_id)
                if p and p.status == "executing":
                    p.status = "failed" if res.error else "approved"
                    S.alert(db, f"Execution not confirmed: {p.title}",
                            res.error or "The agent finished without calling mark_executed.", t.staff_id, t.id)
            th = S.get_or_create_thread(db, "task", t.id, t.staff_id, t.brief[:120])
            rep = db.scalar(select(Report).where(Report.task_id == t.id))
            summary = f"**{t.status.upper()}**: " + (rep.headline if rep else res.error or "")
            S.post_message(db, th, "system", "saga-os", summary)

    # ------------------------------------------------------------ chats
    async def answer_thread(self, thread_id: str):
        with session_scope() as db:
            th = db.get(Thread, thread_id)
            st = db.get(Staff, th.staff_id)
            if st.status != "active":
                S.post_message(db, th, "system", st.id, f"{st.name} is paused (Team → {st.name} to resume or raise its budget).", awaiting_reply=False)
                return
            msgs = S.thread_messages(db, th, limit=40)
            # empty messages (an engine that answered nothing) would make the AI reject the whole history
            history = [{"role": "owner" if m.role == "owner" else "agent", "text": m.text} for m in msgs if m.role in ("owner", "agent") and (m.text or "").strip()]
            open_items = db.scalar(select(func.count()).select_from(S.InboxItem).where(S.InboxItem.status == "open"))
            note = f"Inbox: {open_items} open item(s)."
            if th.scope == "task" and (t := db.get(Task, th.ref_id)):
                rep = db.scalar(select(Report).where(Report.task_id == t.id))
                note += f"\nThis thread is about task {t.id} ({t.status}): {t.brief}\nReport: {rep.headline if rep else '-'}"
            if th.scope == "proposal" and (p := db.get(Proposal, th.ref_id)):
                note += f"\nThis thread is about proposal {p.id} ({p.status}): {p.title}\nCurrent text:\n{S.current_body(p)}"
            ctx = ChatContext(staff_id=st.id, staff_name=st.name, job=st.job, is_chief=st.is_chief, thread_id=th.id,
                              scope=th.scope, history=history, context_note=note, mcp_url=_mcp_url(),
                              mcp_token=decrypt(st.mcp_token_enc), engine_config=st.engine or {},
                              emit=Emitter(st.id, thread_id=th.id), resources=resolve(db, thread_id=th.id))
        t0 = time.monotonic()
        ctx.emit("status", state="started", engine=_engine_label(ctx.engine_config))
        try:
            res = await asyncio.wait_for(get_engine(ctx.engine_config).chat(ctx), timeout=600)
        except Exception as e:
            res = EngineResult(error=f"{type(e).__name__}: {e}")
        if not res.error and not (res.text or "").strip():
            res.error = "the AI finished without writing an answer"
        ctx.emit("usage", tokens=res.tokens, cost_usd=round(res.cost_usd, 4), seconds=round(time.monotonic() - t0, 1))
        self._budget(ctx.staff_id)
        ctx.emit("status", state="failed" if res.error else "done", error=res.error)
        with session_scope() as db:
            th = db.get(Thread, thread_id)
            text = res.text if not res.error else f"Sorry, I couldn't answer: {res.error}"
            S.post_message(db, th, "agent" if not res.error else "system", th.staff_id, text, awaiting_reply=False)


def _engine_label(cfg: dict) -> str:
    t = (cfg or {}).get("type", "fake")
    if t == "hermes":
        return f"Hermes · {cfg.get('claude_model')}" if cfg.get("managed") else "Hermes"
    if t == "claude-code":
        return "Claude Code pool" + (f" · {cfg['model']}" if cfg.get("model") else "")
    if t == "claude":
        return f"Claude · {cfg.get('model') or ''}".strip(" ·")
    return "Practice mode"


def main():  # `saga-worker`: the worker as its own process (server mode)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    init_db()
    asyncio.run(Worker().run_forever())


if __name__ == "__main__":
    main()
