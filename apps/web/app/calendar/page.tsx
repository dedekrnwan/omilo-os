"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Avatar, { lookFor, useLooks } from "@/components/Avatar";
import Drawer from "@/components/Drawer";
import { useOverview } from "@/components/Shell";
import { Err } from "@/components/ui";
import { ago, api } from "@/lib/api";
import { openTask } from "@/lib/open";
import { usePoll } from "@/lib/poll";
import { DAYS, Day, MONTHS, addDays, dayKey, dayLabel, dayOf, dow, hhmm, instant, sameDay, today, wall } from "@/lib/tz";

/* The calendar: when each helper works. Regular jobs come from their schedules, jobs that ran or are running sit where
   they happened, and scheduled workflows show too. Month, week and day views; on the right, everything coming up,
   oldest first, loading more as you scroll. Times are on the company's clock. */

type Ev = { id: string; kind: "shift" | "task" | "workflow" | "workflow_run"; ref_id: string; staff_id: string | null; staff: string;
  title: string; detail: string; start: string; end: string; status: string; recurring: boolean; cron?: string; origin?: string;
  shift_id?: string | null; workflow_id?: string; now?: boolean; role?: string; brief?: string; when?: string; outcome?: string;
  seconds?: number | null; cost_usd?: number; tokens?: number; typical_min?: number; ai_steps?: number };
type View = "month" | "week" | "day";

const HOUR = 44; // px per hour in week and day views
const KINDS: [string, string, string][] = [["shift", "Regular", "Runs of regular jobs (from their schedules)"], ["task", "One-off", "Jobs queued, running or done"],
  ["workflow", "Workflows", "Scheduled workflows and their runs"]];
const STATUS: Record<string, string> = { scheduled: "Scheduled", queued: "Waiting for a free spot", running: "Running", done: "Done",
  failed: "Failed", cancelled: "Cancelled", skipped: "Skipped", paused: "Paused", waiting: "Waiting", };

function useColor() {
  const looks = useLooks();
  return useCallback((e: Ev) => (e.staff_id ? lookFor({ id: e.staff_id, name: e.staff }, looks[e.staff_id]).color : "#64748b"), [looks]);
}

function range(view: View, anchor: Day): [Day, number] {
  if (view === "day") return [anchor, 1];
  if (view === "week") return [addDays(anchor, -dow(anchor)), 7];
  const first = { ...anchor, d: 1 };
  return [addDays(first, -dow(first)), 42];
}

function title(view: View, anchor: Day, tz: string) {
  if (view === "month") return `${MONTHS[anchor.m - 1]} ${anchor.y}`;
  if (view === "day") return `${dayLabel(anchor, tz)} · ${anchor.d} ${MONTHS[anchor.m - 1]} ${anchor.y}`;
  const [s] = range("week", anchor);
  const e = addDays(s, 6);
  return s.m === e.m ? `${s.d}–${e.d} ${MONTHS[s.m - 1]} ${s.y}` : `${s.d} ${MONTHS[s.m - 1].slice(0, 3)} – ${e.d} ${MONTHS[e.m - 1].slice(0, 3)} ${e.y}`;
}

/* ---------------------------------------------------------- who does it: the helper's own mascot on every event */
type Who = { id: string; name: string; is_chief?: boolean };
const WhoCtx = createContext<Record<string, Who>>({});

/* ---------------------------------------------------------- hover card: more about an event, without a click */
type Hover = { e: Ev; r: DOMRect } | null;
const HoverCtx = createContext<(e: Ev | null, el?: HTMLElement) => void>(() => {});

/** Props that make any element show the hover card for `e` (mouse and keyboard focus; touch uses the click). */
function useHoverable(e: Ev) {
  const show = useContext(HoverCtx);
  return {
    onPointerEnter: (x: React.PointerEvent<HTMLElement>) => { if (x.pointerType !== "touch") show(e, x.currentTarget); },
    onPointerLeave: () => show(null),
    onFocus: (x: React.FocusEvent<HTMLElement>) => show(e, x.currentTarget),
    onBlur: () => show(null),
  };
}

const ORIGIN: Record<string, string> = { shift: "Regular job", manual: "Asked by you", chat: "From a chat", delegation: "Handed out by a helper",
  execution: "Doing what you approved", revision: "Revising a proposal", answer: "After your answer", followup: "After your answer" };
const dur = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);

const kindLabel = (e: Ev) => (e.kind === "workflow" ? "Scheduled workflow" : e.kind === "workflow_run" ? "Workflow run"
  : e.kind === "shift" || e.shift_id ? "Regular job" : "One-off job");

function HoverCard({ h, tz, color }: { h: Hover; tz: string; color: (e: Ev) => string }) {
  const card = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!h || !card.current) { setPos(null); return; }
    const c = card.current.getBoundingClientRect(), r = h.r, pad = 10, vw = window.innerWidth, vh = window.innerHeight;
    let left: number, top: number;
    if (r.right + pad + c.width <= vw - pad) { left = r.right + pad; top = r.top; }          // beside, on the right
    else if (r.left - pad - c.width >= pad) { left = r.left - pad - c.width; top = r.top; }  // beside, on the left
    else {                                                                                     // no room beside: below, or above
      left = Math.min(Math.max(pad, r.left), vw - c.width - pad);
      top = r.bottom + 8 + c.height <= vh - pad ? r.bottom + 8 : r.top - 8 - c.height;
    }
    top = Math.min(Math.max(pad, top), vh - c.height - pad);
    setPos({ left, top });
  }, [h]);
  if (!h) return null;
  const e = h.e;
  const start = new Date(e.start), end = new Date(e.end);
  const future = start.getTime() > Date.now();
  const length = e.seconds != null ? dur(e.seconds) : e.typical_min ? `about ${e.typical_min} min` : dur((end.getTime() - start.getTime()) / 1000);
  return (
    <div ref={card} className={`cal-hover st-${e.status}`} role="tooltip" style={{ "--c": color(e), left: pos?.left ?? -9999, top: pos?.top ?? -9999 } as React.CSSProperties}>
      <div className="ch-head">
        <Face e={e} size={44} />
        <div className="ch-who"><b>{e.staff}</b><span>{kindLabel(e)}{e.role && e.role.replace(/[-_]/g, " ").toLowerCase() !== e.staff.toLowerCase() ? ` · ${e.role}` : ""}</span></div>
        <span className={`chip st-${e.status}`}>{STATUS[e.status] || e.status}</span>
      </div>
      <div className="ch-title">{e.title}</div>
      <div className="ch-rows">
        <div><i className="ri-time-line" /><span>{dayLabel(dayOf(e.start, tz), tz)}, {hhmm(e.start, tz)}–{hhmm(e.end, tz)}
          <em> · {e.status === "running" ? "running for " + dur((Date.now() - start.getTime()) / 1000) : future ? length : e.seconds != null ? `took ${length}` : length}</em></span></div>
        {e.when && <div><i className="ri-repeat-line" /><span>{e.when}</span></div>}
        {e.kind === "task" && e.origin && !e.shift_id && <div><i className="ri-user-line" /><span>{ORIGIN[e.origin] || e.origin}</span></div>}
        {future && <div><i className="ri-hourglass-line" /><span>Starts {ago(e.start)}</span></div>}
        {!!e.cost_usd && <div><i className="ri-coins-line" /><span>${e.cost_usd.toFixed(e.cost_usd < 0.1 ? 3 : 2)}{e.tokens ? ` · ${e.tokens.toLocaleString()} tokens` : ""}</span></div>}
        {e.kind === "workflow_run" && e.ai_steps != null && <div><i className="ri-sparkling-line" /><span>{e.ai_steps ? `${e.ai_steps} AI step${e.ai_steps > 1 ? "s" : ""}` : "No AI steps: free"}</span></div>}
      </div>
      {e.brief && <p className="ch-brief">{e.brief}</p>}
      {e.outcome && <p className={`ch-out ${e.status === "failed" ? "bad" : ""}`}><i className={e.status === "failed" ? "ri-error-warning-line" : "ri-checkbox-circle-line"} />{e.outcome}</p>}
      <div className="ch-foot">Click for actions</div>
    </div>
  );
}

/** The face of an event: the helper's mascot (working while the job runs, asleep while it is paused), or the
 *  workflow mark for automations that run without a helper. */
function Face({ e, size }: { e: Ev; size: number }) {
  const team = useContext(WhoCtx);
  if (!e.staff_id) return <span className="cal-wf" style={{ width: size, height: size }} aria-hidden><i className="ri-flow-chart" /></span>;
  const who = team[e.staff_id] || { id: e.staff_id, name: e.staff };
  return <Avatar who={who} size={size} state={e.status === "running" ? "working" : e.status === "paused" ? "sleeping" : null}
    mood={e.status === "failed" ? "sad" : null} />;
}

/* ---------------------------------------------------------- one event, as a chip (month) or a block (time grid) */
function Chip({ e, color, tz, onOpen }: { e: Ev; color: string; tz: string; onOpen: (e: Ev) => void }) {
  return (
    <button className={`cal-chip st-${e.status}`} style={{ "--c": color } as React.CSSProperties} onClick={(x) => { x.stopPropagation(); onOpen(e); }}
      aria-label={`${hhmm(e.start, tz)} ${e.title}, ${e.staff}`} {...useHoverable(e)}>
      <Face e={e} size={16} /><span className="t">{hhmm(e.start, tz)}</span><span className="n">{e.title}</span>
    </button>
  );
}

function Block({ e, h, tz, style, onOpen }: { e: Ev; h: number; tz: string; style: React.CSSProperties; onOpen: (e: Ev) => void }) {
  return (
    <button className={`cal-block st-${e.status}`} onClick={() => onOpen(e)} style={style} aria-label={`${hhmm(e.start, tz)}–${hhmm(e.end, tz)} ${e.title}, ${e.staff}`}
      {...useHoverable(e)}>
      <span className="cal-block-t"><Face e={e} size={h >= 34 ? 20 : 16} /><b>{e.title}</b></span>
      {h >= 40 && <span className="cal-block-s">{hhmm(e.start, tz)} · {e.staff}</span>}
    </button>
  );
}

function UpItem({ e, tz, color, onOpen }: { e: Ev; tz: string; color: string; onOpen: (e: Ev) => void }) {
  return (
    <button className={`cal-up st-${e.status}`} style={{ "--c": color } as React.CSSProperties} onClick={() => onOpen(e)} {...useHoverable(e)}>
      <span className="when">{e.now ? (e.status === "running" ? "running" : "queued") : hhmm(e.start, tz)}</span>
      <Face e={e} size={30} />
      <span className="what"><b>{e.title}</b><span>{e.staff}{e.kind === "workflow" ? "" : e.recurring ? " · regular job" : ""}</span></span>
    </button>
  );
}

function lanes(evs: { e: Ev; top: number; h: number }[]) {
  // overlapping blocks share the width: greedy columns inside each cluster of overlaps
  const out: { e: Ev; top: number; h: number; col: number; cols: number }[] = [];
  let cluster: typeof out = [];
  let end = -1;
  const flush = () => { const n = Math.max(1, ...cluster.map((c) => c.col + 1)); cluster.forEach((c) => (c.cols = n)); out.push(...cluster); cluster = []; };
  for (const x of [...evs].sort((a, b) => a.top - b.top || b.h - a.h)) {
    if (x.top >= end) { flush(); end = -1; }
    const used = new Set(cluster.filter((c) => c.top + c.h > x.top).map((c) => c.col));
    let col = 0;
    while (used.has(col)) col++;
    cluster.push({ ...x, col, cols: 1 });
    end = Math.max(end, x.top + x.h);
  }
  flush();
  return out;
}

function TimeGrid({ days, events, tz, color, onOpen, now }: { days: Day[]; events: Ev[]; tz: string; color: (e: Ev) => string; onOpen: (e: Ev) => void; now: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const t = today(tz);
  const nowW = wall(now, tz);
  const hasToday = days.some((d) => sameDay(d, t));
  useEffect(() => { // open where it matters: just before now when today is in view, else at 07:00
    if (scroller.current) scroller.current.scrollTop = hasToday ? Math.max(0, (nowW.h - 1.5) * HOUR) : HOUR * 7 - 8;
  }, [days.length, days[0] && dayKey(days[0]), hasToday]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="cal-time">
      <div className="cal-time-h" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
        <span />
        {days.map((d) => (
          <span key={dayKey(d)} className={sameDay(d, t) ? "today" : ""}><b>{DAYS[dow(d)]}</b><em>{d.d}</em></span>
        ))}
      </div>
      <div className="cal-time-b" ref={scroller}>
        <div className="cal-time-g" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))`, height: HOUR * 24 }}>
          <div className="cal-hours">{Array.from({ length: 24 }, (_, h) => <span key={h} style={{ top: h * HOUR }}>{h ? `${String(h).padStart(2, "0")}:00` : ""}</span>)}</div>
          {days.map((d) => {
            const start = instant(d.y, d.m, d.d, 0, 0, tz).getTime();
            const end = instant(addDays(d, 1).y, addDays(d, 1).m, addDays(d, 1).d, 0, 0, tz).getTime();
            const mine = events.filter((e) => new Date(e.start).getTime() < end && new Date(e.end).getTime() > start).map((e) => {
              const a = Math.max(new Date(e.start).getTime(), start), b = Math.min(new Date(e.end).getTime(), end);
              // place by the wall clock (not elapsed time), so days with a daylight-saving change still line up with the hours
              const wa = wall(a, tz), wb = wall(b, tz);
              const from = wa.h * 60 + wa.mi, to = b >= end ? 24 * 60 : wb.h * 60 + wb.mi;
              const top = (from / 60) * HOUR;
              return { e, top, h: Math.max(20, (Math.max(to - from, 0) / 60) * HOUR) };
            });
            return (
              <div key={dayKey(d)} className={`cal-col ${sameDay(d, t) ? "today" : ""}`}>
                {lanes(mine).map(({ e, top, h, col, cols }) => (
                  <Block key={e.id} e={e} h={h} tz={tz} onOpen={onOpen}
                    style={{ top, height: h - 2, left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, "--c": color(e) } as React.CSSProperties} />
                ))}
                {sameDay(d, t) && <div className="cal-now" style={{ top: ((nowW.h * 60 + nowW.mi) / 60) * HOUR }} aria-label="Now" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ start, anchor, events, tz, color, onOpen, onDay }: { start: Day; anchor: Day; events: Ev[]; tz: string; color: (e: Ev) => string;
  onOpen: (e: Ev) => void; onDay: (d: Day) => void }) {
  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of events) { const k = dayKey(dayOf(e.start, tz)); m.set(k, [...(m.get(k) || []), e]); }
    return m;
  }, [events, tz]);
  const t = today(tz);
  return (
    <div className="cal-month">
      <div className="cal-month-h">{DAYS.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="cal-month-g">
        {Array.from({ length: 42 }, (_, i) => addDays(start, i)).map((d) => {
          const list = byDay.get(dayKey(d)) || [];
          return (
            <div key={dayKey(d)} className={`cal-cell ${d.m !== anchor.m ? "out" : ""} ${sameDay(d, t) ? "today" : ""}`} onClick={() => onDay(d)}
              role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onDay(d); }} aria-label={`${d.d} ${MONTHS[d.m - 1]}: ${list.length} events`}>
              <span className="num">{d.d}</span>
              {list.slice(0, 3).map((e) => <Chip key={e.id} e={e} color={color(e)} tz={tz} onOpen={onOpen} />)}
              {list.length > 3 && <span className="more">+{list.length - 3} more</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- the right-hand list: what comes next, loading as you scroll */
function Upcoming({ tz, staffId, color, onOpen, stamp, tick }: { tz: string; staffId: string; color: (e: Ev) => string; onOpen: (e: Ev) => void;
  stamp: number; tick: number }) {
  type Cursor = { after: string; after_id: string } | null;
  const [items, setItems] = useState<Ev[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const next = useRef<Cursor>(null);
  const loading = useRef(false);
  const gen = useRef(0);

  const load = useCallback(async (more: boolean) => {
    if (loading.current && more) return;
    if (more && !next.current) return;
    const g = more ? gen.current : ++gen.current;
    loading.current = true; setBusy(true); setFailed(false);
    try {
      const q = new URLSearchParams({ limit: "25", ...(staffId ? { staff_id: staffId } : {}), ...(more && next.current ? next.current : {}) });
      const r = await api<{ items: Ev[]; next: Cursor }>(`/calendar/upcoming?${q}`);
      if (g !== gen.current) return; // a fresh reload started meanwhile
      setItems((x) => (more ? [...x, ...r.items] : r.items));
      next.current = r.next;
      setDone(!r.next);
    } catch {
      if (g === gen.current) setFailed(true); // stop loading on its own; the owner can retry
    } finally {
      if (g === gen.current) { loading.current = false; setBusy(false); }
    }
  }, [staffId]);

  useEffect(() => { next.current = null; setDone(false); load(false); }, [load, stamp]);
  useEffect(() => { // jobs changed: refresh, unless the owner has scrolled down the list (don't pull it from under them)
    if (tick > 1 && (box.current?.scrollTop ?? 0) < 40) { next.current = null; setDone(false); load(false); }
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { // load the next page when the end of the list scrolls into view
    const el = end.current;
    if (!el) return;
    const io = new IntersectionObserver((ents) => { if (ents[0].isIntersecting && !failed) load(true); }, { root: box.current, rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [load, failed]);

  // group items by their day label for v2 grouped display
  const groups: { head: string; evs: Ev[] }[] = [];
  for (const e of items) {
    const head = e.now ? "Now" : dayLabel(dayOf(e.start, tz), tz);
    const last = groups[groups.length - 1];
    if (last && last.head === head) last.evs.push(e);
    else groups.push({ head, evs: [e] });
  }
  return (
    <aside className="cal-side" aria-label="Coming up">
      <div className="cal-side-h"><b>Coming up</b><span className="small">{tz}</span></div>
      <div className="cal-side-b" ref={box}>
        {groups.map((g) => (
          <div key={g.head} className="cal-side-group">
            <div className="cal-side-day">{g.head}</div>
            {g.evs.map((e) => <UpItem key={e.id + (e.now ? ":now" : "")} e={e} tz={tz} color={color(e)} onOpen={onOpen} />)}
          </div>
        ))}
        {!items.length && !busy && !failed && (
          <div className="cal-empty"><Avatar who={{ id: staffId || "omilo", name: "Omilo" }} size={48} state="sleeping" />
            <p className="small">Nothing scheduled. Give a helper a regular job in Team.</p></div>
        )}
        <div ref={end} className="cal-side-end">
          {busy ? <span className="spin" /> : failed ? <button className="btn sm" onClick={() => load(items.length > 0)}>Couldn't load. Try again</button>
            : done && items.length ? <span className="small">That's everything in the next year.</span> : null}
        </div>
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------- what you can do with one event */
function Detail({ e, tz, onClose, onChanged }: { e: Ev | null; tz: string; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setErr(null), [e?.id]);
  if (!e) return null;
  const act = async (fn: () => Promise<unknown>, close = true) => {
    setBusy(true); setErr(null);
    try { await fn(); onChanged(); if (close) onClose(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  const shiftId = e.kind === "shift" ? e.ref_id : e.shift_id;
  const day = dayOf(e.start, tz);
  return (
    <Drawer open onClose={onClose} title={e.title}
      sub={`${e.staff} · ${dayLabel(day, tz)} ${hhmm(e.start, tz)}–${hhmm(e.end, tz)}`}
      icon={<Face e={e} size={32} />}
      footer={<><span className="sp" /><button className="btn" onClick={onClose}>Close</button></>}>
      <div className="dw-sec">
        <p><span className={`chip st-${e.status}`}>{STATUS[e.status] || e.status}</span>{" "}
          <span className="small">{e.kind === "shift" ? "A run of a regular job" : e.kind === "task" ? (e.shift_id ? "A run of a regular job" : "A one-off job")
            : e.kind === "workflow" ? "A scheduled workflow run" : "A workflow run"}</span></p>
        {e.detail && <p>{e.detail}</p>}
        {e.cron && <p className="small"><i className="ri-time-line" /> Repeats: <code>{e.cron}</code> ({tz})</p>}
        {e.kind === "shift" && e.status === "scheduled" && <p className="small">Usually takes about {Math.round((new Date(e.end).getTime() - new Date(e.start).getTime()) / 60000)} min.</p>}
        <div className="acts" style={{ marginTop: 14, flexWrap: "wrap" }}>
          {e.kind === "task" && <button className="btn primary" onClick={() => { onClose(); openTask(e.ref_id); }}><i className="ri-external-link-line" />Open the job</button>}
          {e.kind === "shift" && e.status === "scheduled" && <>
            <button className="btn primary" disabled={busy} onClick={() => act(() => api(`/shifts/${e.ref_id}/run`, { body: {} }))}><i className="ri-play-line" />Run now</button>
            <button className="btn" disabled={busy} onClick={() => act(() => api(`/shifts/${e.ref_id}/skip`, { body: { at: e.start } }))}><i className="ri-skip-forward-line" />Skip this run</button>
          </>}
          {e.kind === "shift" && e.status === "skipped" && (
            <button className="btn primary" disabled={busy} onClick={() => act(() => api(`/shifts/${e.ref_id}/skip?at=${encodeURIComponent(e.start)}`, { method: "DELETE" }))}><i className="ri-arrow-go-back-line" />Put this run back</button>
          )}
          {shiftId && e.status !== "paused" && (
            <button className="btn" disabled={busy} onClick={() => act(() => api(`/shifts/${shiftId}`, { method: "PATCH", body: { enabled: false } }))}><i className="ri-pause-line" />Pause this job</button>
          )}
          {shiftId && e.status === "paused" && (
            <button className="btn primary" disabled={busy} onClick={() => act(() => api(`/shifts/${shiftId}`, { method: "PATCH", body: { enabled: true } }))}><i className="ri-play-line" />Resume this job</button>
          )}
          {e.kind === "workflow" && <button className="btn primary" disabled={busy} onClick={() => act(() => api(`/workflows/${e.ref_id}/run`, { body: {} }))}><i className="ri-play-line" />Run now</button>}
          {(e.kind === "workflow" || e.kind === "workflow_run") && (
            <Link className="btn" href={`/workflows/?id=${e.kind === "workflow" ? e.ref_id : e.workflow_id}${e.kind === "workflow_run" ? `&run=${e.ref_id}` : ""}`}><i className="ri-flow-chart" />Open the workflow</Link>
          )}
          {e.staff_id && <Link className="btn quiet" href={`/staff/?id=${e.staff_id}`}><i className="ri-user-line" />{e.staff}</Link>}
        </div>
        <Err error={err} />
      </div>
    </Drawer>
  );
}

/* ---------------------------------------------------------- the page */
export default function CalendarPage() {
  const { overview } = useOverview();
  const [tz, setTz] = useState<string>(overview?.timezone || "UTC");
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchorRaw] = useState<Day>(() => today(overview?.timezone || "UTC"));
  const moved = useRef(false); // until the owner navigates, "today" follows the company's clock once it is known
  const setAnchor = useCallback((a: Day | ((x: Day) => Day)) => { moved.current = true; setAnchorRaw(a); }, []);
  useEffect(() => { // one render with both: the company's clock and today on it
    const z = overview?.timezone;
    if (!z) return;
    setTz(z);
    if (!moved.current) setAnchorRaw(today(z));
  }, [overview?.timezone]);
  const [staffId, setStaffId] = useState("");
  const [kinds, setKinds] = useState<Set<string>>(new Set(["shift", "task", "workflow"]));
  const [events, setEvents] = useState<Ev[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Ev | null>(null);
  const [stamp, setStamp] = useState(0);
  const [now, setNow] = useState(Date.now());
  const color = useColor();
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  useEffect(() => {
    let v: string | null = null;
    try { v = localStorage.getItem("omilo.cal.view"); } catch { /* ignore */ }
    if (v === "month" || v === "week" || v === "day") setView(v);
    else if (window.matchMedia("(max-width: 640px)").matches) setView("day"); // a week of columns is too narrow on a phone
  }, []);
  const pick = (v: View) => { setView(v); try { localStorage.setItem("omilo.cal.view", v); } catch { /* ignore */ } };

  const [start, n] = range(view, anchor);
  const days = useMemo(() => Array.from({ length: n }, (_, i) => addDays(start, i)), [start.y, start.m, start.d, n]); // eslint-disable-line react-hooks/exhaustive-deps
  const req = useRef(0);
  const ready = !!overview?.timezone && tz === overview.timezone; // don't fetch a range on the wrong clock first
  const load = useCallback(async () => {
    if (!ready) return;
    const mine = ++req.current;
    const endD = addDays(start, n);
    const q = new URLSearchParams({
      start: instant(start.y, start.m, start.d, 0, 0, tz).toISOString(), end: instant(endD.y, endD.m, endD.d, 0, 0, tz).toISOString(),
      kinds: [...kinds].flatMap((k) => (k === "workflow" ? ["workflow", "workflow_run"] : [k])).join(","), ...(staffId ? { staff_id: staffId } : {}),
    });
    try {
      const r = await api<{ events: Ev[]; timezone: string }>(`/calendar?${q}`);
      if (mine !== req.current) return; // the view changed while this was loading: a newer answer is coming
      setEvents(r.events); setErr(null);
    } catch (e: any) { setErr(e.message); }
  }, [start.y, start.m, start.d, n, tz, kinds, staffId, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tick, setTick] = useState(0);
  usePoll(async () => { await load(); setTick((t) => t + 1); }, 60000, [load], (x) => x?.kind?.startsWith("job") || x?.kind === "local");
  const changed = () => { load(); setStamp((s) => s + 1); };

  const step = (dir: number) => setAnchor((a) => view === "day" ? addDays(a, dir) : view === "week" ? addDays(a, 7 * dir)
    : (() => { const m = a.m + dir; const y = a.y + Math.floor((m - 1) / 12); return { y, m: ((m - 1) % 12 + 12) % 12 + 1, d: 1 }; })());
  useEffect(() => { // keyboard: ← → move, t today, m/w/d switch view
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey || sel) return;
      if (e.key === "ArrowLeft") step(-1); else if (e.key === "ArrowRight") step(1); else if (e.key === "t") setAnchor(today(tz));
      else if (e.key === "m") pick("month"); else if (e.key === "w") pick("week"); else if (e.key === "d") pick("day");
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const shown = events.filter((e) => kinds.has(e.kind === "workflow_run" ? "workflow" : e.kind));
  const team = useMemo(() => Object.fromEntries((overview?.staff || []).map((s) => [s.id, s])), [overview?.staff]);
  const focus = staffId ? team[staffId] : null;
  const [hover, setHover] = useState<Hover>(null);
  const hoverT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHover = useCallback((e: Ev | null, el?: HTMLElement) => {
    if (hoverT.current) clearTimeout(hoverT.current);
    if (!e || !el) { hoverT.current = setTimeout(() => setHover(null), 60); return; }
    // a short wait, so sweeping the mouse across the grid doesn't flash cards; moving between events switches at once
    hoverT.current = setTimeout(() => setHover({ e, r: el.getBoundingClientRect() }), hover ? 40 : 280);
  }, [hover]);
  useEffect(() => {
    const hide = () => { if (hoverT.current) clearTimeout(hoverT.current); setHover(null); };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, []);
  const open = useCallback((e: Ev) => { if (hoverT.current) clearTimeout(hoverT.current); setHover(null); setSel(e); }, []);
  return (
    <WhoCtx.Provider value={team}>
    <HoverCtx.Provider value={showHover}>
    <div className="cal">
      <div className="cal-main">
        <div className="cal-bar">
          <button className="btn sm" onClick={() => setAnchor(today(tz))}>Today</button>
          <div className="cal-nav">
            <button className="iconbtn" aria-label="Previous" onClick={() => step(-1)}><i className="ri-arrow-left-s-line" /></button>
            <button className="iconbtn" aria-label="Next" onClick={() => step(1)}><i className="ri-arrow-right-s-line" /></button>
          </div>
          <h2 className="cal-title">{title(view, anchor, tz)}{focus && <span className="cal-focus"> · {focus.name}</span>}</h2>
          <span className="sp" />
          <div className="cal-team" role="group" aria-label="Whose schedule">
            <button className={`cal-all ${staffId ? "" : "on"}`} onClick={() => setStaffId("")} aria-pressed={!staffId}>All helpers</button>
            {(overview?.staff || []).map((s) => (
              <button key={s.id} className={`cal-who ${staffId === s.id ? "on" : ""} ${staffId && staffId !== s.id ? "dim" : ""}`}
                aria-pressed={staffId === s.id} title={staffId === s.id ? `${s.name}: show everyone again` : `Only ${s.name}`}
                style={{ "--c": color({ staff_id: s.id, staff: s.name } as Ev) } as React.CSSProperties}
                onClick={() => setStaffId(staffId === s.id ? "" : s.id)}>
                <Avatar who={s} size={26} />
                {staffId === s.id && <span className="nm">{s.name}</span>}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Show">
            {KINDS.map(([k, l, tip]) => (
              <button key={k} className={kinds.has(k) ? "on" : ""} aria-pressed={kinds.has(k)} title={tip}
                onClick={() => setKinds((s) => { const x = new Set(s); if (x.has(k)) { if (x.size > 1) x.delete(k); } else x.add(k); return x; })}>{l}</button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="View">
            {(["month", "week", "day"] as View[]).map((v) => <button key={v} className={view === v ? "on" : ""} onClick={() => pick(v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}
          </div>
        </div>
        <div className="cal-body">
          <Err error={err} />
          {view === "month"
            ? <MonthGrid start={start} anchor={anchor} events={shown} tz={tz} color={color} onOpen={open} onDay={(d) => { setAnchor(d); pick("day"); }} />
            : <TimeGrid days={days} events={shown} tz={tz} color={color} onOpen={open} now={now} />}
          <Upcoming tz={tz} staffId={staffId} color={color} onOpen={open} stamp={stamp} tick={tick} />
        </div>
      </div>
      <Detail e={sel} tz={tz} onClose={() => setSel(null)} onChanged={changed} />
      {!sel && <HoverCard h={hover} tz={tz} color={color} />}
    </div>
    </HoverCtx.Provider>
    </WhoCtx.Provider>
  );
}
