"use client";
import { usePoll } from "@/lib/poll";
import { useCallback, useEffect, useState } from "react";
import Drawer from "@/components/Drawer";
import { Segments, useMeter } from "@/components/PoolMeter";
import { Err } from "@/components/ui";
import { ago, api } from "@/lib/api";
import { copy, menu, sep } from "@/lib/menu";
import { confirmDialog } from "@/lib/dialog";

/* The harness pool: Claude Code subscriptions that helpers share, with automatic switching on usage limits. */

type Account = { id: string; label: string; token_hint: string; enabled: boolean; state: string; cooldown_until: string | null;
  last_used_at: string | null; last_error: string; runs: number; tokens: number; cost_usd: number; busy: number };
type Pool = { accounts: Account[]; ready: number; total: number; parallel_per_account: number; helpers_on_pool: string[];
  cli: { path: string | null; version: string | null; node: boolean; install: { state: string; log: string[] } } };

const STATE: Record<string, [string, string]> = {
  ready: ["up", "Ready"], new: ["idle", "Not tested"], cooling: ["warn", "Resting"], error: ["down", "Needs sign-in"], disabled: ["idle", "Off"],
};

export default function Harness() {
  const [pool, setPool] = useState<Pool | null>(null);
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const meter = useMeter();
  const [adding, setAdding] = useState(false);
  const closeAdd = useCallback(() => { setAdding(false); setErr(null); }, []);
  const use = (id: string) => meter?.accounts.find((a) => a.id === id);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => { try { setPool(await api<Pool>("/harness")); } catch (e: any) { setErr(e.message); } }, []);
  usePoll(load, 15000, [load]);
  useEffect(() => { if (pool?.cli.install.state !== "running") return; const t = setInterval(load, 2000); return () => clearInterval(t); }, [pool?.cli.install.state, load]);

  const add = async () => {
    setErr(null); setMsg(null);
    try {
      const a = await api<Account>("/harness/accounts", { body: { label, token } });
      setLabel(""); setToken(""); setAdding(false);
      await load();
      if (pool?.cli.path) test(a.id);
    } catch (e: any) { setErr(e.message); }
  };
  const test = async (id: string) => {
    setBusy(id); setErr(null);
    try { const r = await api<{ ok: boolean; detail: string }>(`/harness/accounts/${id}/test`, { body: {} }); setMsg(r.ok ? "The account works." : `Test failed: ${r.detail}`); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const patch = async (id: string, body: Record<string, unknown>) => { await api(`/harness/accounts/${id}`, { method: "PATCH", body }); load(); };
  const remove = async (a: Account) => { if (!(await confirmDialog({ title: `Remove ${a.label} from the pool?`, body: "Helpers stop using this Claude subscription. You can add it again later.", confirm: "Remove", danger: true }))) return; await api(`/harness/accounts/${a.id}`, { method: "DELETE" }); load(); };
  const useForAll = async () => {
    if (!(await confirmDialog({ title: "Run every helper on the pool?", body: "All helpers switch to the Claude Code pool for their next jobs.", confirm: "Switch everyone", icon: "ri-stack-line" }))) return;
    try { await api("/ai", { body: { provider: "claude-code" } }); setMsg("All helpers now run on the Claude Code pool."); load(); } catch (e: any) { setErr(e.message); }
  };

  if (!pool) return <p className="small">Loading…</p>;
  const cli = pool.cli;
  return (
    <div>
      <h1>Harness</h1>
      <p className="sub">Your Claude Code subscriptions, shared by your helpers. Omilo picks a free account for each job; when one reaches its usage limit it rests, and the job continues on another account from where it stopped.</p>

      <div className="stats" style={{ marginBottom: 20 }}>
        <div className="stat"><div className="label">Accounts ready</div><div className="num">{pool.ready}<span className="small"> / {pool.total}</span></div></div>
        <div className="stat"><div className="label">Working now</div><div className="num">{pool.accounts.reduce((n, a) => n + a.busy, 0)}</div><span className="pace">up to {pool.parallel_per_account} jobs per account</span></div>
        <div className="stat"><div className="label">Resting</div><div className="num">{pool.accounts.filter((a) => a.state === "cooling").length}</div><span className="pace">hit a usage limit</span></div>
        <div className="stat"><div className="label">Helpers on the pool</div><div className="num">{pool.helpers_on_pool.length}</div></div>
      </div>

      {meter && meter.total > 0 && (
        <div className="paper" style={{ marginBottom: 16 }}>
          <div className="acts" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <b style={{ fontWeight: 500 }}>Usage this 5-hour window</b>
            <span className="small">{meter.avg_pct != null ? `average ${meter.avg_pct}% · ` : ""}one bar per account</span>
          </div>
          <Segments m={meter} big />
        </div>
      )}

      <div className="paper" style={{ marginBottom: 16 }}>
        <div className="acts" style={{ justifyContent: "space-between" }}>
          <div><b style={{ fontWeight: 500 }}>Claude Code</b>
            <div className="small">{cli.path ? `${cli.version || "installed"} · ${cli.path}` : "Not installed on this computer yet."}</div></div>
          {!cli.path && (cli.node
            ? <button className="btn primary" disabled={cli.install.state === "running"} onClick={async () => { await api("/harness/install", { body: {} }); load(); }}>
                {cli.install.state === "running" ? "Installing…" : "Install Claude Code"}</button>
            : <span className="small">Needs Node.js first: nodejs.org</span>)}
        </div>
        {cli.install.state !== "idle" && !cli.path && <pre className="code" style={{ marginTop: 10 }}>{cli.install.log.join("\n")}</pre>}
      </div>

      <div className="sec" style={{ marginTop: 20 }}>
        <div className="sechead"><h2>Accounts</h2><span className="sp" />
          <button className="btn primary" onClick={() => { setErr(null); setAdding(true); }}><i className="ri-add-line" />Add account</button>
          {pool.total > 0 && <button className="btn" onClick={useForAll}><i className="ri-team-line" />Use the pool for all helpers</button>}</div>
        {pool.accounts.length === 0 ? <div className="empty"><b>No accounts yet</b><span>Add your first Claude Code subscription.</span>
          <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => setAdding(true)}><i className="ri-add-line" />Add account</button></div></div> : (
          <div className="tw"><table>
            <thead><tr><th>Account</th><th>Status</th><th>Used (5 h)</th><th className="hide-sm">Last used</th><th className="num-cell">Jobs</th><th className="num-cell hide-sm">Tokens</th><th></th></tr></thead>
            <tbody>{pool.accounts.map((a) => {
              const [cls, txt] = STATE[a.state] || ["idle", a.state];
              return (
                <tr key={a.id} onContextMenu={menu(() => [{ heading: a.label },
                  { label: "Test the account", icon: "ri-pulse-line", disabled: !cli.path, onSelect: () => test(a.id) },
                  a.state === "cooling" && { label: "Use it again now", icon: "ri-restart-line", hint: "clears the cool-down", onSelect: () => patch(a.id, { clear_cooldown: true }) },
                  { label: a.enabled ? "Turn off" : "Turn on", icon: a.enabled ? "ri-toggle-line" : "ri-toggle-fill", onSelect: () => patch(a.id, { enabled: !a.enabled }) },
                  !!a.last_error && { label: "Copy the last error", icon: "ri-error-warning-line", onSelect: () => copy(a.last_error) },
                  { label: "History in Monitor", icon: "ri-line-chart-line", href: "/monitor/#pool" },
                  sep,
                  { label: "Remove from the pool", icon: "ri-delete-bin-line", danger: true, onSelect: () => remove(a) }])}>
                  <td><b style={{ fontWeight: 500 }}>{a.label}</b><div className="small mono">…{a.token_hint}</div></td>
                  <td><span className={`chip ${cls}`}>{a.busy ? `Working (${a.busy})` : txt}</span>
                    {a.state === "cooling" && a.cooldown_until && <div className="small">until {new Date(a.cooldown_until).toLocaleString()}</div>}
                    {a.last_error && a.state !== "ready" && <div className="small" style={{ maxWidth: 260 }}>{a.last_error.slice(0, 120)}</div>}</td>
                  <td style={{ minWidth: 110 }}>{(() => { const u = use(a.id); if (!u) return null;
                    const p = u.state === "cooling" ? 100 : u.five_hour.pct;
                    return <><span className={`pseg wide ${u.state === "cooling" ? "rest" : p == null ? "unknown" : p >= 90 ? "high" : p >= 70 ? "mid" : "low"}`}><i style={{ width: `${p ?? 0}%` }} /></span>
                      <div className="small">{p == null ? `${u.tokens_5h.toLocaleString()} tokens` : `${p}%${u.five_hour.source === "estimate" ? " (est.)" : ""}`}</div></>; })()}</td>
                  <td className="small hide-sm">{a.last_used_at ? ago(a.last_used_at) : "never"}</td>
                  <td className="num-cell">{a.runs}</td>
                  <td className="num-cell hide-sm">{a.tokens.toLocaleString()}</td>
                  <td><div className="acts" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    <button className="btn sm" disabled={busy === a.id || !cli.path} onClick={() => test(a.id)}>{busy === a.id ? "Testing…" : "Test"}</button>
                    {a.state === "cooling" && <button className="btn sm" onClick={() => patch(a.id, { clear_cooldown: true })}>Use again</button>}
                    <button className="btn sm" onClick={() => patch(a.id, { enabled: !a.enabled })}>{a.enabled ? "Turn off" : "Turn on"}</button>
                    <button className="iconbtn" aria-label="Remove" onClick={() => remove(a)}><i className="ri-delete-bin-line" /></button>
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>

      {msg && <div className="callout ok" style={{ marginTop: 16 }}>{msg}</div>}
      {!adding && <Err error={err} />}

      <Drawer open={adding} onClose={closeAdd} icon={<i className="ri-stack-line" />} title="Add a Claude Code account"
        sub="One subscription you own. Helpers share the pool."
        footer={<><span className="sp" /><button className="btn" onClick={closeAdd}>Cancel</button>
          <button className="btn primary" disabled={!token.trim()} onClick={add}><i className="ri-add-line" />Add to pool</button></>}>
        <div className="dw-sec">
          <label style={{ marginTop: 0 }}>Name</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Max #1 (dede@…)" />
          <label>Token</label>
          <input className="mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="sk-ant-oat01-…"
            onKeyDown={(e) => { if (e.key === "Enter" && token.trim()) add(); }} />
          <p className="dw-help">Stored encrypted. Tokens last a year.</p>
        </div>
        <div className="dw-sec">
          <h3>Get the token (once per account)</h3>
          <ol className="steps">
            <li>Open Terminal on this computer.</li>
            <li>Type <code>claude setup-token</code> and press Enter.</li>
            <li>A browser opens: sign in with the Claude account you want to add.</li>
            <li>Copy the token it prints (starts with <code>sk-ant-</code>) and paste it above.</li>
          </ol>
          <p className="dw-help">Use accounts you own, within the terms of your Claude plan. Omilo tests the account right after adding it.</p>
        </div>
        <Err error={err} />
      </Drawer>
    </div>
  );
}
