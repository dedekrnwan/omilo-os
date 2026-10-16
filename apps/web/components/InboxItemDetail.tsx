"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Err } from "@/components/ui";
import { InboxItem, api } from "@/lib/api";

/* What you can do with one inbox item: approve / ask for changes / reject a proposal, answer a question, dismiss an alert. */
export default function InboxItemDetail({ item: i, onDone }: { item: InboxItem; onDone: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setErr(null); setBusy(true);
    try { await fn(); setNote(""); onDone(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const decide = (pid: string, decision: string) => act(() => api(`/proposals/${pid}/decide`, { body: { decision, note } }));
  const discuss = async (pid: string) => {
    const th = await api<{ id: string }>("/threads", { body: { scope: "proposal", ref_id: pid } });
    router.push(`/chat/?thread=${th.id}`);
  };
  return (
    <div className="itemdetail">
      {i.proposal && (
        <>
          <div className="paper"><Markdown text={i.proposal.body_md} /></div>
          <p className="small">Revision {i.proposal.current_revision} · {i.proposal.type} · risk {i.proposal.risk}{i.task_id && <> · from <Link href={`/chat/?view=work&task=${i.task_id}`}>the job</Link></>}</p>
          {i.proposal.status === "pending" && (
            <>
              <textarea placeholder="Note for the helper: required to reject or ask for changes; optional to approve" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="acts" style={{ marginTop: 8 }}>
                <button className="btn primary" disabled={busy} onClick={() => decide(i.proposal!.id, "approve")}><i className="ri-check-line" />Approve</button>
                <button className="btn" onClick={() => decide(i.proposal!.id, "changes")} disabled={busy || !note.trim()}><i className="ri-edit-2-line" />Ask for changes</button>
                <button className="btn danger" onClick={() => decide(i.proposal!.id, "reject")} disabled={busy || !note.trim()}>Reject</button>
                <span className="sp" />
                <button className="btn quiet" onClick={() => discuss(i.proposal!.id)}><i className="ri-chat-3-line" />Discuss</button>
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
                <button className="btn primary" disabled={busy || !note.trim()} onClick={() => act(() => api(`/inbox/${i.id}/answer`, { body: { answer: note } }))}>Answer</button>
                <button className="btn" disabled={busy} onClick={() => act(() => api(`/inbox/${i.id}/snooze`, { body: { hours: 1 } }))}>Snooze 1h</button>
              </div>
            </>
          )}
        </>
      )}
      {i.kind === "alert" && (
        <>
          <div className="paper"><Markdown text={i.body} /></div>
          <div className="acts" style={{ marginTop: 8 }}>
            {i.task_id && <Link className="btn" href={`/chat/?view=work&task=${i.task_id}`}>Open the job</Link>}
            {i.status === "open" && <button className="btn" disabled={busy} onClick={() => act(() => api(`/inbox/${i.id}/dismiss`, { body: {} }))}>Dismiss</button>}
          </div>
        </>
      )}
      <Err error={err} />
    </div>
  );
}
