"use client";
import { useCallback, useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import { InboxItem, api } from "@/lib/api";
import { taskItems } from "@/lib/actions";
import { menu } from "@/lib/menu";
import { openTask } from "@/lib/open";
import { usePoll } from "@/lib/poll";

/* The work map: a tree drawn left to right. Your goals → the jobs the Chief of Staff handed out for them → what
   helpers passed on → what is waiting on you (approvals, questions, alerts). Lines show who came from whom. */

type PNode = { id: string; title: string; staff_id: string; staff: string; status: string; origin: string; created_at: string; headline: string;
  proposals: { id: string; title: string; status: string }[]; children: PNode[] };
type PGoal = { id: string; title: string; target: string; due: string; status: string; work: PNode[] };
type Plan = { goals: PGoal[]; unlinked: PNode[] };

type MNode = { key: string; kind: "goal" | "job" | "need" | "none"; title: string; sub: string; status?: string; staff?: { id: string; name: string };
  taskId?: string; item?: InboxItem; children: MNode[]; x: number; y: number; need: number };

const COL = 268, W = 228, H = 60, GAP = 14, PAD = 16;
const NEED: Record<string, [string, string]> = { proposal: ["ri-checkbox-circle-line", "Approve"], question: ["ri-question-line", "Answer"], alert: ["ri-alarm-warning-line", "Alert"] };

function build(plan: Plan, items: InboxItem[], onlyNeeds: boolean): MNode[] {
  const byTask = new Map<string, InboxItem[]>();
  for (const i of items) if (i.task_id) byTask.set(i.task_id, [...(byTask.get(i.task_id) || []), i]);
  const job = (n: PNode): MNode => {
    const needs: MNode[] = (byTask.get(n.id) || []).map((i) => ({ key: `i-${i.id}`, kind: "need", title: i.title, sub: NEED[i.kind]?.[1] || i.kind, item: i, taskId: n.id,
      children: [], x: 0, y: 0, need: 1 }));
    const kids = n.children.map(job);
    const m: MNode = { key: `t-${n.id}`, kind: "job", title: n.title, sub: n.headline || n.origin, status: n.status, staff: { id: n.staff_id, name: n.staff }, taskId: n.id,
      children: [...kids, ...needs], x: 0, y: 0, need: needs.length + kids.reduce((a, k) => a + k.need, 0) };
    return m;
  };
  const prune = (ns: MNode[]): MNode[] => (onlyNeeds ? ns.filter((n) => n.need > 0).map((n) => ({ ...n, children: prune(n.children) })) : ns);
  const roots: MNode[] = plan.goals.filter((g) => g.status === "active" || g.work.length).map((g) => {
    const kids = g.work.map(job);
    return { key: `g-${g.id}`, kind: "goal" as const, title: g.title, sub: g.target || (g.due ? `by ${g.due}` : "Set by you"), children: kids, x: 0, y: 0,
      need: kids.reduce((a, k) => a + k.need, 0) };
  });
  const loose = plan.unlinked.map(job);
  const linked = new Set<string>();
  const walk = (n: MNode) => { if (n.taskId) linked.add(n.taskId); n.children.forEach(walk); };
  [...roots, ...loose].forEach(walk);
  const orphanNeeds: MNode[] = items.filter((i) => !i.task_id || !linked.has(i.task_id)).map((i) => ({ key: `i-${i.id}`, kind: "need", title: i.title,
    sub: NEED[i.kind]?.[1] || i.kind, item: i, children: [], x: 0, y: 0, need: 1 }));
  if (loose.length || orphanNeeds.length) {
    roots.push({ key: "none", kind: "none", title: "Not linked to a goal", sub: "Work you or the team started without a goal", children: [...loose, ...orphanNeeds],
      x: 0, y: 0, need: loose.reduce((a, k) => a + k.need, 0) + orphanNeeds.length });
  }
  return prune(roots);
}

function layout(roots: MNode[]): { w: number; h: number; all: MNode[] } {
  let next = PAD, maxDepth = 0;
  const all: MNode[] = [];
  const place = (n: MNode, d: number) => {
    maxDepth = Math.max(maxDepth, d);
    n.x = PAD + d * COL;
    if (!n.children.length) { n.y = next; next += H + GAP; }
    else { n.children.forEach((c) => place(c, d + 1)); n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2; }
    all.push(n);
  };
  roots.forEach((r) => { place(r, 0); next += GAP * 2; });
  return { w: PAD * 2 + maxDepth * COL + W, h: Math.max(next, H + PAD * 2), all };
}

export default function WorkMap({ days = 30, defaultOnlyNeeds = true, onOpenItem }: { days?: number; defaultOnlyNeeds?: boolean; onOpenItem?: (i: InboxItem) => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [onlyNeeds, setOnlyNeeds] = useState(defaultOnlyNeeds);
  const [zoom, setZoom] = useState(1);
  const load = useCallback(async () => {
    const [p, i] = await Promise.all([api<Plan>(`/plan?days=${days}`), api<InboxItem[]>("/inbox?status=open")]);
    setPlan(p); setItems(i);
  }, [days]);
  usePoll(load, 20000, [load], (n) => n?.kind === "inbox" || n?.kind?.startsWith("job"));
  const { w, h, all } = useMemo(() => (plan ? layout(build(plan, items, onlyNeeds)) : { w: 0, h: 0, all: [] }), [plan, items, onlyNeeds]);
  if (!plan) return <p className="small">Loading…</p>;

  const open = (n: MNode) => {
    if (n.kind === "need" && n.item) { if (onOpenItem) onOpenItem(n.item); else if (n.taskId) openTask(n.taskId, "approvals"); }
    else if (n.taskId) openTask(n.taskId);
  };
  const edges = all.flatMap((n) => n.children.map((c) => {
    const x1 = n.x + W, y1 = n.y + H / 2, x2 = c.x, y2 = c.y + H / 2, mx = (x1 + x2) / 2;
    return <path key={`${n.key}>${c.key}`} d={`M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} className={`wm-e ${c.kind === "need" ? "need" : ""}`} />;
  }));
  return (
    <div className="wm">
      <div className="wm-bar">
        <div className="seg">
          <button className={onlyNeeds ? "on" : ""} onClick={() => setOnlyNeeds(true)}>What needs me</button>
          <button className={!onlyNeeds ? "on" : ""} onClick={() => setOnlyNeeds(false)}>All work ({days} days)</button>
        </div>
        <span className="small wm-legend"><i className="ri-flag-2-line" /> your goal <span>›</span> job <span>›</span> handed on <span>›</span> <b className="wm-need-dot" /> waiting on you</span>
        <span className="sp" />
        <button className="iconbtn" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.5, zoom - 0.15))}><i className="ri-zoom-out-line" /></button>
        <button className="iconbtn" aria-label="Zoom in" onClick={() => setZoom(Math.min(1.5, zoom + 0.15))}><i className="ri-zoom-in-line" /></button>
      </div>
      {all.length === 0 ? (
        <div className="empty"><b>{onlyNeeds ? "Nothing waiting on you" : "No work yet"}</b><span>{onlyNeeds ? "Switch to All work to see everything that is going on." : "Jobs show up here as the team works."}</span></div>
      ) : (
        <div className="wm-scroll">
          <div className="wm-canvas" style={{ width: w * zoom, height: h * zoom }}>
            <div style={{ width: w, height: h, transform: `scale(${zoom})`, transformOrigin: "0 0", position: "relative" }}>
              <svg width={w} height={h} className="wm-svg">{edges}</svg>
              {all.map((n) => (
                <div key={n.key} className={`wm-n ${n.kind} ${n.status || ""} ${n.item ? `k-${n.item.kind}` : ""}`} style={{ left: n.x, top: n.y, width: W, height: H }}
                  role="button" tabIndex={0} onClick={() => open(n)} onKeyDown={(e) => { if (e.key === "Enter") open(n); }}
                  onContextMenu={n.kind === "job" && n.taskId ? menu(() => taskItems({ id: n.taskId!, staff_id: n.staff!.id, brief: n.title, status: n.status || "" }, n.staff!.name)) : undefined}>
                  {n.kind === "goal" || n.kind === "none" ? <span className="wm-ic"><i className={n.kind === "goal" ? "ri-flag-2-line" : "ri-question-line"} /></span>
                    : n.kind === "need" ? <span className="wm-ic need"><i className={NEED[n.item?.kind || ""]?.[0] || "ri-inbox-line"} /></span>
                    : <Avatar who={n.staff} size={24} state={n.status === "running" ? "working" : null} />}
                  <span className="wm-t"><b>{n.title}</b><span>{n.kind === "job" ? `${n.staff?.name} · ${n.status}` : n.sub}</span></span>
                  {n.need > 0 && n.kind !== "need" && <span className="wm-badge" title={`${n.need} waiting on you below`}>{n.need}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
