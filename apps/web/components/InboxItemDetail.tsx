"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Err } from "@/components/ui";
import { InboxItem, api } from "@/lib/api";
import { openInDrawer } from "@/lib/open";
import { useBlocks } from "@/components/workflows/blocks";
import Canvas from "@/components/workflows/Canvas";

function WorkflowItem({ i, busy, act }: { i: InboxItem; busy: boolean; act: (fn: () => Promise<unknown>) => void }) {
  const blocks = useBlocks();
  const w = i.workflow;
  const wf = w?.workflow as any;
  const decide = (decision: "approved" | "rejected") => act(() => api(`/inbox/${i.id}/decide`, { body: { decision, note: "" } }));
  const href = wf ? `/workflows/?id=${wf.id}${w?.run_id ? `&run=${w.run_id}` : ""}` : null;
  return (
    <>
      <div className="paper"><Markdown text={i.body} /></div>
      {w?.type === "proposal" && wf?.graph && (
        <div className="wf-mini"><Canvas graph={wf.graph} blocks={blocks} readOnly height={300} fitKey={wf.id} /></div>
      )}
      {w?.type === "proposal" && wf && <p className="small">{wf.uses_ai ? "Some steps use AI." : "No AI steps: free to run."} Approving switches it on{wf.trigger?.label ? ` (${wf.trigger.label.toLowerCase()})` : ""}.</p>}
      {i.status === "open" ? (
        <div className="acts" style={{ marginTop: 8 }}>
          <button className="btn primary" disabled={busy} onClick={() => decide("approved")}><i className="ri-check-line" />{w?.type === "proposal" ? "Approve and switch on" : "Approve"}</button>
          <button className="btn danger" disabled={busy} onClick={() => decide("rejected")}>{w?.type === "proposal" ? "Turn down" : "Reject"}</button>
          <span className="sp" />
          {href && <Link className="btn quiet" href={href}><i className="ri-flow-chart" />{w?.type === "proposal" ? "Open to change it" : "Open the run"}</Link>}
        </div>
      ) : <p className="small">Decided: {i.answer || "done"}</p>}
    </>
  );
}

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
    if (!openInDrawer(`/chat/?thread=${th.id}`)) router.push(`/chat/?thread=${th.id}`);
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
      {i.kind === "workflow" && <WorkflowItem i={i} busy={busy} act={act} />}
      {i.kind === "alert" && (
        <>
          <div className="paper"><Markdown text={i.body} /></div>
          <div className="acts" style={{ marginTop: 8 }}>
            {i.task_id && <Link className="btn" href={`/chat/?view=work&task=${i.task_id}`}>Open the job</Link>}
            {i.staff_id && /budget/i.test(i.title) && <Link className="btn primary" href={`/staff/?id=${i.staff_id}#budget`}><i className="ri-wallet-3-line" />Open the budget</Link>}
            {i.status === "open" && <button className="btn" disabled={busy} onClick={() => act(() => api(`/inbox/${i.id}/dismiss`, { body: {} }))}>Dismiss</button>}
          </div>
        </>
      )}
      <Err error={err} />
    </div>
  );
}
