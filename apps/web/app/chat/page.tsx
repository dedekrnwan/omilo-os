"use client";
import { kick, usePoll } from "@/lib/poll";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Meter, Run, RunCard, RunEvent, browserTrail, toRuns, useEvents } from "@/components/Run";
import ComposerTools, { Attached } from "@/components/ComposerTools";
import PoolMeter from "@/components/PoolMeter";
import { Err, StatusChip } from "@/components/ui";
import { Attachments, Markdown } from "@/components/Markdown";
import { BASE, Staff, Task, Thread, ago, api, when } from "@/lib/api";

/* The workspace: chat and work on one page (toggle top right), with a side panel for progress, output and the browser. */

type Msg = { id: string; role: string; author: string; text: string; at: string; blocks?: { type: string; options?: string[]; id?: string; name?: string; mime?: string }[] };
type FullThread = Thread & { messages: Msg[] };

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
  useEffect(() => { if (trail.length && tab === "progress" && last?.state === "running") setTab("browser"); /* follow the agent */ },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trail.length]);
  return (
    <aside className="ws-panel">
      <div className="ptabs">
        <div className="seg">
          <button className={tab === "progress" ? "on" : ""} onClick={() => setTab("progress")}><i className="ri-pulse-line" /> Progress</button>
          <button className={tab === "output" ? "on" : ""} onClick={() => setTab("output")}><i className="ri-file-text-line" /> Output</button>
          <button className={tab === "browser" ? "on" : ""} onClick={() => setTab("browser")}><i className="ri-global-line" /> Browser{trail.length ? ` · ${trail.length}` : ""}</button>
        </div>
        <span className="sp" />
        <button className="iconbtn" aria-label="Close panel" onClick={onClose}><i className="ri-side-bar-fill" /></button>
      </div>
      <div className="pbody">
        {tab === "progress" && (runs.length ? (
          <div className="conv" style={{ gap: 10 }}>
            {runs.slice().reverse().map((r) => <RunCard key={r.id} run={r} compact />)}
          </div>
        ) : <div className="empty"><b>Nothing running</b><span>Steps appear here while a helper works.</span></div>)}
        {tab === "output" && (output || <div className="empty"><b>No output yet</b><span>Reports and drafts show up here.</span></div>)}
        {tab === "browser" && (
          <div>
            <div className="browser">
              <div className="bar"><span className="dots"><i /><i /><i /></span><span className="url">{trail[0]?.url || "about:blank"}</span>
                {trail[0] && <a className="iconbtn" href={trail[0].url} target="_blank" rel="noopener noreferrer" aria-label="Open"><i className="ri-external-link-line" /></a>}</div>
              <div className="view">
                {trail[0]?.image ? <img src={trail[0].image} alt={trail[0].title || trail[0].url} /> : trail[0]
                  ? <div><i className="ri-global-line" style={{ fontSize: 28 }} /><div style={{ marginTop: 8, fontWeight: 500, color: "var(--ink)" }}>{trail[0].title || trail[0].url}</div>
                      <div className="small">The helper opened this page. Screenshots appear here when its browser takes them.</div></div>
                  : <div><i className="ri-window-line" style={{ fontSize: 28 }} /><div style={{ marginTop: 8 }}>No pages opened yet</div></div>}
              </div>
            </div>
            {trail.length > 1 && <div className="sec" style={{ marginTop: 16 }}><div className="small" style={{ marginBottom: 6 }}>Earlier</div>
              {trail.slice(1, 20).map((p, i) => <a key={i} className="ws-item" href={p.url} target="_blank" rel="noopener noreferrer"><i className="ri-history-line" /><span className="t"><b>{p.title || p.url}</b><span>{p.url}</span></span></a>)}</div>}
          </div>
        )}
      </div>
      {usage && <Meter u={usage} />}
    </aside>
  );
}

/* ------------------------------------------------------------------ chat */
/* Clickable options a helper offered (offer_choices). Open until the owner answers; the answer stays highlighted. */
function Choices({ m, messages, busy, onPick }: { m: Msg; messages: Msg[]; busy: boolean; onPick: (o: string) => void }) {
  const [sent, setSent] = useState<string | null>(null);
  const idx = messages.findIndex((x) => x.id === m.id);
  const answer = messages.slice(idx + 1).find((x) => x.role === "owner");
  const chosen = sent || answer?.text || null;
  const open = !answer && !sent;
  return (
    <>
      {m.blocks?.filter((b) => b.type === "choices").map((b, i) => (
        <div key={i} className="choices">{(b.options || []).map((o) => (
          <button key={o} type="button" className={`pick ${chosen === o ? "on" : ""}`} disabled={!open || busy}
            title={open && busy ? "Wait until the helper finishes this turn" : undefined}
            onClick={() => { setSent(o); onPick(o); }}>{o}</button>
        ))}</div>
      ))}
      {open && busy && m.blocks?.some((b) => b.type === "choices") && <div className="small" style={{ marginTop: 4 }}>You can pick as soon as the helper finishes this turn.</div>}
    </>
  );
}

function Conversation({ th, staff, events, onSend, busy }: { th: FullThread; staff: Staff[]; events: RunEvent[]; onSend: (t: string) => void; busy: boolean }) {
  const runs = toRuns(events);
  const name = (id: string) => staff.find((s) => s.id === id)?.name || id;
  // place each run before the first agent/system message that came after it started
  type Row = { kind: "msg"; m: Msg } | { kind: "run"; r: Run };
  const rows: Row[] = [];
  let ri = 0;
  for (const m of th.messages) {
    while (ri < runs.length && runs[ri].start <= m.at && m.role !== "owner") { rows.push({ kind: "run", r: runs[ri++] }); }
    rows.push({ kind: "msg", m });
  }
  while (ri < runs.length) rows.push({ kind: "run", r: runs[ri++] });
  return (
    <div className="conv">
      {th.messages.length === 0 && runs.length === 0 && (
        <div className="sysmsg">Ask anything: what needs you, what someone did, or tell a helper what to do.</div>
      )}
      {rows.map((row) => row.kind === "run" ? <RunCard key={`r${row.r.id}`} run={row.r} /> : (
        row.m.role === "owner" ? <div key={row.m.id} className="bubble"><Markdown text={row.m.text} /><Attachments blocks={row.m.blocks} /></div>
          : row.m.role === "system" ? <div key={row.m.id} className="sysmsg"><Markdown text={row.m.text} /></div>
          : (
            <div key={row.m.id} className="agentmsg">
              <span className="av">{name(row.m.author).slice(0, 1).toUpperCase()}</span>
              <div className="body">
                <div className="who">{name(row.m.author)} · {when(row.m.at)}</div>
                <Markdown text={row.m.text} />
                <Attachments blocks={row.m.blocks} />
                <Choices m={row.m} messages={th.messages} busy={busy} onPick={onSend} />
              </div>
            </div>
          )
      ))}
      {th.awaiting_reply && !runs.some((r) => r.state === "running") && (
        <div className="agentmsg"><span className="av">{name(th.staff_id).slice(0, 1)}</span><div className="body"><span className="shimmer" style={{ fontWeight: 500 }}>Starting…</span></div></div>
      )}
    </div>
  );
}

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
        {th && (th.messages as Msg[]).filter((m) => m.role === "agent" && m.blocks?.some((b) => b.type === "choices" || b.type === "file")).map((m) => (
          <div key={m.id} className="agentmsg"><span className="av">{who.slice(0, 1)}</span><div className="body">
            <div className="who">{who} · {when(m.at)}</div><Markdown text={m.text} /><Attachments blocks={m.blocks} />
            <Choices m={m} messages={th.messages as Msg[]} busy={th.awaiting_reply} onPick={answer} /></div></div>
        ))}
        {runs.length === 0 && t.status === "queued" && <div className="sysmsg">Waiting for a free spot…</div>}
        {t.report && (
          <div className="agentmsg"><span className="av">{who.slice(0, 1)}</span><div className="body"><div className="who">{who} · report</div><Markdown text={t.report.body_md} /></div></div>
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

function NewTask({ staff, onDone }: { staff: Staff[]; onDone: (id: string) => void }) {
  const [form, setForm] = useState({ staff_id: "", brief: "" });
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
  const view = params.get("view") === "work" ? "work" : "chat";
  const tid = params.get("thread");
  const taskId = params.get("task");
  const [panel, setPanel] = useLocal("saga.panel", true);
  const [listOpen, setListOpen] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [current, setCurrent] = useState<FullThread | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const loadLists = useCallback(async () => {
    try {
      const [th, tk, st] = await Promise.all([api<Thread[]>("/threads"), api<Task[]>("/tasks?limit=60"), api<Staff[]>("/staff")]);
      setThreads(th); setTasks(tk); setStaff(st);
    } catch (e: any) { setErr(e.message); }
  }, []);
  usePoll(loadLists, 20000, [loadLists], (n) => n?.kind === "reply" || n?.kind?.startsWith("job"));

  const go = useCallback((q: Record<string, string>) => { router.replace(`/chat/?${new URLSearchParams(q)}`); setListOpen(false); }, [router]);
  const openThread = useCallback(async (body: Record<string, string>) => {
    try { const th = await api<Thread>("/threads", { body }); go({ thread: th.id }); } catch (e: any) { setErr(e.message); }
  }, [go]);
  useEffect(() => { if (view === "chat" && !tid) openThread({ scope: "master" }); }, [view, tid, openThread]);

  // the thread: every 1.5 s while a helper is answering, every 12 s otherwise (and at once when a notice arrives);
  // unchanged threads cost a 304 thanks to the server's ETag
  const awaiting = useRef(false);
  awaiting.current = !!current?.awaiting_reply;
  useEffect(() => { if (view !== "chat" || !tid) setCurrent(null); }, [view, tid]);
  usePoll(async () => {
    if (view !== "chat" || !tid) return;
    const want = tid;
    try { const th = await api<FullThread>(`/threads/${want}`); setCurrent((cur) => (want === tid ? th : cur)); } catch (e: any) { setErr(e.message); }
  }, () => (awaiting.current ? 1500 : 12000), [view, tid], (n) => !!tid && n?.url?.includes(tid));

  const threadEvents = useEvents(view === "chat" && tid ? { thread_id: tid } : null);
  const taskEvents = useEvents(view === "work" && taskId && taskId !== "new" ? { task_id: taskId } : null);
  const events = view === "chat" ? threadEvents : taskEvents;
  const nMsgs = current?.messages.length || 0;
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [nMsgs, events.length]);

  const send = async (t: string) => {
    if ((!t.trim() && !files.length) || !tid) return;
    const att = files;
    const body = { text: t.trim() || `(attached ${att.length} file${att.length > 1 ? "s" : ""})`,
      blocks: att.length ? att.map((f) => ({ type: "file", ...f })) : undefined };
    setText(""); setFiles([]);
    try { setCurrent(await api<FullThread>(`/threads/${tid}/messages`, { body })); awaiting.current = true; kick(tid); } catch (e: any) { setErr(e.message); setText(t); setFiles(att); }
  };

  const chief = staff.find((s) => s.is_chief);
  const name = (id: string) => staff.find((s) => s.id === id)?.name || id;
  const threadLabel = (th: Thread) => th.scope === "master" ? "Chief of Staff" : th.scope === "staff" ? name(th.staff_id) : th.title;
  const title = view === "chat" ? (current ? threadLabel(current) : "Chat") : taskId === "new" ? "New job" : tasks.find((t) => t.id === taskId)?.brief.slice(0, 60) || "Work";
  const lastAgentText = useMemo(() => [...(current?.messages || [])].reverse().find((m) => m.role === "agent")?.text, [current]);
  const selTask = tasks.find((t) => t.id === taskId);

  const output = view === "chat"
    ? (lastAgentText ? <Markdown text={lastAgentText} /> : null)
    : selTask?.report ? <div><div className="small" style={{ marginBottom: 6 }}>Report</div><div className="paper md"><Markdown text={selTask.report.body_md} /></div></div> : null;

  return (
    <div className="ws">
      <div className="topbar">
        <button className="iconbtn hide-lg" aria-label="Show list" onClick={() => setListOpen(!listOpen)}><i className="ri-menu-2-line" /></button>
        <span className="crumb"><i className={view === "chat" ? "ri-chat-3-line" : "ri-list-check-3"} />Workspace<span className="small" style={{ fontWeight: 400 }}>· {title}</span></span>
        <span className="sp" />
        <PoolMeter />
        <div className="seg" role="tablist" aria-label="View">
          <button className={view === "chat" ? "on" : ""} onClick={() => go({})}><i className="ri-chat-3-line" /> Chat</button>
          <button className={view === "work" ? "on" : ""} onClick={() => go({ view: "work" })}><i className="ri-list-check-3" /> Work</button>
        </div>
        <button className="iconbtn" aria-label={panel ? "Hide side panel" : "Show side panel"} title="Progress, output and browser" onClick={() => setPanel(!panel)}>
          <i className={panel ? "ri-side-bar-fill" : "ri-side-bar-line"} />
        </button>
      </div>
      <div className={`ws-body ${panel ? "panel" : ""}`}>
        <nav className={`ws-list ${listOpen ? "open" : ""}`}>
          {view === "chat" ? (
            <>
              {chief && <button className={`ws-item ${current?.scope === "master" ? "on" : ""}`} onClick={() => openThread({ scope: "master" })}>
                <i className="ri-star-smile-line" /><span className="t"><b>Chief of Staff</b><span>Routes work to the team</span></span></button>}
              <div className="grp">Helpers</div>
              {staff.filter((s) => !s.is_chief).map((s) => (
                <button key={s.id} className={`ws-item ${current?.scope === "staff" && current.staff_id === s.id ? "on" : ""}`} onClick={() => openThread({ scope: "staff", staff_id: s.id })}>
                  <i className="ri-user-3-line" /><span className="t"><b>{s.name}</b></span></button>
              ))}
              <div className="grp">About a job or approval</div>
              {threads.filter((t) => t.scope === "task" || t.scope === "proposal").slice(0, 15).map((t) => (
                <button key={t.id} className={`ws-item ${current?.id === t.id ? "on" : ""}`} onClick={() => go({ thread: t.id })}>
                  <i className={t.scope === "task" ? "ri-task-line" : "ri-inbox-archive-line"} /><span className="t"><b>{t.title || t.scope}</b><span>{name(t.staff_id)}</span></span></button>
              ))}
            </>
          ) : (
            <>
              <button className="btn primary" style={{ margin: "2px 2px 8px" }} onClick={() => go({ view: "work", task: "new" })}><i className="ri-add-line" />New job</button>
              {tasks.length === 0 && <p className="small" style={{ padding: 10 }}>No jobs yet.</p>}
              {tasks.map((t) => (
                <button key={t.id} className={`ws-item ${taskId === t.id ? "on" : ""}`} onClick={() => go({ view: "work", task: t.id })}>
                  <span className={`sdot ${t.status}`} /><span className="t"><b>{t.report?.headline || t.brief}</b><span>{name(t.staff_id)} · {ago(t.created_at)}</span></span></button>
              ))}
            </>
          )}
        </nav>
        <section className="ws-main">
          <div className="ws-scroll" ref={scroller}>
            {view === "chat" ? (current ? <div className="ws-inner"><Conversation th={current} staff={staff} events={threadEvents} onSend={send} busy={current.awaiting_reply} /></div>
              : <div className="ws-inner"><p className="small">Loading…</p></div>)
              : taskId === "new" ? <NewTask staff={staff} onDone={(id) => go({ view: "work", task: id })} />
              : taskId ? <TaskView id={taskId} staff={staff} />
              : <div className="ws-inner"><div className="empty"><b>Pick a job on the left</b><span>Or start a new one. Every step shows up live.</span>
                  <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => go({ view: "work", task: "new" })}>New job</button></div></div></div>}
          </div>
          {view === "chat" && current && (
            <div className="ws-composer">
              <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
                <textarea value={text} placeholder={`Message ${threadLabel(current)}…`} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
                <div className="row">
                  <ComposerTools threadId={tid} files={files} setFiles={setFiles} disabled={current.awaiting_reply} />
                  <span className="small hide-sm">{current.awaiting_reply ? "Working on it…" : "Enter to send · Shift+Enter for a new line"}</span>
                  <span className="sp" />
                  <button className="btn primary sm" type="submit" disabled={(!text.trim() && !files.length) || current.awaiting_reply}><i className="ri-arrow-up-line" />Send</button>
                </div>
              </form>
              <Err error={err} />
            </div>
          )}
        </section>
        {panel && <Panel events={events} output={output} onClose={() => setPanel(false)} />}
      </div>
    </div>
  );
}

export default function Workspace() {
  return <Suspense><WorkspaceInner /></Suspense>;
}
