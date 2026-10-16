"use client";
import { useCallback, useState } from "react";
import Avatar from "@/components/Avatar";
import Drawer from "@/components/Drawer";
import { Err, StatusChip } from "@/components/ui";
import { ago, api } from "@/lib/api";
import { taskItems } from "@/lib/actions";
import { MenuItem, copy, menu, sep } from "@/lib/menu";
import { openTask } from "@/lib/open";
import { usePoll } from "@/lib/poll";

/* The plan: the goals you set at the top, the work that serves each goal under it. The Chief of Staff hands work out
   for a goal, helpers hand off sub-jobs, approved proposals are executed: every step stays under its goal. */

type PNode = { id: string; title: string; staff_id: string; staff: string; status: string; origin: string; created_at: string; headline: string;
  proposals: { id: string; title: string; status: string }[]; children: PNode[] };
type PGoal = { id: string; title: string; target: string; due: string; status: string; position: number;
  jobs: { id: string; name: string; staff_id: string; staff: string; cron: string }[]; work: PNode[];
  progress: { total: number; done?: number; failed?: number; running?: number; queued?: number; proposals: number; approved: number } };
type Plan = { days: number; goals: PGoal[]; unlinked: PNode[]; shifts: { id: string; name: string; staff: string; goal_id: string | null }[] };
type Form = { id?: string; title: string; target: string; due: string; status: string; shift_ids: string[] };

const ORIGIN: Record<string, [string, string]> = {
  delegation: ["ri-share-forward-line", "handed out"], execution: ["ri-check-double-line", "doing what you approved"],
  revision: ["ri-edit-2-line", "revising"], shift: ["ri-repeat-line", "regular job"], manual: ["ri-user-line", "from you"],
  chat: ["ri-chat-3-line", "from a chat"], followup: ["ri-question-answer-line", "after your answer"],
};

function Node({ n, depth, goals, onMove }: { n: PNode; depth: number; goals: PGoal[]; onMove: (taskId: string, goalId: string | null) => void }) {
  const [open, setOpen] = useState(depth < 2);
  const [ic, label] = ORIGIN[n.origin] || ["ri-file-list-3-line", n.origin];
  const items = (): MenuItem[] => [
    ...taskItems({ id: n.id, staff_id: n.staff_id, brief: n.title, status: n.status }, n.staff).slice(0, 7),
    ...(depth === 0 ? [sep, { heading: "Move to goal" } as MenuItem,
      ...goals.filter((g) => g.status === "active").map((g) => ({ label: g.title.slice(0, 48), icon: "ri-flag-2-line", onSelect: () => onMove(n.id, g.id) })),
      { label: "Not linked to a goal", icon: "ri-close-circle-line", onSelect: () => onMove(n.id, null) }] : []),
    sep, { label: "Copy the id", icon: "ri-file-copy-line", hint: n.id, onSelect: () => copy(n.id) },
  ];
  return (
    <li className="pn">
      <div className="pn-row" onContextMenu={menu(items)}>
        {n.children.length > 0
          ? <button className="pn-tog" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen(!open)}><i className={open ? "ri-arrow-down-s-line" : "ri-arrow-right-s-line"} /></button>
          : <span className="pn-tog" />}
        <Avatar who={{ id: n.staff_id, name: n.staff }} size={22} state={n.status === "running" ? "working" : null} />
        <button className="pn-main" onClick={() => openTask(n.id)}>
          <span className="pn-title">{n.title}</span>
          <span className="small"><i className={ic} /> {n.staff} · {label} · {ago(n.created_at)}{n.headline ? ` · ${n.headline}` : ""}</span>
        </button>
        {n.proposals.length > 0 && <span className="chip outline" title={n.proposals.map((p) => `${p.title} (${p.status})`).join("\n")}><i className="ri-inbox-archive-line" />{n.proposals.length}</span>}
        <StatusChip status={n.status} />
      </div>
      {open && n.children.length > 0 && <ul className="pn-kids">{n.children.map((c) => <Node key={c.id} n={c} depth={depth + 1} goals={goals} onMove={onMove} />)}</ul>}
    </li>
  );
}

export default function PlanPage() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [days, setDays] = useState(30);
  const [form, setForm] = useState<Form | null>(null);
  const [showLoose, setShowLoose] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setPlan(await api<Plan>(`/plan?days=${days}`)); setErr(null); } catch (e: any) { setErr(e.message); } }, [days]);
  usePoll(load, () => (plan?.goals.some((g) => (g.progress.running || 0) + (g.progress.queued || 0) > 0) ? 5000 : 30000), [load],
    (n) => n?.kind?.startsWith("job") || n?.kind === "inbox");

  const move = async (taskId: string, goalId: string | null) => { try { await api(`/tasks/${taskId}/goal`, { method: "PUT", body: { goal_id: goalId } }); } catch (e: any) { setErr(e.message); } };
  const edit = (g?: PGoal) => setForm(g ? { id: g.id, title: g.title, target: g.target, due: g.due, status: g.status, shift_ids: g.jobs.map((j) => j.id) }
    : { title: "", target: "", due: "", status: "active", shift_ids: [] });
  const save = async () => {
    if (!form) return;
    try {
      const body = { title: form.title, target: form.target, due: form.due, status: form.status, shift_ids: form.shift_ids };
      if (form.id) await api(`/goals/${form.id}`, { method: "PATCH", body }); else await api("/goals", { body });
      setForm(null);
    } catch (e: any) { setErr(e.message); }
  };
  const remove = async () => {
    if (!form?.id || !confirm("Delete this goal? Its work stays, just without a goal.")) return;
    await api(`/goals/${form.id}`, { method: "DELETE" }); setForm(null);
  };
  const goalMenu = (g: PGoal): MenuItem[] => [{ heading: g.title }, { label: "Edit", icon: "ri-edit-line", onSelect: () => edit(g) },
    g.status !== "done" ? { label: "Mark as reached", icon: "ri-flag-2-fill", onSelect: () => api(`/goals/${g.id}`, { method: "PATCH", body: { status: "done" } }) }
      : { label: "Make active again", icon: "ri-flag-2-line", onSelect: () => api(`/goals/${g.id}`, { method: "PATCH", body: { status: "active" } }) },
    { label: "Copy the goal", icon: "ri-file-copy-line", onSelect: () => copy(`${g.title}${g.target ? ` — ${g.target}` : ""}`) }];

  return (
    <div className="plan">
      <div className="sechead" style={{ alignItems: "flex-end" }}>
        <div><h1 style={{ marginBottom: 4 }}>Plan</h1>
          <p className="sub" style={{ margin: 0 }}>Your goals at the top. Under each: what the Chief of Staff handed out for it, what helpers passed on, and what is being done with your approval.</p></div>
        <span className="sp" />
        <div className="seg">{[[7, "7 days"], [30, "30 days"], [90, "90 days"]].map(([d, l]) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d as number)}>{l}</button>)}</div>
        <button className="btn primary" onClick={() => edit()}><i className="ri-add-line" />New goal</button>
      </div>
      <Err error={err} />
      {!plan ? <p className="small">Loading…</p> : (
        <>
          {plan.goals.length === 0 && (
            <div className="empty"><b>No goals yet</b><span>Add what you want to reach. The Chief of Staff links the work it hands out to these goals.</span>
              <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => edit()}><i className="ri-add-line" />New goal</button></div></div>
          )}
          <div className="plan-goals">
            {plan.goals.map((g) => {
              const p = g.progress, total = p.total || 0, done = p.done || 0;
              return (
                <section key={g.id} className={`paper pg ${g.status !== "active" ? "pg-off" : ""}`}>
                  <div className="pg-head" onContextMenu={menu(() => goalMenu(g))}>
                    <span className="pg-flag"><i className={g.status === "done" ? "ri-flag-2-fill" : "ri-flag-2-line"} /></span>
                    <div className="pg-t">
                      <span className="small pg-by">Set by you{g.due ? ` · by ${g.due}` : ""}{g.status === "done" ? " · reached" : g.status === "dropped" ? " · dropped" : ""}</span>
                      <b>{g.title}</b>
                      {g.target && <span className="small">{g.target}</span>}
                    </div>
                    <div className="pg-num">
                      <span className="inl"><span className="inl-bar" style={{ width: 90 }}><i style={{ width: `${total ? (done * 100) / total : 0}%`, background: "#0ca30c" }} /></span>
                        <span className="small">{done}/{total} done</span></span>
                      <span className="small">{p.running ? `${p.running} working · ` : ""}{p.approved}/{p.proposals} approved</span>
                    </div>
                    <button className="iconbtn" aria-label="Edit goal" onClick={() => edit(g)}><i className="ri-edit-line" /></button>
                  </div>
                  {g.jobs.length > 0 && (
                    <div className="pg-jobs">{g.jobs.map((j) => (
                      <span key={j.id} className="chip outline" title={j.cron}><Avatar who={{ id: j.staff_id, name: j.staff }} size={16} />{j.name}</span>
                    ))}</div>
                  )}
                  {g.work.length === 0 ? <p className="small" style={{ margin: "10px 0 0" }}>No work for this goal in the last {plan.days} days. Ask the Chief of Staff in the Workspace, or link a regular job to it.</p>
                    : <ul className="pn-root">{g.work.map((n) => <Node key={n.id} n={n} depth={0} goals={plan.goals} onMove={move} />)}</ul>}
                </section>
              );
            })}
          </div>
          {plan.unlinked.length > 0 && (
            <section className="paper pg" style={{ marginTop: 16 }}>
              <button className="pg-head pg-loose" onClick={() => setShowLoose(!showLoose)}>
                <span className="pg-flag"><i className="ri-question-line" /></span>
                <div className="pg-t"><b>Not linked to a goal</b><span className="small">{plan.unlinked.length} job{plan.unlinked.length === 1 ? "" : "s"}. Right-click one to move it under a goal.</span></div>
                <i className={showLoose ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
              </button>
              {showLoose && <ul className="pn-root">{plan.unlinked.map((n) => <Node key={n.id} n={n} depth={0} goals={plan.goals} onMove={move} />)}</ul>}
            </section>
          )}
        </>
      )}

      <Drawer open={!!form} onClose={() => setForm(null)} icon={<i className="ri-flag-2-line" />} title={form?.id ? "Edit goal" : "New goal"}
        sub="What you want to reach. Your helpers see it and the Chief of Staff links work to it."
        footer={form && <>
          {form.id && <button className="btn quiet" onClick={remove}><i className="ri-delete-bin-line" />Delete</button>}<span className="sp" />
          <button className="btn" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn primary" disabled={!form.title.trim()} onClick={save}>{form.id ? "Save" : "Add goal"}</button></>}>
        {form && (
          <>
            <div className="dw-sec">
              <label style={{ marginTop: 0 }}>Goal</label>
              <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. 10 paying RTs" />
              <label>What success looks like</label>
              <textarea rows={3} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="With a number: MRR Rp 5 juta, churn under 3%" />
              <label>By when</label>
              <input type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
              {form.id && (
                <><label>Status</label>
                  <div className="seg">{[["active", "Active"], ["done", "Reached"], ["dropped", "Dropped"]].map(([k, l]) => (
                    <button key={k} type="button" className={form.status === k ? "on" : ""} onClick={() => setForm({ ...form, status: k })}>{l}</button>))}</div></>
              )}
            </div>
            <div className="dw-sec">
              <h3>Regular jobs that serve it</h3>
              <p className="dw-help" style={{ marginTop: 0 }}>Every run of these counts toward the goal.</p>
              {(plan?.shifts || []).map((sh) => {
                const on = form.shift_ids.includes(sh.id);
                const other = sh.goal_id && sh.goal_id !== form.id ? plan?.goals.find((g) => g.id === sh.goal_id)?.title : null;
                return (
                  <label key={sh.id} className="check">
                    <input type="checkbox" checked={on} onChange={() => setForm({ ...form, shift_ids: on ? form.shift_ids.filter((x) => x !== sh.id) : [...form.shift_ids, sh.id] })} />
                    <span>{sh.name} <span className="small">· {sh.staff}{other ? ` · now under “${other}”` : ""}</span></span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}
