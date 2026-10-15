"use client";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { usePoll } from "@/lib/poll";
import { api } from "@/lib/api";

/* Live agent runs: status, reasoning, tool calls, sources, browser and usage, rendered like an agent at work. */

export type RunEvent = { id: number; at: string; kind: string; staff_id: string; data: Record<string, any> };
export type Run = { id: number; start: string; end?: string; events: RunEvent[]; state: "running" | "done" | "failed" };

/** Split a stream of events into runs (each starts with status=started). */
export function toRuns(events: RunEvent[]): Run[] {
  const runs: Run[] = [];
  for (const e of events) {
    if (e.kind === "status" && e.data.state === "started") {
      runs.push({ id: e.id, start: e.at, events: [e], state: "running" });
      continue;
    }
    if (!runs.length) runs.push({ id: e.id, start: e.at, events: [], state: "running" });
    const r = runs[runs.length - 1];
    r.events.push(e);
    if (e.kind === "status" && (e.data.state === "done" || e.data.state === "failed")) { r.state = e.data.state; r.end = e.at; }
  }
  return runs;
}

/** Poll /api/events for a task or a chat thread. */
export function useEvents(q: { task_id?: string; thread_id?: string } | null, every = 1500) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const key = q ? JSON.stringify(q) : "";
  const st = useRef({ after: 0, lastNew: 0, running: false, key: "" });
  useEffect(() => { setEvents([]); st.current = { after: 0, lastNew: 0, running: false, key }; }, [key]);
  // fast while a run is going (or just produced something), slow when idle; paused while the tab is hidden
  usePoll(async () => {
    if (!q) return;
    const k = key;
    const p = new URLSearchParams({ ...(q as Record<string, string>), after: String(st.current.after) });
    const got = await api<RunEvent[]>(`/events?${p}`);
    if (st.current.key !== k || !got.length) return;
    const first = st.current.after === 0;
    st.current.after = got[got.length - 1].id;
    if (!first) st.current.lastNew = Date.now(); // history loaded on open does not count as activity
    for (const e of got) {
      if (e.kind !== "status") continue;
      if (e.data.state === "done" || e.data.state === "failed") st.current.running = false;
      // a start older than 15 minutes without an end is a run that died, not one in progress
      else if (e.data.state === "started" || e.data.state === "switching") st.current.running = Date.now() - new Date(e.at).getTime() < 15 * 60_000;
    }
    setEvents((x) => [...x, ...got]);
  }, () => (st.current.running || Date.now() - st.current.lastNew < 20000 ? every : 8000), [key, every],
  (n) => !!q && ((q.thread_id && n?.url?.includes(q.thread_id)) || (q.task_id && n?.url?.includes(q.task_id))));
  return events;
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** Tool calls arrive twice from some engines (running, then done): keep the latest per id. */
function steps(events: RunEvent[]): RunEvent[] {
  const out: RunEvent[] = [];
  const byId = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "tool" && e.data.id) {
      const i = byId.get(e.data.id);
      if (i !== undefined) { out[i] = e; continue; }
      byId.set(e.data.id, out.length);
    }
    out.push(e);
  }
  return out;
}

function toolLabel(name: string, input: Record<string, any>): { icon: string; text: string } {
  const n = name.toLowerCase();
  if (n.includes("websearch") || n.includes("web_search")) return { icon: "ri-search-line", text: `Searched the web${input.query ? `: ${input.query}` : ""}` };
  if (n.includes("webfetch") || n.includes("web_fetch") || n.includes("browser_navigate")) return { icon: "ri-global-line", text: `Opened ${input.url ? host(input.url) : "a page"}` };
  if (n.includes("browser")) return { icon: "ri-window-line", text: `Browser: ${name.split(/__|_/).slice(-1)[0]}` };
  if (n.startsWith("saga-os")) {
    const t = name.split("·").pop()!.trim();
    const map: Record<string, [string, string]> = {
      get_context: ["ri-book-open-line", "Read the company files"], get_task: ["ri-task-line", "Read the task"],
      checkpoint: ["ri-flag-line", `Saved progress${input.next ? ` · next: ${input.next}` : ""}`], report: ["ri-file-text-line", "Wrote the report"],
      propose: ["ri-inbox-archive-line", `Sent for your approval: ${input.title || ""}`], request_action: ["ri-shield-check-line", `Asked permission: ${input.action || ""}`],
      ask_founder: ["ri-question-line", "Asked you a question"], create_task: ["ri-share-forward-line", `Handed work to ${input.staff_id || "a helper"}`],
      offer_choices: ["ri-list-radio", "Gave you options"], mark_executed: ["ri-check-double-line", "Confirmed it was done"],
      post_message: ["ri-chat-1-line", "Posted an update"], update_kpi: ["ri-line-chart-line", `Updated ${input.name || "a number"}`],
    };
    const [icon, text] = map[t] || ["ri-tools-line", t];
    return { icon, text };
  }
  if (n === "read" || n === "glob" || n === "grep") return { icon: "ri-file-search-line", text: `${name} ${input.file_path || input.pattern || ""}` };
  if (n === "edit" || n === "write") return { icon: "ri-edit-line", text: `${name} ${input.file_path || ""}` };
  if (n === "bash") return { icon: "ri-terminal-box-line", text: `Ran ${String(input.command || "").slice(0, 60)}` };
  return { icon: "ri-tools-line", text: name };
}

function Step({ e }: { e: RunEvent }) {
  const [open, setOpen] = useState(false);
  const d = e.data;
  if (e.kind === "thinking") return <div className="think"><i className="ri-lightbulb-line" /> {String(d.text).slice(0, 1200)}</div>;
  if (e.kind === "sources") return (
    <div className="srcs">{(d.items || []).map((s: any) => (
      <a key={s.url} className="src" href={s.url} target="_blank" rel="noopener noreferrer"><span className="fav">{host(s.url).slice(0, 1).toUpperCase()}</span><span>{s.title && s.title !== s.url ? s.title : host(s.url)}</span></a>
    ))}</div>
  );
  if (e.kind === "status" && d.state === "switching") return (
    <div className="step"><i className="ri-swap-line" /><span className="st"><span className="lbl">Switched to another account ({d.reason}{d.account ? ` on ${d.account}` : ""}). Work continues where it stopped.</span></span></div>
  );
  if (e.kind === "status" && d.state === "harness") return (
    <div className="step"><i className="ri-stack-line" /><span className="st"><span className="lbl small">Using {d.account}</span></span></div>
  );
  if (e.kind === "tool") {
    const { icon, text } = toolLabel(String(d.name), d.input || {});
    const running = d.state === "running";
    return (
      <div className="step click" onClick={() => setOpen(!open)}>
        {running ? <span className="spin" style={{ width: 12, height: 12, marginTop: 3 }} /> : <i className={icon} style={{ color: d.ok === false ? "var(--bad)" : undefined }} />}
        <span className="st">
          <span className="lbl">{text}{d.decision && d.decision !== "allowed" ? <span className="chip warn" style={{ marginLeft: 6 }}>{d.decision}</span> : null}</span>
          {open && <pre>{JSON.stringify({ input: d.input, output: d.output }, null, 2).slice(0, 4000)}</pre>}
        </span>
        {d.ms !== undefined && <span className="meta">{d.ms} ms</span>}
      </div>
    );
  }
  return null;
}

export function RunCard({ run, live = true, compact = false }: { run: Run; live?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [now, setNow] = useState(Date.now());
  const running = run.state === "running";
  useEffect(() => { if (!running) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [running]);
  const evs = steps(run.events);
  const shown = evs.filter((e) => ["thinking", "tool", "sources"].includes(e.kind) || (e.kind === "status" && ["switching", "harness"].includes(e.data.state)));
  const started = run.events.find((e) => e.kind === "status" && e.data.state === "started");
  const usage = [...run.events].reverse().find((e) => e.kind === "usage")?.data;
  const draft = running ? [...run.events].reverse().find((e) => e.kind === "draft")?.data : null;
  const secs = Math.max(0, Math.round(((run.end ? new Date(run.end).getTime() : now) - new Date(run.start).getTime()) / 1000));
  const nTools = evs.filter((e) => e.kind === "tool").length;
  const isOpen = open ?? (running || compact);
  const failed = run.state === "failed";
  const err = run.events.find((e) => e.kind === "status" && e.data.state === "failed")?.data.error;
  return (
    <div className="run">
      <div className="rhead" onClick={() => setOpen(!isOpen)}>
        {running ? <span className="spin" /> : <i className={failed ? "ri-close-circle-fill" : "ri-checkbox-circle-fill"} style={{ color: failed ? "var(--bad)" : "var(--ok)" }} />}
        <span className={running && live ? "shimmer" : ""} style={{ fontWeight: 500 }}>{running ? "Working" : failed ? "Stopped" : "Worked"}</span>
        <span className="small">{secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`}{nTools ? ` · ${nTools} step${nTools === 1 ? "" : "s"}` : ""}</span>
        <span className="sp" />
        {started?.data.engine && <span className="chip">{started.data.engine}</span>}
        <i className={isOpen ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
      </div>
      {isOpen && (shown.length > 0 || draft || err) && (
        <div className="steps">
          {shown.map((e) => <Step key={e.id} e={e} />)}
          {draft?.thinking && <div className="think">{String(draft.thinking).slice(-600)}</div>}
          {draft?.text && <div style={{ padding: "6px 12px", opacity: .75 }}><Markdown text={String(draft.text).slice(-1500)} /></div>}
          {err && <div className="step"><i className="ri-error-warning-line" style={{ color: "var(--bad)" }} /><span className="st small">{err}</span></div>}
        </div>
      )}
      {usage && <Meter u={usage} />}
    </div>
  );
}

export function Meter({ u }: { u: Record<string, any> }) {
  const tokens = Number(u.tokens || 0);
  const pct = Math.min(100, (tokens / 200000) * 100);
  return (
    <div className="meter" title="Tokens used in this run, compared with a 200k context window">
      <span><i className="ri-cpu-line" /> {tokens.toLocaleString()} tokens</span>
      <span className="bar"><i style={{ width: `${Math.max(pct, tokens ? 1 : 0)}%` }} /></span>
      {Number(u.cost_usd) > 0 && <span>${Number(u.cost_usd).toFixed(4)}</span>}
      {u.seconds !== undefined && <span>{u.seconds}s</span>}
    </div>
  );
}

/** Pages the helper opened, newest first. */
export function browserTrail(events: RunEvent[]) {
  return events.filter((e) => e.kind === "browser").reverse().map((e) => e.data as { url: string; title?: string; image?: string });
}
