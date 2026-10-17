"use client";
import { useSyncExternalStore } from "react";
import { BASE, api } from "@/lib/api";

/* The shared helper state: one store for the whole app, fed by the office WebSocket (with an HTTP fallback).
   The Simple view and the Office view both read it, so they always show the same authoritative state. The state
   itself comes from the server (worked out from the records); events are only used to animate what really happened.
   When nothing new arrives, the last known state stays, with how fresh it is. */

export type AgentStatus = "working" | "blocked" | "failed" | "queued" | "idle" | "paused";
export type Agent = {
  id: string; name: string; role: string; is_chief: boolean; department: string; status: AgentStatus; since: string | null;
  current: { kind: "job" | "chat"; task_id?: string; thread_id?: string; brief: string; origin?: string; started_at: string | null;
    tool: { name: string; phase: string; at: string } | null } | null;
  queued: number; waiting: { id: string; kind: string; title: string; task_id: string | null; at: string }[]; waiting_count: number;
  last_failure: { task_id: string; brief: string; error: string; at: string } | null;
  collaborators: { staff_id: string; task_id: string; brief: string; relation: "working_for" | "handed_to"; live: boolean }[];
  last_activity: string | null; next_job: { name: string; at: string } | null;
};
export type OfficeState = { server_time: string; cursor: number; last_event_at: string | null; paused: boolean; departments: { id: string; name: string }[]; agents: Agent[] };
export type OfficeEvent = { id: number; at: string; staff_id: string; kind: string; task_id: string | null; data: Record<string, any> };
export type Conn = "connecting" | "live" | "reconnecting" | "polling" | "offline";

type Snap = {
  state: OfficeState | null; conn: Conn; cursor: number;
  lastEventAt: number | null;   // when the newest real event happened (server clock, ms)
  lastSyncAt: number | null;    // when we last heard from the server (local clock, ms)
  skew: number;                 // server clock minus local clock, ms
  events: OfficeEvent[];        // newest last, at most 200
};

let snap: Snap = { state: null, conn: "offline", cursor: 0, lastEventAt: null, lastSyncAt: null, skew: 0, events: [] };
const subs = new Set<() => void>();
const evSubs = new Set<(evs: OfficeEvent[], replay: boolean) => void>();
const set = (p: Partial<Snap>) => { snap = { ...snap, ...p }; subs.forEach((f) => f()); };

let users = 0, ws: WebSocket | null = null, retry = 0, retryTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null, closeTimer: ReturnType<typeof setTimeout> | null = null, failures = 0;

function applyState(s: OfficeState) {
  const skew = new Date(s.server_time).getTime() - Date.now();
  const last = s.last_event_at ? new Date(s.last_event_at).getTime() : null;
  set({ state: s, cursor: Math.max(snap.cursor, s.cursor), lastSyncAt: Date.now(), skew, lastEventAt: last && (!snap.lastEventAt || last > snap.lastEventAt) ? last : snap.lastEventAt });
}
function applyEvents(evs: OfficeEvent[], replay = false) {
  if (!evs.length) return;
  const fresh = evs.filter((e) => e.id > (replay ? 0 : snap.cursor) && !snap.events.some((x) => x.id === e.id));
  const all = [...snap.events, ...fresh].sort((a, b) => a.id - b.id).slice(-200);
  const newest = all.length ? new Date(all[all.length - 1].at).getTime() : snap.lastEventAt;
  set({ events: all, cursor: Math.max(snap.cursor, ...evs.map((e) => e.id)), lastEventAt: newest, lastSyncAt: Date.now() });
  if (fresh.length) evSubs.forEach((f) => f(fresh, replay));
}

function wsUrl() {
  const override = process.env.NEXT_PUBLIC_OMILO_WS;
  if (override) return override;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${BASE}/api/office/ws`;
}

function connect() {
  if (ws || users === 0) return;
  if (typeof WebSocket === "undefined") return startPolling();
  set({ conn: snap.state ? "reconnecting" : "connecting" });
  let opened = false;
  try { ws = new WebSocket(wsUrl()); } catch { ws = null; return fallback(); }
  ws.onopen = () => { opened = true; retry = 0; failures = 0; stopPolling(); set({ conn: "live" }); if (snap.cursor) ws?.send(JSON.stringify({ type: "hello", after: snap.cursor })); };
  ws.onmessage = (m) => {
    let msg: any; try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.type === "state") applyState(msg.state);
    else if (msg.type === "events") applyEvents(msg.events, !!msg.replay);
    else if (msg.type === "heartbeat") set({ lastSyncAt: Date.now(), skew: new Date(msg.server_time).getTime() - Date.now() });
  };
  ws.onclose = (e) => {
    ws = null;
    if (users === 0) return set({ conn: "offline" });
    if (e.code === 4401) { set({ conn: "offline" }); return; } // signed out
    if (!opened) failures += 1;
    fallback();
  };
  ws.onerror = () => { /* onclose follows */ };
}

function fallback() {
  // keep the view current over HTTP while the socket is down, and keep trying the socket (slower after repeated failures)
  if (failures >= 2) startPolling(); else set({ conn: "reconnecting" });
  const wait = Math.min(30000, 1000 * 2 ** Math.min(retry++, 5)) + Math.random() * 500;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; connect(); }, wait);
}

async function pollOnce() {
  try {
    const [s, e] = await Promise.all([api<OfficeState>("/office/state"), api<{ cursor: number; events: OfficeEvent[] }>(`/office/events?after=${snap.cursor}`)]);
    if (snap.cursor) applyEvents(e.events); else set({ cursor: e.cursor });
    applyState(s);
    if (snap.conn !== "live") set({ conn: "polling" });
  } catch { if (snap.conn !== "live") set({ conn: "offline" }); }
}
function startPolling() {
  if (pollTimer || users === 0) return;
  const tick = async () => { await pollOnce(); if (users > 0 && snap.conn !== "live") pollTimer = setTimeout(tick, document.hidden ? 15000 : 3000); else pollTimer = null; };
  pollTimer = setTimeout(tick, 0);
}
function stopPolling() { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; }

function retain() {
  users += 1;
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  connect();
  if (!snap.state) pollOnce(); // first paint does not wait for the socket
}
function release() {
  users = Math.max(0, users - 1);
  if (users === 0 && !closeTimer) closeTimer = setTimeout(() => {
    closeTimer = null;
    if (users > 0) return;
    ws?.close(); ws = null; stopPolling();
    if (retryTimer) clearTimeout(retryTimer); retryTimer = null;
    set({ conn: "offline" });
  }, 10000);
}

/** Ask the server for a fresh state now (e.g. after you approved something). */
export function resync() {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resync" })); else pollOnce();
}

if (typeof window !== "undefined") {
  window.addEventListener("omilo:changed", () => { if (users > 0) setTimeout(resync, 200); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && users > 0 && !ws) connect(); });
}

const subscribe = (f: () => void) => { subs.add(f); retain(); return () => { subs.delete(f); release(); }; };
const get = () => snap;
const getServer = () => snap;

/** The shared office state; using it keeps the live stream open. */
export function useOffice(): Snap { return useSyncExternalStore(subscribe, get, getServer); }

/** Called with each batch of new, verified events (for animations). Returns an unsubscribe function. */
export function onOfficeEvents(f: (evs: OfficeEvent[], replay: boolean) => void): () => void {
  evSubs.add(f); retain();
  return () => { evSubs.delete(f); release(); };
}
export const officeSnapshot = () => snap;
export function subscribeOffice(f: () => void) { return subscribe(f); }

/* ---------------------------------------------------------------------------- shared labels */
export const STATUS_META: Record<AgentStatus, { label: string; color: string; icon: string; hint: string }> = {
  working: { label: "Working", color: "#2a78d6", icon: "ri-loader-4-line", hint: "A job or chat is running now" },
  blocked: { label: "Waiting on you", color: "#d97706", icon: "ri-hand", hint: "Needs your approval or answer" },
  failed: { label: "Failed", color: "#d03b3b", icon: "ri-close-circle-line", hint: "Its last job failed" },
  queued: { label: "Up next", color: "#7c3aed", icon: "ri-time-line", hint: "A job is queued and starts soon" },
  idle: { label: "Idle", color: "#16a34a", icon: "ri-checkbox-blank-circle-line", hint: "Ready, nothing to do right now" },
  paused: { label: "Paused", color: "#78716c", icon: "ri-pause-line", hint: "Paused by you" },
};

/** "12s ago" from a server timestamp, corrected for clock skew. */
export function freshness(at: number | string | null | undefined, skew = 0): string {
  if (at == null) return "never";
  const t = typeof at === "number" ? at : new Date(at).getTime();
  const s = Math.max(0, Math.round((Date.now() + skew - t) / 1000));
  return s < 5 ? "just now" : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
}
