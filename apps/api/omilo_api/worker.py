"""The worker: turns shifts into tasks, runs tasks on engines (respecting the concurrency limit),
and answers chat threads. Runs inside the API (laptop mode) or as its own process: `omilo-worker`.
"""
import asyncio
import logging
import time

from sqlalchemy import func, select

from . import company as C
from . import services as S
from .capabilities import resolve
from .config import get_settings
from .db import init_db, session_scope
from .engines import ChatContext, EngineResult, TaskContext, get_engine
from .events import Emitter
from .models import Proposal, Report, Shift, Staff, Task, Thread, now
from .security import decrypt

log = logging.getLogger("omilo.worker")


def _mcp_url() -> str:
    return get_settings().mcp_url()


class Worker:
    def __init__(self):
        self.running: dict[str, asyncio.Task] = {}
        self.retry_at: dict[str, float] = {}  # task id -> monotonic time it may run again (after a transient failure)
        self._daily: dict[str, float] = {}    # company -> last time the loop housekeeping ran
        self._nudged: dict[str, float] = {}   # company -> last time the nudge ladder ran
        self.chatting: dict[str, asyncio.Task] = {}
        self.flowing: dict[str, asyncio.Task] = {}  # workflow runs in progress
        self._stop = asyncio.Event()

    # ------------------------------------------------------------ lifecycle
    def recover(self):
        """Tasks left 'running' by a previous process: requeue once, then fail (in every company)."""
        for _cid in C.each():
            try:
                self._recover_one()
            except Exception:
                log.exception("recovering %s failed", _cid)

    def _recover_one(self):
        with session_scope() as db:
            for t in db.scalars(select(Task).where(Task.status == "running")):
                if t.attempts < 2:
                    t.status, t.error = "queued", "requeued after restart"
                else:
                    t.status, t.ended_at, t.error = "failed", now(), "interrupted twice"
            # Graph runs suspended for approval ("waiting"): if the owner already decided before
            # the crash, the resume may have been lost — re-signal it (enqueued, drained once a
            # loop runs). If still pending, leave it parked; the nudge ladder prods the owner and
            # the decision will drive the resume then.
            _decision = {"approved": "approve", "rejected": "reject", "changes_requested": "changes"}
            for t in db.scalars(select(Task).where(Task.status == "waiting")):
                p = db.scalar(select(Proposal).where(Proposal.task_id == t.id).order_by(Proposal.created_at.desc()))
                if p is not None and p.status in _decision:
                    request_resume(t.id, _decision[p.status], p.decision_note or "")
            for _th in db.scalars(select(Thread).where(Thread.awaiting_reply.is_(True))):
                pass  # still awaiting: will be picked up
            from .models import WorkflowRun

            for r in db.scalars(select(WorkflowRun).where(WorkflowRun.status == "running")):
                r.status = "queued"  # goes on from the step it was on

    def weekly_digest(self) -> None:
        from . import digest

        try:
            with session_scope() as db:
                digest.maybe_send(db)
        except Exception:
            log.exception("weekly digest failed")

    def nudges(self) -> None:
        """The nudge ladder for the current company (every few ticks, at most every 20 s): wake snoozed items, remind about waiting ones."""
        from . import nudge
        from .models import User

        cid = C.current()
        if time.monotonic() - self._nudged.get(cid, 0) < min(20.0, get_settings().worker_interval_s * 5):
            return
        self._nudged[cid] = time.monotonic()
        try:
            with session_scope(C.MAIN) as adb:
                owner = adb.scalar(select(User.id).order_by(User.created_at).limit(1))
            with session_scope() as db:
                for line in nudge.tick(db, owner):
                    log.info("nudge: %s", line)
        except Exception:
            log.exception("nudge ladder failed")

    def _budget(self, staff_id: str) -> None:
        """Monthly budget: alert at 80%, pause the helper at 100%."""
        from . import budgets

        try:
            with session_scope() as db:
                budgets.check(db, staff_id)
                budgets.check_company(db)
        except Exception:
            log.exception("budget check failed")

    async def push_loop(self):
        """Web Push for notices while no tab is open (every 3 s)."""
        from . import notify

        while not self._stop.is_set():
            many = len(C.ids()) > 1
            for cid in C.each():
                try:
                    label = C.summary(cid)["name"] if many else ""
                    await notify.push_pending(session_scope, lambda: session_scope(C.MAIN), label, cid if many else "")
                except Exception:
                    log.exception("web push failed for %s", cid)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=3)
            except TimeoutError:
                pass

    async def cancel_loop(self):
        """Subscribe to Redis cancel:chat signals across all companies and cancel matching chatting tasks.

        Resilient: if Redis drops or throws, wait 5 s and re-subscribe so a transient hiccup never
        kills cancel processing permanently. asyncio.CancelledError (worker shutdown) exits cleanly.
        """
        import json as _json

        from . import bus

        prefix = get_settings().redis_prefix
        pattern = f"{prefix}:*:ch:cancel:chat"

        while not self._stop.is_set():
            pubsub = bus.ar().pubsub()
            try:
                await pubsub.psubscribe(pattern)
                async for message in pubsub.listen():
                    if self._stop.is_set():
                        return
                    if message["type"] != "pmessage":
                        continue
                    try:
                        data = _json.loads(message["data"])
                        thread_id = data.get("thread_id")
                        if not thread_id:
                            continue
                        task = self.chatting.get(thread_id)
                        if task and not task.done():
                            task.cancel()
                            log.info("cancel_loop: cancelled chatting task for thread %s", thread_id)
                    except Exception:
                        log.exception("cancel_loop: error handling cancel signal")
            except asyncio.CancelledError:
                return
            except Exception:
                log.exception("cancel_loop: unexpected error; retrying in 5 s")
                try:
                    await asyncio.sleep(5)
                except asyncio.CancelledError:
                    return
            finally:
                try:
                    await pubsub.punsubscribe(pattern)
                    await pubsub.aclose()
                except Exception:
                    pass

    async def run_forever(self):
        self.recover()
        self._push = asyncio.create_task(self.push_loop())
        self._kb = asyncio.create_task(self.kb_loop())
        self._cancelsub = asyncio.create_task(self.cancel_loop())
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
        for t in list(self.running.values()) + list(self.chatting.values()) + list(self.flowing.values()):
            t.cancel()
        if hasattr(self, "_cancelsub"):
            self._cancelsub.cancel()

    # ------------------------------------------------------------ one tick
    async def tick(self):
        from . import bus

        await drain_resume_queue()  # continue any graph runs whose owner decided off-loop
        for cid in C.each():  # every company runs on its own: its pause switch, concurrency limit and schedule
            try:
                self.loop_housekeeping(cid)
                # several worker processes may run (server mode): only one hands out this company's work at a time
                with bus.lock("dispatch", ttl_s=30) as mine:
                    if mine:
                        self.schedule_shifts()
                        self.nudges()
                        self.weekly_digest()
                        self.dispatch_tasks()  # jobs started here keep this company (context is copied into the task)
                        self.dispatch_chats()
                        self.dispatch_workflows()
                self.knowledge()
            except Exception:
                log.exception("worker tick failed for %s", cid)
        self.running = {k: v for k, v in self.running.items() if not v.done()}
        self.chatting = {k: v for k, v in self.chatting.items() if not v.done()}
        self.flowing = {k: v for k, v in self.flowing.items() if not v.done()}

    def loop_housekeeping(self, cid: str):
        """Every few hours per company: make sure the retro loop exists, and measure retro changes (keep or roll back)."""
        from . import loops

        if time.monotonic() - self._daily.get(cid, -1e9) < 3 * 3600:
            return
        self._daily[cid] = time.monotonic()
        try:
            with session_scope() as db:
                loops.ensure_retro(db)
                loops.evaluate(db)
        except Exception:
            log.exception("loop housekeeping failed for %s", cid)

    def schedule_shifts(self):
        with session_scope() as db:
            if S.is_paused(db):
                return
            due = db.scalars(select(Shift).where(Shift.enabled.is_(True), Shift.next_at <= now()))
            for sh in due:
                st = db.get(Staff, sh.staff_id)
                from . import agenda

                skipped = agenda.is_skipped(db, sh, sh.next_at)  # the owner skipped this one run in the calendar
                sh.last_at = now()
                sh.next_at = S.next_run(sh.cron, db=db)
                if skipped:
                    S.audit(db, "system", "shift.skipped", sh.id)
                    continue
                if not st or st.status != "active":
                    continue
                busy = db.scalar(select(func.count()).select_from(Task).where(
                    Task.shift_id == sh.id, Task.status.in_(["queued", "running"])))
                if busy:
                    continue  # previous shift still in progress
                brief = sh.brief or sh.name
                if st.is_chief and ("brief" in (sh.name or "").lower() or "morning brief" in brief.lower()):
                    from . import nudge  # what is still waiting on the owner goes on top of the morning brief

                    brief += nudge.brief_section(db)
                db.add(Task(staff_id=st.id, origin="shift", brief=brief, created_by="schedule", shift_id=sh.id))
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
                if self.retry_at.get(t.id, 0) > time.monotonic():
                    continue  # waiting before another try
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

    def dispatch_workflows(self, limit: int = 8):
        """Start due workflow runs (schedules, events, webhooks, by hand) and go on with runs whose wait is over."""
        from . import workflows as W

        with session_scope() as db:
            if S.is_paused(db):
                return
            ready = [r.id for r in W.due_runs(db)]
        for rid in ready:
            if rid in self.flowing or len(self.flowing) >= limit:
                continue
            self.flowing[rid] = asyncio.create_task(self.run_workflow(rid))

    async def run_workflow(self, run_id: str):
        from . import bus
        from . import workflows as W
        from .models import WorkflowRun

        if not bus.claim(f"wfrun:{run_id}", ttl_s=1800):
            return  # another worker process has it
        try:
            with session_scope() as db:
                r = db.get(WorkflowRun, run_id)
                if r and r.status == "queued":
                    await W.execute(db, r)
        except Exception:
            log.exception("workflow run %s failed", run_id)
        finally:
            bus.release(f"wfrun:{run_id}")

    # ------------------------------------------------------------ knowledge base
    def knowledge(self):
        """Index what changed (jobs, chats, approved work, docs edited outside); the first time, the history too."""
        from . import kb

        with session_scope() as db:
            kb.backfill(db)
            kb.process_marks(db)
            kb.sync_docs(db)

    def _embed_company(self, cid: str, seconds: float = 20) -> int:
        from . import kb

        n, end = 0, time.monotonic() + seconds
        with C.use(cid):
            while time.monotonic() < end:
                with session_scope(cid) as db:
                    k = kb.embed_pending(db)
                if not k:
                    break
                n += k
        return n

    async def kb_loop(self):
        """Embeds new chunks in the background (a thread, so the API stays quick). Companies with new chunks are
        announced in Redis; every minute all of them are checked anyway."""
        from . import bus

        t_all = 0.0
        while not self._stop.is_set():
            try:
                due = set(bus.r().spop(bus.gkey("kb:pending"), 50) or [])
                if time.monotonic() - t_all > 60:
                    due |= set(C.ids())
                    t_all = time.monotonic()
                for cid in due:
                    with bus.lock("embed", ttl_s=60, cid=cid) as mine:
                        if mine:
                            n = await asyncio.to_thread(self._embed_company, cid)
                            if n:
                                bus.r().sadd(bus.gkey("kb:pending"), cid)  # more may be left: come back soon
            except Exception:  # noqa: BLE001 - never let embedding stop the worker
                log.exception("knowledge loop failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=2)
            except TimeoutError:
                pass

    # ------------------------------------------------------------ run one task
    def _task_context(self, task_id: str) -> tuple[TaskContext, dict, int]:
        with session_scope() as db:
            t = db.get(Task, task_id)
            st = db.get(Staff, t.staff_id)
            ck = S.latest_checkpoint(db, t.id)
            prop = None
            if t.proposal_id and (p := db.get(Proposal, t.proposal_id)):
                prop = {"id": p.id, "title": p.title, "type": p.type, "approved_text": S.current_body(p)}
            # Per-staff opt-in to the graph brain. A ``single_engine`` staff (the default)
            # keeps its engine config exactly as today — ``get_engine(st.engine)`` runs the
            # ordinary path and the graph is NEVER constructed. A ``graph`` staff's effective
            # engine becomes the GraphEngine wrapping its REAL engine under ``exec_engine``;
            # ``get_engine`` stays the single dispatch, and the graph's worker node delegates
            # to the real engine. The staff's SOUL (voice/autonomy) rides along so the graph's
            # node prompts reflect it without changing the TaskContext signature.
            engine_cfg = _effective_engine(st)
            ctx = TaskContext(
                staff_id=st.id, staff_name=st.name, job=st.job, is_chief=st.is_chief, task_id=t.id, origin=t.origin,
                brief=t.brief, founder_note=t.founder_note,
                checkpoint=ck and {"plan": ck.plan, "done": ck.done, "next": ck.next, "notes": ck.notes},
                proposal=prop, mcp_url=_mcp_url(), mcp_token=decrypt(st.mcp_token_enc), engine_config=engine_cfg,
                emit=Emitter(st.id, task_id=t.id), resources=resolve(db, proposal=prop, staff=st), memory=_memory(db, st, t),
            )
            return ctx, dict(engine_cfg), int(st.max_task_minutes or 30)

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
        if res.suspended:
            # A high-risk graph action interrupted for the owner's approval. The run is
            # PAUSED on its checkpoint, not finished: a Proposal is pending. Mark the task
            # "waiting" (durable, so services._graph_origin_task can detect it on decision)
            # and stop — no done/failed, no retry. The resume path finishes it later.
            ctx.emit("status", state="waiting")
        else:
            ctx.emit("status", state="failed" if res.error else "done", error=res.error)
        self.finish(task_id, res)

    def finish(self, task_id: str, res: EngineResult):
        retry: dict = {}
        self._finish(task_id, res, retry)
        if retry:  # after the database session closed (the event is written with its own)
            Emitter(retry["staff_id"], task_id=task_id)("status", state="retrying", error=retry["error"], wait_s=retry["wait_s"])

    def _finish(self, task_id: str, res: EngineResult, retry: dict):
        with session_scope() as db:
            t = db.get(Task, task_id)
            if t is None or t.status == "cancelled":
                return
            t.cost_usd += res.cost_usd
            t.tokens += res.tokens
            if res.suspended:
                # The graph interrupted for approval: park the task in a durable "waiting"
                # state and stop. It is in-flight-but-paused — NOT done, NOT failed, NOT
                # retried, and (because waiting is not "queued") never re-dispatched. The
                # owner's decision resumes the run and writes the terminal status.
                t.status = "waiting"
                S.audit(db, "system", "task.waiting", t.id)
                db.commit()
                return
            report = db.scalar(select(Report).where(Report.task_id == t.id))
            from . import loops

            if res.error and report is None and t.origin != "execution" and t.attempts < 3 and loops.transient(res.error):
                delay = 30 * 2 ** (t.attempts - 1)  # 30 s, then 60 s
                t.status, t.error = "queued", f"try {t.attempts} failed ({res.error[:200]}); trying again in {delay} s"
                self.retry_at[t.id] = time.monotonic() + delay
                retry.update(staff_id=t.staff_id, error=res.error[:300], wait_s=delay)
                return
            self.retry_at.pop(t.id, None)
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
            S.post_message(db, th, "system", "omilo", summary)
            try:  # the run log of a regular job, which its next run reads
                from . import memory

                memory.log_run(db, t)
            except Exception:
                log.exception("run log failed")

    # ------------------------------------------------------------ chats
    async def answer_thread(self, thread_id: str):
        """Answer the owner's last message: the helper of a one-to-one chat, or everyone it named (@Marketing), one by
        one, in order; a helper that names a teammate in its reply hands over to them (see teamchat.py)."""
        from . import teamchat as TC
        from .models import Message

        answered: list[str] = []
        turn = None  # the owner message being answered; a new one while answering starts the round again
        stop_note_posted = False  # guard: post "Stopped by the owner." at most once per turn

        def _post_stop_note():
            nonlocal stop_note_posted
            if stop_note_posted:
                return
            stop_note_posted = True
            try:
                with session_scope() as db:
                    th = db.get(Thread, thread_id)
                    if th:
                        th.awaiting_reply = False
                        th.pending = None
                        S.post_message(db, th, "system", "omilo", "Stopped by the owner.")
            except Exception:
                log.exception("answer_thread: failed to post stop note for thread %s", thread_id)

        try:
            while True:
                with session_scope() as db:
                    th = db.get(Thread, thread_id)
                    if not th or not th.awaiting_reply:
                        return
                    last = db.scalar(select(Message.id).where(Message.thread_id == th.id, Message.role == "owner").order_by(Message.at.desc()).limit(1))
                    if last != turn:
                        turn, answered = last, []
                    queue = [s for s in TC.responders(th) if s not in answered]
                    if not queue or len(answered) >= TC.MAX_REPLIES:
                        th.pending, th.awaiting_reply = None, False
                        return
                    sid = queue[0]
                text = await self._answer_as(thread_id, sid, answered)
                answered.append(sid)
                # Cross-process cancel check: re-read the thread from DB to detect a cancel that
                # landed in a different worker process (which set awaiting_reply=False via the route
                # but couldn't cancel *our* asyncio.Task via pubsub). Belt-and-suspenders alongside
                # the in-process pubsub fast path in cancel_loop.
                with session_scope() as db:
                    th_check = db.get(Thread, thread_id)
                    if not th_check or not th_check.awaiting_reply:
                        # Cancel landed (possibly cross-process); end cleanly.
                        _post_stop_note()
                        return
                with session_scope() as db:
                    th = db.get(Thread, thread_id)
                    if not th:
                        return
                    rest = [s for s in (th.pending or []) if s not in answered]
                    rest += [s for s in TC.handover(db, th, sid, text or "", answered) if s not in rest]
                    if rest and len(answered) < TC.MAX_REPLIES:
                        th.pending = rest
                    else:
                        th.pending, th.awaiting_reply = None, False
                        return
        except asyncio.CancelledError:
            log.info("answer_thread: turn cancelled for thread %s (stop requested by owner)", thread_id)
            _post_stop_note()
            # Do not re-raise — the task ends cleanly (not as a failure)

    async def _answer_as(self, thread_id: str, staff_id: str, answered: list[str]) -> str:
        """One helper's reply in the thread. Returns what it wrote ("" when it could not answer)."""
        from . import teamchat as TC

        with session_scope() as db:
            th = db.get(Thread, thread_id)
            st = db.get(Staff, staff_id)
            if not st or st.status == "retired":
                return ""
            if st.status != "active":
                S.post_message(db, th, "system", st.id, f"{st.name} is paused (Team → {st.name} to resume or raise its budget).")
                return ""
            msgs = S.thread_messages(db, th, limit=40)
            shared = TC.shared(th, st.id)
            if shared:
                history = TC.history(db, th, st, msgs)
            else:  # empty messages (an engine that answered nothing) would make the AI reject the whole history
                history = [{"role": "owner" if m.role == "owner" else "agent", "text": m.text} for m in msgs if m.role in ("owner", "agent") and (m.text or "").strip()]
            open_items = db.scalar(select(func.count()).select_from(S.InboxItem).where(S.InboxItem.status == "open"))
            note = f"Inbox: {open_items} open item(s)."
            if th.scope == "task" and (t := db.get(Task, th.ref_id)):
                rep = db.scalar(select(Report).where(Report.task_id == t.id))
                note += f"\nThis thread is about task {t.id} ({t.status}): {t.brief}\nReport: {rep.headline if rep else '-'}"
            if th.scope == "proposal" and (p := db.get(Proposal, th.ref_id)):
                note += f"\nThis thread is about proposal {p.id} ({p.status}): {p.title}\nCurrent text:\n{S.current_body(p)}"
            if room := TC.note(db, th, st, answered):
                note += "\n" + room
            note += _memory(db, st, None)
            ctx = ChatContext(staff_id=st.id, staff_name=st.name, job=st.job, is_chief=st.is_chief, thread_id=th.id,
                              scope=th.scope, history=history, context_note=note, mcp_url=_mcp_url(),
                              mcp_token=decrypt(st.mcp_token_enc), engine_config=st.engine or {},
                              emit=Emitter(st.id, thread_id=th.id), resources=resolve(db, thread_id=th.id, staff=st), shared=shared)
        t0 = time.monotonic()
        ctx.emit("status", state="started", engine=_engine_label(ctx.engine_config))
        try:
            res = await asyncio.wait_for(get_engine(ctx.engine_config).chat(ctx), timeout=600)
        except asyncio.CancelledError:
            # The owner stopped the turn. Close out the run with a terminal status so the UI's
            # "Working" card finalizes to "Stopped" — without this, no done/failed event ever
            # arrives and the spinner runs forever. Re-raise so answer_thread posts the stop note
            # and the cancellation keeps propagating.
            ctx.emit("status", state="failed", error="stopped by the owner")
            raise
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
            S.post_message(db, th, "agent" if not res.error else "system", staff_id, text)
        return "" if res.error else res.text


def _effective_engine(st: Staff) -> dict:
    """The engine config the worker actually runs for this staff.

    ``single_engine`` (default): the staff's own engine config, UNCHANGED — the
    old dispatch path, byte-for-byte. No graph code is reached.

    ``graph``: the GraphEngine wrapper ``{"type":"graph","exec_engine": dict(st.engine or {})}``.
    ``exec_engine`` is the staff's real engine (what the graph's worker node delegates to),
    and the staff's SOUL (``voice``/``autonomy``) rides on the wrapper so the graph's node
    prompts reflect the staff without widening the TaskContext signature.
    """
    if st.brain == "graph":
        return {
            "type": "graph",
            "exec_engine": dict(st.engine or {}),
            "voice": st.voice or "",
            "autonomy": st.autonomy or "standard",
        }
    return st.engine or {}


def _memory(db, st, t) -> str:
    try:
        from . import memory

        return memory.brief_for(db, st, t)
    except Exception:  # noqa: BLE001 - a broken note must not stop the work
        log.exception("memory brief failed")
        return ""


# ------------------------------------------------------------ resume a suspended graph
#
# A high-risk graph run suspends on an ``interrupt`` (Task 4). When the owner decides the
# escalated proposal, ``services.decide_proposal`` calls ``request_resume`` to continue
# the checkpointed run OFF the request path — the HTTP handler must not block on the graph.
#
# ``resume_graph_run`` is the awaitable hook: it opens a FRESH AsyncPostgresSaver keyed by
# ``thread_id = task_id`` (never a cached, event-loop-bound saver), re-invokes the graph
# with the owner's decision, and marks the task done. It is deliberately module-level and
# awaitable so a test can drive it deterministically instead of sleeping on a background
# task. ``request_resume`` is the non-blocking dispatcher: it schedules ``resume_graph_run``
# as a detached asyncio task when a loop is running, preserving the caller's company context.

# Resume requests enqueued when no event loop is running (e.g. a sync test, or a decision
# made outside the async server). The worker loop drains these on its next tick. Each item
# is ``(task_id, decision, note, company_id)``.
_resume_queue: list[tuple[str, str, str, str]] = []

# Dedup guard: a decision both schedules a detached resume (request_resume) AND may be
# awaited directly (a test, or drain_resume_queue). Both must not resume the same checkpoint
# concurrently — two resumes race on the same thread_id. We admit exactly one resume per
# task_id at a time by claiming the id here; a second concurrent call returns immediately.
_resuming: set[str] = set()


async def resume_graph_run(task_id: str, decision: str, note: str, cid: str | None = None):
    """Continue a suspended graph run from its checkpoint and finish the task.

    Opens a fresh checkpointer (cross-process/loop safe), re-invokes the compiled graph
    with ``Command(resume={"decision","note"})`` under ``thread_id = task_id``, then writes
    the task's terminal status (the resume path does not go back through ``run_task``'s finish,
    so it must move the task out of ``waiting`` itself). No execution task is ever spawned for
    a graph-origin decision — the graph owns completion. Returns the ``EngineResult``.

    Idempotent per ``task_id``: if a resume for this id is already in flight, or the task has
    already left ``waiting`` (another resume finished it), this is a no-op that returns an
    empty result — so a detached resume and a directly-awaited one never double-resume."""
    from .graph.engine import GraphEngine

    if task_id in _resuming:
        return EngineResult()
    _resuming.add(task_id)
    try:
        with C.use(cid or C.current()):
            # Only a task still parked in "waiting" is resumable; if it already reached a
            # terminal state (a prior resume won the race) do nothing.
            with session_scope() as db:
                t = db.get(Task, task_id)
                if t is None or t.status != "waiting":
                    return EngineResult()
            res = await GraphEngine().resume(task_id, decision, note)
            with session_scope() as db:
                t = db.get(Task, task_id)
                if t is not None and t.status == "waiting":
                    status = "failed" if res.error else "done"
                    t.cost_usd += res.cost_usd
                    t.tokens += res.tokens
                    S.finish_task(db, t, status, error=res.error, result_text=res.text)
        return res
    finally:
        _resuming.discard(task_id)


def request_resume(task_id: str, decision: str, note: str) -> None:
    """Signal a resume without blocking the caller (an HTTP request handler).

    When an event loop is running, schedule the resume as a detached task so the decision
    returns immediately. Otherwise enqueue it for the worker loop (or a test) to drain.
    The current company context is captured so the detached run resolves the right schema."""
    cid = C.current()
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop is not None:
        loop.create_task(resume_graph_run(task_id, decision, note, cid))
    else:
        _resume_queue.append((task_id, decision, note, cid))


async def drain_resume_queue() -> int:
    """Run any resume requests enqueued while no loop was available. Returns the count."""
    n = 0
    while _resume_queue:
        task_id, decision, note, cid = _resume_queue.pop(0)
        try:
            await resume_graph_run(task_id, decision, note, cid)
            n += 1
        except Exception:  # noqa: BLE001 - one bad resume must not stall the rest
            log.exception("resume of graph task %s failed", task_id)
    return n


def _engine_label(cfg: dict) -> str:
    t = (cfg or {}).get("type", "fake")
    if t == "claude-code":
        auth = cfg.get("auth")
        base = "Claude Code · your API key" if auth == "api" else "Claude Code pool" + (" + API overflow" if auth == "auto" else "")
        return base + (f" · {cfg['model']}" if cfg.get("model") else "")
    if t == "claude":
        return f"Claude · {cfg.get('model') or ''}".strip(" ·")
    return "Practice mode"


def main():  # `omilo-worker`: the worker as its own process (server mode)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    init_db()
    asyncio.run(Worker().run_forever())


if __name__ == "__main__":
    main()
