"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

/* Claude Code is the engine helpers run on: with your Claude API key, or on the subscription pool.
   It gives them files and commands in the folders you share, the web, and every connector (a browser too).
   Saga OS installs it with one click; this shows its state. */

export type CliInfo = { path: string | null; version: string | null; node: boolean; install: { state: "idle" | "running" | "done" | "failed"; log: string[] } };

export default function ClaudeCodeSetup({ autoInstall, onReady }: { autoInstall?: boolean; onReady?: (ready: boolean) => void }) {
  const [c, setC] = useState<CliInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const x = (await api<{ cli: CliInfo }>("/harness")).cli; setC(x); return x; } catch (e: any) { setErr(e.message); return null; }
  }, []);
  const install = useCallback(async () => {
    setErr(null);
    try { await api("/harness/install", { body: {} }); await load(); } catch (e: any) { setErr(e.message); }
  }, [load]);

  useEffect(() => {
    load().then((x) => { if (x && !x.path && x.node && autoInstall && x.install.state === "idle") install(); });
  }, [load, install, autoInstall]);
  useEffect(() => {
    if (c?.install.state !== "running") return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [c?.install.state, load]);
  useEffect(() => { onReady?.(!!c?.path); }, [c?.path, onReady]);

  if (!c) return <p className="small">Checking Claude Code…</p>;
  const running = c.install.state === "running";
  return (
    <div className="q">
      <b>Claude Code</b>
      <span className="hint">The engine your helpers work in: it reads and edits files in the folders you share, runs safe commands, searches the web
        and uses your connectors (add the Browser connector for websites). Saga OS installs it for you.</span>
      {c.path && !running ? (
        <div className="callout ok" style={{ margin: "6px 0 0" }}>✓ Ready{c.version ? ` · ${c.version}` : ""}</div>
      ) : running ? (
        <div className="callout" style={{ margin: "6px 0 0" }}>
          <b>Installing Claude Code…</b> This takes a minute the first time.
          <pre className="code" style={{ marginTop: 8, maxHeight: 160 }}>{c.install.log.join("\n") || "starting…"}</pre>
        </div>
      ) : (
        <>
          {!c.node && <div className="error">Claude Code needs Node.js on this computer (nodejs.org, version 18 or newer). Install it, then come back.</div>}
          {c.install.state === "failed" && <pre className="code" style={{ marginTop: 6, maxHeight: 140 }}>{c.install.log.join("\n")}</pre>}
          <button type="button" className="btn primary" disabled={!c.node} onClick={install} style={{ marginTop: 6 }}>
            {c.install.state === "failed" ? "Try again" : "Install Claude Code"}</button>
        </>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
}
