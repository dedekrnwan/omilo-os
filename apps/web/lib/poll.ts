"use client";
import { useEffect, useRef } from "react";

/** Run `fn` now and then every `ms` (a number, or a function re-read after each run so pages can poll fast only while
 *  something is happening). Pauses while the tab is hidden and runs at once when it comes back. Returns nothing;
 *  `nudge` events (window "saga:notice" matching `onNotice`) trigger an immediate run. */
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
    window.addEventListener("saga:notice", note);
    window.addEventListener("saga:changed", changed);
    return () => {
      dead = true; if (timer) clearTimeout(timer); if (soon) clearTimeout(soon);
      document.removeEventListener("visibilitychange", vis); window.removeEventListener("saga:notice", note); window.removeEventListener("saga:changed", changed);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Ask pollers watching `url` (a thread or task id works too) to refresh now, e.g. right after sending a message. */
export const kick = (url: string) => window.dispatchEvent(new CustomEvent("saga:notice", { detail: { kind: "local", url } }));

/* Every successful change made through api() (and changes in other tabs) is announced as "saga:changed". */
let chan: BroadcastChannel | null = null;
if (typeof window !== "undefined") {
  try {  // one channel object: it hears the other tabs, never itself
    chan = new BroadcastChannel("saga-changes");
    chan.onmessage = (e) => window.dispatchEvent(new CustomEvent("saga:changed", { detail: e.data }));
  } catch { /* old browser */ }
}
export function announceChange(path: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("saga:changed", { detail: { path } }));
  try { chan?.postMessage({ path }); } catch { /* closed */ }
}
