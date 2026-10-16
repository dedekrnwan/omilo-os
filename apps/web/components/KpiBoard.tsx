"use client";
import { useCallback, useState } from "react";
import Drawer from "@/components/Drawer";
import { Err } from "@/components/ui";
import { ago, api } from "@/lib/api";
import { copy, menu, sep } from "@/lib/menu";
import { openTask } from "@/lib/open";
import { usePoll } from "@/lib/poll";
import { confirmDialog } from "@/lib/dialog";

/* KPIs on the Company page: the numbers you watch. Each card shows the latest value, the change since the last one,
   how far it is toward its target, a small trend line and where the number came from. You can add a value, edit the
   KPI (target, goal, who keeps it current), look at the history, or ask a helper to fetch the current number. */

export type Kpi = {
  name: string; label: string; unit: string; target: number | null; direction: "up" | "down"; goal_id: string | null; goal: string | null;
  owner: string; owner_name: string; note: string; defined: boolean; value: number | null; period: string; source: string; by: string;
  at: string | null; previous: number | null; progress: number | null;
  history: { id: string; value: number; period: string; source: string; at: string; by: string }[];
};
type Goal = { id: string; title: string; status: string };
type Form = { name: string; isNew: boolean; label: string; unit: string; target: string; direction: "up" | "down"; goal_id: string; owner: string; note: string };

export const fmt = (n: number | null | undefined) => (n == null ? "—" : Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(+n.toFixed(2)));
const thisMonth = () => new Date().toISOString().slice(0, 7);

export function Spark({ values, w = 96, h = 28, good = true }: { values: number[]; w?: number; h?: number; good?: boolean }) {
  if (values.length < 2) return <svg width={w} height={h} className="kpi-spark" aria-hidden />;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - lo) / span) * (h - 6)]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={w} height={h} className={`kpi-spark ${good ? "good" : "bad"}`} aria-hidden>
      <path d={d} fill="none" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.5" />
    </svg>
  );
}

function Delta({ k }: { k: Kpi }) {
  if (k.value == null || k.previous == null) return null;
  const d = k.value - k.previous;
  if (!d) return <span className="kpi-d flat">no change</span>;
  const better = k.direction === "up" ? d > 0 : d < 0;
  const pct = k.previous ? ` (${d > 0 ? "+" : ""}${Math.round((d / Math.abs(k.previous)) * 100)}%)` : "";
  return <span className={`kpi-d ${better ? "up" : "down"}`}><i className={d > 0 ? "ri-arrow-right-up-line" : "ri-arrow-right-down-line"} />{d > 0 ? "+" : ""}{fmt(d)}{pct}</span>;
}

export default function KpiBoard() {
  const [rows, setRows] = useState<Kpi[] | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [hist, setHist] = useState<string | null>(null);
  const [val, setVal] = useState<{ name: string; value: string; period: string; source: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [b, g, s] = await Promise.all([api<Kpi[]>("/kpis/board"), api<{ goals: Goal[] }>("/plan?days=7").then((p) => p.goals).catch(() => [] as Goal[]), api<{ id: string; name: string }[]>("/staff").catch(() => [])]);
    setRows(b); setGoals(g); setStaff(s);
  }, []);
  usePoll(load, 30000, [load], (n) => n?.kind?.startsWith("job") || n?.kind === "kpi");

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await fn(); await load(); return true; } catch (e: any) { setErr(e.message); return false; } finally { setBusy(null); }
  };
  const edit = (k?: Kpi) => setForm(k ? { name: k.name, isNew: false, label: k.label, unit: k.unit, target: k.target == null ? "" : String(k.target), direction: k.direction,
    goal_id: k.goal_id || "", owner: k.owner || "", note: k.note || "" }
    : { name: "", isNew: true, label: "", unit: "", target: "", direction: "up", goal_id: "", owner: "finance", note: "" });
  const addValue = (k: Kpi) => setVal({ name: k.name, value: "", period: thisMonth(), source: "" });
  const ask = (k: Kpi) => run(`ask-${k.name}`, async () => { const t = await api<{ task_id: string }>(`/kpis/${k.name}/ask`, { method: "POST" }); openTask(t.task_id); });
  const remove = async (k: Kpi) => {
    if (!(await confirmDialog({ title: `Delete the KPI “${k.label}”?`, body: `Its ${k.history.length} recorded value${k.history.length === 1 ? "" : "s"} go too. This can’t be undone.`, confirm: "Delete KPI", danger: true }))) return;
    run(`del-${k.name}`, () => api(`/kpis/defs/${k.name}?values=true`, { method: "DELETE" })).then((ok) => { if (ok) { setForm(null); setHist(null); } });
  };
  const saveDef = async () => {
    if (!form) return;
    const label = form.label.trim();
    const name = form.isNew ? (form.name.trim() || label) : form.name;
    const t = form.target.trim();
    const ok = await run("def", () => api(`/kpis/defs/${encodeURIComponent(name)}`, { method: "PUT", body: {
      label, unit: form.unit.trim(), direction: form.direction, goal_id: form.goal_id, owner: form.owner, note: form.note,
      ...(t === "" ? { clear_target: true } : { target: Number(t.replace(/,/g, "")) }) } }));
    if (ok) setForm(null);
  };
  const saveValue = async () => {
    if (!val) return;
    const ok = await run("val", () => api("/kpis/values", { method: "POST", body: { name: val.name, value: Number(val.value.replace(/,/g, "")), period: val.period, source: val.source } }));
    if (ok) setVal(null);
  };
  const delValue = (id: string) => run(`v-${id}`, () => api(`/kpis/values/${id}`, { method: "DELETE" }));

  const items = (k: Kpi) => [
    { label: "Add a value", icon: "ri-add-line", onSelect: () => addValue(k) },
    { label: `Ask ${k.owner_name || "a helper"} to update`, icon: "ri-robot-2-line", onSelect: () => ask(k) },
    { label: "History", icon: "ri-history-line", onSelect: () => setHist(k.name) },
    { label: "Edit KPI", icon: "ri-edit-line", onSelect: () => edit(k) },
    sep,
    { label: "Copy value", icon: "ri-file-copy-line", disabled: k.value == null, onSelect: () => copy(`${k.label}: ${fmt(k.value)}${k.unit ? " " + k.unit : ""}`) },
    { label: "Delete KPI", icon: "ri-delete-bin-line", danger: true, onSelect: () => remove(k) },
  ];
  const h = rows?.find((r) => r.name === hist) || null;
  const valid = val && val.value.trim() !== "" && !isNaN(Number(val.value.replace(/,/g, "")));
  const key = form?.isNew ? (form.name.trim() || form.label.trim()).toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) : form?.name;

  return (
    <div className="sec" style={{ marginTop: 16 }}>
      <div className="acts" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>KPIs</h2>
        <span className="small">The numbers you watch. Helpers see them and their targets.</span>
        <span className="sp" />
        <button className="btn primary" onClick={() => edit()}><i className="ri-add-line" />New KPI</button>
      </div>
      <Err error={err} />
      {!rows ? <p className="small">Loading…</p> : rows.length === 0 ? (
        <div className="empty"><b>No KPIs yet</b><span>Add the numbers that tell you how the company is doing (MRR, paying customers, churn). Give each a target and the helper who keeps it current.</span>
          <button className="btn" style={{ marginTop: 10 }} onClick={() => edit()}><i className="ri-add-line" />Add your first KPI</button></div>
      ) : (
        <div className="kpi-grid">
          {rows.map((k) => {
            const good = k.value == null || k.previous == null || (k.direction === "up" ? k.value >= k.previous : k.value <= k.previous);
            const pr = k.progress == null ? null : Math.min(100, k.progress);
            return (
              <div key={k.name} className="kpi" onContextMenu={menu(() => items(k))}>
                <div className="kpi-top">
                  <span className="kpi-l" title={k.name}>{k.label}</span>
                  <button className="iconbtn sm" aria-label="More" onClick={(e) => menu(() => items(k))(e)}><i className="ri-more-2-fill" /></button>
                </div>
                <div className="kpi-v">
                  <span className="num">{fmt(k.value)}</span>{k.unit && k.value != null && <span className="unit">{k.unit}</span>}
                  <span className="sp" /><Spark values={k.history.map((x) => x.value)} good={good} />
                </div>
                <div className="kpi-meta"><Delta k={k} />{k.period && <span>{k.period}</span>}</div>
                {k.target != null ? (
                  <div className="kpi-t" title={`${k.progress ?? 0}% of target`}>
                    <div className="bar"><i style={{ width: `${pr ?? 0}%` }} className={pr != null && pr >= 100 ? "done" : ""} /></div>
                    <span>{k.progress == null ? "no value yet" : `${k.progress}%`} of {k.direction === "down" ? "≤ " : ""}{fmt(k.target)}{k.unit ? ` ${k.unit}` : ""}</span>
                  </div>
                ) : <button className="kpi-t add" onClick={() => edit(k)}><i className="ri-focus-3-line" />Set a target</button>}
                <div className="kpi-src small" title={k.source}>
                  {k.value == null ? "No value recorded yet" : <>{k.by} · {ago(k.at)}{k.source && <> · {k.source}</>}</>}
                </div>
                <div className="kpi-goal small" title={k.goal ? `Measures the goal: ${k.goal}` : "Not linked to a goal"}>
                  <i className="ri-flag-2-line" />{k.goal ? <span className="kpi-gt">{k.goal}</span> : <button className="linkbtn" onClick={() => edit(k)}>Link to a goal</button>}
                  {k.owner_name && <span className="kpi-own"><i className="ri-user-line" />{k.owner_name}</span>}
                </div>
                <div className="kpi-foot">
                  <span className="sp" />
                  <button className="btn sm quiet" disabled={busy === `ask-${k.name}`} onClick={() => ask(k)} title={`Ask ${k.owner_name || "a helper"} to find the current number`}>
                    <i className="ri-refresh-line" />{busy === `ask-${k.name}` ? "Asking…" : "Ask to update"}</button>
                  <button className="btn sm" onClick={() => addValue(k)}><i className="ri-add-line" />Value</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* create / edit a KPI */}
      <Drawer open={!!form} onClose={() => setForm(null)} icon={<i className="ri-line-chart-line" />} title={form?.isNew ? "New KPI" : "Edit KPI"}
        sub="A number you watch. Helpers see it, its target and the goal it measures."
        footer={form && <>
          {!form.isNew && <button className="btn quiet" onClick={() => { const k = rows?.find((r) => r.name === form.name); if (k) remove(k); }}><i className="ri-delete-bin-line" />Delete</button>}
          <span className="sp" />
          <button className="btn" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn primary" disabled={!form.label.trim() || !key || busy === "def"} onClick={saveDef}>{form.isNew ? "Add KPI" : "Save"}</button></>}>
        {form && (
          <>
            <div className="dw-sec">
              <label style={{ marginTop: 0 }}>Name</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Monthly recurring revenue" />
              {form.isNew ? (
                <><label>Short key <span className="small">used by helpers</span></label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={key || "mrr"} />
                  <p className="dw-help">Saved as <code>{key || "…"}</code>. Helpers record values with this key.</p></>
              ) : <p className="dw-help">Key: <code>{form.name}</code></p>}
              <div className="grid2" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><label>Unit</label><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="Rp jt, users, %" /></div>
                <div><label>Target</label><input inputMode="decimal" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="e.g. 10" /></div>
              </div>
              <label>Better when it goes</label>
              <div className="seg">{([["up", "Up", "ri-arrow-up-line"], ["down", "Down", "ri-arrow-down-line"]] as const).map(([d, l, ic]) => (
                <button key={d} type="button" className={form.direction === d ? "on" : ""} onClick={() => setForm({ ...form, direction: d })}><i className={ic} />{l}</button>))}</div>
            </div>
            <div className="dw-sec">
              <h3 style={{ marginBottom: 10 }}>Who and why</h3>
              <label style={{ marginTop: 0 }}>Goal it measures</label>
              <select value={form.goal_id} onChange={(e) => setForm({ ...form, goal_id: e.target.value })}>
                <option value="">No goal</option>
                {goals.filter((g) => g.status === "active" || g.id === form.goal_id).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
              <label>Helper who keeps it current</label>
              <select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
                <option value="">Nobody (you enter it)</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <p className="dw-help">“Ask to update” gives this helper a job to find the number from a real source.</p>
              <label>What it means / how to count it</label>
              <textarea rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Paid subscriptions only, from the Midtrans dashboard, end of month" />
            </div>
          </>
        )}
      </Drawer>

      {/* add one value */}
      <Drawer open={!!val} onClose={() => setVal(null)} icon={<i className="ri-add-line" />} title="Add a value"
        sub={rows?.find((r) => r.name === val?.name)?.label}
        footer={val && <><span className="sp" /><button className="btn" onClick={() => setVal(null)}>Cancel</button>
          <button className="btn primary" disabled={!valid || busy === "val"} onClick={saveValue}>Save value</button></>}>
        {val && (
          <div className="dw-sec">
            <label style={{ marginTop: 0 }}>Value {rows?.find((r) => r.name === val.name)?.unit && <span className="small">in {rows?.find((r) => r.name === val.name)?.unit}</span>}</label>
            <input inputMode="decimal" value={val.value} onChange={(e) => setVal({ ...val, value: e.target.value })} placeholder="e.g. 5.2"
              onKeyDown={(e) => { if (e.key === "Enter" && valid) saveValue(); }} />
            <label>Period</label>
            <input value={val.period} onChange={(e) => setVal({ ...val, period: e.target.value })} placeholder="2026-10, Q4, week 42" />
            <label>Source <span className="small">optional</span></label>
            <input value={val.source} onChange={(e) => setVal({ ...val, source: e.target.value })} placeholder="Where the number comes from" />
          </div>
        )}
      </Drawer>

      {/* history */}
      <Drawer open={!!h} onClose={() => setHist(null)} icon={<i className="ri-history-line" />} title={h?.label || ""} sub="Every recorded value, newest first"
        footer={h && <><button className="btn quiet" onClick={() => edit(h)}><i className="ri-edit-line" />Edit KPI</button><span className="sp" />
          <button className="btn" onClick={() => ask(h)}><i className="ri-robot-2-line" />Ask to update</button>
          <button className="btn primary" onClick={() => addValue(h)}><i className="ri-add-line" />Add value</button></>}>
        {h && (
          <>
            <div className="dw-sec kpi-hist-top">
              <span className="num">{fmt(h.value)}</span>{h.unit && <span className="unit">{h.unit}</span>}<span className="sp" />
              <Spark values={h.history.map((x) => x.value)} w={180} h={44} />
            </div>
            <div className="dw-sec">
              {h.history.length === 0 ? <p className="small">No values yet.</p> : (
                <table className="kpi-tbl"><thead><tr><th>Period</th><th>Value</th><th>By</th><th>Source</th><th /></tr></thead>
                  <tbody>{[...h.history].reverse().map((x) => (
                    <tr key={x.id} onContextMenu={menu(() => [{ label: "Delete this value", icon: "ri-delete-bin-line", danger: true, onSelect: () => delValue(x.id) }])}>
                      <td>{x.period || ago(x.at)}</td><td className="mono">{fmt(x.value)}</td><td>{x.by}</td><td className="small">{x.source}</td>
                      <td><button className="iconbtn sm" aria-label="Delete value" disabled={busy === `v-${x.id}`} onClick={() => delValue(x.id)}><i className="ri-delete-bin-line" /></button></td>
                    </tr>))}</tbody></table>
              )}
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}
