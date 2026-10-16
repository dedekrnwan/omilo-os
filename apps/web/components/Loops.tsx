"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import Avatar from "@/components/Avatar";
import { ago, api } from "@/lib/api";
import { helperItems } from "@/lib/actions";
import { copy, menu, sep } from "@/lib/menu";
import { openTask } from "@/lib/open";
import { usePoll } from "@/lib/poll";

/* Loop engineering on the Monitor: one row per regular job (is it working?), and what the weekly retro changed,
   whether it helped, with undo. */

type Loop = { shift_id: string; name: string; staff_id: string; staff: string; cron: string; enabled: boolean; runs: number; done: number; failed: number;
  success: number | null; proposals: number; decided: number; approved: number; approval: number | null; cost_usd: number; stalled: boolean;
  last_useful: { at: string; headline: string; task_id: string } | null; next_at: string | null; log: string };
type Score = { runs?: number; success?: number | null; approval?: number | null; decided?: number };
type Imp = { id: string; by: string; by_name: string; staff_id: string; staff: string; kind: string; shift: string | null; reason: string; status: string;
  baseline: Score; result: Score; created_at: string; evaluated_at: string | null; after: Record<string, string>; before: Record<string, string> };

const pct = (v: number | null | undefined) => (v == null ? "–" : `${v}%`);
const KIND: Record<string, string> = { job: "instructions", shift_brief: "job brief", shift_schedule: "schedule", lessons: "lessons" };
const STATUS: Record<string, [string, string]> = { active: ["run", "Measuring"], kept: ["up", "Kept"], rolled_back: ["down", "Rolled back"], undone: ["idle", "Undone"] };
const docUrl = (p: string) => `/docs/?path=${encodeURIComponent(p)}`;

function Rate({ v, good = 80, ok = 50 }: { v: number | null; good?: number; ok?: number }) {
  if (v == null) return <span className="small">–</span>;
  return <span className="inl"><span className="inl-bar"><i style={{ width: `${v}%`, background: v >= good ? "#0ca30c" : v >= ok ? "#fab219" : "#d03b3b" }} /></span><span className="small">{v}%</span></span>;
}

export function LoopsCard({ days }: { days: number }) {
  const [rows, setRows] = useState<Loop[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => { try { setRows((await api<{ loops: Loop[] }>(`/loops?days=${days}`)).loops); } catch { /* next time */ } }, [days]);
  usePoll(load, 60000, [load], (n) => n?.kind?.startsWith("job"));
  const retro = async () => {
    try { const r = await api<{ task_id: string }>("/loops/retro", { body: {} }); openTask(r.task_id); setMsg("The retro is running."); } catch (e: any) { setMsg(e.message); }
  };
  if (!rows) return null;
  const stalled = rows.filter((r) => r.stalled).length;
  return (
    <section className="paper mcard" style={{ marginTop: 16 }} id="loops">
      <div className="mhead"><h2>Loops</h2>
        {stalled > 0 && <span className="chip down" style={{ marginLeft: 8 }}>{stalled} stalled</span>}
        <span className="sp" /><button className="btn sm" onClick={retro}><i className="ri-refresh-line" />Run the retro now</button></div>
      <p className="small" style={{ marginTop: 0 }}>Every regular job, over the last {days} days. Runs read their lessons and last results; your notes become lessons;
        the Friday retro fixes what isn't working. {msg}</p>
      {rows.length === 0 ? <p className="small">No regular jobs yet.</p> : (
        <div className="tw"><table className="mtable">
          <thead><tr><th>Job</th><th className="hide-sm">Helper</th><th className="num-cell">Runs</th><th>Succeeded</th><th className="hide-sm">Approved</th>
            <th className="hide-sm">Last useful result</th><th className="num-cell hide-sm">Spend</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.shift_id} className={r.stalled ? "row-warn" : ""} onContextMenu={menu(() => [{ heading: r.name },
              { label: "Open the run log", icon: "ri-file-list-3-line", href: docUrl(r.log) },
              { label: "Lessons", icon: "ri-lightbulb-line", href: docUrl(`Memory/${r.staff_id}/Lessons.md`) },
              r.last_useful && { label: "Open the last good run", icon: "ri-checkbox-circle-line", onSelect: () => openTask(r.last_useful!.task_id) },
              { label: "Edit the schedule", icon: "ri-calendar-line", href: `/staff/?id=${r.staff_id}` }, sep, ...helperItems({ id: r.staff_id, name: r.staff })])}>
              <td><Link href={docUrl(r.log)} className="plain"><b style={{ fontWeight: 500 }}>{r.name}</b></Link>
                {r.stalled && <span className="chip down" style={{ marginLeft: 6 }}>Stalled</span>}{!r.enabled && <span className="chip idle" style={{ marginLeft: 6 }}>Off</span>}
                <div className="small mono">{r.cron}{r.next_at ? ` · next ${new Date(r.next_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</div></td>
              <td className="hide-sm"><span className="mh-name"><Avatar who={{ id: r.staff_id, name: r.staff }} size={22} /><span>{r.staff}</span></span></td>
              <td className="num-cell">{r.runs}</td>
              <td><Rate v={r.success} /></td>
              <td className="hide-sm">{r.decided ? <Rate v={r.approval} good={60} ok={30} /> : <span className="small">{r.proposals ? `${r.proposals} waiting` : "–"}</span>}</td>
              <td className="hide-sm small" style={{ maxWidth: 300 }}>{r.last_useful ? <button className="lnk" onClick={() => openTask(r.last_useful!.task_id)}>{r.last_useful.headline || "done"}</button> : "–"}
                {r.last_useful && <span className="small"> · {ago(r.last_useful.at)}</span>}</td>
              <td className="num-cell mono small hide-sm">${r.cost_usd.toFixed(2)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}

export function ImproveCard() {
  const [rows, setRows] = useState<Imp[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setRows(await api<Imp[]>("/improvements?limit=20")); } catch { /* next time */ } }, []);
  usePoll(load, 60000, [load], (n) => n?.kind === "doc");
  const undo = async (i: Imp) => {
    if (!confirm(`Undo this change to ${i.staff}'s ${KIND[i.kind]}? The previous version comes back.`)) return;
    try { await api(`/improvements/${i.id}/undo`, { body: {} }); load(); } catch (e: any) { setErr(e.message); }
  };
  if (!rows) return null;
  return (
    <section className="paper mcard" style={{ marginTop: 16 }} id="improve">
      <div className="mhead"><h2>Self-improvement</h2><span className="sp" /><Link className="small" href={docUrl("Memory/Index.md")}>Memory in Docs</Link></div>
      <p className="small" style={{ marginTop: 0 }}>What the weekly retro changed on its own. Each change is measured after a week: kept if it helped or held, rolled back
        if results got worse. Permissions, budgets and approvals are never changed. You can undo anything.</p>
      {err && <div className="error">{err}</div>}
      {rows.length === 0 ? <p className="small">No changes yet. The retro runs on Fridays; you can also start it from Loops above.</p> : (
        <div className="imp-list">{rows.map((i) => {
          const [cls, label] = STATUS[i.status] || ["idle", i.status];
          const now = i.after.job || i.after.brief || i.after.cron || i.after.text || "";
          const was = i.before.job || i.before.brief || i.before.cron || i.before.text || "";
          return (
            <div key={i.id} className={`imp ${open === i.id ? "open" : ""}`} onContextMenu={menu(() => [{ heading: `${i.staff}: ${KIND[i.kind]}` },
              { label: open === i.id ? "Hide the change" : "Show the change", icon: "ri-git-commit-line", onSelect: () => setOpen(open === i.id ? null : i.id) },
              (i.status === "active" || i.status === "kept") && { label: "Undo", icon: "ri-arrow-go-back-line", danger: true, onSelect: () => undo(i) },
              { label: "Copy the reason", icon: "ri-file-copy-line", onSelect: () => copy(i.reason) }, sep, ...helperItems({ id: i.staff_id, name: i.staff })])}>
              <button className="imp-h" onClick={() => setOpen(open === i.id ? null : i.id)}>
                <Avatar who={{ id: i.staff_id, name: i.staff }} size={26} />
                <span className="t"><b>{i.staff} · {KIND[i.kind]}{i.shift ? ` of “${i.shift}”` : ""}</b><span className="small">{i.reason}</span></span>
                <span className="imp-score small">{pct(i.baseline.success)} → {i.status === "active" ? "…" : pct(i.result.success)}<br />succeeded</span>
                <span className={`chip ${cls}`}>{label}</span>
              </button>
              {open === i.id && (
                <div className="imp-b">
                  <div className="grid2">
                    <div><div className="small">Before</div><pre className="code">{was || "(empty)"}</pre></div>
                    <div><div className="small">After</div><pre className="code">{now || "(empty)"}</pre></div>
                  </div>
                  <div className="acts" style={{ marginTop: 8 }}>
                    <span className="small">By {i.by_name} · {ago(i.created_at)}{i.evaluated_at ? ` · measured ${ago(i.evaluated_at)}` : " · measured after a week"}</span><span className="sp" />
                    {(i.status === "active" || i.status === "kept") && <button className="btn sm" onClick={() => undo(i)}><i className="ri-arrow-go-back-line" />Undo</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}</div>
      )}
    </section>
  );
}

