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
import { helperItems, taskItems } from "@/lib/actions";
import { MenuItem, copy, menu, sep } from "@/lib/menu";
import { openTask, openThread } from "@/lib/open";
import { useBoardStream, usePoll } from "@/lib/poll";
import { confirmDialog } from "@/lib/dialog";

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
const KIND: Record<string, string> = { proposal: "Approval", question: "Question", alert: "Alert", workflow: "Workflow", access_request: "Permission", skill_share: "Skill" };
const BULK_ELIGIBLE = new Set(["proposal", "access_request"]);

type BulkResult = { approved: string[]; denied: string[]; skipped: { id: string; reason: string }[]; needs_confirm: { id: string; risk: string; why: string }[] };

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

function BoardView({ onCount }: { onCount: () => void }) {
  const router = useRouter();
  const [b, setB] = useState<Board | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<NeedCard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [denyDialogOpen, setDenyDialogOpen] = useState(false);
  const [denyNote, setDenyNote] = useState("");
  const load = useCallback(async () => { try { setB(await api<Board>("/board")); setErr(null); } catch (e: any) { setErr(e.message); } }, []);
  usePoll(load, () => (b?.running.length ? 4000 : 20000), [load], (n) => n?.kind === "inbox" || n?.kind === "nudge" || n?.kind?.startsWith("job") || n?.kind === "local");
  useBoardStream(load);
  const now = useNow(!!b?.running.length || !!b?.needs.length);
  const seenIds = useRef<Set<string>>(new Set());
  const detailRef = useRef<NeedCard | null>(null);
  detailRef.current = detail;
  useEffect(() => {
    if (!b) return;
    // opened from a notification (/?item=…): show that item
    const want = new URLSearchParams(location.search).get("item");
    if (want) {
      const c = b.needs.find((x) => x.id === want);
      if (c) { if (c.task_id && c.kind !== "workflow") openTask(c.task_id, "approvals"); else setDetail(c); }
      const u = new URL(location.href); u.searchParams.delete("item"); history.replaceState(history.state, "", u.pathname + u.search);
    }
    // if the inbox drawer is open and the item was resolved elsewhere (e.g. approved in chat),
    // close the drawer so it does not show a stale item
    const cur = detailRef.current;
    if (cur && !b.needs.some((x) => x.id === cur.id)) setDetail(null);
    // looking at the board acknowledges Critical items, so their every-15-minutes reminders stop
    const crit = b.needs.filter((c) => c.level === "critical" && !seenIds.current.has(c.id)).map((c) => c.id);
    if (crit.length && !document.hidden) { crit.forEach((id) => seenIds.current.add(id)); api("/notify/seen", { body: { item_ids: crit } }).catch(() => {}); }
  }, [b]);
  const toggle = (id: string) => setOpen((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const closeDetail = useCallback(() => setDetail(null), []);

  const eligibleNeeds = b?.needs.filter((c) => BULK_ELIGIBLE.has(c.kind)) ?? [];
  const allEligibleSelected = eligibleNeeds.length > 0 && eligibleNeeds.every((c) => selectedIds.has(c.id));

  const toggleSelect = (id: string, e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setSelectedIds((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  };

  const selectAll = () => setSelectedIds(new Set(eligibleNeeds.map((c) => c.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const bulkApprove = async () => {
    if (bulkBusy) return;
    setBulkBusy(true);
    setErr(null);
    try {
      const ids = Array.from(selectedIds);
      const res = await api<BulkResult>("/inbox/bulk", { body: { ids, decision: "approve" } });
      if (res.needs_confirm.length > 0) {
        // The whole batch was held back (nothing applied yet) because some items spend
        // money or send externally. Confirm, then re-send the FULL selection so the
        // low-risk items in it are approved too, not only the high-risk ones.
        const ok = await confirmDialog({
          title: `${res.needs_confirm.length} item${res.needs_confirm.length === 1 ? "" : "s"} need a second look`,
          body: (
            <div>
              <p style={{ margin: "0 0 8px" }}>
                {res.needs_confirm.length === 1 ? "This item" : "These items"} spend money or send messages externally.
                Confirm to approve everything you selected.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, textAlign: "left", fontSize: 13 }}>
                {res.needs_confirm.map((x) => <li key={x.id}>{x.why}</li>)}
              </ul>
            </div>
          ),
          confirm: "Approve everything",
          danger: true,
        });
        if (!ok) return;  // nothing was applied; keep the selection so the owner can adjust it
        const res2 = await api<BulkResult>("/inbox/bulk", { body: { ids, decision: "approve", confirm_high_risk: true } });
        if (res2.skipped.length > 0) setErr(`${res2.skipped.length} item${res2.skipped.length === 1 ? "" : "s"} could not be decided.`);
      } else if (res.skipped.length > 0) {
        setErr(`${res.skipped.length} item${res.skipped.length === 1 ? "" : "s"} could not be decided.`);
      }
      clearSelection();
      await load();
      onCount();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBulkBusy(false);
    }
  };

  const openDenyDialog = () => { setDenyNote(""); setDenyDialogOpen(true); };
  const closeDenyDialog = () => setDenyDialogOpen(false);

  const bulkDeny = async () => {
    if (bulkBusy || !denyNote.trim()) return;
    setBulkBusy(true);
    setErr(null);
    try {
      const ids = Array.from(selectedIds);
      const res = await api<BulkResult>("/inbox/bulk", { body: { ids, decision: "deny", note: denyNote.trim() } });
      if (res.skipped.length > 0) setErr(`${res.skipped.length} item${res.skipped.length === 1 ? "" : "s"} could not be decided.`);
      setDenyDialogOpen(false);
      clearSelection();
      await load();
      onCount();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBulkBusy(false);
    }
  };

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
  // Split the "running" feed: queued tasks get their own group so they don't distract from what is actually running.
  const running = b.running.filter((c) => c.status !== "queued");
  const queued = b.running.filter((c) => c.status === "queued");
  return (
    <>
      <Err error={err} />

      {/* Bulk action bar — appears when items are selected */}
      {selectedIds.size > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Bulk actions">
          <span className="bulk-bar-count">{selectedIds.size} selected</span>
          <button className="btn sm" onClick={allEligibleSelected ? clearSelection : selectAll} disabled={bulkBusy}>
            {allEligibleSelected ? "Deselect all" : "Select all"}
          </button>
          <button className="btn sm" onClick={clearSelection} disabled={bulkBusy}>Clear</button>
          <span className="sp" />
          <button className="btn sm danger" onClick={openDenyDialog} disabled={bulkBusy}>
            <i className="ri-close-line" />Deny
          </button>
          <button className="btn sm primary" onClick={bulkApprove} disabled={bulkBusy}>
            {bulkBusy ? <span className="spin" style={{ width: 12, height: 12 }} /> : <i className="ri-check-line" />}
            Approve
          </button>
        </div>
      )}

      {/* Main + Side two-column layout */}
      <div className="inbox2">
        {/* Main: Needs you */}
        <div className="inbox2-main">
          <div className="inbox2-sec">
            <span className="inbox2-sec-label"><i className="ri-user-voice-line" /> Needs you</span>
            <span className="inbox2-sec-count">{b.needs.length}</span>
          </div>

          {b.needs.length === 0 ? (
            <div className="inbox2-empty">Nothing waiting on you.</div>
          ) : (
            <>
              {/* Bulk-select hint shown above cards when eligible items exist and none selected */}
              {selectedIds.size === 0 && eligibleNeeds.length > 1 && (
                <div className="inbox2-bulk-hint">
                  <button className="btn sm quiet" onClick={selectAll}><i className="ri-checkbox-multiple-line" />Select all approvals and permissions</button>
                  <span className="sp" />
                  <button className="btn sm primary" onClick={() => {
                    const allIds = new Set(eligibleNeeds.map((c) => c.id));
                    setSelectedIds(allIds);
                    // Approve immediately against the full eligible set (don't wait for state flush)
                    const ids = Array.from(allIds);
                    if (!bulkBusy && ids.length > 0) {
                      setBulkBusy(true);
                      setErr(null);
                      api<BulkResult>("/inbox/bulk", { body: { ids, decision: "approve" } }).then(async (res) => {
                        if (res.needs_confirm.length > 0) {
                          const ok = await confirmDialog({
                            title: `${res.needs_confirm.length} item${res.needs_confirm.length === 1 ? "" : "s"} need a second look`,
                            body: (
                              <div>
                                <p style={{ margin: "0 0 8px" }}>
                                  {res.needs_confirm.length === 1 ? "This item" : "These items"} spend money or send messages externally.
                                  Confirm to approve everything you selected.
                                </p>
                                <ul style={{ margin: 0, paddingLeft: 18, textAlign: "left", fontSize: 13 }}>
                                  {res.needs_confirm.map((x) => <li key={x.id}>{x.why}</li>)}
                                </ul>
                              </div>
                            ),
                            confirm: "Approve everything",
                            danger: true,
                          });
                          if (!ok) return;
                          const res2 = await api<BulkResult>("/inbox/bulk", { body: { ids, decision: "approve", confirm_high_risk: true } });
                          if (res2.skipped.length > 0) setErr(`${res2.skipped.length} item${res2.skipped.length === 1 ? "" : "s"} could not be decided.`);
                        } else if (res.skipped.length > 0) {
                          setErr(`${res.skipped.length} item${res.skipped.length === 1 ? "" : "s"} could not be decided.`);
                        }
                        clearSelection();
                        await load();
                        onCount();
                      }).catch((e: any) => setErr(e.message)).finally(() => setBulkBusy(false));
                    }
                  }}>
                    <i className="ri-check-double-line" />Approve all {eligibleNeeds.length}
                  </button>
                </div>
              )}

              {b.needs.map((c) => {
                const eligible = BULK_ELIGIBLE.has(c.kind);
                const checked = selectedIds.has(c.id);
                return (
                  <div key={c.id} className={`bcard-wrap${eligible ? " has-check" : ""}${checked ? " bcard-wrap-sel" : ""}`}>
                    {eligible && (
                      <input
                        type="checkbox"
                        className="bcard-check"
                        checked={checked}
                        readOnly
                        aria-label={`Select ${c.title}`}
                        onClick={(e) => toggleSelect(c.id, e)}
                        onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleSelect(c.id, e); } }}
                      />
                    )}
                    <Card c={c} open={open.has(c.id)} onToggle={() => toggle(c.id)} onOpen={() => (c.task_id && c.kind !== "workflow" ? openTask(c.task_id, "approvals") : setDetail(c))}
                      items={() => needItems(c)}
                      indicator={<i className={`ri-time-line bc-ind ${c.level === "critical" || c.blocking ? "crit" : "wait"}`} />}
                      time={dur(since(c.since, now))}
                      tag={<div className="bc-tags"><span className={`chip ${c.kind === "alert" ? "down" : c.kind === "question" || c.kind === "access_request" ? "warn" : c.kind === "workflow" ? "run" : "outline"}`}>{KIND[c.kind] || c.kind}</span>
                        {c.blocking && <span className="chip warn">Blocking</span>}{c.item.proposal && c.item.proposal.risk === "high" && <span className="chip down">High risk</span>}</div>} />
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Side: Running now + Done today */}
        <div className="inbox2-side">
          {/* Running now section */}
          <div className="inbox2-sec">
            <span className="inbox2-sec-label"><span className="spin inbox2-spin" />Running now</span>
            <span className="inbox2-sec-count">{running.length}</span>
          </div>

          {running.length === 0 ? (
            <div className="inbox2-empty inbox2-idle">No helper is working right now.</div>
          ) : (
            <div className="inbox2-run-list">
              {running.map((c) => (
                <div key={c.id} className="side-item" role="button" tabIndex={0}
                  onClick={() => openTask(c.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(c.id); } }}
                  onContextMenu={menu(() => taskItems({ id: c.id, staff_id: c.staff.id, brief: `${c.title}\n${c.summary}`, status: c.status }, c.staff.name, load))}>
                  <div className="side-item-lead">
                    <Avatar who={c.staff} size={24} />
                    <span className="spin side-status-spin" />
                  </div>
                  <div className="side-item-body">
                    <span className="side-item-title">{c.title}</span>
                    <span className="side-item-meta">
                      {c.staff.name} · {dur(since(c.started_at, now))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Queued section — waiting for a free spot, kept apart from what's actually running */}
          {queued.length > 0 && (
            <>
              <div className="inbox2-sec inbox2-sec-queued">
                <span className="inbox2-sec-label"><i className="ri-hourglass-line" />Queued</span>
                <span className="inbox2-sec-count">{queued.length}</span>
              </div>
              <div className="inbox2-run-list">
                {queued.map((c) => (
                  <div key={c.id} className="side-item" role="button" tabIndex={0}
                    onClick={() => openTask(c.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(c.id); } }}
                    onContextMenu={menu(() => taskItems({ id: c.id, staff_id: c.staff.id, brief: `${c.title}\n${c.summary}`, status: c.status }, c.staff.name, load))}>
                    <div className="side-item-lead">
                      <Avatar who={c.staff} size={24} />
                      <i className="ri-hourglass-line side-status-icon wait" title="Queued" />
                    </div>
                    <div className="side-item-body">
                      <span className="side-item-title">{c.title}</span>
                      <span className="side-item-meta">
                        {c.staff.name} · queued
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Done today section */}
          <div className="inbox2-sec inbox2-sec-done">
            <span className="inbox2-sec-label"><i className="ri-checkbox-circle-line inbox2-done-icon" /> Done today</span>
            <span className="inbox2-sec-count">{Math.min(b.done.length, 10)}</span>
          </div>

          {b.done.length === 0 ? (
            <div className="inbox2-empty">Finished jobs from the last two days show here.</div>
          ) : (
            <div className="inbox2-done-list">
              {b.done.slice(0, 10).map((c) => (
                <div key={c.id} className="side-item side-item-done" role="button" tabIndex={0}
                  onClick={() => openTask(c.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(c.id); } }}
                  onContextMenu={menu(() => taskItems({ id: c.id, staff_id: c.staff.id, brief: c.title, status: c.status }, c.staff.name, load))}>
                  <div className="side-item-lead">
                    <Avatar who={c.staff} size={22} />
                  </div>
                  <div className="side-item-body">
                    <span className="side-item-title">{c.title}</span>
                    <span className="side-item-meta">
                      <span className={`bc-dot ${c.status === "done" ? "ok" : c.status === "failed" ? "bad" : "off"}`} style={{ display: "inline-block", marginRight: 4, verticalAlign: "1px" }} />
                      {dur(c.seconds)}{c.searches ? ` · ${c.searches} sources` : ""}{c.steps.length ? ` · ${c.steps.length} steps` : ""}
                    </span>
                  </div>
                  <span className={`chip ${c.status === "done" ? "up" : c.status === "failed" ? "down" : "outline"} side-done-chip`}>
                    {c.status === "done" ? "Done" : c.status === "failed" ? "Failed" : c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {denyDialogOpen && (
        <div className="dlg-scrim" role="dialog" aria-modal="true" aria-labelledby="deny-dlg-title" onClick={(e) => { if (e.target === e.currentTarget) closeDenyDialog(); }}>
          <div className="dlg danger">
            <div className="dlg-icon"><i className="ri-close-circle-line" /></div>
            <h2 id="deny-dlg-title">Deny {selectedIds.size} item{selectedIds.size === 1 ? "" : "s"}</h2>
            <p className="dlg-body">Add a short reason. The helper sees this note.</p>
            <textarea
              className="deny-note-input"
              rows={3}
              placeholder="Reason for denying"
              value={denyNote}
              onChange={(e) => setDenyNote(e.target.value)}
              autoFocus
              style={{ width: "100%", marginTop: 12, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line-strong)", font: "inherit", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
            />
            <div className="dlg-acts">
              <button className="btn" onClick={closeDenyDialog} disabled={bulkBusy}>Cancel</button>
              <button className="btn danger-solid" onClick={bulkDeny} disabled={bulkBusy || !denyNote.trim()}>
                {bulkBusy ? <span className="spin" style={{ width: 12, height: 12 }} /> : null}
                Deny {selectedIds.size === 1 ? "it" : "all"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Drawer open={!!detail} onClose={closeDetail} wide
        icon={detail ? <Avatar who={detail.staff} size={28} /> : null}
        title={detail?.title || ""} sub={detail ? `${detail.staff.name} · ${KIND[detail.kind] || detail.kind} · waiting ${dur(since(detail.since, now))}` : ""}
        footer={detail && <>{detail.item.proposal ? <button className="btn quiet" onClick={async () => { try { const th = await api<{ id: string }>("/threads", { body: { scope: "proposal", ref_id: detail.item.proposal!.id } }); openThread(th.id); } catch (e: any) { setErr(e.message); } }}><i className="ri-external-link-line" />Open the chat</button> : detail.task_id ? <Link className="btn quiet" href={`/chat/?view=work&task=${detail.task_id}`}><i className="ri-external-link-line" />Open the job</Link> : null}<span className="sp" /><button className="btn" onClick={closeDetail}>Close</button></>}>
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
            <span className={`chip ${i.kind === "alert" ? "down" : i.kind === "question" || i.kind === "access_request" ? "warn" : "outline"}`}>{KIND[i.kind] || i.kind}</span>
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
      {/* Page Header v2 */}
      <div className="ph2">
        <div className="ph2-text">
          <h1 className="ph2-title">Inbox</h1>
          <p className="ph2-sub">Your helpers propose, you decide. Whatever you approve is done exactly as written.</p>
        </div>
        <div className="ph2-actions">
          <div className="seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === "board"} className={view === "board" ? "on" : ""} onClick={() => pick("board")}><i className="ri-focus-3-line" /> Focus</button>
            <button role="tab" aria-selected={view === "list"} className={view === "list" ? "on" : ""} onClick={() => pick("list")}><i className="ri-list-unordered" /> List</button>
            <button role="tab" aria-selected={view === "map"} className={view === "map" ? "on" : ""} onClick={() => pick("map")}><i className="ri-node-tree" /> Map</button>
          </div>
        </div>
      </div>
      {view === "board" ? <BoardView onCount={refresh} /> : view === "list" ? <ListView onCount={refresh} /> : <WorkMap />}
    </div>
  );
}
