"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import WorkCard from "@/components/workspace/WorkCard";
import { BoardCard, BoardHelper, TeamBoard as TeamBoardType, PlanTree, PlanGoal, PlanNode, api } from "@/lib/api";
import { usePoll } from "@/lib/poll";

/* ------------------------------------------------------------------ helpers */

/** Map a PlanNode (goal work item) to the common BoardCard shape so WorkCard can render it. */
function nodeToCard(node: PlanNode): BoardCard {
  const status = mapNodeStatus(node.status);
  return {
    id: node.id,
    title: node.title,
    staff_id: node.staff_id,
    status,
    needs_proposal: node.proposals.some((p) => p.status === "pending" || p.status === "open"),
    awaiting_reply: false,
    progress: { done: 0, total: 0 },
    goal: null,
    cost_usd: 0,
    updated_at: node.created_at,
  };
}

function mapNodeStatus(s: string): BoardCard["status"] {
  if (s === "running" || s === "working") return "running";
  if (s === "needs_you" || s === "waiting_for_owner") return "needs_you";
  if (s === "waiting" || s === "queued") return "waiting";
  if (s === "done" || s === "completed") return "done";
  if (s === "failed" || s === "error") return "failed";
  return "waiting";
}

/** Flatten a PlanNode tree (including children) into a flat list for a goal column. */
function flattenNodes(nodes: PlanNode[]): PlanNode[] {
  const result: PlanNode[] = [];
  const visit = (n: PlanNode) => { result.push(n); n.children?.forEach(visit); };
  nodes.forEach(visit);
  return result;
}

/** Derive a helper-like object from a PlanNode's staff field (for Avatar). */
function nodeHelper(node: PlanNode): { id: string; name: string; role?: string; is_chief?: boolean } | null {
  if (node.staff) return { id: node.staff.id, name: node.staff.name, role: node.staff.role, is_chief: node.staff.is_chief };
  if (node.staff_id) return { id: node.staff_id, name: node.staff_id };
  return null;
}

/* ------------------------------------------------------------------ Goal progress % */
function goalPct(goal: PlanGoal): number {
  const { total, done = 0 } = goal.progress;
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

/* ------------------------------------------------------------------ By-helper column */
function HelperColumn({ helper, paused }: { helper: BoardHelper; paused: boolean }) {
  const isIdle = helper.cards.length === 0;
  const helperObj = { id: helper.id, name: helper.name, role: helper.role, is_chief: helper.is_chief };

  return (
    <div className="board-col">
      <div className="board-col-head">
        <Avatar who={helperObj} size={28} state={helper.status === "working" ? "working" : null} />
        <div className="board-col-title">
          <b>{helper.name}</b>
          <span className="board-col-role">{helper.role}</span>
        </div>
        {helper.is_chief && <span className="chip">Chief</span>}
        {!helper.is_chief && (
          <span
            className={
              helper.status === "working" ? "chip run" :
              helper.status === "blocked" ? "chip warn" :
              helper.status === "failed" ? "chip down" :
              helper.status === "queued" ? "chip warn" :
              "chip idle"
            }
          >
            {helper.status === "idle" ? "Idle" :
             helper.status === "working" ? "Working" :
             helper.status === "blocked" ? "Blocked" :
             helper.status === "failed" ? "Failed" :
             helper.status === "queued" ? "Queued" :
             helper.status === "paused" ? "Paused" :
             helper.status}
          </span>
        )}
      </div>

      <div className="board-col-body">
        {isIdle ? (
          <div className="board-col-empty">
            <i className="ri-sleep-line" />
            <span>No work for {helper.name}</span>
          </div>
        ) : (
          helper.cards.map((card) => (
            <WorkCard
              key={card.id}
              card={card}
              helper={helperObj}
              paused={paused}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ By-goal group */
function GoalGroup({ goal, helpers, paused }: {
  goal: PlanGoal;
  helpers: Map<string, { id: string; name: string; role: string; is_chief: boolean }>;
  paused: boolean;
}) {
  const nodes = flattenNodes(goal.work);
  const pct = goalPct(goal);

  return (
    <div className="goal-group">
      {/* Goal header */}
      <div className="goal-group-head">
        <div className="goal-group-title">
          <i className="ri-flag-2-line" />
          <b>{goal.title}</b>
          {goal.due && <span className="goal-due">{goal.due}</span>}
        </div>
        <div className="goal-group-meta">
          {goal.progress.total > 0 && (
            <div className="goal-progress">
              <div className="goal-progress-bar">
                <i style={{ width: `${pct}%` }} />
              </div>
              <span className="goal-progress-pct">{pct}%</span>
            </div>
          )}
          <span className="chip">{nodes.length} task{nodes.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Cards grid */}
      <div className="goal-group-cards">
        {nodes.length === 0 ? (
          <div className="board-col-empty goal-empty">
            <i className="ri-checkbox-blank-circle-line" />
            <span>No tasks yet</span>
          </div>
        ) : (
          nodes.map((node) => {
            const card = nodeToCard(node);
            const helper = helpers.get(node.staff_id) || nodeHelper(node);
            return (
              <WorkCard
                key={node.id}
                card={card}
                helper={helper}
                paused={paused}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ TeamBoard */

interface TeamBoardProps {
  group: "helper" | "goal";
}

export default function TeamBoard({ group }: TeamBoardProps) {
  const router = useRouter();
  const [board, setBoard] = useState<TeamBoardType | null>(null);
  const [plan, setPlan] = useState<PlanTree | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (group === "helper") {
        const b = await api<TeamBoardType>("/team/board");
        setBoard(b);
      } else {
        const p = await api<PlanTree>("/plan");
        setPlan(p);
      }
      setErr(null);
    } catch (e: any) {
      setErr(e.message ?? "Failed to load board");
    }
  }, [group]);

  usePoll(load, 10000, [load]);

  const paused = board?.paused ?? false;

  /* Build a helpers map for quick lookup in goal view */
  const helpersMap = new Map<string, { id: string; name: string; role: string; is_chief: boolean }>(
    (board?.helpers || []).map((h) => [h.id, { id: h.id, name: h.name, role: h.role, is_chief: h.is_chief }])
  );

  const newWork = async () => {
    try {
      const th = await api<{ id: string }>("/threads", { body: { scope: "master" } });
      router.push(`/chat/?thread=${th.id}`);
    } catch {
      /* silently ignore */
    }
  };

  return (
    <div className="team-board">
      {/* Top bar */}
      <div className="board-topbar">
        <div className="board-topbar-left">
          <button
            className="threads-rail-back"
            onClick={() => router.push("/chat/")}
            aria-label="Back to desk"
          >
            <i className="ri-arrow-left-line" />
            Desk
          </button>
          <div className="board-topbar-title">
            <i className="ri-team-line" />
            <span>Your team at work</span>
          </div>
        </div>

        {/* Segmented toggle: By helper | By goal */}
        <div className="seg" role="tablist" aria-label="Board grouping">
          <button
            className={group === "helper" ? "on" : ""}
            role="tab"
            aria-selected={group === "helper"}
            onClick={() => router.replace("/chat/?view=board&group=helper")}
          >
            By helper
          </button>
          <button
            className={group === "goal" ? "on" : ""}
            role="tab"
            aria-selected={group === "goal"}
            onClick={() => router.replace("/chat/?view=board&group=goal")}
          >
            By goal
          </button>
        </div>

        <span className="sp" />

        {/* + New work → CoS chat */}
        <button className="btn primary sm" onClick={newWork}>
          <i className="ri-add-line" />
          New work
        </button>
      </div>

      {/* Paused banner */}
      {paused && (
        <div className="board-paused-banner">
          <i className="ri-pause-circle-line" />
          <span>Work is paused. Cards are read-only until you resume.</span>
        </div>
      )}

      {/* Error */}
      {err && (
        <div className="board-err">
          <i className="ri-error-warning-line" />
          {err}
        </div>
      )}

      {/* Content area */}
      <div className="board-scroll">
        {group === "helper" && (
          <div className="board-cols">
            {!board && !err && (
              /* Loading shimmer: show placeholder columns */
              [0, 1, 2].map((i) => (
                <div key={i} className="board-col board-col-loading">
                  <div className="board-col-head">
                    <div className="board-col-skeleton board-col-skeleton-avatar" />
                    <div className="board-col-skeleton board-col-skeleton-name" />
                  </div>
                  <div className="board-col-body">
                    <div className="board-col-skeleton board-col-skeleton-card" />
                    <div className="board-col-skeleton board-col-skeleton-card" />
                  </div>
                </div>
              ))
            )}
            {board?.helpers.map((helper) => (
              <HelperColumn key={helper.id} helper={helper} paused={paused} />
            ))}
          </div>
        )}

        {group === "goal" && (
          <div className="board-goals">
            {!plan && !err && (
              <div className="board-col-loading">
                <span className="spin" /> Loading…
              </div>
            )}

            {plan?.goals.map((goal) => (
              <GoalGroup
                key={goal.id}
                goal={goal}
                helpers={helpersMap}
                paused={paused}
              />
            ))}

            {plan && plan.goals.length === 0 && (
              <div className="board-empty-state">
                <i className="ri-flag-2-line" />
                <b>No goals yet</b>
                <span>Create goals in the Plan view to organise your team&apos;s work.</span>
              </div>
            )}

            {/* Unlinked nodes */}
            {plan && plan.unlinked && plan.unlinked.length > 0 && (
              <div className="goal-group goal-group-unlinked">
                <div className="goal-group-head">
                  <div className="goal-group-title">
                    <i className="ri-link-unlink-line" />
                    <b>Unlinked work</b>
                  </div>
                  <span className="chip">{plan.unlinked.length}</span>
                </div>
                <div className="goal-group-cards">
                  {flattenNodes(plan.unlinked).map((node) => (
                    <WorkCard
                      key={node.id}
                      card={nodeToCard(node)}
                      helper={helpersMap.get(node.staff_id) || nodeHelper(node)}
                      paused={paused}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
