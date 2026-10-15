"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useOverview } from "@/components/Shell";
import { Empty, Err, Markdown, StatusChip } from "@/components/ui";
import { InboxItem, ago, api } from "@/lib/api";

export default function Inbox() {
  const { overview, refresh } = useOverview();
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [filter, setFilter] = useState("open");
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems(await api<InboxItem[]>(`/inbox?status=${filter}`)); } catch (e: any) { setErr(e.message); }
  }, [filter]);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); setNote(""); setOpen(null); await load(); refresh(); } catch (e: any) { setErr(e.message); }
  };
  const decide = (pid: string, decision: string) => act(() => api(`/proposals/${pid}/decide`, { body: { decision, note } }));
  const discuss = async (pid: string) => {
    const th = await api<{ id: string }>("/threads", { body: { scope: "proposal", ref_id: pid } });
    router.push(`/chat/?thread=${th.id}`);
  };

  const o = overview;
  return (
    <div>
      <h1>Inbox</h1>
      <p className="sub">Your helpers propose, you decide. Whatever you approve is done exactly as written.</p>
      {o && (
        <div className="stats">
          <div className="stat"><div className="label">Waiting for you</div><div className="num">{o.inbox.open}</div>
            <span className={`pace ${o.inbox.blocking ? "warn" : "flat"}`}>{o.inbox.blocking ? `${o.inbox.blocking} blocking a helper` : "nothing blocking"}</span></div>
          <div className="stat"><div className="label">Working now</div><div className="num">{o.tasks.running}</div>
            <span className="pace flat">{o.tasks.queued} queued · limit {o.max_concurrent_tasks}</span></div>
          <div className="stat"><div className="label">Done · 24h</div><div className="num">{o.tasks.done_24h}</div>
            <span className="pace">finished jobs</span></div>
          <div className="stat"><div className="label">Failed · 24h</div><div className="num">{o.tasks.failed_24h}</div>
            <span className={`pace ${o.tasks.failed_24h ? "down" : "up"}`}>{o.tasks.failed_24h ? "look at Work" : "none"}</span></div>
        </div>
      )}

      <div className="sec">
        <div className="sechead">
          <div className="seg">{["open", "snoozed", "done", "all"].map((s) => <button key={s} className={filter === s ? "on" : ""} onClick={() => setFilter(s)}>{s}</button>)}</div>
        </div>
        <Err error={err} />
        {items.length === 0 ? <Empty title={filter === "open" ? "Nothing waiting" : "No items"} text={filter === "open" ? "Your helpers have nothing for you right now." : "Nothing here yet."} /> : items.map((i) => (
          <div key={i.id} className={`item ${open === i.id ? "open" : ""}`}>
            <div className="h" onClick={() => { setOpen(open === i.id ? null : i.id); setNote(""); }}>
              <span className={`chip ${i.kind === "alert" ? "down" : i.kind === "question" ? "warn" : "outline"}`}>{i.kind}</span>
              {i.blocking && <span className="chip warn">blocking</span>}
              {i.proposal && <span className={`chip ${i.proposal.risk === "high" ? "down" : i.proposal.risk === "medium" ? "warn" : "idle"}`}>risk {i.proposal.risk}</span>}
              <div className="t"><b>{i.title}</b><span className="small">{i.staff_id} · {ago(i.created_at)}{i.proposal ? ` · ${i.proposal.type}` : ""}</span></div>
              {i.proposal && <StatusChip status={i.proposal.status} />}
            </div>
            {open === i.id && (
              <div className="b">
                {i.proposal && (
                  <>
                    <div className="paper"><Markdown text={i.proposal.body_md} /></div>
                    <p className="small">Revision {i.proposal.current_revision}{i.task_id && <> · from <Link href={`/chat/?view=work&task=${i.task_id}`}>task {i.task_id}</Link></>}</p>
                    {i.proposal.status === "pending" && (
                      <>
                        <textarea placeholder="Note for the helper: required to reject or ask for changes; optional to approve" value={note} onChange={(e) => setNote(e.target.value)} />
                        <div className="acts" style={{ marginTop: 8 }}>
                          <button className="btn primary" onClick={() => decide(i.proposal!.id, "approve")}><i className="ri-check-line" />Approve</button>
                          <button className="btn" onClick={() => decide(i.proposal!.id, "changes")} disabled={!note.trim()}><i className="ri-edit-2-line" />Ask for changes</button>
                          <button className="btn danger" onClick={() => decide(i.proposal!.id, "reject")} disabled={!note.trim()}>Reject</button>
                          <span className="sp" />
                          <button className="btn quiet" onClick={() => discuss(i.proposal!.id)}><i className="ri-chat-3-line" />Discuss with the helper</button>
                        </div>
                      </>
                    )}
                  </>
                )}
                {i.kind === "question" && (
                  <>
                    <div className="paper"><Markdown text={i.body} /></div>
                    {i.status === "open" && (
                      <>
                        <textarea placeholder="Your answer" value={note} onChange={(e) => setNote(e.target.value)} />
                        <div className="acts" style={{ marginTop: 8 }}>
                          <button className="btn primary" disabled={!note.trim()} onClick={() => act(() => api(`/inbox/${i.id}/answer`, { body: { answer: note } }))}>Answer</button>
                          <button className="btn" onClick={() => act(() => api(`/inbox/${i.id}/snooze`, { body: { hours: 1 } }))}>Snooze 1h</button>
                        </div>
                      </>
                    )}
                  </>
                )}
                {i.kind === "alert" && (
                  <>
                    <div className="paper"><Markdown text={i.body} /></div>
                    <div className="acts" style={{ marginTop: 8 }}>
                      {i.task_id && <Link className="btn" href={`/chat/?view=work&task=${i.task_id}`}>Open task</Link>}
                      {i.status === "open" && <button className="btn" onClick={() => act(() => api(`/inbox/${i.id}/dismiss`, { body: {} }))}>Dismiss</button>}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
