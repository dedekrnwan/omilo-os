"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { Err } from "@/components/ui";
import { InboxItem, Proposal, ago, api, when } from "@/lib/api";
import { openInDrawer, openThread } from "@/lib/open";
import { useBlocks } from "@/components/workflows/blocks";
import Canvas from "@/components/workflows/Canvas";
import { accessLabel } from "@/components/Conversation";

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

export const SNOOZES: [string, string, { hours?: number; until?: string }][] = [
  ["1 hour", "ri-time-line", { hours: 1 }], ["Tomorrow 08:00", "ri-sun-line", { until: "tomorrow" }], ["Monday 08:00", "ri-calendar-line", { until: "monday" }],
];

export async function askCos(itemId: string) {
  const th = await api<{ id: string }>(`/inbox/${itemId}/ask-cos`, { body: {} });
  openThread(th.id);
}

/* Under every open item: snooze it, hand it to the Chief of Staff, and when Omilo will remind you next. */
function Later({ i, busy, act }: { i: InboxItem; busy: boolean; act: (fn: () => Promise<unknown>) => void }) {
  const [err, setErr] = useState<string | null>(null);
  if (i.status !== "open" && i.status !== "snoozed") return null;
  const next = i.nudge?.next_at;
  return (
    <div className="later">
      {i.status === "snoozed" ? (
        <span className="small"><i className="ri-time-line" /> Snoozed until {when(i.snooze_until)}</span>
      ) : (
        <>
          <span className="small">Snooze</span>
          <div className="seg">{SNOOZES.map(([label, icon, body]) => (
            <button key={label} disabled={busy} onClick={() => act(() => api(`/inbox/${i.id}/snooze`, { body }))}><i className={icon} />{label}</button>
          ))}</div>
          <button className="btn sm quiet" disabled={busy} onClick={() => askCos(i.id).catch((e) => setErr(e.message))}><i className="ri-user-star-line" />Ask the Chief of Staff</button>
        </>
      )}
      {i.status === "open" && next && (
        <span className="small sp-l" title={when(next)}>
          <i className={i.nudge?.held ? "ri-moon-line" : "ri-alarm-line"} />{" "}
          {i.nudge?.held ? "Reminders wait for quiet hours or focus to end"
            : new Date(next).getTime() <= Date.now() ? "Reminder going out now"
            : i.nudge?.channel === "brief" ? `In the morning brief ${ago(next)} if still open`
            : i.nudge?.channel === "cos" ? `The Chief of Staff calls it out ${ago(next)}`
            : `Next reminder ${ago(next)}`}
        </span>
      )}
      <Err error={err} />
    </div>
  );
}

/* Low-risk proposals of the same kind from the same helper can be approved together. */
function Similar({ p, busy, act }: { p: Proposal; busy: boolean; act: (fn: () => Promise<unknown>) => void }) {
  const [list, setList] = useState<Proposal[]>([]);
  useEffect(() => {
    if (p.risk !== "low" || p.status !== "pending") return;
    api<Proposal[]>(`/proposals/${p.id}/similar`).then(setList).catch(() => setList([]));
  }, [p.id, p.risk, p.status]);
  if (!list.length) return null;
  return (
    <div className="callout" style={{ marginTop: 10 }}>
      <b>{list.length} more like this</b> are waiting from the same helper ({p.type}, low risk):
      <ul className="small" style={{ margin: "4px 0 8px" }}>{list.slice(0, 5).map((x) => <li key={x.id}>{x.title}</li>)}{list.length > 5 && <li>…</li>}</ul>
      <button className="btn sm" disabled={busy} onClick={() => act(() => api(`/proposals/${p.id}/decide-similar`, { body: { decision: "approve" } }))}>
        <i className="ri-check-double-line" />Approve this and {list.length} similar
      </button>
    </div>
  );
}

/* Inline decision UI for an access_request inbox item. Mirrors the chat-card AccessCard. */
type SkillReq = { slug: string; update: boolean; name: string; description: string; body: string; current_body: string | null; status?: string };

function SkillShareItem({ i, busy, act }: { i: InboxItem; busy: boolean; act: (fn: () => Promise<unknown>) => void }) {
  const [req, setReq] = useState<SkillReq | null>(null);
  const [note, setNote] = useState("");
  const [showOld, setShowOld] = useState(false);
  useEffect(() => { api<SkillReq>(`/skill-requests/${i.id}`).then(setReq).catch(() => setReq(null)); }, [i.id]);
  const decide = (approve: boolean) => act(() => api(`/skill-requests/${i.id}/decide`, { body: { approve, note } }));
  if (!req) return <p className="small">Loading the skill…</p>;
  return (
    <>
      <p className="small" style={{ margin: "0 0 6px" }}>
        {req.update ? "A new version of a skill the whole team uses. Approve it and every helper follows the new steps."
          : "This helper wrote the skill for itself and thinks teammates would use it too. Share it and every helper can follow it."}
      </p>
      <div className="paper">
        <p style={{ margin: "0 0 4px", fontWeight: 500 }}><i className="ri-magic-line" /> {req.name} <span className="small mono">/{req.slug}</span></p>
        {req.description && <p className="small" style={{ margin: "0 0 8px" }}>{req.description}</p>}
        <Markdown text={req.body} />
      </div>
      {req.update && req.current_body && (
        <>
          <button className="btn quiet sm" type="button" onClick={() => setShowOld(!showOld)}>{showOld ? "Hide" : "Show"} the current version</button>
          {showOld && <div className="paper" style={{ opacity: 0.8 }}><Markdown text={req.current_body} /></div>}
        </>
      )}
      {i.status === "open" && (
        <>
          <textarea placeholder="Optional note for the helper (it learns from it)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          <div className="acts" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={busy} onClick={() => decide(true)}><i className="ri-team-line" />{req.update ? "Approve the change" : "Share with the team"}</button>
            <button className="btn" disabled={busy} onClick={() => decide(false)}>{req.update ? "Keep the current version" : "Keep it personal"}</button>
            <span className="sp" />
            <Link className="btn quiet" href="/skills/">Open Skills</Link>
          </div>
        </>
      )}
    </>
  );
}

function AccessRequestItem({ i, busy, act }: { i: InboxItem; busy: boolean; act: (fn: () => Promise<unknown>) => void }) {
  let parsed: { kind?: string; target?: Record<string, unknown>; reason?: string } = {};
  try { parsed = JSON.parse(i.body); } catch { /* malformed body: show title only */ }
  const kind = parsed.kind || "";
  const target = parsed.target || {};
  const reason = parsed.reason || i.title;
  const label = accessLabel(kind, target);
  const [denyOpen, setDenyOpen] = useState(false);
  const [denyNote, setDenyNote] = useState("");
  return (
    <>
      <div className="paper">
        <p style={{ margin: "0 0 6px", fontWeight: 500 }}>{label}</p>
        {reason && <p className="small" style={{ margin: 0 }}>{reason}</p>}
      </div>
      {i.status === "open" && (
        denyOpen ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            <textarea
              value={denyNote}
              onChange={(e) => setDenyNote(e.target.value)}
              placeholder="Optional: why you are denying this (the helper will see it)"
              rows={2}
              aria-label="Reason for denying (optional)"
              style={{ resize: "vertical", fontSize: 13 }}
              onKeyDown={(e) => { if (e.key === "Escape") { setDenyOpen(false); setDenyNote(""); } }}
            />
            <div className="acts" style={{ gap: 6 }}>
              <button className="btn sm danger" type="button" disabled={busy}
                onClick={() => act(() => api(`/access/${i.id}/decide`, { body: { scope: "deny", note: denyNote } }))}>
                Confirm deny
              </button>
              <button className="btn sm quiet" type="button" disabled={busy}
                onClick={() => { setDenyOpen(false); setDenyNote(""); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="acts" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
            <button className="btn sm" type="button" disabled={busy}
              onClick={() => act(() => api(`/access/${i.id}/decide`, { body: { scope: "once" } }))}>
              Allow once
            </button>
            <button className="btn sm" type="button" disabled={busy}
              onClick={() => act(() => api(`/access/${i.id}/decide`, { body: { scope: "always" } }))}>
              Always allow this helper
            </button>
            <button className="btn sm danger" type="button" disabled={busy} onClick={() => setDenyOpen(true)}>
              Deny
            </button>
          </div>
        )
      )}
      {i.status !== "open" && (
        <p className="small">{i.status === "done" ? "Decided" : i.status}</p>
      )}
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
  const decide = async (pid: string, decision: string) => {
    // Bug #2: if the proposal was already decided (409 + "already"), treat as success-ish —
    // refresh the parent item to show the current decided state instead of surfacing a scary error.
    setErr(null); setBusy(true);
    try {
      await api(`/proposals/${pid}/decide`, { body: { decision, note } });
      setNote(""); onDone();
    } catch (e: any) {
      if (e.status === 409 || /already/i.test(e.message || "")) { onDone(); }
      else { setErr(e.message); }
    } finally { setBusy(false); }
  };
  const discuss = async (pid: string) => {
    try {
      const th = await api<{ id: string }>("/threads", { body: { scope: "proposal", ref_id: pid } });
      if (!openInDrawer(`/chat/?thread=${th.id}`)) router.push(`/chat/?thread=${th.id}`);
    } catch (e: any) { setErr(e.message); }
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
              <Similar p={i.proposal} busy={busy} act={act} />
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
      {i.kind === "access_request" && <AccessRequestItem i={i} busy={busy} act={act} />}
      {i.kind === "skill_share" && <SkillShareItem i={i} busy={busy} act={act} />}
      <Later i={i} busy={busy} act={act} />
      <Err error={err} />
    </div>
  );
}
