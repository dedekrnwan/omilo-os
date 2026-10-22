"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import WorkCard from "@/components/workspace/WorkCard";
import { BoardCard, BoardHelper, TeamBoard as TeamBoardType, PlanTree, PlanGoal, PlanNode, ago, api } from "@/lib/api";
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
/** Progress bar fill %: prefer the primary-KPI percent, else derive from work progress. */
function goalPct(goal: PlanGoal): number {
  if (typeof goal.percent === "number") return Math.max(0, Math.min(100, goal.percent));
  const { total, done = 0 } = goal.progress;
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

/** Big metric number for a goal's left panel — e.g. "92%", or null to hide the metric row. */
function goalMetricNum(goal: PlanGoal): string | null {
  if (typeof goal.percent === "number") return `${goal.percent}%`;
  return null;
}

/** Secondary metric label — e.g. "this week · target 95%", or null. */
function goalMetricLabel(goal: PlanGoal): string | null {
  return goal.metric_label ?? null;
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
type HelperFilter = "all" | "running" | "needs_you" | "done";
const HELPER_FILTERS: [HelperFilter, string][] = [
  ["all", "All"], ["running", "Running"], ["needs_you", "Needs me"], ["done", "Done"],
];

function HelperColumn({
  helper,
  paused,
  onAddWork,
  filter,
}: {
  helper: BoardHelper;
  paused: boolean;
  onAddWork: () => void;
  filter: HelperFilter;
}) {
  const [doneFolded, setDoneFolded] = useState(true);
  const helperObj = { id: helper.id, name: helper.name, role: helper.role, is_chief: helper.is_chief };
  const matchFilter = (c: BoardCard) =>
    filter === "all" ? true : filter === "done" ? c.status === "done" : c.status === filter;
  const visible = helper.cards.filter(matchFilter);
  const activeCards = visible.filter(c => c.status !== "done");
  const doneCards = visible.filter(c => c.status === "done");
  const doneCount = helper.cards.filter(c => c.status === "done").length;
  const showDoneFooter = filter === "all" || filter === "done";
  const forceDoneOpen = filter === "done";
  const activityDotCls = helperActivityDotCls(helper);
  const activityText = helperActivity(helper);
  const emptyMsg = filter === "all"
    ? `No work for ${helper.name}`
    : `No ${filter === "needs_you" ? "needs-me" : filter} work`;
  const bodyCards = [...activeCards, ...(forceDoneOpen ? doneCards : [])];
  const showEmpty = bodyCards.length === 0 && (filter !== "all" || doneCount === 0);

  return (
    <div className="board-col">
      {/* Column header: avatar + name + count badge + "+" button */}
      <div className="board-col-head">
        <Avatar who={helperObj} size={28} state={helper.status === "working" ? "working" : null} />
        <span className="board-col-name">{helper.name}</span>
        <span className="board-col-badge">{filter === "all" ? helper.cards.length : visible.length}</span>
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
        {showEmpty ? (
          <div className="board-col-empty">
            <i className="ri-sleep-line" />
            <span>{emptyMsg}</span>
          </div>
        ) : (
          bodyCards.map((card) => (
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

      {/* Column footer: "✓ N done today" + chevron (only in All view) */}
      {showDoneFooter && !forceDoneOpen && (
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
      )}
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

/* ------------------------------------------------------------------ By-goal: work tree */
/** Status pill for a work node. */
function statusBadge(status: BoardCard["status"]): { label: string; cls: string; icon: boolean } {
  if (status === "done") return { label: "Done", cls: "gtb-done", icon: true };
  if (status === "running") return { label: "Running", cls: "gtb-run", icon: false };
  if (status === "needs_you") return { label: "Needs you", cls: "gtb-warn", icon: false };
  if (status === "failed") return { label: "Failed", cls: "gtb-bad", icon: false };
  return { label: "Waiting", cls: "gtb-idle", icon: false };
}

/** How a node came to exist, in plain words — for the meta line. */
const ORIGIN_LABELS: Record<string, string> = {
  handoff: "handed out", handout: "handed out", delegated: "handed out", delegate: "handed out", delegation: "handed out",
  review: "review", cron: "routine", shift: "routine", chat: "chat", proposal: "proposal",
  goal: "goal", plan: "plan",
};
function originLabel(o?: string | null): string {
  if (!o) return "";
  return ORIGIN_LABELS[o] ?? o.replace(/_/g, " ");
}

/** One node in the goal work tree — renders itself, then its children nested with a connector rail. */
function GoalWorkRow({ node, helpers, paused }: {
  node: PlanNode;
  helpers: Map<string, { id: string; name: string; role: string; is_chief: boolean }>;
  paused: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const kids = node.children ?? [];
  const hasKids = kids.length > 0;
  const owner = helpers.get(node.staff_id) || nodeHelper(node);
  const badge = statusBadge(nodeToCard(node).status);
  const meta = [owner?.name, originLabel(node.origin), ago(node.created_at), node.headline]
    .filter(Boolean).join(" · ");
  const open = async () => {
    if (busy || paused || !node.id) return;
    setBusy(true);
    try {
      const th = await api<{ id: string }>("/threads", { body: { scope: "task", ref_id: node.id } });
      router.push(`/chat/?thread=${th.id}`);
    } catch { /* silently ignore */ } finally { setBusy(false); }
  };
  return (
    <div className="goal-tree-node">
      <div className="goal-tree-row">
        {hasKids ? (
          <button className="goal-tree-toggle" onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded} aria-label={expanded ? "Collapse" : "Expand"}>
            <i className={`ri-arrow-${expanded ? "down" : "right"}-s-line`} />
          </button>
        ) : (
          <span className="goal-tree-toggle goal-tree-leaf" aria-hidden />
        )}
        <div className="goal-tree-click" role="button" tabIndex={0}
          onClick={open} onKeyDown={(e) => e.key === "Enter" && open()}>
          {owner && <Avatar who={owner} size={24} state={null} />}
          <div className="goal-tree-text">
            <div className="goal-tree-title">{node.title}</div>
            {meta && <div className="goal-tree-meta">{meta}</div>}
          </div>
        </div>
        <span className={`goal-tree-badge ${badge.cls}`}>
          {badge.icon && <i className="ri-check-line" />}{badge.label}
        </span>
      </div>
      {hasKids && expanded && (
        <div className="goal-tree-children">
          {kids.map((ch) => (
            <GoalWorkRow key={ch.id} node={ch} helpers={helpers} paused={paused} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ By-goal row */
function GoalRow({
  goal,
  helpers,
  paused,
  onAddWork,
  onTalk,
}: {
  goal: PlanGoal;
  helpers: Map<string, { id: string; name: string; role: string; is_chief: boolean }>;
  paused: boolean;
  onAddWork: () => void;
  onTalk: () => void;
}) {
  const [open, setOpen] = useState(true);
  const flat = flattenNodes(goal.work);
  const needCount = flat.filter(n => n.proposals.some(p => p.status === "pending" || p.status === "open")).length;
  const pct = goalPct(goal);
  const metricNum = goalMetricNum(goal);
  const metricLabel = goalMetricLabel(goal);
  const { dot, text } = goalStatusInfo(goal);
  const doneCount = typeof goal.done_this_week === "number"
    ? goal.done_this_week
    : flat.filter(n => n.status === "done" || n.status === "completed").length;

  /* Team avatars: prefer backend `team`, else derive distinct contributors from work nodes */
  let contributors: { id: string; name: string; role?: string; is_chief?: boolean }[] = [];
  if (goal.team && goal.team.length > 0) {
    contributors = goal.team.map((t) => helpers.get(t.id) ?? { id: t.id, name: t.name });
  } else {
    const seen = new Set<string>();
    for (const node of flat) {
      const h = helpers.get(node.staff_id) || nodeHelper(node);
      if (h && !seen.has(h.id)) {
        seen.add(h.id);
        contributors.push(h);
      }
    }
  }

  return (
    <div className="goal-row">
      {/* Left panel */}
      <div className="goal-panel">
        <div className="goal-panel-head">
          <i className="ri-focus-3-line goal-panel-icon" />
          <span className="goal-panel-title">{goal.title}</span>
          <button
            className="goal-panel-collapse"
            onClick={() => setOpen(o => !o)}
            aria-expanded={open}
            aria-label={open ? "Collapse work" : "Expand work"}
            title={open ? "Hide work" : "Show work"}
          >
            <i className={`ri-arrow-${open ? "up" : "down"}-s-line`} />
          </button>
        </div>
        {metricNum && (
          <div className="goal-panel-metric">
            <span className="goal-panel-metric-num">{metricNum}</span>
            {metricLabel && (
              <span className="goal-panel-metric-sub">{metricLabel}</span>
            )}
          </div>
        )}
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
          <div className="goal-panel-foot-meta">
            {contributors.length > 0 && (
              <div className="goal-panel-avatars">
                {contributors.slice(0, 5).map((c) => (
                  <Avatar key={c.id} who={c} size={24} state={null} />
                ))}
              </div>
            )}
            <span className="goal-panel-done">
              <i className="ri-checkbox-circle-line" />
              {doneCount} done this week
            </span>
          </div>
          <button className="goal-panel-talk" onClick={onTalk} title="Talk about it">
            <i className="ri-message-3-line" />
            Talk about it
          </button>
        </div>
      </div>

      {/* Right: hierarchical, scannable work tree */}
      <div className="goal-work">
        <div className="goal-work-head">
          <span className="goal-work-head-label">WORK</span>
          <span className="goal-work-head-count">· {flat.length} item{flat.length !== 1 ? "s" : ""}</span>
          <span className="sp" />
          {needCount > 0 && <span className="goal-work-head-need">{needCount} need you</span>}
        </div>
        {open && (
          <div className="goal-work-list">
            {goal.work.length === 0 ? (
              <div className="goal-work-empty">
                <i className="ri-checkbox-blank-circle-line" />
                <span>No tasks yet</span>
              </div>
            ) : (
              goal.work.map((node) => (
                <GoalWorkRow
                  key={node.id}
                  node={node}
                  helpers={helpers}
                  paused={paused}
                />
              ))
            )}
            {/* "Give work to this goal" — spawns a seeded Chief chat about this goal */}
            <button className="goal-give-row" onClick={onAddWork} disabled={paused} title="Give work to this goal">
              <i className="ri-add-line" />
              <span>Give work to this goal</span>
            </button>
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
  const router = useRouter();
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
            <button
              key={shift.id}
              className="routine-chip routine-chip-idle"
              onClick={() => router.push(`/calendar/?shift=${shift.id}`)}
              title={`Open "${shift.name}" in the calendar`}
            >
              {agent && <Avatar who={agent} size={22} state={null} />}
              <span className="routine-dot routine-dot-idle" />
              {chipLabel}
              {schedule && <span className="routine-chip-schedule">{schedule}</span>}
            </button>
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
  const [hFilter, setHFilter] = useState<HelperFilter>("all");
  const [search, setSearch] = useState("");

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
  const searchQ = search.trim().toLowerCase();
  const visibleGoals = searchQ
    ? goals.filter(g => g.title.toLowerCase().includes(searchQ) || flattenNodes(g.work).some(n => n.title.toLowerCase().includes(searchQ)))
    : goals;
  const goalRunning = goals.reduce((n, g) => n + flattenNodes(g.work).filter(nd => nd.status === "running" || nd.status === "working").length, 0);
  const goalNeedsYou = goals.reduce((n, g) => n + flattenNodes(g.work).filter(nd => nd.proposals.some(p => p.status === "pending" || p.status === "open")).length, 0);

  const subtitle = group === "helper"
    ? `${totalHelpers} helper${totalHelpers !== 1 ? "s" : ""} · ${totalRunning} running · ${totalNeedsYou} waiting on you`
    : `${goals.length} goal${goals.length !== 1 ? "s" : ""} · ${goalRunning} running · ${goalNeedsYou} waiting on you`;

  /** Open a Chief-of-Staff chat, or — when a helper is passed — a staff-scoped chat for that helper. */
  const newWork = async (helper?: BoardHelper) => {
    try {
      const body = helper
        ? { scope: "staff", staff_id: helper.id }
        : { scope: "master" };
      const th = await api<{ id: string }>("/threads", { body });
      router.push(`/chat/?thread=${th.id}`);
    } catch {
      /* silently ignore */
    }
  };

  /** Spawn a new Chief-of-Staff chat seeded to plan work for a specific goal. */
  const planGoalWork = async (goal: PlanGoal) => {
    try {
      const th = await api<{ id: string }>("/threads", { body: { scope: "master" } });
      await api(`/threads/${th.id}/messages`, {
        body: {
          text: `Let's plan new work for the goal "${goal.title}". What should we do next?`,
          mentions: [],
        },
      });
      router.push(`/chat/?thread=${th.id}`);
    } catch {
      /* silently ignore */
    }
  };

  /** Open the goal's discussion thread (backend scope=goal branch may land separately). */
  const talkAboutGoal = async (goal: PlanGoal) => {
    try {
      const th = await api<{ id: string }>("/threads", { body: { scope: "goal", ref_id: goal.id } });
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
        <button className="btn primary sm board-new-work" onClick={() => newWork()}>
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
          <>
          {board && (
            <div className="board-filter-bar">
              <div className="seg" role="tablist" aria-label="Filter work">
                {HELPER_FILTERS.map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={hFilter === key}
                    className={hFilter === key ? "on" : ""}
                    onClick={() => setHFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="sp" />
              <span className="board-filter-count">{totalRunning} running · {totalNeedsYou} waiting on you</span>
            </div>
          )}
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
                onAddWork={() => newWork(helper)}
                filter={hFilter}
              />
            ))}
            {/* Ghost "Add a helper" column */}
            {board && <GhostHelperColumn onClick={goToStaff} />}
          </div>
          </>
        )}

        {/* ---- By goal ---- */}
        {group === "goal" && (
          <div className="board-goals">
            {!plan && !err && (
              <div className="board-col-loading">
                <span className="spin" /> Loading…
              </div>
            )}

            {plan && goals.length > 0 && (
              <div className="board-search-bar">
                <div className="board-search-field">
                  <i className="ri-search-line" />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search goals & work…"
                    aria-label="Search goals and work"
                  />
                  {search && (
                    <button className="board-search-clear" onClick={() => setSearch("")} aria-label="Clear search">
                      <i className="ri-close-line" />
                    </button>
                  )}
                </div>
                <span className="sp" />
                <span className="board-filter-count">{goals.length} goal{goals.length !== 1 ? "s" : ""}</span>
              </div>
            )}

            {visibleGoals.map((goal) => (
              <GoalRow
                key={goal.id}
                goal={goal}
                helpers={helpersMap}
                paused={paused}
                onAddWork={() => planGoalWork(goal)}
                onTalk={() => talkAboutGoal(goal)}
              />
            ))}

            {plan && goals.length > 0 && visibleGoals.length === 0 && (
              <div className="board-empty-state">
                <i className="ri-search-line" />
                <b>No matches</b>
                <span>Nothing matches &ldquo;{search}&rdquo;. Try a different search.</span>
              </div>
            )}

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
