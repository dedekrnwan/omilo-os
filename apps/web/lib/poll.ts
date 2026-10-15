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
    const note = (e: Event) => { if (match.current?.((e as CustomEvent).detail)) run(); };
    run();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("saga:notice", note);
    return () => { dead = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", vis); window.removeEventListener("saga:notice", note); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Ask pollers watching `url` (a thread or task id works too) to refresh now, e.g. right after sending a message. */
export const kick = (url: string) => window.dispatchEvent(new CustomEvent("saga:notice", { detail: { kind: "local", url } }));
