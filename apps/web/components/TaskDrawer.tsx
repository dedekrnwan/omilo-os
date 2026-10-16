"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { ChatPane } from "@/components/Conversation";
import Drawer from "@/components/Drawer";
import InboxItemDetail from "@/components/InboxItemDetail";
import { Markdown } from "@/components/Markdown";
import { RunCard, toRuns, useEvents } from "@/components/Run";
import { Err, StatusChip } from "@/components/ui";
import { InboxItem, Staff, Task, ago, api } from "@/lib/api";
import { usePoll } from "@/lib/poll";

/* A job, opened from anywhere (Inbox, Monitor, notifications, links in chats): live progress, what waits on you,
   and a chat with the helper about it, in one drawer. Chats open the same way. */

type Tab = "progress" | "chat" | "approvals";

const dur = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`);

function JobBody({ id, staff, tab, setTab, onOpenTask }: { id: string; staff: Staff[]; tab: Tab; setTab: (t: Tab) => void; onOpenTask: (id: string) => void }) {
  const [t, setT] = useState<Task | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState<string | null>(null);
  const events = useEvents({ task_id: id });
  const load = useCallback(async () => {
    try {
      const [task, inbox] = await Promise.all([api<Task>(`/tasks/${id}`), api<InboxItem[]>("/inbox?status=open")]);
      setT(task); setItems(inbox.filter((i) => i.task_id === id)); setErr(null);
    } catch (e: any) { setErr(e.message); }
  }, [id]);
  usePoll(load, () => (t && ["queued", "running"].includes(t.status) ? 3000 : 15000), [load], (n) => n?.url?.includes(id) || n?.kind === "inbox");
  useEffect(() => { if (!t || t.status !== "running") return; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [t?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab !== "chat" || threadId) return;
    api<{ id: string }>("/threads", { body: { scope: "task", ref_id: id } }).then((th) => setThreadId(th.id)).catch((e) => setErr(e.message));
  }, [tab, threadId, id]);

  if (!t) return <p className="small" style={{ padding: 20 }}>{err || "Loading…"}</p>;
  const runs = toRuns(events);
  const lines = t.brief.trim().split("\n");
  const ck = t.checkpoints?.[t.checkpoints.length - 1];

  return (
    <div className="jd">
      <div className="jd-tabs seg">
        <button className={tab === "progress" ? "on" : ""} onClick={() => setTab("progress")}><i className="ri-pulse-line" /> Progress</button>
        <button className={tab === "approvals" ? "on" : ""} onClick={() => setTab("approvals")}><i className="ri-checkbox-multiple-line" /> Needs you{items.length ? <span className="jd-n">{items.length}</span> : null}</button>
        <button className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}><i className="ri-chat-3-line" /> Chat</button>
      </div>

      {tab === "progress" && (
        <div className="jd-body">
          <div className="jd-brief">
            <div className="small">The job · {t.origin} · {ago(t.created_at)}</div>
            <Markdown text={lines.slice(1).join("\n").trim() || lines[0]} />
            {t.founder_note && <div className="small"><b>Your note:</b> {t.founder_note}</div>}
          </div>
          {items.length > 0 && (
            <button className="callout warn jd-wait" onClick={() => setTab("approvals")}><i className="ri-hand" /><span><b>{items.length} thing{items.length > 1 ? "s" : ""} waiting on you</b> for this job.</span><span className="sp" /><span className="small">Review →</span></button>
          )}
          {ck && t.status === "running" && (
            <div className="jd-ck"><div className="small">Latest checkpoint · {ago(ck.at)}</div>{ck.done && <div><b>Done:</b> {ck.done}</div>}{ck.next && <div><b>Next:</b> {ck.next}</div>}</div>
          )}
          {runs.length === 0 && t.status === "queued" && <div className="sysmsg">Waiting for a free spot…</div>}
          {runs.map((r) => <RunCard key={r.id} run={r} />)}
          {t.report && (
            <div className="jd-report"><div className="small">Report</div><b>{t.report.headline}</b><Markdown text={t.report.body_md} /></div>
          )}
          {t.error && <div className="callout warn"><b>What went wrong:</b> {t.error}</div>}
          {!!t.proposals?.length && (
            <div className="jd-list"><div className="small">Proposals</div>
              {t.proposals.map((p) => <div key={p.id} className="acts" style={{ margin: "4px 0" }}><StatusChip status={p.status} /><span>{p.title}</span></div>)}</div>
          )}
          {!!t.children?.length && (
            <div className="jd-list"><div className="small">Handed off to</div>
              {t.children.map((c) => (
                <button key={c.id} className="jd-child" onClick={() => onOpenTask(c.id)}>
                  <Avatar who={staff.find((s) => s.id === c.staff_id) || { id: c.staff_id }} size={18} /><span>{c.brief.split("\n")[0].slice(0, 80)}</span><StatusChip status={c.status} />
                </button>
              ))}</div>
          )}
          {t.status === "running" && t.started_at && <p className="small">Running for {dur((now - new Date(t.started_at).getTime()) / 1000)}.</p>}
        </div>
      )}

      {tab === "approvals" && (
        <div className="jd-body">
          {items.length === 0 ? <div className="empty"><b>Nothing waiting</b><span>This job has no open approvals or questions.</span></div> : items.map((i) => (
            <div key={i.id} className="paper jd-item">
              <div className="acts" style={{ marginBottom: 8 }}><span className={`chip ${i.kind === "alert" ? "down" : i.kind === "question" ? "warn" : "outline"}`}>{i.kind === "proposal" ? "Approval" : i.kind === "question" ? "Question" : "Alert"}</span><b>{i.title}</b></div>
              <InboxItemDetail item={i} onDone={load} />
            </div>
          ))}
        </div>
      )}

      {tab === "chat" && (threadId ? <ChatPane threadId={threadId} staff={staff} placeholder="Ask about this job, or tell the helper what to change…" /> : <p className="small" style={{ padding: 20 }}>Opening the chat…</p>)}
      <Err error={err} />
    </div>
  );
}

export type Open = { kind: "task"; id: string; tab?: Tab } | { kind: "thread"; id: string; title?: string };

export default function TaskDrawerHost({ initial }: { initial: Open }) {
  const [job, setJob] = useState<{ id: string; tab: Tab } | null>(initial.kind === "task" ? { id: initial.id, tab: initial.tab || "progress" } : null);
  const [chat, setChat] = useState<{ id: string; title?: string } | null>(initial.kind === "thread" ? { id: initial.id, title: initial.title } : null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [head, setHead] = useState<Task | null>(null);
  const [chatHead, setChatHead] = useState<{ staff_id: string; title: string; scope: string } | null>(null);

  useEffect(() => {
    const onTask = (e: Event) => { const d = (e as CustomEvent).detail; setChat(null); setJob({ id: d.id, tab: d.tab || "progress" }); };
    const onThread = (e: Event) => { const d = (e as CustomEvent).detail; setJob(null); setChat({ id: d.id, title: d.title }); };
    window.addEventListener("saga:task", onTask);
    window.addEventListener("saga:thread", onThread);
    return () => { window.removeEventListener("saga:task", onTask); window.removeEventListener("saga:thread", onThread); };
  }, []);
  useEffect(() => { if ((job || chat) && !staff.length) api<Staff[]>("/staff").then(setStaff).catch(() => {}); }, [job, chat, staff.length]);
  useEffect(() => { setHead(null); if (job) api<Task>(`/tasks/${job.id}`).then(setHead).catch(() => {}); }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setChatHead(null); if (chat) api<{ staff_id: string; title: string; scope: string }>(`/threads/${chat.id}`).then(setChatHead).catch(() => {}); }, [chat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeJob = useCallback(() => setJob(null), []);
  const closeChat = useCallback(() => setChat(null), []);
  const who = (id?: string) => staff.find((s) => s.id === id);

  return (
    <>
      <Drawer open={!!job} onClose={closeJob} wide
        icon={head ? <Avatar who={who(head.staff_id) || { id: head.staff_id }} size={28} state={head.status === "running" ? "working" : null} /> : <i className="ri-list-check-3" />}
        title={head ? head.brief.split("\n")[0].slice(0, 90) : "Job"}
        sub={head ? <span className="acts" style={{ gap: 6 }}>{who(head.staff_id)?.name || head.staff_id}<StatusChip status={head.status} /></span> : undefined}
        footer={job && (
          <>
            {head && ["queued", "running"].includes(head.status) && (
              <button className="btn quiet" onClick={async () => { if (!confirm("Stop this job?")) return; await api(`/tasks/${job.id}/cancel`, { body: {} }); setHead({ ...head, status: "cancelled" }); }}><i className="ri-stop-circle-line" />Stop</button>
            )}
            <span className="sp" />
            <Link className="btn quiet" href={`/chat/?view=work&task=${job.id}`} data-full onClick={closeJob}><i className="ri-external-link-line" />Full view</Link>
            <button className="btn" onClick={closeJob}>Close</button>
          </>
        )}>
        {job && <JobBody key={job.id} id={job.id} staff={staff} tab={job.tab} setTab={(tab) => setJob({ ...job, tab })} onOpenTask={(id) => setJob({ id, tab: "progress" })} />}
      </Drawer>

      <Drawer open={!!chat} onClose={closeChat} wide
        icon={chatHead ? <Avatar who={who(chatHead.staff_id) || { id: chatHead.staff_id }} size={28} /> : <i className="ri-chat-3-line" />}
        title={chat?.title || (chatHead ? (chatHead.scope === "master" ? "Chief of Staff" : chatHead.scope === "staff" ? who(chatHead.staff_id)?.name || chatHead.title : chatHead.title) : "Chat")}
        sub={chatHead ? `with ${who(chatHead.staff_id)?.name || chatHead.staff_id}` : undefined}
        footer={chat && <><span className="sp" /><Link className="btn quiet" href={`/chat/?thread=${chat.id}`} data-full onClick={closeChat}><i className="ri-external-link-line" />Open in Workspace</Link><button className="btn" onClick={closeChat}>Close</button></>}>
        {chat && <ChatPane key={chat.id} threadId={chat.id} staff={staff} />}
      </Drawer>
    </>
  );
}
