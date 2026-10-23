"use client";
import { kick, usePoll } from "@/lib/poll";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Meter, RunCard, RunEvent, browserTrail, toRuns, useEvents } from "@/components/Run";
import Avatar from "@/components/Avatar";
import BrowserView from "@/components/BrowserView";
import Lineage from "@/components/Lineage";
import { FullThread, Msg } from "@/components/Conversation";
import { Reply } from "@/components/chat/Reply";
import { taskItems } from "@/lib/actions";
import { menu } from "@/lib/menu";
import { Err, StatusChip } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { Staff, Task, Thread, ago, api, when } from "@/lib/api";
import { confirmDialog } from "@/lib/dialog";
import Desk from "@/components/workspace/Desk";
import TeamBoard from "@/components/workspace/TeamBoard";
import ChannelsRail from "@/components/workspace/ChannelsRail";
import { boardHref, saveWsGroup, wsGroup } from "@/lib/ws";
import { RailThread } from "@/components/workspace/ThreadsRail";
import FocusThread from "@/components/workspace/FocusThread";
import FocusDetails from "@/components/workspace/FocusDetails";

/* The workspace: chat and work on one page (toggle top right), with a side panel for progress, output and the browser. */


function useLocal(key: string, init: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(init);
  useEffect(() => {
    // on phones and small windows the panel covers the chat, so it starts closed there
    if (window.innerWidth <= 1100) { setV(false); return; }
    try { const s = localStorage.getItem(key); if (s !== null) setV(s === "1"); } catch { /* private mode */ }
  }, [key]);
  return [v, (x: boolean) => { setV(x); try { localStorage.setItem(key, x ? "1" : "0"); } catch { /* ignore */ } }];
}

/* ------------------------------------------------------------------ side panel */
function Panel({ events, output, onClose }: { events: RunEvent[]; output: React.ReactNode; onClose: () => void }) {
  const [tab, setTab] = useState<"progress" | "output" | "browser">("progress");
  const runs = toRuns(events);
  const trail = browserTrail(events);
  const last = runs[runs.length - 1];
  const usage = [...events].reverse().find((e) => e.kind === "usage")?.data;
  const failedCount = runs.filter((r) => r.state === "failed").length;
  useEffect(() => { if (trail.length && tab === "progress" && last?.state === "running") setTab("browser"); /* follow the agent */ },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trail.length]);
  return (
    <aside className="ws-panel-v2">
      {/* Tabs row */}
      <div className="ptabs">
        <div className="seg">
          <button className={tab === "progress" ? "on" : ""} onClick={() => setTab("progress")}><i className="ri-pulse-line" /> Progress</button>
          <button className={tab === "output" ? "on" : ""} onClick={() => setTab("output")}><i className="ri-file-text-line" /> Output</button>
          <button className={tab === "browser" ? "on" : ""} onClick={() => setTab("browser")}><i className="ri-global-line" /> Browser{trail.length ? ` · ${trail.length}` : ""}</button>
        </div>
        <span className="sp" />
        {/* hidden on wide screens (the top bar has the toggle); on phones the panel covers the chat, so it needs its own close */}
        <button className="iconbtn ws-panel-close" aria-label="Close panel" onClick={onClose}><i className="ri-close-line" /></button>
      </div>

      {/* Progress tab content */}
      {tab === "progress" && (
        <>
          {runs.length > 0 && <div className="panel-section-head">Last run</div>}
          <div className="panel-runs">
            {runs.length ? (
              runs.slice().reverse().map((r) => <RunCard key={r.id} run={r} compact />)
            ) : (
              <div className="empty"><b>Nothing running</b><span>Steps appear here while a helper works.</span></div>
            )}
          </div>
          {failedCount >= 3 && (
            <div className="panel-hint">
              <i className="ri-information-line" />
              <span>The {failedCount} failed runs are folded into one card in the chat. Open it for the full error detail.</span>
            </div>
          )}
        </>
      )}

      {/* Output tab content */}
      {tab === "output" && (
        <div className="panel-runs">
          {output || <div className="empty"><b>No output yet</b><span>Reports and drafts show up here.</span></div>}
        </div>
      )}

      {/* Browser tab content */}
      {tab === "browser" && (
        <div className="panel-runs">
          <BrowserView trail={trail} />
        </div>
      )}

      {usage && <Meter u={usage} />}
    </aside>
  );
}

/* ------------------------------------------------------------------ chat */
/* Clickable options a helper offered (offer_choices). Open until the owner answers; the answer stays highlighted. */
/* ------------------------------------------------------------------ work */
function TaskView({ id, staff }: { id: string; staff: Staff[] }) {
  const router = useRouter();
  const [t, setT] = useState<Task | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const events = useEvents({ task_id: id });
  const [th, setTh] = useState<FullThread | null>(null);
  // a helper asked a question with options during this job: show it here so the owner can answer without leaving
  const asked = events.some((e) => e.kind === "tool" && /offer_choices|share_file/.test(String(e.data?.name || "")));
  const load = useCallback(async () => {
    try { setT(await api<Task>(`/tasks/${id}`)); } catch (e: any) { setErr(e.message); }
    if (asked) { try { setTh(await api<FullThread>("/threads", { body: { scope: "task", ref_id: id } })); } catch { /* ignore */ } }
  }, [id, asked]);
  usePoll(load, () => (t && ["queued", "running"].includes(t.status) ? 2500 : 15000), [load], (n) => n?.url?.includes(id));
  const answer = async (o: string) => {
    if (!th) return;
    try { setTh(await api<FullThread>(`/threads/${th.id}/messages`, { body: { text: o } })); kick(id); } catch (e: any) { setErr(e.message); }
  };
  if (!t) return <div className="ws-inner"><Err error={err} /></div>;
  const runs = toRuns(events);
  const who = staff.find((s) => s.id === t.staff_id)?.name || t.staff_id;
  const discuss = async () => { const th = await api<{ id: string }>("/threads", { body: { scope: "task", ref_id: id } }); router.push(`/chat/?thread=${th.id}`); };
  return (
    <div className="ws-inner">
      <Lineage l={(t as any).lineage} self={t.id} />
      <div className="small">{who} · {t.origin} · {when(t.created_at)}</div>
      <h1 style={{ margin: "4px 0 10px" }}>{t.report?.headline || t.brief.slice(0, 120)}</h1>
      <div className="acts" style={{ marginBottom: 16 }}>
        <StatusChip status={t.status} />
        {["queued", "running"].includes(t.status) && <button className="btn sm danger" onClick={async () => { await api(`/tasks/${id}/cancel`, { body: {} }); load(); }}>Stop</button>}
        <button className="btn sm" onClick={discuss}><i className="ri-chat-3-line" />Discuss</button>
      </div>
      <div className="conv">
        <div className="bubble" style={{ alignSelf: "stretch", maxWidth: "none", borderRadius: "var(--r-lg)" }}>
          <div className="small" style={{ marginBottom: 4 }}>The job</div>
          <Markdown text={t.brief + (t.founder_note ? `\n\n**Your note:** ${t.founder_note}` : "")} />
        </div>
        {runs.map((r) => <RunCard key={r.id} run={r} />)}
        {th && (th.messages as Msg[]).filter((m) => m.role === "agent" && m.blocks?.some((b) => b.type === "choices" || b.type === "file" || b.type === "access_request")).map((m) => (
          <Reply
            key={m.id}
            m={m}
            th={th}
            staff={staff}
            messages={th.messages as Msg[]}
            busy={th.awaiting_reply}
            onPick={answer}
            onDecide={async (rid, scope, note) => { try { await api(`/access/${rid}/decide`, { body: { scope, note } }); load(); } catch (e: any) { setErr(e.message); } }}
          />
        ))}
        {runs.length === 0 && t.status === "queued" && <div className="sysmsg">Waiting for a free spot…</div>}
        {t.report && (
          <div className="agentmsg"><Avatar who={staff.find((x) => x.id === t.staff_id)} size={30} /><div className="body"><div className="who">{who} · report</div><Markdown text={t.report.body_md} /></div></div>
        )}
        {t.error && <div className="callout warn"><b>Error</b> {t.error}</div>}
        {!!t.proposals?.length && <div className="soft"><div className="small">Waiting on you</div>
          {t.proposals.map((p) => <div key={p.id} className="acts" style={{ margin: "6px 0" }}><StatusChip status={p.status} /><Link href="/">{p.title}</Link></div>)}</div>}
        {!!t.children?.length && <div className="soft"><div className="small">Handed off</div>
          {t.children.map((c) => <div key={c.id} className="acts" style={{ margin: "6px 0" }}><StatusChip status={c.status} /><Link href={`/chat/?view=work&task=${c.id}`}>{c.staff_id}: {c.brief.slice(0, 70)}</Link></div>)}</div>}
      </div>
    </div>
  );
}

function NewTask({ staff, onDone, who }: { staff: Staff[]; onDone: (id: string) => void; who?: string }) {
  const [form, setForm] = useState({ staff_id: who || "", brief: "" });
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    try { const t = await api<Task>("/tasks", { body: form }); onDone(t.id); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div className="ws-inner">
      <h1>New job</h1>
      <p className="sub">Give a helper something to do. You can watch every step on the right.</p>
      <label>Who</label>
      <select value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: e.target.value })}>
        <option value="">Choose a helper</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <label>What should they do?</label>
      <textarea rows={5} value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} placeholder="e.g. Find 10 offices in South Jakarta that order catering and draft a short intro message" />
      <div className="acts" style={{ marginTop: 10 }}><button className="btn primary" disabled={!form.staff_id || !form.brief.trim()} onClick={create}>Start</button></div>
      <Err error={err} />
    </div>
  );
}

/* ------------------------------------------------------------------ page */
function WorkspaceInner() {
  const params = useSearchParams();
  const router = useRouter();
  const rawView = params.get("view");
  const view = rawView === "work" ? "work" : rawView === "board" ? "board" : "chat";
  const tid = params.get("thread");
  const taskId = params.get("task");

  /* ---- Board view: team board at /chat/?view=board ---- */
  const isBoard = view === "board";
  const boardGroup = params.get("group") === "goal" ? "goal" : "helper";

  /* ---- Desk: default /chat view with no thread/task/view params ---- */
  const isDesk = view === "chat" && !tid && !taskId;
  /* ---- Focus session: chat view with a thread id ---- */
  const isFocus = view === "chat" && !!tid;
  /* ---- Chat mode: same sessions grouped by channel/staff (a left channels rail) ---- */
  const isChat = params.get("mode") === "chat";

  const [panel, setPanel] = useLocal("omilo.panel", true);
  const [listOpen, setListOpen] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [current, setCurrent] = useState<FullThread | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    try {
      const [th, tk, st] = await Promise.all([api<Thread[]>("/threads"), api<Task[]>("/tasks?limit=60"), api<Staff[]>("/staff")]);
      setThreads(th); setTasks(tk); setStaff(st);
    } catch (e: any) { setErr(e.message); }
  }, []);
  usePoll(loadLists, 20000, [loadLists], (n) => n?.kind === "reply" || n?.kind?.startsWith("job"));

  const go = useCallback((q: Record<string, string>) => { router.push(`/chat/?${new URLSearchParams(q)}`); setListOpen(false); }, [router]);
  const openThread = useCallback(async (body: Record<string, string>) => {
    try { const th = await api<Thread>("/threads", { body }); go({ thread: th.id }); } catch (e: any) { setErr(e.message); }
  }, [go]);
  /* Open a session but stay in Chat mode (keep the channels rail). */
  const openThreadChat = useCallback(async (body: Record<string, string>) => {
    try { const th = await api<Thread>("/threads", { body }); go({ mode: "chat", thread: th.id }); } catch (e: any) { setErr(e.message); }
  }, [go]);
  // ChatThread only reports its thread while mounted (chat view with a thread); clear it otherwise so the topbar/panel don't show stale info
  useEffect(() => { if (view !== "chat" || !tid) setCurrent(null); }, [view, tid]);
  // Remember the board grouping (By-helper / By-goal) so it sticks across navigation…
  useEffect(() => {
    const g = params.get("group");
    if (isBoard && (g === "helper" || g === "goal")) saveWsGroup(g);
  }, [isBoard, params]);
  // …and restore it when a board URL arrives without one (e.g. a plain "Board" link).
  useEffect(() => {
    if (isBoard && !params.get("group") && wsGroup() === "goal") router.replace("/chat/?view=board&group=goal");
  }, [isBoard, params, router]);

  const threadEvents = useEvents(view === "chat" && tid ? { thread_id: tid } : null);
  const taskEvents = useEvents(view === "work" && taskId && taskId !== "new" ? { task_id: taskId } : null);

  const startJob = async (brief: string) => {
    const who = staff.find((x) => x.is_chief) || staff[0];
    if (!who || !brief.trim()) return;
    try {
      const t = await api<Task>("/tasks", { body: { staff_id: who.id, brief: brief.trim() } });
      go({ view: "work", task: t.id });
    } catch (e: any) { setErr(e.message); }
  };

  const name = (id: string) => staff.find((s) => s.id === id)?.name || id;
  const selTask = tasks.find((t) => t.id === taskId);

  /* Board: full-page team board (by helper / by goal) */
  if (isBoard) return <TeamBoard group={boardGroup} />;

  /* Chat mode: left channels/staff rail + the selected session (same sessions as Work mode) */
  if (isChat) {
    const railThreads = threads as RailThread[];
    const chatSeed: FullThread | null = current?.id === tid ? current : null;
    return (
      <div className="chat-mode">
        <ChannelsRail
          threads={threads}
          staff={staff}
          activeThreadId={tid}
          onOpen={openThreadChat}
          onSwitchMode={() => go({ view: "board" })}
        />
        {tid ? (
          <>
            <FocusThread
              threadId={tid}
              seed={chatSeed}
              staff={staff}
              events={threadEvents}
              threads={railThreads}
              onThread={setCurrent}
              onStartJob={startJob}
              onOpenThread={openThread}
              backHref="/chat/?mode=chat"
            />
            <FocusDetails threadId={tid} />
          </>
        ) : (
          <div className="chat-mode-welcome">
            <div className="chat-mode-welcome-inner">
              <i className="ri-chat-3-line" />
              <b>Pick a channel or a teammate</b>
              <span>Every chat is a session. Channels hold goals; staff are one-on-one.</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* Desk: full-page three-column layout (threads rail + desk center + team now) */
  if (isDesk) return <Desk />;

  /* ---- Focus session: two-column layout (thread + details rail), matching the
     pen.dev design. Navigation (back / "needs you N of M" / next-prev) lives in the
     thread's own top bar, so there is no separate left threads rail here. ---- */
  if (isFocus) {
    /* Cast threads to RailThread — the /threads endpoint may carry group/subtitle/last_at */
    const railThreads = threads as RailThread[];

    // Use the parent's `current` ONLY when it already carries this thread (and therefore its
    // messages array). The /threads LIST entries do NOT carry messages, so seeding from them
    // would produce a messages-less FullThread that crashes render guards. For unknown/first-open
    // threads we fall back to null — the poll fires immediately and fills messages within one
    // round-trip, with no crash and no stale-switch.
    const focusSeed: FullThread | null =
      current?.id === tid ? current : null;

    return (
      <div className="ws-focus">
        <FocusThread
          threadId={tid}
          seed={focusSeed}
          staff={staff}
          events={threadEvents}
          threads={railThreads}
          onThread={setCurrent}
          onStartJob={startJob}
          onOpenThread={openThread}
          backHref={boardHref()}
        />
        <FocusDetails threadId={tid} />
      </div>
    );
  }

  /* ---- Work view: old .ws shell with task list + TaskView/NewTask ---- */
  const title = taskId === "new" ? "New job" : selTask?.brief.slice(0, 60) || "Work";

  const output = selTask?.report
    ? <div><div className="small" style={{ marginBottom: 6 }}>Report</div><div className="paper md"><Markdown text={selTask.report.body_md} /></div></div>
    : null;

  return (
    <div className="ws">
      <div className="topbar">
        <button className="iconbtn hide-lg" aria-label="Show list" onClick={() => setListOpen(!listOpen)}><i className="ri-menu-2-line" /></button>
        <span className="crumb"><i className="ri-list-check-3" />Workspace<span className="small" style={{ fontWeight: 400 }}>· {title}</span></span>
        <span className="sp" />
        <button className="btn sm" onClick={() => go({})}><i className="ri-arrow-left-line" />Desk</button>
        <button className="iconbtn" aria-label={panel ? "Hide side panel" : "Show side panel"} title="Progress, output and browser" onClick={() => setPanel(!panel)}>
          <i className={panel ? "ri-side-bar-fill" : "ri-side-bar-line"} />
        </button>
      </div>
      <div className={`ws-body${panel ? " panel" : ""}`}>
        <nav className={`ws-list${listOpen ? " open" : ""}`}>
          <button className="btn primary" style={{ margin: "2px 2px 8px" }} onClick={() => go({ view: "work", task: "new" })}><i className="ri-add-line" />New job</button>
          {tasks.length === 0 && <p className="small" style={{ padding: 10 }}>No jobs yet.</p>}
          {tasks.map((t) => (
            <button key={t.id} className={`ws-item ${taskId === t.id ? "on" : ""}`} onClick={() => go({ view: "work", task: t.id })}
              onContextMenu={menu(() => taskItems(t, name(t.staff_id), loadLists, () => go({ view: "work", task: t.id })))}>
              <span className={`sdot ${t.status}`} /><span className="t"><Lineage l={(t as any).lineage} plain /><b>{t.report?.headline || t.brief}</b><span>{name(t.staff_id)} · {ago(t.created_at)}</span></span></button>
          ))}
        </nav>
        <section className="ws-main">
          <div className="ws-scroll">
            {taskId === "new" ? <NewTask key={params.get("staff") || ""} who={params.get("staff") || ""} staff={staff} onDone={(id) => go({ view: "work", task: id })} />
              : taskId ? <TaskView id={taskId} staff={staff} />
              : <div className="ws-inner"><div className="empty"><b>Pick a job on the left</b><span>Or start a new one. Every step shows up live.</span>
                  <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => go({ view: "work", task: "new" })}>New job</button></div></div></div>}
          </div>
        </section>
        {panel && <Panel events={taskEvents} output={output} onClose={() => setPanel(false)} />}
      </div>
    </div>
  );
}

export default function Workspace() {
  return <Suspense><WorkspaceInner /></Suspense>;
}
