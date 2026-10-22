"use client";
import { useEffect, useRef, useState } from "react";
import { BASE } from "./api";

/** True while the API is reachable. api() dispatches "omilo:online"/"omilo:offline" on each call;
 *  we also listen to the browser's native online/offline events. usePoll keeps retrying on its own
 *  interval, so the banner clears automatically on the next successful request — no extra retry here. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("omilo:online", on);
    window.addEventListener("omilo:offline", off);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if (typeof navigator !== "undefined" && navigator.onLine === false) setOnline(false);
    return () => {
      window.removeEventListener("omilo:online", on);
      window.removeEventListener("omilo:offline", off);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Run `fn` now and then every `ms` (a number, or a function re-read after each run so pages can poll fast only while
 *  something is happening). Pauses while the tab is hidden and runs at once when it comes back. Returns nothing;
 *  `nudge` events (window "omilo:notice" matching `onNotice`) trigger an immediate run. */
export function usePoll(fn: () => unknown, ms: number | (() => number), deps: unknown[] = [], onNotice?: (n: any) => boolean) {
  const f = useRef(fn); f.current = fn;
  const m = useRef(ms); m.current = ms;
  const match = useRef(onNotice); match.current = onNotice;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let dead = false, busy = false;
    const delay = () => (typeof m.current === "function" ? m.current() : m.current);
    const run = async () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (dead) return;
      if (!document.hidden && !busy) { busy = true; try { await f.current(); } catch { /* next time */ } busy = false; }
      if (!dead && !document.hidden) timer = setTimeout(run, delay());
    };
    const vis = () => { if (!document.hidden) run(); };
    let soon: ReturnType<typeof setTimeout> | null = null;
    const later = () => { if (soon) clearTimeout(soon); soon = setTimeout(() => { soon = null; run(); }, 150); };
    // a server notice: the page's own filter decides; without one, anything that changed data refreshes it
    const note = (e: Event) => {
      const n = (e as CustomEvent).detail;
      if (match.current ? match.current(n) : n?.kind && n.kind !== "local" && n.kind !== "test") later();
    };
    const changed = () => later();  // you changed something (here or in another tab): every live view catches up
    run();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("omilo:notice", note);
    window.addEventListener("omilo:changed", changed);
    return () => {
      dead = true; if (timer) clearTimeout(timer); if (soon) clearTimeout(soon);
      document.removeEventListener("visibilitychange", vis); window.removeEventListener("omilo:notice", note); window.removeEventListener("omilo:changed", changed);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Ask pollers watching `url` (a thread or task id works too) to refresh now, e.g. right after sending a message. */
export const kick = (url: string) => window.dispatchEvent(new CustomEvent("omilo:notice", { detail: { kind: "local", url } }));

/** Subscribe to /api/board/stream (SSE, ch:office) and call `onTick` each time the server emits a 'tick'.
 *  Reconnects automatically on disconnect (browser EventSource handles retry). */
export function useBoardStream(onTick: () => void) {
  const cb = useRef(onTick); cb.current = onTick;
  useEffect(() => {
    if (typeof EventSource === "undefined") return; // SSR or old browser
    const es = new EventSource(`${BASE}/api/board/stream`, { withCredentials: true });
    es.addEventListener("tick", () => cb.current());
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/* Every successful change made through api() (and changes in other tabs) is announced as "omilo:changed". */
let chan: BroadcastChannel | null = null;
if (typeof window !== "undefined") {
  try {  // one channel object: it hears the other tabs, never itself
    chan = new BroadcastChannel("omilo-changes");
    chan.onmessage = (e) => window.dispatchEvent(new CustomEvent("omilo:changed", { detail: e.data }));
  } catch { /* old browser */ }
}
export function announceChange(path: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("omilo:changed", { detail: { path } }));
  try { chan?.postMessage({ path }); } catch { /* closed */ }
}
