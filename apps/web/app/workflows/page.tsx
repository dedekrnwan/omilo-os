"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import Drawer from "@/components/Drawer";
import { Empty, Err, StatusChip } from "@/components/ui";
import { useBlocks } from "@/components/workflows/blocks";
import Builder from "@/components/workflows/Builder";
import Canvas from "@/components/workflows/Canvas";
import { WfPattern, WfRun, WfTemplate, Workflow, api } from "@/lib/api";
import { confirmDialog } from "@/lib/dialog";
import { copy, menu, sep } from "@/lib/menu";
import { usePoll } from "@/lib/poll";

/* Workflows: repeated work as a trigger and steps that run without AI unless a step needs it. Yours, the ones your
   helpers suggest (they wait for your OK), ready-made ones from the marketplace, what your helpers keep doing by hand
   (good candidates), and every run. ?id=… opens the builder. */

type Tab = "mine" | "repeat" | "market" | "runs";
type Staff = { id: string; name: string; is_chief?: boolean };

const ago = (iso: string | null) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const TRIG_ICON: Record<string, string> = { "trigger.manual": "ri-hand", "trigger.schedule": "ri-time-line", "trigger.webhook": "ri-webhook-line", "trigger.event": "ri-flashlight-line" };

function WorkflowCard({ w, onOpen, items }: { w: Workflow; onOpen: () => void; items: () => any[] }) {
  return (
    <div className={`card wf-card ${w.status}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }} onContextMenu={menu(items)}>
      <div className="acts" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <b className="wf-card-t"><i className={TRIG_ICON[w.trigger.type] || "ri-flow-chart"} />{w.name}</b>
        <StatusChip status={w.status} />
      </div>
      <div className="small clamp">{w.description || `${w.trigger.label} · ${w.steps} step${w.steps === 1 ? "" : "s"}`}</div>
      <div className="wf-card-f">
        {w.created_by.kind === "helper" ? <span className="wf-by"><Avatar who={{ id: w.created_by.id!, name: w.created_by.name } as any} size={16} />{w.created_by.name}</span>
          : w.source.startsWith("market:") ? <span className="wf-by"><i className="ri-store-2-line" />Marketplace</span> : <span className="wf-by"><i className="ri-user-line" />You</span>}
        <span className={`chip ${w.uses_ai ? "run" : "up"}`}><i className={w.uses_ai ? "ri-sparkling-2-line" : "ri-leaf-line"} />{w.uses_ai ? "AI" : "No AI"}</span>
        <span className="sp" />
        <span className="small">{w.runs} run{w.runs === 1 ? "" : "s"}{w.last_run ? ` · last ${ago(w.last_run.created_at)}` : ""}</span>
        {w.last_run && <span className={`bc-dot ${w.last_run.status === "done" ? "ok" : w.last_run.status === "failed" ? "bad" : "off"}`} title={`Last run: ${w.last_run.status}`} />}
      </div>
    </div>
  );
}

function List() {
  const router = useRouter();
  const blocks = useBlocks();
  const [tab, setTab] = useState<Tab>("mine");
  const [list, setList] = useState<Workflow[] | null>(null);
  const [market, setMarket] = useState<WfTemplate[] | null>(null);
  const [pats, setPats] = useState<WfPattern[] | null>(null);
  const [runs, setRuns] = useState<WfRun[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [peek, setPeek] = useState<WfTemplate | null>(null);
  const [build, setBuild] = useState<{ description: string; staff_id: string; task_ids: string[] } | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [cat, setCat] = useState("All");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setList(await api<Workflow[]>("/workflows")); } catch (e: any) { setErr(e.message); }
  }, []);
  usePoll(load, 15000, [load], (n) => n?.kind === "inbox");
  useEffect(() => {
    try { const t = localStorage.getItem("saga.wf.tab") as Tab | null; if (t && ["mine", "repeat", "market", "runs"].includes(t)) setTab(t); } catch { /* ignore */ }
    api<Staff[]>("/staff").then(setStaff).catch(() => {});
  }, []);
  useEffect(() => {
    try { localStorage.setItem("saga.wf.tab", tab); } catch { /* ignore */ }
    if (tab === "market" && !market) api<WfTemplate[]>("/workflows/market").then(setMarket).catch((e) => setErr(e.message));
    if (tab === "repeat") api<WfPattern[]>("/workflows/patterns").then(setPats).catch((e) => setErr(e.message));
    if (tab === "runs") api<WfRun[]>("/workflow-runs").then(setRuns).catch((e) => setErr(e.message));
  }, [tab, market]);

  const open = (id: string, run?: string) => router.push(`/workflows/?id=${id}${run ? `&run=${run}` : ""}`);
  const create = async () => {
    setBusy("new");
    try {
      const w = await api<Workflow>("/workflows", { body: { name: "New workflow", description: "", graph: { nodes: [{ id: "start", type: "trigger.manual", label: "Run by hand", config: {}, x: 0, y: 0 }], edges: [] } } });
      open(w.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const install = async (t: WfTemplate) => {
    setBusy(t.slug); setErr(null);
    try {
      const w = await api<Workflow & { missing_connectors: string[] }>(`/workflows/market/${t.slug}/install`, { body: {} });
      open(w.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const askBuild = async () => {
    if (!build) return;
    setBusy("build"); setErr(null);
    try {
      const r = await api<{ task_id: string; staff: { name: string } }>("/workflows/build", { body: build });
      setBuild(null);
      setNote(`${r.staff.name} is designing it. The workflow shows up in your Inbox to approve.`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const doImport = async () => {
    if (!importing) return;
    setBusy("import"); setErr(null);
    try { const w = await api<Workflow>("/workflows/import", { body: { data: JSON.parse(importing) } }); setImporting(null); open(w.id); }
    catch (e: any) { setErr(e instanceof SyntaxError ? "That isn't valid JSON." : e.message); } finally { setBusy(null); }
  };
  const items = (w: Workflow) => [
    { heading: w.name },
    { label: "Open", icon: "ri-edit-line", onSelect: () => open(w.id) },
    w.status === "active" ? { label: "Pause", icon: "ri-pause-line", onSelect: () => api(`/workflows/${w.id}/pause`, { body: {} }).then(load) }
      : w.status !== "rejected" && { label: w.status === "pending" ? "Approve and switch on" : "Switch on", icon: "ri-flashlight-line", onSelect: () => api(`/workflows/${w.id}/activate`, { body: {} }).then(load).catch((e) => setErr(e.message)) },
    { label: "Copy as JSON (to share)", icon: "ri-share-line", onSelect: async () => copy(JSON.stringify(await api(`/workflows/${w.id}/export`), null, 2)) },
    sep,
    { label: "Delete", icon: "ri-delete-bin-line", danger: true, onSelect: async () => {
      if (!(await confirmDialog({ title: `Delete “${w.name}”?`, body: "It stops running and its run history goes too.", confirm: "Delete workflow", danger: true }))) return;
      await api(`/workflows/${w.id}`, { method: "DELETE" }); load();
    } },
  ];

  const pending = (list || []).filter((w) => w.status === "pending");
  const rest = (list || []).filter((w) => w.status !== "pending");
  const cats = ["All", ...Array.from(new Set((market || []).map((m) => m.category)))];
  const helpers = staff;

  return (
    <div>
      <div className="sechead" style={{ alignItems: "flex-start" }}>
        <div><h1>Workflows</h1>
          <p className="sub" style={{ marginBottom: 0, maxWidth: 640 }}>Work that repeats, as steps that run on their own: connectors, web requests and data steps cost nothing; AI only where thinking is needed. Helpers can suggest workflows too. Nothing they suggest runs until you approve it.</p></div>
        <span className="sp" />
        <div className="acts">
          <button className="btn" onClick={() => setBuild({ description: "", staff_id: helpers.find((s) => s.is_chief)?.id || "", task_ids: [] })}><i className="ri-robot-2-line" />Ask a helper to build one</button>
          <button className="btn primary" disabled={busy === "new"} onClick={create}><i className="ri-add-line" />New workflow</button>
        </div>
      </div>

      <div className="sechead" style={{ marginTop: 16 }}>
        <div className="seg" role="tablist">
          {([["mine", "Your workflows", "ri-flow-chart"], ["repeat", "What helpers repeat", "ri-repeat-line"], ["market", "Marketplace", "ri-store-2-line"], ["runs", "Runs", "ri-history-line"]] as [Tab, string, string][]).map(([k, l, ic]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}><i className={ic} /> {l}{k === "mine" && pending.length ? <span className="wf-dot">{pending.length}</span> : null}</button>
          ))}
        </div>
        <span className="sp" />
        {tab === "mine" && <button className="btn quiet sm" onClick={() => setImporting("")}><i className="ri-upload-2-line" />Import JSON</button>}
      </div>
      {note && <div className="wfb-note" style={{ margin: "12px 0 0" }}><i className="ri-robot-2-line" /><span>{note}</span><span className="sp" /><button className="iconbtn" aria-label="Close" onClick={() => setNote(null)}><i className="ri-close-line" /></button></div>}
      <Err error={err} />

      {tab === "mine" && (
        <div className="sec" style={{ marginTop: 16 }}>
          {list === null ? <p className="small">Loading…</p> : list.length === 0 ? (
            <div className="wf-empty">
              <b>No workflows yet</b>
              <span>Start from the marketplace, draw one yourself, or ask a helper to turn something they do every week into a workflow.</span>
              <div className="acts" style={{ justifyContent: "center", marginTop: 8 }}>
                <button className="btn" onClick={() => setTab("market")}><i className="ri-store-2-line" />Browse the marketplace</button>
                <button className="btn" onClick={() => setTab("repeat")}><i className="ri-repeat-line" />See what helpers repeat</button>
              </div>
            </div>
          ) : (
            <>
              {pending.length > 0 && (
                <>
                  <h3 className="wf-h"><i className="ri-lightbulb-flash-line" />Suggested by your helpers · waiting for you</h3>
                  <div className="grid2">{pending.map((w) => <WorkflowCard key={w.id} w={w} onOpen={() => open(w.id)} items={() => items(w)} />)}</div>
                  <h3 className="wf-h">All workflows</h3>
                </>
              )}
              <div className="grid2">{rest.map((w) => <WorkflowCard key={w.id} w={w} onOpen={() => open(w.id)} items={() => items(w)} />)}</div>
            </>
          )}
        </div>
      )}

      {tab === "repeat" && (
        <div className="sec" style={{ marginTop: 16 }}>
          <p className="small" style={{ marginTop: 0 }}>Jobs your helpers did three or more times in the last 30 days. Each one costs AI time; a workflow can do the routine part for free and keep the AI for the thinking.</p>
          {pats === null ? <p className="small">Loading…</p> : pats.length === 0 ? <Empty title="Nothing repeats yet" text="When a helper does the same kind of job again and again, it shows here." /> : (
            <div className="wf-pats">
              {pats.map((p, i) => (
                <div key={i} className="card wf-pat">
                  <div className="acts" style={{ flexWrap: "nowrap" }}>
                    <Avatar who={p.staff as any} size={28} />
                    <div className="t"><b>{p.title}</b><span className="small">{p.staff.name} · {p.count}× in 30 days · about {p.per_week}/week{p.cost_usd ? ` · $${p.cost_usd.toFixed(2)} spent` : ""}</span></div>
                    <span className="sp" />
                    <button className="btn sm primary" onClick={() => setBuild({ description: `Turn this repeated job into a workflow: ${p.title}`, staff_id: p.staff.id, task_ids: p.task_ids })}>
                      <i className="ri-flow-chart" />Turn into a workflow</button>
                  </div>
                  <p className="small clamp" style={{ margin: "8px 0 0" }}>{p.example}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "market" && (
        <div className="sec" style={{ marginTop: 16 }}>
          <div className="seg" style={{ marginBottom: 12 }}>{cats.map((c) => <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>)}</div>
          {market === null ? <p className="small">Loading…</p> : (
            <div className="grid2">
              {market.filter((m) => cat === "All" || m.category === cat).map((m) => (
                <div key={m.slug} className="card wf-tpl" role="button" tabIndex={0} onClick={() => setPeek(m)} onKeyDown={(e) => { if (e.key === "Enter") setPeek(m); }}>
                  <div className="acts" style={{ flexWrap: "nowrap" }}>
                    <span className="wf-tpl-ic"><i className={m.icon} /></span>
                    <div className="t"><b>{m.name}</b><span className="small">{m.category} · {m.trigger} · {m.steps} steps</span></div>
                  </div>
                  <div className="small clamp">{m.description}</div>
                  <div className="wf-card-f">
                    <span className={`chip ${m.uses_ai ? "run" : "up"}`}><i className={m.uses_ai ? "ri-sparkling-2-line" : "ri-leaf-line"} />{m.uses_ai ? "AI" : "No AI"}</span>
                    {m.needs.map((n) => <span key={n} className="chip outline"><i className="ri-plug-line" />{n}</span>)}
                    <span className="sp" />
                    <button className="btn sm" disabled={busy === m.slug} onClick={(e) => { e.stopPropagation(); install(m); }}>{busy === m.slug ? "Adding…" : "Use it"}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="small" style={{ marginTop: 16 }}>Share your own: open a workflow → ⋯ → Copy as JSON. Anyone can import it here.</p>
        </div>
      )}

      {tab === "runs" && (
        <div className="sec" style={{ marginTop: 16 }}>
          {runs === null ? <p className="small">Loading…</p> : runs.length === 0 ? <Empty title="No runs yet" text="Runs of every workflow show here." /> : (
            <div className="wf-runs wide">
              {runs.map((r) => (
                <button key={r.id} className="wf-run" onClick={() => open(r.workflow_id, r.id)}>
                  <StatusChip status={r.status} />
                  <span className="t"><b>{r.workflow_name}</b> · {r.trigger}{r.ai_steps ? ` · ${r.ai_steps} AI step${r.ai_steps === 1 ? "" : "s"}` : ""}{r.error ? ` · ${r.error}` : ""}</span>
                  <span className="small">{ago(r.created_at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <Drawer open={!!peek} onClose={() => setPeek(null)} wide icon={<i className={peek?.icon || "ri-store-2-line"} />} title={peek?.name || ""} sub={peek ? `${peek.category} · by ${peek.by}` : ""}
        footer={peek && <><span className="small">{peek.uses_ai ? "Some steps use AI." : "No AI: free to run."} It starts as a draft.</span><span className="sp" /><button className="btn" onClick={() => setPeek(null)}>Close</button>
          <button className="btn primary" disabled={busy === peek.slug} onClick={() => install(peek)}>{busy === peek.slug ? "Adding…" : "Use this workflow"}</button></>}>
        {peek && (
          <>
            <div className="dw-sec"><p style={{ margin: 0 }}>{peek.description}</p>
              {peek.needs.length > 0 && <p className="dw-help">Needs a connector: {peek.needs.join(", ")}.</p>}</div>
            <div className="dw-sec" style={{ padding: 0 }}><Canvas graph={peek.graph} blocks={blocks} readOnly height={420} fitKey={peek.slug} /></div>
          </>
        )}
      </Drawer>

      <Drawer open={!!build} onClose={() => setBuild(null)} icon={<i className="ri-robot-2-line" />} title="Ask a helper to build a workflow"
        sub="They design it with your connectors and send it to your Inbox. Nothing runs until you approve."
        footer={build && <><span className="sp" /><button className="btn" onClick={() => setBuild(null)}>Cancel</button>
          <button className="btn primary" disabled={busy === "build" || build.description.trim().length < 3 || !build.staff_id} onClick={askBuild}>{busy === "build" ? "Asking…" : "Ask"}</button></>}>
        {build && (
          <div className="dw-sec">
            <label style={{ marginTop: 0 }}>What should it do?</label>
            <textarea rows={5} value={build.description} onChange={(e) => setBuild({ ...build, description: e.target.value })}
              placeholder="Every morning, read new leads from the CRM, pull out name, company and budget, and ask me before Sales replies to the big ones." />
            <label>Who builds it</label>
            <select value={build.staff_id} onChange={(e) => setBuild({ ...build, staff_id: e.target.value })}>
              <option value="">Pick a helper…</option>
              {helpers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_chief ? " (Chief of Staff)" : ""}</option>)}
            </select>
            {build.task_ids.length > 0 && <p className="dw-help">They'll look at {build.task_ids.length} past jobs like this one.</p>}
          </div>
        )}
      </Drawer>

      <Drawer open={importing !== null} onClose={() => setImporting(null)} icon={<i className="ri-upload-2-line" />} title="Import a workflow" sub="Paste a workflow someone shared (Copy as JSON)."
        footer={<><span className="sp" /><button className="btn" onClick={() => setImporting(null)}>Cancel</button>
          <button className="btn primary" disabled={!importing?.trim() || busy === "import"} onClick={doImport}>Import</button></>}>
        <div className="dw-sec">
          <textarea className="mono" rows={14} value={importing || ""} onChange={(e) => setImporting(e.target.value)} placeholder='{"saga_workflow": 1, "name": "…", "graph": {…}}' />
          <Err error={err} />
        </div>
      </Drawer>
    </div>
  );
}

function Page() {
  const p = useSearchParams();
  const id = p.get("id");
  return id ? <Builder key={id} id={id} runId={p.get("run")} /> : <List />;
}

export default function WorkflowsPage() {
  return <Suspense><Page /></Suspense>;
}
