"use client";
import { useCallback, useEffect, useState } from "react";
import { useOverview } from "@/components/Shell";
import { Err } from "@/components/ui";
import { api, when } from "@/lib/api";

type Audit = { id: number; at: string; actor: string; action: string; ref: string; detail: Record<string, unknown> };

export default function Settings() {
  const { overview, refresh } = useOverview();
  const [health, setHealth] = useState<Record<string, { ok: boolean; detail?: string }>>({});
  const [audit, setAudit] = useState<Audit[]>([]);
  const [conc, setConc] = useState<number>(3);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setHealth(await api("/health/engines"));
      setAudit(await api<Audit[]>("/audit?limit=100"));
    } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (overview) setConc(overview.max_concurrent_tasks); }, [overview]);
  const set = async (body: Record<string, unknown>) => {
    try { await api("/system", { body }); refresh(); } catch (e: any) { setErr(e.message); }
  };
  if (!overview) return null;
  return (
    <div>
      <div className="eyebrow">How the office runs</div>
      <h1>Settings</h1>
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
          <h2>Engines</h2>
          <p className="note">Can each staff agent's engine be reached?</p>
          <table><tbody>{Object.entries(health).map(([k, h]) => (
            <tr key={k}><td>{k}</td><td><span className={`chip ${h.ok ? "up" : "down"}`}>{h.ok ? "✓ reachable" : "✕ down"}</span></td><td className="small">{h.detail}</td></tr>
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
