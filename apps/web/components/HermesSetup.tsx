"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

/* Hermes is the engine that gives helpers a browser, terminal, web, skills and memory.
   Saga OS installs and runs it; this shows its state and installs it with one click. */

export type HermesInfo = {
  installed: boolean; path: string | null; version: string | null; python_ok: boolean;
  install: { state: "idle" | "running" | "done" | "failed"; log: string[]; started_at: number | null };
  browser: { ready: boolean; helper: string | null; chrome: string | null; node: boolean };
};

export default function HermesSetup({ autoInstall, onReady }: { autoInstall?: boolean; onReady?: (ready: boolean) => void }) {
  const [h, setH] = useState<HermesInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const x = await api<HermesInfo>("/hermes"); setH(x); return x; } catch (e: any) { setErr(e.message); return null; }
  }, []);
  const install = useCallback(async (browserOnly = false) => {
    setErr(null);
    try { await api("/hermes/install", { body: { browser_only: browserOnly } }); await load(); } catch (e: any) { setErr(e.message); }
  }, [load]);

  useEffect(() => {
    load().then((x) => { if (x && !x.installed && autoInstall && x.install.state === "idle") install(); });
  }, [load, install, autoInstall]);
  useEffect(() => {
    if (h?.install.state !== "running") return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [h?.install.state, load]);
  useEffect(() => { onReady?.(!!h?.installed); }, [h?.installed, onReady]);

  if (!h) return <p className="small">Checking the AI workspace…</p>;
  const running = h.install.state === "running";
  return (
    <div className="q">
      <b>AI workspace (Hermes)</b>
      <span className="hint">Hermes is what lets your helpers use a web browser, search the internet, run tools and remember things. Saga OS installs and runs it for you.</span>
      {h.installed && !running ? (
        <>
          <div className="callout ok" style={{ margin: "6px 0 0" }}>✓ Ready{h.version ? ` · ${h.version}` : ""}</div>
          {h.browser.ready ? (
            <p className="small" style={{ margin: "6px 0 0" }}>✓ Web browser ready{h.browser.chrome ? " (using the browser on this computer)" : ""}</p>
          ) : (
            <p className="small" style={{ margin: "6px 0 0" }}>
              {h.browser.node ? "The web browser for helpers is not set up yet. " : "The web browser needs Node.js (nodejs.org). Everything else works. "}
              {h.browser.node && <button type="button" className="btn" onClick={() => install(true)}>Set up web browser</button>}
            </p>
          )}
        </>
      ) : running ? (
        <div className="callout" style={{ margin: "6px 0 0" }}>
          <b>Setting up the AI workspace…</b> This takes a few minutes the first time. You can keep this page open.
          <pre className="code" style={{ marginTop: 8, maxHeight: 160 }}>{h.install.log.join("\n") || "starting…"}</pre>
        </div>
      ) : (
        <>
          {h.install.state === "failed" && (
            <div className="error">
              Setup did not finish. {h.python_ok ? "" : "Your computer needs Python 3.11–3.13 (on a Mac: brew install python@3.12). "}
              <pre className="code" style={{ marginTop: 6, maxHeight: 140 }}>{h.install.log.join("\n")}</pre>
            </div>
          )}
          <button type="button" className="btn primary" onClick={() => install()} style={{ marginTop: 6 }}>
            {h.install.state === "failed" ? "Try again" : "Set up the AI workspace"}
          </button>
        </>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
}
