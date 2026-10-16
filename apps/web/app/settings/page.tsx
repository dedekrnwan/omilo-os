"use client";
import { usePoll } from "@/lib/poll";
import { useCallback, useEffect, useState } from "react";
import { useOverview } from "@/components/Shell";
import ClaudeSetup, { ClaudeChoice } from "@/components/ClaudeSetup";
import ClaudeCodeSetup from "@/components/ClaudeCodeSetup";
import NotifySettings from "@/components/NotifySettings";
import { Err } from "@/components/ui";
import { api, when } from "@/lib/api";

type AiState = { provider: string; model: string | null; claude_key_hint: string | null;
  staff: Record<string, { provider: string }> };
type Audit = { id: number; at: string; actor: string; action: string; ref: string; detail: Record<string, unknown> };

export default function Settings() {
  const { overview, refresh } = useOverview();
  const [health, setHealth] = useState<Record<string, { ok: boolean; detail?: string }>>({});
  const [audit, setAudit] = useState<Audit[]>([]);
  const [conc, setConc] = useState<number>(3);
  const [err, setErr] = useState<string | null>(null);
  const [ai, setAi] = useState<AiState | null>(null);
  const [editAi, setEditAi] = useState(false);
  const [claude, setClaude] = useState<ClaudeChoice>({ key: "", model: "", ok: false });
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [ccReady, setCcReady] = useState(false);
  const [light, setLight] = useState(false);
  const load = useCallback(async () => {
    try {
      setAi(await api<AiState>("/ai"));
      setHealth(await api("/health/engines"));
      setAudit(await api<Audit[]>("/audit?limit=100"));
    } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {  // helpers' AI can come up a few seconds after a change
    const t = setInterval(async () => { if (document.hidden) return; try { setHealth(await api("/health/engines")); } catch { /* next time */ } }, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (overview) setConc(overview.max_concurrent_tasks); }, [overview]);
  const set = async (body: Record<string, unknown>) => {
    try { await api("/system", { body }); refresh(); } catch (e: any) { setErr(e.message); }
  };
  const saveAi = async (provider: string) => {
    setErr(null); setAiMsg(null);
    try {
      const isClaude = provider === "claude" || provider === "claude-direct";
      await api("/ai", { body: isClaude ? { provider, api_key: claude.key || undefined, model: claude.model } : { provider } });
      setEditAi(false); setClaude({ key: "", model: "", ok: false });
      setAiMsg(provider === "claude" ? "Saved. Your helpers now run in Claude Code with your API key."
        : provider === "claude-direct" ? "Saved. Your helpers use built-in Claude (web search and Saga's tools)." : "Saved. All helpers are in practice mode.");
      load();
    } catch (e: any) { setErr(e.message); }
  };
  const aiLabel = (p?: string) => ({ claude: "Claude Code with your API key", "claude-direct": "Built-in Claude (light: web and Saga's tools)",
    fake: "Practice mode (no AI)", "claude-code": "Claude Code pool (Harness)", mixed: "Different per helper" } as Record<string, string>)[p || ""] || p;
  if (!overview) return null;
  return (
    <div>
      <h1>Settings</h1>
      <NotifySettings />
      <div className="paper" style={{ marginBottom: 24 }}>
        <h2>AI</h2>
        <p className="note">The AI your helpers think with.</p>
        {ai && (
          <p style={{ margin: "8px 0" }}><b>{aiLabel(ai.provider)}</b>
            {ai.provider === "claude" && ai.model ? <span className="small"> · {ai.model}</span> : null}
            {ai.claude_key_hint ? <span className="small"> · key ending in {ai.claude_key_hint}</span> : null}</p>
        )}
        {aiMsg && <div className="callout ok">{aiMsg}</div>}
        {!editAi ? (
          <div className="acts">
            <button className="btn primary" onClick={() => setEditAi(true)}>{ai?.provider === "claude" || ai?.provider === "claude-direct" ? "Change key or model" : "Use my Claude API key"}</button>
            {ai?.provider !== "fake" && <button className="btn" onClick={() => saveAi("fake")}>Switch to practice mode</button>}
          </div>
        ) : (
          <>
            <ClaudeSetup value={claude} onChange={setClaude} savedHint={ai?.claude_key_hint} />
            {claude.ok && !light && <ClaudeCodeSetup autoInstall onReady={setCcReady} />}
            {claude.ok && !ccReady && (
              <label className="check"><input type="checkbox" checked={light} onChange={(e) => setLight(e.target.checked)} />
                <span>Use built-in Claude for now (nothing to install: web search and Saga&apos;s tools, but no files, commands or browser)</span></label>
            )}
            <div className="acts" style={{ marginTop: 12 }}>
              <button className="btn primary" disabled={!(claude.ok && claude.model && (ccReady || light))}
                onClick={() => saveAi(light ? "claude-direct" : "claude")}>Use Claude for all helpers</button>
              <button className="btn" onClick={() => setEditAi(false)}>Cancel</button>
            </div>
          </>
        )}
        <p className="small" style={{ marginTop: 10 }}>Prefer your Claude subscriptions? Add them on the Harness page and choose the pool per helper under Team.</p>
      </div>
      <div className="grid2">
        <div className="paper">
          <h2>Running</h2>
          <label>All agents</label>
          <button className={`btn ${overview.paused ? "primary" : "danger"}`} onClick={() => set({ paused: !overview.paused })}>{overview.paused ? "Resume everything" : "Pause everything"}</button>
          <label>Strict mode</label>
          <p className="note">On: anything that leaves the company needs your approval, whatever an agent's permissions say.</p>
          <button className="btn" onClick={() => set({ strict_mode: !overview.strict_mode })}>{overview.strict_mode ? "On · turn off" : "Off · turn on"}</button>
          <label>Agents working at the same time</label>
          <div className="acts"><input type="number" min={1} max={100} style={{ width: 100 }} value={conc} onChange={(e) => setConc(Number(e.target.value))} />
            <button className="btn" onClick={() => set({ max_concurrent_tasks: conc })}>Save</button></div>
        </div>
        <div className="paper">
          <h2>Connection check</h2>
          <p className="note">Can each helper reach its AI right now?</p>
          <table><tbody>{Object.entries(health).map(([k, h]) => (
            <tr key={k}><td>{k}</td><td><span className={`chip ${h.ok ? "up" : "down"}`}>{h.ok ? "✓ working" : "✕ not working"}</span></td><td className="small">{h.detail}</td></tr>
          ))}</tbody></table>
        </div>
      </div>
      <div className="sec">
        <h2>Audit log</h2>
        <div className="tw"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Ref</th><th className="hide-sm">Detail</th></tr></thead><tbody>
          {audit.map((a) => (
            <tr key={a.id}><td className="small">{when(a.at)}</td><td className="small">{a.actor}</td><td>{a.action}</td><td className="small">{a.ref}</td>
              <td className="small hide-sm">{JSON.stringify(a.detail).slice(0, 120)}</td></tr>
          ))}
        </tbody></table></div>
      </div>
      <Err error={err} />
    </div>
  );
}
