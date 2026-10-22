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
  const needs_proposal = node.proposals.some((p) => p.status === "pending" || p.status === "open");
  const status: BoardCard["status"] = needs_proposal ? "needs_you" : mapNodeStatus(node.status);
  return {
    id: node.id,
    title: node.title,
    staff_id: node.staff_id,
    status,
    needs_proposal,
    awaiting_reply: false,
    progress: { done: 0, total: 0 },
    goal: null,
    cost_usd: 0,
    updated_at: node.created_at,
  };
}

function mapNodeStatus(s: string): BoardCard["status"] {
  if (s === "running" || s === "working") return "running";
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
  if (node.staff) {
    if (typeof node.staff === "string") return { id: node.staff_id, name: node.staff };
    return { id: node.staff.id, name: node.staff.name, role: node.staff.role, is_chief: node.staff.is_chief };
  }
  if (node.staff_id) return { id: node.staff_id, name: node.staff_id };
  return null;
}

/* ------------------------------------------------------------------ Derived counts */

/** Count of needs_you cards across all helpers. */
function countNeedsYou(helpers: BoardHelper[]): number {
  return helpers.reduce((n, h) => n + h.cards.filter(c => c.status === "needs_you").length, 0);
}

/** Count of running cards across all helpers. */
function countRunning(helpers: BoardHelper[]): number {
  return helpers.reduce((n, h) => n + h.cards.filter(c => c.status === "running").length, 0);
}

/** Derive a one-line activity text for a helper.
 *  Prefers helper.activity (from office state current.brief) when available;
 *  falls back to card-derived text when null/absent. */
function helperActivity(helper: BoardHelper): string {
  // Use the server-side activity (≤80 chars from the running task/chat brief) when present
  if (helper.activity) return helper.activity;
  const running = helper.cards.filter(c => c.status === "running");
  const waiting = helper.cards.filter(c => c.status === "waiting");
  const needsYou = helper.cards.filter(c => c.status === "needs_you");
  if (helper.status === "idle" || helper.cards.length === 0) return "No active work";
  if (needsYou.length > 0) return `Waiting on you · ${needsYou.length} item${needsYou.length !== 1 ? "s" : ""}`;
  if (running.length > 0) {
    const card = running[0];
    return card.title.length > 42 ? card.title.slice(0, 42) + "…" : card.title;
  }
  if (waiting.length > 0) return `${waiting.length} task${waiting.length !== 1 ? "s" : ""} queued`;
  return helper.status.charAt(0).toUpperCase() + helper.status.slice(1);
}

/** Convert a cron expression to a short human-readable schedule label.
 *  Never throws — returns empty string when cron is empty or unparseable. */
function cronLabel(cron?: string | null): string {
  if (!cron) return "";
  try {
    const parts = cron.trim().split(/\s+/);
    if (parts.length < 5) return "";
    const [min, hour, dom, , dow] = parts;
    // Hourly: "0 * * * *"
    if (hour === "*") return "Hourly";
    // Daily: "X H * * *" (dom=*, dow=*)
    if (dom === "*" && dow === "*") {
      const h = parseInt(hour, 10);
      if (!isNaN(h)) {
        const ampm = h < 12 ? "am" : "pm";
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `Daily ${h12}${ampm}`;
      }
      return "Daily";
    }
    // Weekly: "X H * * N" where N is a specific weekday (0-6)
    if (dow !== "*" && dom === "*") {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const d = parseInt(dow, 10);
      if (!isNaN(d) && d >= 0 && d < 7) return `Weekly · ${days[d]}`;
      // Multiple weekdays like "1,3,5"
      const ds = dow.split(",").map(x => parseInt(x.trim(), 10)).filter(x => !isNaN(x) && x >= 0 && x < 7);
      if (ds.length > 0) return ds.map(x => days[x]).join("/");
    }
    // Fallback: show human time if parseable
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (!isNaN(h) && !isNaN(m)) {
      const ampm = h < 12 ? "am" : "pm";
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${h12}:${m.toString().padStart(2, "0")}${ampm}`;
    }
  } catch {
    // Never throw on odd cron
  }
  return "";
}

/** Dot class for helper activity. */
function helperActivityDotCls(helper: BoardHelper): string {
  if (helper.status === "idle") return "col-status-dot col-status-dot-idle";
  if (helper.status === "working") return "col-status-dot col-status-dot-run";
  if (helper.status === "blocked" || helper.status === "failed") return "col-status-dot col-status-dot-bad";
  if (helper.status === "queued") return "col-status-dot col-status-dot-warn";
  return "col-status-dot col-status-dot-idle";
}


/* ------------------------------------------------------------------ Goal progress % */
function goalPct(goal: PlanGoal): number {
  const { total, done = 0 } = goal.progress;
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

/** Big metric string for a goal. */
function goalMetric(goal: PlanGoal): string {
  const pct = goalPct(goal);
  const { total, done = 0 } = goal.progress;
  if (total > 0) {
    const due = goal.due ? ` · by ${goal.due}` : "";
    return `${done} of ${total} · ${pct}%${due}`;
  }
  if (goal.target) return goal.target;
  return "No metric";
}

/** Goal status dot class + text. */
function goalStatusInfo(goal: PlanGoal): { dot: string; text: string } {
  const s = goal.status?.toLowerCase() || "";
  if (s === "behind" || s === "at_risk") return { dot: "goal-dot-bad", text: "Behind" };
  if (s === "on_track" || s === "healthy") return { dot: "goal-dot-ok", text: "On track" };
  if (s === "close" || s === "warning") return { dot: "goal-dot-warn", text: "Close" };
  return { dot: "goal-dot-idle", text: s || "In progress" };
}

/* ------------------------------------------------------------------ By-helper column */
function HelperColumn({
  helper,
  paused,
  onAddWork,
}: {
  helper: BoardHelper;
  paused: boolean;
  onAddWork: () => void;
}) {
  const [doneFolded, setDoneFolded] = useState(true);
  const helperObj = { id: helper.id, name: helper.name, role: helper.role, is_chief: helper.is_chief };
  const activeCards = helper.cards.filter(c => c.status !== "done");
  const doneCards = helper.cards.filter(c => c.status === "done");
  const doneCount = doneCards.length;
  const activityDotCls = helperActivityDotCls(helper);
  const activityText = helperActivity(helper);

  return (
    <div className="board-col">
      {/* Column header: avatar + name + count badge + "+" button */}
      <div className="board-col-head">
        <Avatar who={helperObj} size={28} state={helper.status === "working" ? "working" : null} />
        <span className="board-col-name">{helper.name}</span>
        <span className="board-col-badge">{helper.cards.length}</span>
        <button
          className="board-col-add"
          onClick={onAddWork}
          aria-label={`Add work to ${helper.name}`}
          title="Add work"
        >
          <i className="ri-add-line" />
        </button>
      </div>

      {/* Column status line: dot + activity text */}
      <div className="board-col-status">
        <span className={activityDotCls} />
        <span className="board-col-status-text">{activityText}</span>
      </div>

      {/* Cards */}
      <div className="board-col-body">
        {activeCards.length === 0 && doneCards.length === 0 ? (
          <div className="board-col-empty">
            <i className="ri-sleep-line" />
            <span>No work for {helper.name}</span>
          </div>
        ) : (
          activeCards.map((card) => (
            <WorkCard
              key={card.id}
              card={card}
              helper={helperObj}
              paused={paused}
              subtitle={card.goal?.title ?? null}
            />
          ))
        )}
      </div>

      {/* Column footer: "✓ N done today" + chevron */}
      <div className="board-col-footer">
        <button
          className="board-col-done-toggle"
          onClick={() => setDoneFolded(f => !f)}
          aria-expanded={!doneFolded}
        >
          <i className="ri-checkbox-circle-line" />
          <span>{doneCount} done today</span>
          <i className={`ri-arrow-${doneFolded ? "down" : "up"}-s-line board-col-chevron`} />
        </button>
        {!doneFolded && doneCards.length > 0 && (
          <div className="board-col-done-list">
            {doneCards.map((card) => (
              <WorkCard
                key={card.id}
                card={card}
                helper={helperObj}
                paused={paused}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Ghost "Add a helper" column */
function GhostHelperColumn({ onClick }: { onClick: () => void }) {
  return (
    <div className="board-col board-col-ghost" role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}>
      <i className="ri-user-add-line board-ghost-icon" />
      <span className="board-ghost-label">Add a helper</span>
    </div>
  );
}

/* ------------------------------------------------------------------ By-goal row */
function GoalRow({
  goal,
  helpers,
  paused,
  isLast,
}: {
  goal: PlanGoal;
  helpers: Map<string, { id: string; name: string; role: string; is_chief: boolean }>;
  paused: boolean;
  isLast: boolean;
}) {
  const nodes = flattenNodes(goal.work);
  const pct = goalPct(goal);
  const metric = goalMetric(goal);
  const { dot, text } = goalStatusInfo(goal);
  const doneCount = nodes.filter(n => n.status === "done" || n.status === "completed").length;

  /* Collect unique contributors from this goal's work */
  const contributors: { id: string; name: string; role?: string; is_chief?: boolean }[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const h = helpers.get(node.staff_id) || nodeHelper(node);
    if (h && !seen.has(h.id)) {
      seen.add(h.id);
      contributors.push(h);
    }
  }

  return (
    <div className="goal-row">
      {/* Left panel */}
      <div className="goal-panel">
        <div className="goal-panel-head">
          <i className="ri-focus-2-line goal-panel-icon" />
          <span className="goal-panel-title">{goal.title}</span>
        </div>
        <div className="goal-panel-metric">
          <span className="goal-panel-metric-num">{metric.split(" ")[0]}</span>
          {metric.split(" ").length > 1 && (
            <span className="goal-panel-metric-sub">{metric.split(" ").slice(1).join(" ")}</span>
          )}
        </div>
        <div className="goal-panel-bar-wrap">
          <div className="goal-panel-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="goal-panel-status">
          <span className={`goal-panel-dot ${dot}`} />
          <span className="goal-panel-status-text">{text}</span>
        </div>
        <div className="goal-panel-foot">
          {contributors.length > 0 && (
            <div className="goal-panel-avatars">
              {contributors.slice(0, 5).map((c) => (
                <Avatar key={c.id} who={c} size={20} state={null} />
              ))}
            </div>
          )}
          <span className="goal-panel-done">
            <i className="ri-checkbox-circle-line" />
            {doneCount} done this week
          </span>
        </div>
      </div>

      {/* Right: horizontal card strip */}
      <div className="goal-cards-strip">
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
                subtitle={node.headline}
                showOwner
              />
            );
          })
        )}
        {/* Ghost "Give work to this goal" card — only on the last goal row */}
        {isLast && (
          <div className="goal-card-ghost">
            <i className="ri-add-line" />
            <span>Give work to this goal</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Routines footer strip */
function RoutinesStrip({ plan, helpers }: {
  plan: PlanTree;
  helpers: Map<string, { id: string; name: string; role: string; is_chief: boolean }>;
}) {
  /* Render from plan.shifts that are NOT tied to a goal (goal_id === null) */
  const unlinkedShifts = (plan.shifts || []).filter(s => !s.goal_id);

  if (unlinkedShifts.length === 0) return null;

  /* Resolve a shift's agent (shift.staff may be an id or a name) for its avatar */
  const shiftAgent = (staff: string) =>
    helpers.get(staff) ||
    Array.from(helpers.values()).find((h) => h.name === staff) ||
    (staff ? { id: staff, name: staff } : null);

  return (
    <div className="routines-strip">
      <span className="routines-label">
        <i className="ri-loop-left-line" />
        <b>Routine</b>
        <span className="routines-label-sub">not tied to a goal</span>
      </span>
      <div className="routines-chips">
        {unlinkedShifts.slice(0, 8).map((shift) => {
          const schedule = cronLabel(shift.cron);
          const chipLabel = shift.name.length > 28 ? shift.name.slice(0, 28) + "…" : shift.name;
          const agent = shiftAgent(shift.staff);
          return (
            <span key={shift.id} className="routine-chip routine-chip-idle">
              {agent && <Avatar who={agent} size={22} state={null} />}
              <span className="routine-dot routine-dot-idle" />
              {chipLabel}
              {schedule && <span className="routine-chip-schedule">{schedule}</span>}
            </span>
          );
        })}
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
      const fetches: [Promise<TeamBoardType>, Promise<PlanTree> | null] = [
        api<TeamBoardType>("/team/board"),
        group === "goal" ? api<PlanTree>("/plan") : null,
      ];
      const [b, p] = await Promise.all([fetches[0], fetches[1] ?? Promise.resolve(null)]);
      setBoard(b);
      if (p !== null) setPlan(p);
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

  const helpers = board?.helpers || [];
  const totalHelpers = helpers.length;
  const totalRunning = countRunning(helpers);
  const totalNeedsYou = countNeedsYou(helpers);

  const goals = plan?.goals || [];
  const goalRunning = goals.reduce((n, g) => n + flattenNodes(g.work).filter(nd => nd.status === "running" || nd.status === "working").length, 0);
  const goalNeedsYou = goals.reduce((n, g) => n + flattenNodes(g.work).filter(nd => nd.proposals.some(p => p.status === "pending" || p.status === "open")).length, 0);

  const subtitle = group === "helper"
    ? `${totalHelpers} helper${totalHelpers !== 1 ? "s" : ""} · ${totalRunning} running · ${totalNeedsYou} waiting on you`
    : `${goals.length} goal${goals.length !== 1 ? "s" : ""} · ${goalRunning} running · ${goalNeedsYou} waiting on you`;

  const newWork = async () => {
    try {
      const th = await api<{ id: string }>("/threads", { body: { scope: "master" } });
      router.push(`/chat/?thread=${th.id}`);
    } catch {
      /* silently ignore */
    }
  };

  const goToStaff = () => router.push("/staff");

  return (
    <div className="team-board">
      {/* Head: back link above the title, grouping toggle + New work on the right (matches design) */}
      <div className="board-head">
        <div className="board-head-title">
          <button
            className="board-head-back"
            onClick={() => router.push("/chat/")}
            aria-label="Back to desk"
          >
            <i className="ri-arrow-left-line" />
            Start
          </button>
          <span className="board-head-h1">Your team at work</span>
          {board && (
            <span className="board-head-sub">{subtitle}</span>
          )}
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

        {/* + New work → CoS chat */}
        <button className="btn primary sm board-new-work" onClick={newWork}>
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
        {/* ---- By helper ---- */}
        {group === "helper" && (
          <div className="board-cols">
            {!board && !err && (
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
            {helpers.map((helper) => (
              <HelperColumn
                key={helper.id}
                helper={helper}
                paused={paused}
                onAddWork={newWork}
              />
            ))}
            {/* Ghost "Add a helper" column */}
            {board && <GhostHelperColumn onClick={goToStaff} />}
          </div>
        )}

        {/* ---- By goal ---- */}
        {group === "goal" && (
          <div className="board-goals">
            {!plan && !err && (
              <div className="board-col-loading">
                <span className="spin" /> Loading…
              </div>
            )}

            {goals.map((goal, idx) => (
              <GoalRow
                key={goal.id}
                goal={goal}
                helpers={helpersMap}
                paused={paused}
                isLast={idx === goals.length - 1}
              />
            ))}

            {plan && goals.length === 0 && (
              <div className="board-empty-state">
                <i className="ri-flag-2-line" />
                <b>No goals yet</b>
                <span>Create goals in the Plan view to organise your team&apos;s work.</span>
              </div>
            )}

            {/* Routines footer strip */}
            {plan && <RoutinesStrip plan={plan} helpers={helpersMap} />}
          </div>
        )}
      </div>
    </div>
  );
}
