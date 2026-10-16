"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar, { lookFor, useLooks } from "@/components/Avatar";
import { Markdown } from "@/components/Markdown";
import { BASE, ago, api } from "@/lib/api";
import { Agent, AgentStatus, OfficeEvent, STATUS_META, freshness, onOfficeEvents, useOffice } from "@/lib/office";
import { openTask } from "@/lib/open";
import { describe } from "./describe";
import type { Hover, OfficeApi } from "./engine";

const OfficeCanvas = dynamic(() => import("./OfficeCanvas"), { ssr: false, loading: () => <div className="ov-canvas ov-loading"><span className="small">Opening the office…</span></div> });

const ORDER: AgentStatus[] = ["blocked", "failed", "working", "queued", "idle", "paused"];

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

export function StatusChip({ s }: { s: AgentStatus }) {
  const m = STATUS_META[s];
  return <span className={`ov-st st-${s}`} title={m.hint}><i style={{ background: m.color }} />{m.label}</span>;
}

/** Live / reconnecting / offline, with how fresh the last real event is. */
export function Freshness({ compact = false }: { compact?: boolean }) {
  const o = useOffice();
  useTick(5000);
  const label = o.conn === "live" ? "Live" : o.conn === "polling" ? "Live (polling)" : o.conn === "offline" ? "Offline" : o.conn === "connecting" ? "Connecting" : "Reconnecting";
  const title = `Connection: ${label}. Last event ${freshness(o.lastEventAt, 0)}; last heard from the server ${freshness(o.lastSyncAt, 0)}.`;
  return (
    <span className={`ov-fresh c-${o.conn}`} title={title}>
      <i />{label}{!compact && <span className="small"> · last event {o.lastEventAt ? freshness(o.lastEventAt, 0) : "none yet"}{o.conn !== "live" && o.lastSyncAt ? ` · synced ${freshness(o.lastSyncAt, 0)}` : ""}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ inspector */
type Detail = {
  agent: Agent;
  jobs: { id: string; brief: string; status: string; origin: string; created_at: string; started_at: string | null; ended_at: string | null; error: string; tokens: number; cost_usd: number }[];
  log: { task_id: string; brief: string; status: string; lines: { id: number; at: string; kind: string; text: string; ok: boolean }[] } | null;
  tools: { name: string; calls: number }[];
  output: { task_id: string; brief: string; at: string; text: string } | null;
  events: OfficeEvent[];
};

function Inspector({ id, agents, onClose, nameOf }: { id: string; agents: Agent[]; onClose: () => void; nameOf: (id: string) => string }) {
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"now" | "log" | "jobs" | "output">("now");
  const [err, setErr] = useState<string | null>(null);
  const a = agents.find((x) => x.id === id) || d?.agent;
  const load = useCallback(async () => { try { setD(await api<Detail>(`/office/agent/${id}`)); setErr(null); } catch (e: any) { setErr(e.message); } }, [id]);
  useEffect(() => { setD(null); setTab("now"); load(); }, [load]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = onOfficeEvents((evs) => { if (evs.some((e) => e.staff_id === id)) { if (t) clearTimeout(t); t = setTimeout(load, 500); } });
    return () => { off(); if (t) clearTimeout(t); };
  }, [id, load]);
  useTick(10000);
  if (!a) return null;
  const m = STATUS_META[a.status];
  return (
    <aside className="ov-insp" aria-label={`${a.name} details`}>
      <div className="ov-insp-h">
        <Avatar who={a} size={40} state={a.status === "working" ? "working" : null} />
        <div className="ov-insp-t"><b>{a.name}</b><span className="small">{a.role || (a.is_chief ? "Chief of Staff" : "Helper")}</span></div>
        <button className="iconbtn" aria-label="Close" onClick={onClose}><i className="ri-close-line" /></button>
      </div>
      <div className="ov-insp-st" style={{ borderColor: m.color }}>
        <StatusChip s={a.status} /><span className="small">{a.since ? `since ${ago(a.since)}` : ""}</span><span className="sp" />
        <span className="small" title="When this helper last did anything">active {a.last_activity ? freshness(a.last_activity) : "never"}</span>
      </div>
      <div className="seg ov-tabs" role="tablist">
        {([["now", "Now"], ["log", "Log"], ["jobs", "Jobs"], ["output", "Output"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>))}
      </div>
      <div className="ov-insp-b">
        {err && <p className="small crit">{err}</p>}
        {tab === "now" && (
          <>
            {a.current ? (
              <div className="ov-card">
                <span className="small">{a.current.kind === "chat" ? "Replying in chat" : "Working on"}{a.current.started_at ? ` · ${ago(a.current.started_at)}` : ""}</span>
                <b>{a.current.brief}</b>
                {a.current.tool && <span className="small"><i className="ri-tools-line" /> {a.current.tool.phase === "start" ? "using" : "last used"} {a.current.tool.name} · {freshness(a.current.tool.at)}</span>}
                <div className="acts">{a.current.task_id && <button className="btn sm" onClick={() => openTask(a.current!.task_id!)}><i className="ri-eye-line" />Watch the job</button>}
                  {a.current.thread_id && <Link className="btn sm" href="/chat/">Open chat</Link>}</div>
              </div>
            ) : <p className="small">{a.status === "paused" ? "Paused. Resume it on its page to give it work again." : a.queued ? `${a.queued} job${a.queued > 1 ? "s" : ""} queued, starting soon.` : "Not working on anything right now."}{a.next_job ? ` Next regular job: ${a.next_job.name} ${ago(a.next_job.at).replace(" ago", "")}.` : ""}</p>}
            {a.waiting_count > 0 && (
              <div className="ov-card warn">
                <span className="small"><b>Waiting on you</b> · {a.waiting_count}</span>
                {a.waiting.map((w) => <Link key={w.id} href="/" className="ov-row"><i className={w.kind === "question" ? "ri-question-line" : "ri-checkbox-circle-line"} /><span>{w.title}</span><span className="small">{ago(w.at)}</span></Link>)}
              </div>
            )}
            {a.last_failure && (
              <div className="ov-card bad">
                <span className="small"><b>Last job failed</b> · {ago(a.last_failure.at)}</span>
                <span>{a.last_failure.brief}</span>
                {a.last_failure.error && <span className="mono small ov-err">{a.last_failure.error}</span>}
                <div className="acts"><button className="btn sm" onClick={() => openTask(a.last_failure!.task_id)}>Open the job</button></div>
              </div>
            )}
            {a.collaborators.length > 0 && (
              <div className="ov-card">
                <span className="small"><b>Working with</b></span>
                {a.collaborators.map((c) => (
                  <button key={c.task_id + c.staff_id} className="ov-row" onClick={() => openTask(c.task_id)}>
                    <Avatar who={{ id: c.staff_id, name: nameOf(c.staff_id) }} size={18} />
                    <span>{c.relation === "handed_to" ? `Handed to ${nameOf(c.staff_id)}` : `For ${nameOf(c.staff_id)}`}: {c.brief}</span>
                    {c.live && <span className="ov-live">live</span>}
                  </button>))}
              </div>
            )}
            {d && d.tools.length > 0 && (
              <div className="ov-card"><span className="small"><b>Tools this week</b></span>
                <div className="ov-tools">{d.tools.map((t) => <span key={t.name} className="chip">{t.name}<b>{t.calls}</b></span>)}</div></div>
            )}
            {d && d.events.length > 0 && (
              <div className="ov-card"><span className="small"><b>Recent events</b></span>
                {d.events.slice(0, 10).map((e) => { const x = describe(e, nameOf); return <div key={e.id} className={`ov-ev t-${x.tone}`}><i className={x.icon} /><span>{x.text}</span><span className="small">{freshness(e.at)}</span></div>; })}</div>
            )}
          </>
        )}
        {tab === "log" && (!d ? <p className="small">Loading…</p> : !d.log ? <p className="small">No job has run yet.</p> : (
          <>
            <button className="ov-row" onClick={() => openTask(d.log!.task_id)}><b>{d.log.brief}</b><span className="small">{d.log.status}</span></button>
            <div className="ov-log">{d.log.lines.length === 0 ? <span className="small">Nothing logged yet.</span> : d.log.lines.map((l) => (
              <div key={l.id} className={`ov-ll k-${l.kind} ${l.ok ? "" : "bad"}`}><span className="mono small">{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</span>
                <i className={l.kind === "tool" ? "ri-tools-line" : l.kind === "status" ? "ri-flag-line" : l.kind === "browser" ? "ri-global-line" : "ri-chat-1-line"} /><span>{l.text}</span></div>))}</div>
          </>
        ))}
        {tab === "jobs" && (!d ? <p className="small">Loading…</p> : d.jobs.length === 0 ? <p className="small">No jobs yet.</p> : d.jobs.map((j) => (
          <button key={j.id} className="ov-row ov-job" onClick={() => openTask(j.id)}>
            <span className={`ov-jd s-${j.status}`} /><span><b>{j.brief}</b><span className="small">{j.origin} · {j.status} · {ago(j.ended_at || j.started_at || j.created_at)}{j.tokens ? ` · ${j.tokens.toLocaleString()} tokens` : ""}</span></span>
          </button>)))}
        {tab === "output" && (!d ? <p className="small">Loading…</p> : !d.output ? <p className="small">No finished job with a result yet.</p> : (
          <>
            <button className="ov-row" onClick={() => openTask(d.output!.task_id)}><b>{d.output.brief}</b><span className="small">{ago(d.output.at)}</span></button>
            <div className="paper ov-out"><Markdown text={d.output.text} /></div>
          </>
        ))}
      </div>
      <div className="ov-insp-f">
        <Link className="btn sm" href={`/staff/?id=${a.id}`}><i className="ri-user-settings-line" />Helper page</Link>
        <Link className="btn sm" href="/chat/"><i className="ri-chat-3-line" />Workspace</Link>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ the office mode */
export default function OfficeView() {
  const o = useOffice();
  const looks = useLooks();
  const router = useRouter();
  const apiRef = useRef<OfficeApi | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [ticker, setTicker] = useState<OfficeEvent[]>([]);
  useTick(10000);
  const agents = useMemo(() => o.state?.agents || [], [o.state]);
  const nameOf = useCallback((id: string) => agents.find((a) => a.id === id)?.name || id, [agents]);
  const looksRef = useRef(looks); looksRef.current = looks;

  useEffect(() => onOfficeEvents((evs, replay) => { if (!replay) setTicker((t) => [...t, ...evs.filter((e) => !(e.kind === "tool" && e.data?.phase === "start"))].slice(-30)); }), []);
  useEffect(() => { if (!ticker.length && o.events.length) setTicker(o.events.filter((e) => !(e.kind === "tool" && e.data?.phase === "start")).slice(-30)); }, [o.events, ticker.length]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of agents) c[a.status] = (c[a.status] || 0) + 1;
    return c;
  }, [agents]);
  const depts = useMemo(() => (o.state?.departments || []).map((d) => ({ ...d, agents: agents.filter((a) => a.department === d.id) })), [o.state, agents]);
  const sorted = useMemo(() => [...agents].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name)), [agents]);

  const bridge = useMemo(() => ({
    base: BASE,
    lookOf: (a: Agent) => { const l = lookFor(a, looksRef.current[a.id]); return { color: l.color, shape: l.shape, prop: l.prop }; },
    onSelect: (id: string | null) => setSel(id),
    onOpen: (action: string) => router.push(action),
    onHover: (h: Hover) => setHover(h),
    onReady: (api: OfficeApi) => { apiRef.current = api; },
  }), [router]);

  const pick = (id: string) => { setSel(id); apiRef.current?.select(id); apiRef.current?.focusAgent(id); };
  const goDept = (id: string) => { setDept(id); apiRef.current?.focusZone(id); };
  const hovered = hover?.kind === "agent" ? agents.find((a) => a.id === hover.id) : null;

  return (
    <div className={`ov ${sel ? "with-insp" : ""}`}>
      <nav className="ov-rail" aria-label="Departments and helpers">
        <div className="ov-rail-h"><b>Saga HQ</b><Freshness compact /></div>
        <span className="ov-rail-sec" style={{ paddingTop: 2 }}>Helpers now</span>
        <div className="ov-counts">
          {ORDER.filter((s) => counts[s]).map((s) => <span key={s} className="ov-count" title={STATUS_META[s].hint}><i style={{ background: STATUS_META[s].color }} />{counts[s]} {STATUS_META[s].label.toLowerCase()}</span>)}
        </div>
        <span className="ov-rail-sec">Rooms</span>
        <button className={`ov-dept ${dept === null ? "on" : ""}`} onClick={() => { setDept(null); apiRef.current?.fit(); }}><i className="ri-layout-grid-line" /><span>Whole office</span></button>
        {depts.map((d) => (
          <button key={d.id} className={`ov-dept ${dept === d.id ? "on" : ""}`} onClick={() => goDept(d.id)}>
            <i className="ri-door-open-line" /><span>{d.name}</span>
            <span className="ov-dots">{d.agents.map((a) => <i key={a.id} title={`${a.name}: ${STATUS_META[a.status].label}`} style={{ background: STATUS_META[a.status].color }} />)}</span>
          </button>))}
        <button className="ov-dept" onClick={() => goDept("meeting")}><i className="ri-group-line" /><span>Huddle room</span></button>
        <span className="ov-rail-sec">Helpers</span>
        <div className="ov-people">
          {sorted.map((a) => (
            <button key={a.id} className={`ov-person ${sel === a.id ? "on" : ""}`} onClick={() => pick(a.id)}>
              <Avatar who={a} size={24} state={a.status === "working" ? "working" : null} />
              <span className="ov-pt"><b>{a.name}</b><span className="small">{a.current ? a.current.brief : a.status === "blocked" ? `${a.waiting_count} waiting on you` : a.status === "failed" ? "Last job failed" : STATUS_META[a.status].label}</span></span>
              <i className="ov-pdot" style={{ background: STATUS_META[a.status].color }} title={STATUS_META[a.status].label} />
            </button>))}
        </div>
      </nav>

      <div className="ov-stage">
        <OfficeCanvas bridge={bridge} />
        {!o.state && <div className="ov-empty small">Loading your office…</div>}
        {o.state && agents.length === 0 && <div className="ov-empty"><b>No helpers yet</b><span className="small">Hire your first helper and they get a desk here.</span><Link className="btn sm" href="/talent/">Hire</Link></div>}
        <div className="ov-hud tl"><Freshness /></div>
        <div className="ov-hud tr">
          <button className="iconbtn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => apiRef.current?.zoomBy(1.2)}><i className="ri-zoom-in-line" /></button>
          <button className="iconbtn" aria-label="Zoom out" title="Zoom out (−)" onClick={() => apiRef.current?.zoomBy(1 / 1.2)}><i className="ri-zoom-out-line" /></button>
          <button className="iconbtn" aria-label="Fit the office" title="Fit the office" onClick={() => { setDept(null); apiRef.current?.fit(); }}><i className="ri-fullscreen-exit-line" /></button>
        </div>
        <div className="ov-hud bl ov-legend">
          {(["working", "blocked", "failed", "queued", "idle", "paused"] as AgentStatus[]).map((s) => <span key={s}><i style={{ background: STATUS_META[s].color }} />{STATUS_META[s].label}</span>)}
          <span><b className="ov-dash" />working together</span>
        </div>
        {ticker.length > 0 && (
          <div className="ov-hud br ov-ticker" aria-live="polite">
            {ticker.slice(-4).reverse().map((e) => { const x = describe(e, nameOf); return (
              <button key={e.id} className={`ov-tk t-${x.tone}`} onClick={() => pick(e.staff_id)}><i className={x.icon} /><span>{x.text}</span><span className="small">{freshness(e.at)}</span></button>); })}
          </div>
        )}
        {hover && (
          <div className="ov-tip" style={{ left: hover.x, top: hover.y }}>
            {hover.kind === "object" ? <><b>{hover.label}</b><span>{hover.hint}</span><span className="small">Click to open</span></>
              : hovered && <><b>{hovered.name}</b><StatusChip s={hovered.status} />{hovered.current && <span>{hovered.current.brief}</span>}
                {hovered.current?.tool && <span className="small"><i className="ri-tools-line" /> {hovered.current.tool.name}</span>}
                <span className="small">active {hovered.last_activity ? freshness(hovered.last_activity) : "never"} · click for details</span></>}
          </div>
        )}
      </div>

      {sel && <Inspector id={sel} agents={agents} nameOf={nameOf} onClose={() => { setSel(null); apiRef.current?.select(null); }} />}
    </div>
  );
}
