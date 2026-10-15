"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Empty, Err, Markdown, StatusChip } from "@/components/ui";
import { Staff, Task, ago, api, when } from "@/lib/api";

function TaskDetail({ id }: { id: string }) {
  const router = useRouter();
  const [t, setT] = useState<Task | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setT(await api<Task>(`/tasks/${id}`)); } catch (e: any) { setErr(e.message); } }, [id]);
  useEffect(() => { load(); const i = setInterval(load, 3000); return () => clearInterval(i); }, [load]);
  if (!t) return <Err error={err} />;
  const rerun = async () => { const n = await api<Task>(`/tasks/${id}/rerun`, { body: { founder_note: note } }); router.push(`/work/?id=${n.id}`); };
  const discuss = async () => { const th = await api<{ id: string }>("/threads", { body: { scope: "task", ref_id: id } }); router.push(`/chat/?thread=${th.id}`); };
  return (
    <div>
      <div className="eyebrow"><Link href="/work/">Work</Link> · {t.staff_id} · {t.origin}</div>
      <h1 style={{ fontSize: 32 }}>{t.report?.headline || t.brief.slice(0, 90)}</h1>
      <div className="acts" style={{ marginBottom: 16 }}>
        <StatusChip status={t.status} /><span className="small">created {when(t.created_at)} · engine {t.engine_type || "-"} · attempts {t.attempts} · ${t.cost_usd.toFixed(2)}</span>
      </div>
      {t.error && <div className="paper" style={{ borderColor: "var(--stagnant)" }}><b className="down">Error</b><pre className="code">{t.error}</pre></div>}
      <div className="grid2">
        <div>
          <h2>Brief</h2>
          <div className="paper"><Markdown text={t.brief + (t.founder_note ? `\n\n**Founder note:** ${t.founder_note}` : "")} /></div>
          <div className="sec"><h2>Report</h2>
            {t.report ? <div className="paper"><Markdown text={t.report.body_md} /></div> : <Empty title="No report yet" text="The agent writes it when it finishes." />}
          </div>
        </div>
        <div>
          <h2>Progress</h2>
          {t.checkpoints?.length ? t.checkpoints.map((c, i) => (
            <div key={i} className="paper" style={{ marginBottom: 8 }}>
              <div className="small">{when(c.at)}</div>
              <div><b>Done:</b> {c.done || "-"}</div><div><b>Next:</b> {c.next}</div>
              {c.notes && <div className="small">{c.notes}</div>}
            </div>
          )) : <p className="small">No checkpoints.</p>}
          {!!t.proposals?.length && <div className="sec"><h2>Proposals</h2>
            {t.proposals.map((p) => <div key={p.id} className="acts" style={{ margin: "8px 0" }}><StatusChip status={p.status} /><span>{p.title}</span></div>)}</div>}
          {!!t.children?.length && <div className="sec"><h2>Follow-up tasks</h2>
            {t.children.map((c) => <div key={c.id} className="acts"><StatusChip status={c.status} /><Link href={`/work/?id=${c.id}`}>{c.origin}: {c.brief.slice(0, 60)}</Link></div>)}</div>}
          <div className="sec"><h2>Tool calls</h2>
            <div className="tw"><table><tbody>{t.tool_calls?.map((c, i) => (
              <tr key={i}><td className="small">{when(c.at)}</td><td>{c.tool}</td><td><span className={`chip ${c.decision === "allowed" ? "up" : c.decision === "proposal" ? "warn" : "down"}`}>{c.decision}</span></td><td className="num-cell small">{c.ms} ms</td></tr>
            ))}</tbody></table></div>
          </div>
        </div>
      </div>
      <div className="sec">
        <h2>Run it again</h2>
        <textarea placeholder="Instructions for the rerun (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="acts" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={rerun}>Rerun with these instructions</button>
          {["queued", "running"].includes(t.status) && <button className="btn danger" onClick={async () => { await api(`/tasks/${id}/cancel`, { body: {} }); load(); }}>Cancel</button>}
          <button className="btn quiet" onClick={discuss}>Discuss this task →</button>
        </div>
      </div>
      <Err error={err} />
    </div>
  );
}

function WorkList() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [who, setWho] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({ staff_id: "", brief: "", founder_note: "" });
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (who) q.set("staff_id", who);
    if (status) q.set("status", status);
    setTasks(await api<Task[]>(`/tasks?${q}`));
  }, [who, status]);
  useEffect(() => { api<Staff[]>("/staff").then(setStaff); }, []);
  useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, [load]);
  const create = async () => {
    try { const t = await api<Task>("/tasks", { body: form }); router.push(`/work/?id=${t.id}`); } catch (e: any) { setErr(e.message); }
  };
  return (
    <div>
      <div className="eyebrow">Everything your staff did</div>
      <h1>Work</h1>
      <div className="paper" style={{ marginBottom: 24 }}>
        <div className="grid2">
          <div><label>Give a task to</label>
            <select value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: e.target.value })}>
              <option value="">Choose a staff agent</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><label>Note (optional)</label><input value={form.founder_note} onChange={(e) => setForm({ ...form, founder_note: e.target.value })} /></div>
        </div>
        <label>What should they do?</label>
        <textarea value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} />
        <div className="acts" style={{ marginTop: 8 }}><button className="btn primary" disabled={!form.staff_id || !form.brief.trim()} onClick={create}>Start task</button></div>
        <Err error={err} />
      </div>
      <div className="sechead">
        <select style={{ width: 200 }} value={who} onChange={(e) => setWho(e.target.value)}><option value="">All staff</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <div className="seg">{["", "running", "queued", "done", "failed"].map((s) => <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s || "all"}</button>)}</div>
      </div>
      {tasks.length === 0 ? <Empty title="No tasks" text="Start one above, or wait for the next shift." /> : (
        <div className="tw"><table>
          <thead><tr><th>Status</th><th>Staff</th><th>Started</th><th>Result</th><th className="hide-sm">Origin</th><th className="num-cell hide-sm">Cost</th></tr></thead>
          <tbody>{tasks.map((t) => (
            <tr key={t.id} className="click" onClick={() => router.push(`/work/?id=${t.id}`)}>
              <td><StatusChip status={t.status} /></td><td>{t.staff_id}</td><td className="small">{ago(t.created_at)}</td>
              <td>{t.report?.headline || t.error || t.brief.slice(0, 80)}</td><td className="hide-sm small">{t.origin}</td>
              <td className="num-cell hide-sm">${t.cost_usd.toFixed(2)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function WorkInner() {
  const id = useSearchParams().get("id");
  return id ? <TaskDetail id={id} /> : <WorkList />;
}

export default function Work() {
  return <Suspense><WorkInner /></Suspense>;
}
