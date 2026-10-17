"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import Drawer from "@/components/Drawer";
import Lineage from "@/components/Lineage";
import WorkMap from "@/components/WorkMap";
import InboxItemDetail, { SNOOZES, askCos } from "@/components/InboxItemDetail";
import { useOverview } from "@/components/Shell";
import { Empty, Err, StatusChip } from "@/components/ui";
import { InboxItem, ago, api } from "@/lib/api";
import { chatWith, helperItems, taskItems } from "@/lib/actions";
import { MenuItem, copy, menu, sep } from "@/lib/menu";
import { openTask, openThread } from "@/lib/open";
import { usePoll } from "@/lib/poll";

/* The Inbox: a board of what needs you, what is running and what just finished (or the classic list with history). */

type Who = { id: string; name: string; role: string; is_chief: boolean };
type Step = { at: string | null; text: string };
type Base = { id: string; title: string; summary: string; staff: Who; searches: number; tools: number; engine: string; steps: Step[] };
type NeedCard = Base & { kind: string; since: string; level: string; blocking: boolean; task_id: string | null; item: InboxItem };
type RunCard = Base & { status: string; started_at: string | null; created_at: string; origin: string };
type DoneCard = Base & { status: string; ended_at: string; seconds: number | null };
type Board = { needs: NeedCard[]; running: RunCard[]; done: DoneCard[]; now: string };

const dur = (s: number | null | undefined) => {
  if (s == null || s < 0) return "–";
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
};
const since = (iso: string | null, now: number) => (iso ? (now - new Date(iso).getTime()) / 1000 : null);
const KIND: Record<string, string> = { proposal: "Approval", question: "Question", alert: "Alert", workflow: "Workflow" };

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!active) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [active]);
  return now;
}

function Card({ c, indicator, time, tag, open, onToggle, onOpen, items }: {
  c: Base; indicator: React.ReactNode; time: string; tag?: React.ReactNode; open: boolean; onToggle: () => void; onOpen: () => void; items?: () => MenuItem[];
}) {
  return (
    <div className={`bcard ${open ? "open" : ""}`} role="button" tabIndex={0} aria-expanded={open} onContextMenu={items ? menu(items) : undefined}
      onClick={onToggle} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}>
      <Lineage l={(c as any).lineage} self={c.id} />
      <div className="bc-t"><Avatar who={c.staff} size={18} /><b>{c.title}</b></div>
      {tag}
      <p className="bc-s">{c.summary}</p>
      <div className="bc-f">
        {indicator}<span className="mono">{time}</span><span className="sp" />
        <span className="bc-n" title={`${c.searches} sources read`}><i className="ri-search-line" />{c.searches}</span>
        <span className="bc-sep" />
        <span className="bc-n" title={`${c.tools} tool calls`}><i className="ri-hammer-line" />{c.tools}</span>
      </div>
      {open && (
        <div className="bc-x" onClick={(e) => e.stopPropagation()}>
          <div className="bc-who">{c.staff.name}{c.engine ? ` · ${c.engine}` : ""}</div>
          {c.steps.length > 0 ? (
            <ul className="tl">
              {c.steps.map((s, i) => (
                <li key={i} className={i === c.steps.length - 1 ? "last" : ""}><span>{s.text}</span><span className="tl-at">{s.at ? ago(s.at) : "now"}</span></li>
              ))}
            </ul>
          ) : <p className="small" style={{ margin: "4px 0" }}>No steps recorded yet.</p>}
          <div className="bc-open"><button className="btn sm" onClick={onOpen}>Open</button></div>
        </div>
      )}
    </div>
  );
}

function Column({ title, icon, count, children, empty }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode; empty: string }) {
  return (
    <section className="bcol" aria-label={title}>
      <div className="bcol-h">{icon}<span>{title}</span><span className="bcol-n">{count}</span></div>
      <div className="bcol-b">{count === 0 ? <div className="bcol-empty">{empty}</div> : children}</div>
    </section>
  );
}

function BoardView({ onCount }: { onCount: () => void }) {
  const router = useRouter();
  const [b, setB] = useState<Board | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<NeedCard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setB(await api<Board>("/board")); setErr(null); } catch (e: any) { setErr(e.message); } }, []);
  usePoll(load, () => (b?.running.length ? 4000 : 20000), [load], (n) => n?.kind === "inbox" || n?.kind?.startsWith("job") || n?.kind === "local");
  const now = useNow(!!b?.running.length || !!b?.needs.length);
  const seenIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!b) return;
    // opened from a notification (/?item=…): show that item
    const want = new URLSearchParams(location.search).get("item");
    if (want) {
      const c = b.needs.find((x) => x.id === want);
      if (c) { if (c.task_id && c.kind !== "workflow") openTask(c.task_id, "approvals"); else setDetail(c); }
      const u = new URL(location.href); u.searchParams.delete("item"); history.replaceState(history.state, "", u.pathname + u.search);
    }
    // looking at the board acknowledges Critical items, so their every-15-minutes reminders stop
    const crit = b.needs.filter((c) => c.level === "critical" && !seenIds.current.has(c.id)).map((c) => c.id);
    if (crit.length && !document.hidden) { crit.forEach((id) => seenIds.current.add(id)); api("/notify/seen", { body: { item_ids: crit } }).catch(() => {}); }
  }, [b]);
  const toggle = (id: string) => setOpen((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const closeDetail = useCallback(() => setDetail(null), []);

  const quick = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); onCount(); } catch (e: any) { setErr(e.message); } };
  const needItems = (c: NeedCard): MenuItem[] => {
    const p = c.item.proposal;
    return [
      { heading: c.title },
      { label: "Open", icon: "ri-file-list-3-line", onSelect: () => (c.task_id && c.kind !== "workflow" ? openTask(c.task_id, "approvals") : setDetail(c)) },
      p && p.status === "pending" && { label: "Approve", icon: "ri-check-line", onSelect: () => quick(() => api(`/proposals/${p.id}/decide`, { body: { decision: "approve", note: "" } })) },
      p && { label: "Discuss with the helper", icon: "ri-chat-3-line", onSelect: async () => { const th = await api<{ id: string }>("/threads", { body: { scope: "proposal", ref_id: p.id } }); openThread(th.id); } },
      c.kind === "workflow" && c.item.status === "open" && { label: c.item.workflow?.type === "proposal" ? "Approve and switch on" : "Approve", icon: "ri-check-line", onSelect: () => quick(() => api(`/inbox/${c.id}/decide`, { body: { decision: "approved" } })) },
      c.kind === "workflow" && c.item.workflow?.workflow && { label: "Open the workflow", icon: "ri-flow-chart", onSelect: () => router.push(`/workflows/?id=${(c.item.workflow!.workflow as any).id}`) },
      c.kind === "question" && { label: "Answer…", icon: "ri-question-answer-line", onSelect: () => (c.task_id && c.kind !== "workflow" ? openTask(c.task_id, "approvals") : setDetail(c)) },
      sep,
      ...SNOOZES.map(([label, icon, body]) => ({ label: `Snooze: ${label}`, icon, onSelect: () => quick(() => api(`/inbox/${c.id}/snooze`, { body })) })),
      { label: "Ask the Chief of Staff", icon: "ri-user-star-line", onSelect: () => askCos(c.id).catch((e) => setErr(e.message)) },
      sep,
      c.kind === "alert" && { label: "Dismiss", icon: "ri-close-circle-line", onSelect: () => quick(() => api(`/inbox/${c.id}/dismiss`, { body: {} })) },
      c.task_id && { label: "Open the job", icon: "ri-list-check-3", onSelect: () => openTask(c.task_id!) },
      { label: "Copy the text", icon: "ri-file-copy-line", onSelect: () => copy(`${c.title}\n\n${c.summary}`) },
      sep,
      { heading: c.staff.name },
      ...helperItems(c.staff),
    ].filter(Boolean) as MenuItem[];
  };

  if (!b) return err ? <Err error={err} /> : <p className="small">Loading…</p>;
  return (
    <>
      <Err error={err} />
      <div className="board">
        <Column title="Needs you" count={b.needs.length} icon={<i className="ri-user-voice-line bcol-i needs" />} empty="Nothing waiting on you.">
          {b.needs.map((c) => (
            <Card key={c.id} c={c} open={open.has(c.id)} onToggle={() => toggle(c.id)} onOpen={() => (c.task_id && c.kind !== "workflow" ? openTask(c.task_id, "approvals") : setDetail(c))}
              items={() => needItems(c)}
              indicator={<i className={`ri-time-line bc-ind ${c.level === "critical" || c.blocking ? "crit" : "wait"}`} />}
              time={dur(since(c.since, now))}
              tag={<div className="bc-tags"><span className={`chip ${c.kind === "alert" ? "down" : c.kind === "question" ? "warn" : c.kind === "workflow" ? "run" : "outline"}`}>{KIND[c.kind] || c.kind}</span>
                {c.blocking && <span className="chip warn">Blocking</span>}{c.item.proposal && c.item.proposal.risk === "high" && <span className="chip down">High risk</span>}</div>} />
          ))}
        </Column>
        <Column title="Running" count={b.running.length} icon={<span className="spin bcol-i" />} empty="No helper is working right now.">
          {b.running.map((c) => (
            <Card key={c.id} c={c} open={open.has(c.id)} onToggle={() => toggle(c.id)} onOpen={() => openTask(c.id)}
              items={() => taskItems({ id: c.id, staff_id: c.staff.id, brief: `${c.title}\n${c.summary}`, status: c.status }, c.staff.name, load)}
              indicator={c.status === "queued" ? <i className="ri-hourglass-line bc-ind wait" title="Waiting for a free spot" /> : <span className="spin bc-ind" />}
              time={c.status === "queued" ? "queued" : dur(since(c.started_at, now))} />
          ))}
        </Column>
        <Column title="Done" count={b.done.length} icon={<i className="ri-checkbox-circle-line bcol-i done" />} empty="Finished jobs from the last two days show here.">
          {b.done.map((c) => (
            <Card key={c.id} c={c} open={open.has(c.id)} onToggle={() => toggle(c.id)} onOpen={() => openTask(c.id)}
              items={() => taskItems({ id: c.id, staff_id: c.staff.id, brief: c.title, status: c.status }, c.staff.name, load)}
              indicator={<span className={`bc-dot ${c.status === "done" ? "ok" : c.status === "failed" ? "bad" : "off"}`} title={c.status} />}
              time={dur(c.seconds)} />
          ))}
        </Column>
      </div>

      <Drawer open={!!detail} onClose={closeDetail} wide
        icon={detail ? <Avatar who={detail.staff} size={28} /> : null}
        title={detail?.title || ""} sub={detail ? `${detail.staff.name} · ${KIND[detail.kind] || detail.kind} · waiting ${dur(since(detail.since, now))}` : ""}
        footer={detail && <>{detail.task_id && <Link className="btn quiet" href={`/chat/?view=work&task=${detail.task_id}`}><i className="ri-external-link-line" />Open the job</Link>}<span className="sp" /><button className="btn" onClick={closeDetail}>Close</button></>}>
        {detail && <div className="dw-sec"><InboxItemDetail item={detail.item} onDone={() => { setDetail(null); load(); onCount(); }} /></div>}
      </Drawer>
    </>
  );
}

function ListView({ onCount }: { onCount: () => void }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [filter, setFilter] = useState("open");
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setItems(await api<InboxItem[]>(`/inbox?status=${filter}`)); } catch (e: any) { setErr(e.message); }
  }, [filter]);
  usePoll(load, 30000, [load], (n) => n?.kind === "inbox" || n?.kind?.startsWith("job"));
  return (
    <div className="sec" style={{ marginTop: 0 }}>
      <div className="sechead">
        <div className="seg">{[["open", "Open"], ["snoozed", "Snoozed"], ["done", "Done"], ["all", "All"]].map(([s, l]) => <button key={s} className={filter === s ? "on" : ""} onClick={() => setFilter(s)}>{l}</button>)}</div>
      </div>
      <Err error={err} />
      {items.length === 0 ? <Empty title={filter === "open" ? "Nothing waiting" : "No items"} text={filter === "open" ? "Your helpers have nothing for you right now." : "Nothing here yet."} /> : items.map((i) => (
        <div key={i.id} className={`item ${open === i.id ? "open" : ""}`}>
          <div className="h" onClick={() => setOpen(open === i.id ? null : i.id)} onContextMenu={menu(() => {
            const p = i.proposal; const act = (f: () => Promise<unknown>) => f().then(() => { load(); onCount(); }).catch((e) => setErr(e.message));
            return [{ heading: i.title },
              { label: open === i.id ? "Close" : "Open", icon: "ri-file-list-3-line", onSelect: () => setOpen(open === i.id ? null : i.id) },
              p && p.status === "pending" && { label: "Approve", icon: "ri-check-line", onSelect: () => act(() => api(`/proposals/${p.id}/decide`, { body: { decision: "approve", note: "" } })) },
              p && { label: "Discuss with the helper", icon: "ri-chat-3-line", onSelect: async () => { const th = await api<{ id: string }>("/threads", { body: { scope: "proposal", ref_id: p.id } }); openThread(th.id); } },
              ...(i.status === "open" ? SNOOZES.map(([label, icon, body]) => ({ label: `Snooze: ${label}`, icon, onSelect: () => act(() => api(`/inbox/${i.id}/snooze`, { body })) })) : []),
              i.status === "open" && { label: "Ask the Chief of Staff", icon: "ri-user-star-line", onSelect: () => askCos(i.id).catch((e) => setErr(e.message)) },
              i.kind === "alert" && i.status === "open" && { label: "Dismiss", icon: "ri-close-circle-line", onSelect: () => act(() => api(`/inbox/${i.id}/dismiss`, { body: {} })) },
              !!i.task_id && { label: "Open the job", icon: "ri-list-check-3", onSelect: () => openTask(i.task_id!) },
              { label: "Copy the text", icon: "ri-file-copy-line", onSelect: () => copy(`${i.title}\n\n${i.body}`) },
              ...(i.staff_id ? [sep, ...helperItems({ id: i.staff_id })] : [])];
          })}>
            <span className={`chip ${i.kind === "alert" ? "down" : i.kind === "question" ? "warn" : "outline"}`}>{KIND[i.kind] || i.kind}</span>
            {i.blocking && <span className="chip warn">Blocking</span>}
            <div className="t"><Lineage l={(i as any).lineage} /><b>{i.title}</b><span className="small">{i.staff_id} · {ago(i.created_at)}{i.proposal ? ` · ${i.proposal.type}` : ""}</span></div>
            {i.proposal && <StatusChip status={i.proposal.status} />}
          </div>
          {open === i.id && <div className="b"><InboxItemDetail item={i} onDone={() => { setOpen(null); load(); onCount(); }} /></div>}
        </div>
      ))}
    </div>
  );
}

export default function Inbox() {
  const { refresh } = useOverview();
  const [view, setView] = useState<"board" | "list" | "map">("board");
  useEffect(() => { try { const v = localStorage.getItem("omilo.inbox.view"); if (v === "list" || v === "board" || v === "map") setView(v); } catch { /* ignore */ } }, []);
  const pick = (v: "board" | "list" | "map") => { setView(v); try { localStorage.setItem("omilo.inbox.view", v); } catch { /* ignore */ } };
  return (
    <div className="inbox-page">
      <div className="sechead" style={{ alignItems: "flex-end", marginBottom: 16 }}>
        <div><h1 style={{ marginBottom: 4 }}>Inbox</h1>
          <p className="sub" style={{ margin: 0 }}>Your helpers propose, you decide. Whatever you approve is done exactly as written.</p></div>
        <span className="sp" />
        <div className="seg" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "board"} className={view === "board" ? "on" : ""} onClick={() => pick("board")}><i className="ri-layout-column-line" /> Board</button>
          <button role="tab" aria-selected={view === "list"} className={view === "list" ? "on" : ""} onClick={() => pick("list")}><i className="ri-list-unordered" /> List</button>
          <button role="tab" aria-selected={view === "map"} className={view === "map" ? "on" : ""} onClick={() => pick("map")}><i className="ri-node-tree" /> Map</button>
        </div>
      </div>
      {view === "board" ? <BoardView onCount={refresh} /> : view === "list" ? <ListView onCount={refresh} /> : <WorkMap />}
    </div>
  );
}
