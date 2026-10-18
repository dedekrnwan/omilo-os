"use client";
import { kick, usePoll } from "@/lib/poll";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Meter, Run, RunCard, RunEvent, browserTrail, toRuns, useEvents } from "@/components/Run";
import ComposerTools, { Attached } from "@/components/ComposerTools";
import PoolMeter from "@/components/PoolMeter";
import Avatar from "@/components/Avatar";
import BrowserView from "@/components/BrowserView";
import Lineage from "@/components/Lineage";
import { Choices, Conversation, FullThread, Msg, useQuote } from "@/components/Conversation";
import { SlashAction, useSlash } from "@/components/SlashMenu";
import { useMentions } from "@/components/Mentions";
import MentionBox, { type MentionHandle } from "@/components/MentionBox";
import { helperItems, taskItems } from "@/lib/actions";
import { MenuItem, copy, menu, sep } from "@/lib/menu";
import { Err, StatusChip } from "@/components/ui";
import { Attachments, Markdown } from "@/components/Markdown";
import { BASE, Staff, Task, Thread, ago, api, when } from "@/lib/api";
import { confirmDialog } from "@/lib/dialog";

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
        {/* hidden on wide screens (the top bar has the toggle); on phones the panel covers the chat, so it needs its own close */}
        <button className="iconbtn ws-panel-close" aria-label="Close panel" onClick={onClose}><i className="ri-close-line" /></button>
      </div>
      <div className="pbody">
        {tab === "progress" && (runs.length ? (
          <div className="conv" style={{ gap: 10 }}>
            {runs.slice().reverse().map((r) => <RunCard key={r.id} run={r} compact />)}
          </div>
        ) : <div className="empty"><b>Nothing running</b><span>Steps appear here while a helper works.</span></div>)}
        {tab === "output" && (output || <div className="empty"><b>No output yet</b><span>Reports and drafts show up here.</span></div>)}
        {tab === "browser" && <BrowserView trail={trail} />}
      </div>
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
        {th && (th.messages as Msg[]).filter((m) => m.role === "agent" && m.blocks?.some((b) => b.type === "choices" || b.type === "file")).map((m) => (
          <div key={m.id} className="agentmsg"><Avatar who={staff.find((x) => x.id === t.staff_id)} size={30} /><div className="body">
            <div className="who">{who} · {when(m.at)}</div><Markdown text={m.text} /><Attachments blocks={m.blocks} />
            <Choices m={m} messages={th.messages as Msg[]} busy={th.awaiting_reply} onPick={answer} /></div></div>
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

/* naming a team chat, in place in the list */
function NameBox({ value, onChange, onDone, onCancel }: { value: string; onChange: (v: string) => void; onDone: () => void; onCancel: () => void }) {
  return (
    <form className="ws-item ws-name" onSubmit={(e) => { e.preventDefault(); onDone(); }}>
      <span className="hash">#</span>
      <input autoFocus value={value} maxLength={80} placeholder="Name, e.g. Launch week" aria-label="Chat name" onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }} onBlur={() => (value.trim() ? onDone() : onCancel())} />
    </form>
  );
}

/* ------------------------------------------------------------------ page */
function WorkspaceInner() {
  const params = useSearchParams();
  const router = useRouter();
  const view = params.get("view") === "work" ? "work" : "chat";
  const tid = params.get("thread");
  const taskId = params.get("task");
  const [panel, setPanel] = useLocal("omilo.panel", true);
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
  useEffect(() => { if (view === "chat" && !tid) openThread({ scope: "group" }); }, [view, tid, openThread]); // the team's General chat

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

  const box = useRef<MentionHandle>(null);
  useQuote(current?.id, setText, () => box.current?.focus());
  const startJob = async (brief: string) => {
    const who = staff.find((x) => x.is_chief) || staff[0];
    if (!who || !brief.trim()) return;
    try {
      const t = await api<Task>("/tasks", { body: { staff_id: who.id, brief: brief.trim() } });
      setText(""); go({ view: "work", task: t.id });
    } catch (e: any) { setErr(e.message); }
  };
  const onSlash = (a: SlashAction, rest: string) => {
    const focus = () => setTimeout(() => { const h = box.current; if (h) { h.focus(); h.setCaret(h.getValue().length); } }, 0);
    if (a.kind === "insert") { setText(a.text + rest); focus(); }
    else if (a.kind === "send") { setText(""); send(rest.trim() ? `${a.text}\n\n${rest}` : a.text); }
    else if (a.kind === "composer") { setText(""); window.dispatchEvent(new CustomEvent("omilo:composer", { detail: { action: a.action, kind: a.sub, id: a.id } })); focus(); }
    else if (a.kind === "job") { setText("/job "); focus(); }
    else if (a.kind === "talk") { setText(""); const st = staff.find((x) => x.id === a.staffId); openThread(st?.is_chief ? { scope: "master" } : { scope: "staff", staff_id: a.staffId }); }
    else if (a.kind === "go") { setText(""); router.push(a.href); }
    else if (a.kind === "pause") { setText(""); confirmDialog({ title: "Pause all helpers?", body: "Running jobs finish their current step; nothing new starts until you resume.", confirm: "Pause everyone", mood: "worried" }).then((ok) => { if (ok) api("/system", { body: { paused: true } }).catch((e) => setErr(e.message)); }); }
  };
  const slash = useSlash(text, staff, onSlash);
  const mention = useMentions(text, setText, staff, box);
  const [naming, setNaming] = useState<{ id: string | null; title: string } | null>(null); // new team chat / rename
  const saveName = async () => {
    const n = naming;
    setNaming(null);
    if (!n || !n.title.trim()) return;
    try {
      if (n.id) { await api(`/threads/${n.id}`, { method: "PATCH", body: { title: n.title } }); loadLists(); }
      else { const th = await api<Thread>("/threads", { body: { scope: "group", title: n.title } }); await loadLists(); go({ thread: th.id }); }
    } catch (e: any) { setErr(e.message); }
  };
  const removeGroup = async (t: Thread) => {
    if (!(await confirmDialog({ title: `Delete “${t.title}”?`, body: "The chat and its messages go away. Helpers keep what they learned.", confirm: "Delete", danger: true }))) return;
    try { await api(`/threads/${t.id}`, { method: "DELETE" }); await loadLists(); if (current?.id === t.id) go({}); } catch (e: any) { setErr(e.message); }
  };

  const send = async (t: string) => {
    if (slash.jobBrief !== null && t.startsWith("/job")) { startJob(slash.jobBrief); return; }
    if ((!t.trim() && !files.length) || !tid) return;
    const att = files;
    const body = { text: t.trim() || `(attached ${att.length} file${att.length > 1 ? "s" : ""})`,
      blocks: att.length ? att.map((f) => ({ type: "file", ...f })) : undefined, mentions: mention.mentioned(t) };
    setText(""); setFiles([]);
    try { setCurrent(await api<FullThread>(`/threads/${tid}/messages`, { body })); awaiting.current = true; kick(tid); } catch (e: any) { setErr(e.message); setText(t); setFiles(att); }
  };

  const chief = staff.find((s) => s.is_chief);
  const name = (id: string) => staff.find((s) => s.id === id)?.name || id;
  const threadLabel = (th: Thread) => th.scope === "master" ? "Chief of Staff" : th.scope === "staff" ? name(th.staff_id) : th.scope === "group" ? `# ${th.title}` : th.title;
  const groups = threads.filter((t) => t.scope === "group").sort((a, b) => (a.ref_id === "general" ? -1 : b.ref_id === "general" ? 1 : a.title.localeCompare(b.title)));
  const isGroup = current?.scope === "group";
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
              <div className="grp grp-act"><span>Team chats</span>
                <button className="iconbtn" aria-label="New team chat" title="New team chat" onClick={() => setNaming({ id: null, title: "" })}><i className="ri-add-line" /></button></div>
              {groups.length === 0 && !naming && <button className="ws-item" onClick={() => openThread({ scope: "group" })}><span className="hash">#</span><span className="t"><b>General</b><span>The whole team</span></span></button>}
              {groups.map((t) => naming?.id === t.id ? (
                <NameBox key={t.id} value={naming.title} onChange={(v) => setNaming({ ...naming, title: v })} onDone={saveName} onCancel={() => setNaming(null)} />
              ) : (
                <button key={t.id} className={`ws-item ${current?.id === t.id ? "on" : ""}`} onClick={() => go({ thread: t.id })}
                  onContextMenu={menu(() => [{ heading: `# ${t.title}` }, { label: "Open chat", icon: "ri-chat-3-line", onSelect: () => go({ thread: t.id }) },
                    { label: "Rename", icon: "ri-edit-line", onSelect: () => setNaming({ id: t.id, title: t.title }) },
                    t.ref_id !== "general" && { label: "Delete chat", icon: "ri-delete-bin-line", danger: true, onSelect: () => removeGroup(t) }].filter(Boolean) as MenuItem[])}>
                  <span className="hash">#</span><span className="t"><b>{t.title}</b><span>{t.ref_id === "general" ? "The whole team · @ to mention" : "Team chat"}</span></span>
                  {t.awaiting_reply && <span className="spin" style={{ width: 10, height: 10 }} />}
                </button>
              ))}
              {naming && !naming.id && <NameBox value={naming.title} onChange={(v) => setNaming({ ...naming, title: v })} onDone={saveName} onCancel={() => setNaming(null)} />}
              <div className="grp">Direct</div>
              {chief && <button className={`ws-item ${current?.scope === "master" ? "on" : ""}`} onClick={() => openThread({ scope: "master" })}
                onContextMenu={menu(() => [{ heading: "Chief of Staff" }, { label: "Open chat", icon: "ri-chat-3-line", onSelect: () => openThread({ scope: "master" }) },
                  { label: "Brief me", icon: "ri-sun-line", onSelect: async () => { await openThread({ scope: "master" }); setText("/brief"); } }, sep, ...helperItems(chief, loadLists).slice(1)])}>
                <Avatar who={chief} size={24} /><span className="t"><b>Chief of Staff</b><span>Routes work to the team</span></span></button>}
              {staff.filter((s) => !s.is_chief).map((s) => (
                <button key={s.id} className={`ws-item ${current?.scope === "staff" && current.staff_id === s.id ? "on" : ""}`} onClick={() => openThread({ scope: "staff", staff_id: s.id })}
                  onContextMenu={menu(() => [{ heading: s.name }, { label: "Open chat", icon: "ri-chat-3-line", onSelect: () => openThread({ scope: "staff", staff_id: s.id }) },
                    { label: `Mention ${s.name} in General`, icon: "ri-at-line", onSelect: async () => { await openThread({ scope: "group" }); setText(`@${s.name} `); } },
                    { label: `Give ${s.name} a job`, icon: "ri-add-circle-line", onSelect: () => go({ view: "work", task: "new", staff: s.id }) }, sep, ...helperItems(s, loadLists).slice(1)])}>
                  <Avatar who={s} size={24} state={(s as any).state === "working" ? "working" : null} /><span className="t"><b>{s.name}</b></span></button>
              ))}
            </>
          ) : (
            <>
              <button className="btn primary" style={{ margin: "2px 2px 8px" }} onClick={() => go({ view: "work", task: "new" })}><i className="ri-add-line" />New job</button>
              {tasks.length === 0 && <p className="small" style={{ padding: 10 }}>No jobs yet.</p>}
              {tasks.map((t) => (
                <button key={t.id} className={`ws-item ${taskId === t.id ? "on" : ""}`} onClick={() => go({ view: "work", task: t.id })}
                  onContextMenu={menu(() => taskItems(t, name(t.staff_id), loadLists, () => go({ view: "work", task: t.id })))}>
                  <span className={`sdot ${t.status}`} /><span className="t"><Lineage l={(t as any).lineage} plain /><b>{t.report?.headline || t.brief}</b><span>{name(t.staff_id)} · {ago(t.created_at)}</span></span></button>
              ))}
            </>
          )}
        </nav>
        <section className="ws-main">
          <div className="ws-scroll" ref={scroller}>
            {view === "chat" ? (current ? <div className="ws-inner"><Conversation th={current} staff={staff} events={threadEvents} onSend={send} busy={current.awaiting_reply} /></div>
              : <div className="ws-inner"><p className="small">Loading…</p></div>)
              : taskId === "new" ? <NewTask key={params.get("staff") || ""} who={params.get("staff") || ""} staff={staff} onDone={(id) => go({ view: "work", task: id })} />
              : taskId ? <TaskView id={taskId} staff={staff} />
              : <div className="ws-inner"><div className="empty"><b>Pick a job on the left</b><span>Or start a new one. Every step shows up live.</span>
                  <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => go({ view: "work", task: "new" })}>New job</button></div></div></div>}
          </div>
          {view === "chat" && current && (
            <div className="ws-composer">
              <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
                {slash.menu}
                {mention.menu}
                <MentionBox handleRef={box} value={text} onChange={setText} staff={staff}
                  placeholder={isGroup ? `Message ${threadLabel(current)}… (@ to mention a helper, / for commands)` : `Message ${threadLabel(current)}… (@ to bring someone in, / for commands)`}
                  ariaExpanded={slash.open || mention.open}
                  onKeyDown={(e) => { if (mention.onKeyDown(e) || slash.onKeyDown(e)) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
                <div className="row">
                  <ComposerTools threadId={tid} files={files} setFiles={setFiles} disabled={current.awaiting_reply} />
                  <span className="small hide-sm">{current.awaiting_reply ? "Working on it…" : slash.jobBrief !== null ? "Enter starts a job for the Chief of Staff"
                    : isGroup ? "No @mention: the Chief of Staff answers · Enter to send" : "@ to mention · / for commands · Enter to send"}</span>
                  <span className="sp" />
                  <button className="btn primary sm" type="submit" disabled={(!text.trim() && !files.length) || current.awaiting_reply}><i className="ri-arrow-up-line" />Send</button>
                </div>
              </form>
              <PoolMeter />
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
