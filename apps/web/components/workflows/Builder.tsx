"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { StatusChip } from "@/components/ui";
import { BASE, WfBlock, WfField, WfGraph, WfNode, WfRun, Workflow, api } from "@/lib/api";
import { confirmDialog } from "@/lib/dialog";
import { copy, menu, sep } from "@/lib/menu";
import { useBlocks } from "./blocks";
import Canvas, { NODE_H, outPorts } from "./Canvas";

/* The workflow builder: blocks on the left, the canvas in the middle, and on the right either the selected step's
   settings or the workflow's settings and runs. Save, Test run and Switch on live in the bar on top. */

type Staff = { id: string; name: string; role?: string; is_chief?: boolean; status?: string };
type Conn = { id: string; label: string; enabled: boolean; kind: string };
type Tool = { name: string; description: string; schema: any };

const CRON_PRESETS: [string, string][] = [["0 9 * * 1-5", "Weekdays at 9:00"], ["0 9 * * *", "Every day at 9:00"], ["0 9 * * 1", "Mondays at 9:00"],
  ["0 * * * *", "Every hour"], ["*/15 * * * *", "Every 15 minutes"], ["0 17 * * 5", "Fridays at 17:00"]];
const RUN_LIVE = ["queued", "running"];

export { useBlocks };

function newId(type: string, g: WfGraph) {
  const base = type.split(".")[1].replace(/[^a-z]/g, "").slice(0, 8) || "step";
  let i = 1;
  while (g.nodes.some((n) => n.id === `${base}${i}`)) i++;
  return `${base}${i}`;
}

function defaults(b: WfBlock): Record<string, any> {
  const c: Record<string, any> = {};
  for (const f of b.fields) if (f.default !== undefined) c[f.key] = f.default;
  return c;
}

function ancestors(g: WfGraph, id: string): string[] {
  const seen = new Set<string>();
  const walk = (n: string) => g.edges.filter((e) => e.to === n).forEach((e) => { if (!seen.has(e.from)) { seen.add(e.from); walk(e.from); } });
  walk(id);
  return g.nodes.filter((n) => seen.has(n.id)).map((n) => n.id);
}

function JsonField({ value, onChange, rows = 4, placeholder }: { value: any; onChange: (v: any) => void; rows?: number; placeholder?: string }) {
  const [text, setText] = useState(() => (value === undefined || value === null ? "" : JSON.stringify(value, null, 2)));
  const [bad, setBad] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (JSON.stringify(value) !== JSON.stringify(last.current)) { last.current = value; setText(value === undefined || value === null ? "" : JSON.stringify(value, null, 2)); }
  }, [value]);
  return (
    <>
      <textarea className={`mono wf-json ${bad ? "bad" : ""}`} rows={rows} value={text} placeholder={placeholder || "{ }"} spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) { setBad(false); last.current = undefined; onChange(undefined); return; }
          try { const v = JSON.parse(e.target.value); setBad(false); last.current = v; onChange(v); } catch { setBad(true); }
        }} />
      {bad && <p className="dw-help" style={{ color: "var(--bad)" }}>Not valid JSON yet.</p>}
    </>
  );
}

function Refs({ refs, onPick }: { refs: string[]; onPick: (r: string) => void }) {
  if (!refs.length) return null;
  return (
    <div className="wf-refs">
      {refs.slice(0, 14).map((r) => <button key={r} type="button" className="wf-ref" onClick={() => onPick(r)} title={`Insert {{ ${r} }}`}>{r}</button>)}
    </div>
  );
}

function FieldEdit({ f, node, set, staff, conns, kpis, refs }: {
  f: WfField; node: WfNode; set: (k: string, v: any) => void; staff: Staff[]; conns: Conn[]; kpis: string[]; refs: string[];
}) {
  const v = node.config[f.key];
  const [tools, setTools] = useState<{ cid: string; list: Tool[]; err?: string; loading: boolean } | null>(null);
  const cid = node.config.connector;
  useEffect(() => {
    if (f.kind !== "tool" || !cid) return;
    let off = false;
    setTools({ cid, list: [], loading: true });
    api<{ tools: Tool[]; error?: string }>(`/workflows/connector-tools/${cid}`)
      .then((r) => { if (!off) setTools({ cid, list: r.tools, err: r.error, loading: false }); })
      .catch((e) => { if (!off) setTools({ cid, list: [], err: e.message, loading: false }); });
    return () => { off = true; };
  }, [f.kind, cid]);
  const insert = (r: string) => set(f.key, `${typeof v === "string" ? v : ""}{{ ${r} }}`);
  const label = f.label ? <label>{f.label}{f.optional && <span className="small"> · optional</span>}</label> : null;
  switch (f.kind) {
    case "bool":
      return (
        <div className="togrow" onClick={() => set(f.key, !(v ?? f.default))}>
          <span className="t"><b>{f.label}</b></span>
          <span className={`switch ${(v ?? f.default) ? "on" : ""}`} role="switch" aria-checked={!!(v ?? f.default)}><i /></span>
        </div>
      );
    case "select":
      return <>{label}<select value={v ?? f.default ?? ""} onChange={(e) => set(f.key, e.target.value)}>{(f.options || []).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></>;
    case "staff":
      return <>{label}<select value={v || ""} onChange={(e) => set(f.key, e.target.value || undefined)}>
        <option value="">{f.optional ? "Anyone" : "Pick a helper…"}</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_chief ? " (Chief of Staff)" : ""}</option>)}
      </select></>;
    case "connector":
      return <>{label}<select value={v || ""} onChange={(e) => { set(f.key, e.target.value); set("tool", ""); }}>
        <option value="">Pick a connector…</option>
        {conns.map((c) => <option key={c.id} value={c.id} disabled={!c.enabled}>{c.label}{c.enabled ? "" : " (off)"}</option>)}
      </select>
        {!conns.length && <p className="dw-help">No connectors yet. <Link href="/connectors/">Add one</Link> (GitHub, a CRM, Sheets…).</p>}</>;
    case "tool": {
      const list = tools?.cid === cid ? tools!.list : [];
      const pick = (name: string) => {
        set(f.key, name);
        const t = list.find((x) => x.name === name);
        const props = t?.schema?.properties || {};
        if (t && (!node.config.args || !Object.keys(node.config.args).length) && Object.keys(props).length) {
          set("args", Object.fromEntries(Object.keys(props).slice(0, 12).map((k) => [k, ""])));
        }
      };
      const cur = list.find((x) => x.name === v);
      return <>{label}
        {list.length ? (
          <select value={v || ""} onChange={(e) => pick(e.target.value)}>
            <option value="">Pick a tool…</option>
            {list.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        ) : <input value={v || ""} onChange={(e) => set(f.key, e.target.value)} placeholder={!cid ? "Pick a connector first" : tools?.loading ? "Loading its tools…" : "tool name"} disabled={!cid} />}
        {cur?.description && <p className="dw-help clamp">{cur.description}</p>}
        {tools?.err && <p className="dw-help">Couldn't list its tools ({tools.err}). Type the tool name.</p>}</>;
    }
    case "json":
      return <>{label}<JsonField value={v} onChange={(x) => set(f.key, x)} rows={f.key === "sample" ? 4 : 5} />
        {f.help && <p className="dw-help">{f.help}</p>}
        {f.key !== "sample" && <Refs refs={refs} onPick={(r) => set(f.key, { ...(typeof v === "object" && v ? v : {}), value: `{{ ${r} }}` })} />}</>;
    case "cron": {
      const preset = CRON_PRESETS.find(([c]) => c === v);
      return <>{label}
        <select value={preset ? v : "custom"} onChange={(e) => e.target.value !== "custom" && set(f.key, e.target.value)}>
          {CRON_PRESETS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {!preset && <input className="mono" style={{ marginTop: 6 }} value={v || ""} onChange={(e) => set(f.key, e.target.value)} placeholder="min hour day month weekday" />}
        <p className="dw-help">In your company's time zone (Settings).</p></>;
    }
    case "number":
      return <>{label}<input type="number" value={v ?? ""} onChange={(e) => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))} placeholder={f.placeholder} /></>;
    case "kpi":
      return <>{label}<input list="wf-kpis" value={v || ""} onChange={(e) => set(f.key, e.target.value)} placeholder="revenue" />
        <datalist id="wf-kpis">{kpis.map((k) => <option key={k} value={k} />)}</datalist></>;
    case "textarea":
      return <>{label}<textarea rows={f.rows || 4} value={v || ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
        {f.help && <p className="dw-help">{f.help}</p>}</>;
    default: // template, text
      return <>{label}
        {(f.rows || 1) > 1 ? <textarea rows={f.rows} value={typeof v === "string" ? v : v == null ? "" : JSON.stringify(v)} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
          : <input value={typeof v === "string" ? v : v == null ? "" : JSON.stringify(v)} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />}
        {f.kind === "template" && <Refs refs={refs} onPick={insert} />}</>;
  }
}

function preview(v: any) {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s && s.length > 3000 ? `${s.slice(0, 3000)}…` : s;
}

export default function Builder({ id, runId }: { id: string; runId?: string | null }) {
  const router = useRouter();
  const blocks = useBlocks();
  const [wf, setWf] = useState<Workflow | null>(null);
  const [graph, setGraph] = useState<WfGraph>({ nodes: [], edges: [] });
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [run, setRun] = useState<WfRun | null>(null);
  const [runs, setRuns] = useState<WfRun[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [kpis, setKpis] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const loadRuns = useCallback(() => api<WfRun[]>(`/workflows/${id}/runs`).then(setRuns).catch(() => {}), [id]);
  useEffect(() => {
    api<Workflow>(`/workflows/${id}`).then((w) => { setWf(w); setGraph(w.graph || { nodes: [], edges: [] }); setDirty(false); }).catch((e) => setErr(e.message));
    api<WfRun[]>(`/workflows/${id}/runs`).then((rs) => {
      setRuns(rs);
      const live = !runId && rs[0] && ["queued", "running", "waiting"].includes(rs[0].status) ? rs[0] : null;
      if (live) api<WfRun>(`/workflow-runs/${live.id}`).then(setRun).catch(() => {});
    }).catch(() => {});
    api<Staff[]>("/staff").then(setStaff).catch(() => {});
    api<Conn[]>("/connectors").then(setConns).catch(() => {});
    api<Record<string, unknown>>("/kpis").then((k) => setKpis(Object.keys(k))).catch(() => {});
  }, [id, runId]);
  useEffect(() => { if (runId) api<WfRun>(`/workflow-runs/${runId}`).then(setRun).catch(() => {}); }, [runId]);

  // follow a live run
  useEffect(() => {
    if (!run || !RUN_LIVE.includes(run.status) && !(run.status === "waiting")) return;
    const t = setTimeout(async () => {
      try {
        const r = await api<WfRun>(`/workflow-runs/${run.id}`);
        setRun(r);
        if (!RUN_LIVE.includes(r.status)) { loadRuns(); api<Workflow>(`/workflows/${id}`).then((w) => setWf((cur) => (cur ? { ...cur, ...w, graph: cur.graph } : w))).catch(() => {}); }
      } catch { /* keep the last view */ }
    }, run.status === "waiting" ? 3000 : 900);
    return () => clearTimeout(t);
  }, [run, id, loadRuns]);

  // leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const change = useCallback((g: WfGraph) => { setGraph(g); setDirty(true); }, []);
  const node = graph.nodes.find((n) => n.id === sel) || null;
  const setCfg = (k: string, v: any) => {
    if (!node) return;
    change({ ...graph, nodes: graph.nodes.map((n) => (n.id === node.id ? { ...n, config: { ...n.config, [k]: v } } : n)) });
  };
  const setNode = (patch: Partial<WfNode>) => node && change({ ...graph, nodes: graph.nodes.map((n) => (n.id === node.id ? { ...n, ...patch } : n)) });

  const add = (type: string, at?: { x: number; y: number }) => {
    const b = blocks[type];
    if (!b) return;
    if (b.trigger) { // one trigger: swap the kind
      const t = graph.nodes.find((n) => blocks[n.type]?.trigger);
      if (t) { change({ ...graph, nodes: graph.nodes.map((n) => (n.id === t.id ? { ...n, type, label: b.label, config: defaults(b) } : n)) }); setSel(t.id); return; }
    }
    const from = graph.nodes.find((n) => n.id === sel) || graph.nodes.slice().sort((a, c) => c.y - a.y)[0];
    const nid = newId(type, graph);
    let x = at?.x ?? (from ? from.x : 0), y = at?.y ?? (from ? from.y + NODE_H + 70 : 0);
    if (!at && from) {
      const kids = graph.edges.filter((e) => e.from === from.id).length;
      x = from.x + kids * 270;
    }
    const n: WfNode = { id: nid, type, label: b.label, note: "", config: defaults(b), x, y };
    const edges = [...graph.edges];
    if (!at && from && !b.trigger) {
      const free = outPorts(blocks[from.type]).find((p) => !graph.edges.some((e) => e.from === from.id && e.port === p)) || outPorts(blocks[from.type])[0];
      edges.push({ from: from.id, port: free, to: nid });
    }
    change({ nodes: [...graph.nodes, n], edges });
    setSel(nid);
  };
  const remove = () => {
    if (!node || blocks[node.type]?.trigger) return;
    change({ nodes: graph.nodes.filter((n) => n.id !== node.id), edges: graph.edges.filter((e) => e.from !== node.id && e.to !== node.id) });
    setSel(null);
  };

  const save = async (quiet = false) => {
    if (!wf) return false;
    setErr(null); setBusy("save");
    try {
      const w = await api<Workflow>(`/workflows/${wf.id}`, { method: "PUT", body: { name: wf.name, description: wf.description, autonomy: wf.autonomy, graph } });
      setWf(w); setGraph(w.graph || graph); setDirty(false);
      return true;
    } catch (e: any) { setErr(e.message); return false; } finally { setBusy(null); if (!quiet) { /* saved */ } }
  };
  const testRun = async () => {
    if (dirty && !(await save(true))) return;
    setBusy("run"); setErr(null);
    try { const r = await api<WfRun>(`/workflows/${id}/run`, { body: {} }); setRun(r); setSel(null); loadRuns(); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const toggle = async () => {
    if (!wf) return;
    if (dirty && !(await save(true))) return;
    setBusy("on"); setErr(null);
    try { setWf(await api<Workflow>(`/workflows/${wf.id}/${wf.status === "active" ? "pause" : "activate"}`, { body: {} })); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const del = async () => {
    if (!wf || !(await confirmDialog({ title: `Delete “${wf.name}”?`, body: "It stops running and its run history goes too. This can’t be undone.", confirm: "Delete workflow", danger: true }))) return;
    await api(`/workflows/${wf.id}`, { method: "DELETE" });
    router.push("/workflows/");
  };
  const exportIt = async () => { if (wf) copy(JSON.stringify(await api(`/workflows/${wf.id}/export`), null, 2)); };

  const refs = useMemo(() => {
    if (!node) return [];
    const out: string[] = [];
    const trig = graph.nodes.find((n) => blocks[n.type]?.trigger);
    const sample = trig?.config?.sample;
    const runIn = run?.input;
    const keys = Object.keys((runIn && typeof runIn === "object" ? runIn : null) || (sample && typeof sample === "object" ? sample : {}) || {});
    keys.slice(0, 6).forEach((k) => out.push(`trigger.${k}`));
    if (!keys.length && trig) out.push("trigger");
    for (const a of ancestors(graph, node.id)) {
      if (blocks[graph.nodes.find((n) => n.id === a)?.type || ""]?.trigger) continue;
      const o = run?.steps?.[a]?.output;
      if (o && typeof o === "object" && !Array.isArray(o)) Object.keys(o).slice(0, 5).forEach((k) => out.push(`steps.${a}.output.${k}`));
      else out.push(`steps.${a}.output`);
    }
    out.push("last", "now");
    return out;
  }, [node, graph, blocks, run]);

  if (!wf) return err ? <div className="error">{err}</div> : <p className="small">Loading…</p>;
  const groups = Object.values(blocks).reduce<Record<string, WfBlock[]>>((a, b) => { (a[b.group] ||= []).push(b); return a; }, {});
  const fq = q.trim().toLowerCase();
  const nb = node ? blocks[node.type] : null;
  const step = node && run?.steps?.[node.id];

  return (
    <div className="wfb">
      <div className="wfb-bar">
        <Link className="iconbtn" href="/workflows/" aria-label="All workflows"><i className="ri-arrow-left-line" /></Link>
        <input className="wfb-name" value={wf.name} onChange={(e) => { setWf({ ...wf, name: e.target.value }); setDirty(true); }} aria-label="Workflow name" />
        <StatusChip status={wf.status} />
        {wf.created_by.kind === "helper" && <span className="chip outline"><Avatar who={{ id: wf.created_by.id!, name: wf.created_by.name } as any} size={14} />by {wf.created_by.name}</span>}
        <span className={`chip ${wf.uses_ai ? "run" : "up"}`} title={wf.uses_ai ? "Some steps use AI (tokens)" : "No AI steps: runs cost nothing"}>
          <i className={wf.uses_ai ? "ri-sparkling-2-line" : "ri-leaf-line"} />{wf.uses_ai ? "Uses AI" : "No AI"}</span>
        <span className="sp" />
        {dirty && <span className="small">Unsaved</span>}
        <button className="btn" disabled={!dirty || busy === "save"} onClick={() => save()}>{busy === "save" ? "Saving…" : "Save"}</button>
        <button className="btn" disabled={busy === "run" || wf.status === "rejected"} onClick={testRun}><i className="ri-play-line" />{wf.status === "active" ? "Run now" : "Test run"}</button>
        <button className={`btn ${wf.status === "active" ? "" : "primary"}`} disabled={busy === "on"} onClick={toggle}>
          <i className={wf.status === "active" ? "ri-pause-line" : "ri-flashlight-line"} />{wf.status === "active" ? "Pause" : wf.status === "pending" ? "Approve & switch on" : "Switch on"}</button>
        <button className="iconbtn" aria-label="More" onClick={menu(() => [
          { heading: wf.name },
          { label: "Copy as JSON (to share)", icon: "ri-share-line", onSelect: exportIt },
          !!wf.hook_path && { label: "Copy the webhook address", icon: "ri-webhook-line", onSelect: () => copy(location.origin + BASE + wf.hook_path) },
          sep,
          { label: "Delete", icon: "ri-delete-bin-line", danger: true, onSelect: del },
        ])}><i className="ri-more-2-line" /></button>
      </div>
      {err && <div className="error" style={{ margin: "8px 12px 0" }}>{err}</div>}
      {wf.status === "pending" && (
        <div className="wfb-note"><i className="ri-lightbulb-flash-line" /><span><b>{wf.created_by.name} suggests this workflow.</b> {wf.reason}</span></div>
      )}

      <div className="wfb-main">
        <aside className="wfb-pal">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a block" aria-label="Find a block" />
          {Object.entries(groups).map(([g, list]) => {
            const shown = list.filter((b) => !fq || `${b.label} ${b.desc}`.toLowerCase().includes(fq));
            if (!shown.length) return null;
            return (
              <div key={g} className="wfb-grp">
                <div className="wfb-gh">{g}{g === "AI" && <span className="small"> · uses tokens</span>}</div>
                {shown.map((b) => (
                  <button key={b.type} className={`wfb-blk c-${b.color}`} draggable onDragStart={(e) => { e.dataTransfer.setData("application/x-omilo-block", b.type); e.dataTransfer.effectAllowed = "copy"; }}
                    onClick={() => add(b.type)} title={b.desc}>
                    <span className="wfn-ic"><i className={b.icon} /></span><span className="t"><b>{b.label}</b><span>{b.desc}</span></span>
                  </button>
                ))}
              </div>
            );
          })}
        </aside>

        <div className="wfb-cv">
          <Canvas graph={graph} blocks={blocks} steps={run?.steps || run?.nodes} selected={sel} onSelect={setSel} onChange={change}
            onDropBlock={(t, x, y) => add(t, { x, y })} fitKey={wf.id} />
          {run && (
            <div className={`wfb-runbar st-${run.status}`}>
              {RUN_LIVE.includes(run.status) ? <span className="spin" /> : <i className={run.status === "done" ? "ri-checkbox-circle-line" : run.status === "waiting" ? "ri-time-line" : run.status === "failed" ? "ri-error-warning-line" : "ri-stop-circle-line"} />}
              <span>{run.trigger === "test" ? "Test run" : "Run"} · <b>{run.status === "waiting" ? (run.waiting?.kind === "task" ? "waiting for a helper's job" : "waiting for you in the Inbox") : run.status}</b>
                {run.error ? ` · ${run.error}` : ""}</span>
              <span className="sp" />
              {run.status === "waiting" && run.waiting?.kind !== "task" && <Link className="btn sm" href="/">Open the Inbox</Link>}
              {["queued", "running", "waiting"].includes(run.status) && <button className="btn sm" onClick={async () => setRun(await api<WfRun>(`/workflow-runs/${run.id}/cancel`, { body: {} }))}>Stop</button>}
              <button className="iconbtn" aria-label="Hide the run" onClick={() => setRun(null)}><i className="ri-close-line" /></button>
            </div>
          )}
        </div>

        <aside className="wfb-side">
          {node && nb ? (
            <>
              <div className="wfb-sh">
                <span className={`wfn-ic c-${nb.color}`}><i className={nb.icon} /></span>
                <div className="t"><b>{nb.label}</b><span>{nb.desc}</span></div>
                <button className="iconbtn" aria-label="Close" onClick={() => setSel(null)}><i className="ri-close-line" /></button>
              </div>
              <div className="wfb-sb">
                <label style={{ marginTop: 0 }}>Name on the card</label>
                <input value={node.label} onChange={(e) => setNode({ label: e.target.value })} />
                {nb.fields.map((f) => (
                  <FieldEdit key={`${node.id}-${f.key}`} f={f} node={node} set={setCfg} staff={staff} conns={conns} kpis={kpis} refs={refs} />
                ))}
                <label>Note</label>
                <input value={node.note || ""} onChange={(e) => setNode({ note: e.target.value })} placeholder="Shown on the card" />
                <p className="dw-help mono">id: {node.id} · use {"{{ steps." + node.id + ".output }}"} later on</p>
                {step && (
                  <div className="wfb-out">
                    <div className="acts"><b>Last run</b><StatusChip status={step.status} /></div>
                    {step.error && <div className="error">{step.error}</div>}
                    {step.output !== undefined && <pre className="mono">{preview(step.output)}</pre>}
                  </div>
                )}
                {!nb.trigger && <button className="btn quiet" style={{ marginTop: 16 }} onClick={remove}><i className="ri-delete-bin-line" />Remove this step</button>}
              </div>
            </>
          ) : (
            <>
              <div className="wfb-sh"><span className="wfn-ic c-slate"><i className="ri-flow-chart" /></span><div className="t"><b>Workflow</b><span>Click a card to set it up.</span></div></div>
              <div className="wfb-sb">
                <label style={{ marginTop: 0 }}>What it does</label>
                <textarea rows={3} value={wf.description} onChange={(e) => { setWf({ ...wf, description: e.target.value }); setDirty(true); }} placeholder="One or two lines, so helpers know when to use it" />
                <div className="togrow" style={{ marginTop: 12 }} onClick={() => { setWf({ ...wf, autonomy: wf.autonomy === "auto" ? "ask" : "auto" }); setDirty(true); }}>
                  <span className="t"><b>Run risky steps without asking</b><span>Off: web requests that change things, and connectors set to “ask first”, wait for your OK each run.</span></span>
                  <span className={`switch ${wf.autonomy === "auto" ? "on" : ""}`} role="switch" aria-checked={wf.autonomy === "auto"}><i /></span>
                </div>
                {wf.hook_path && (
                  <>
                    <label>Webhook address</label>
                    <div className="acts" style={{ flexWrap: "nowrap" }}>
                      <input className="mono" readOnly value={(typeof location !== "undefined" ? location.origin : "") + BASE + wf.hook_path} />
                      <button className="btn sm" onClick={() => copy(location.origin + BASE + wf.hook_path)}>Copy</button>
                    </div>
                    <p className="dw-help">POST JSON here; it becomes {"{{ trigger }}"}. Keep it secret.</p>
                  </>
                )}
                {wf.next_at && <p className="small">Next run: {new Date(wf.next_at).toLocaleString()}</p>}
                <h3 style={{ margin: "20px 0 8px" }}>Runs</h3>
                {runs.length === 0 ? <p className="small">No runs yet. Press Test run.</p> : (
                  <div className="wf-runs">
                    {runs.slice(0, 20).map((r) => (
                      <button key={r.id} className={`wf-run ${run?.id === r.id ? "on" : ""}`} onClick={async () => setRun(await api<WfRun>(`/workflow-runs/${r.id}`))}>
                        <StatusChip status={r.status} />
                        <span className="t">{r.trigger}{r.ai_steps ? ` · ${r.ai_steps} AI` : ""}</span>
                        <span className="small">{new Date(r.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
