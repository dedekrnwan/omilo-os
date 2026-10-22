"use client";
import { useRouter } from "next/navigation";
import { Thread, ago } from "@/lib/api";

/* Thread list item shape — the /threads endpoint (Task 3) enriches threads with
   group, subtitle, and last_at. We fall back gracefully if any field is missing. */
export type RailThread = Thread & {
  group?: "needs_you" | "active" | "earlier";
  subtitle?: string;
  last_at?: string;
};

interface ThreadsRailProps {
  threads: RailThread[];
  activeThreadId?: string | null;
  /* filter tab — "all" | "needs_you" | "active" */
  filter?: "all" | "needs_you" | "active";
  onFilterChange?: (f: "all" | "needs_you" | "active") => void;
}

function dotClass(group?: string, awaiting?: boolean): string {
  if (awaiting || group === "needs_you") return "needs";
  if (group === "active") return "active";
  if (group === "earlier") return "done";
  return "";
}

function threadTitle(t: RailThread): string {
  if (t.scope === "master") return "Chief of Staff";
  if (t.scope === "group") return `# ${t.title}`;
  return t.title || "Thread";
}

const GROUP_ORDER: Array<"needs_you" | "active" | "earlier"> = ["needs_you", "active", "earlier"];
const GROUP_LABEL: Record<string, string> = {
  needs_you: "Needs you",
  active: "Active",
  earlier: "Earlier today",
};

export default function ThreadsRail({
  threads,
  activeThreadId,
  filter = "all",
  onFilterChange,
}: ThreadsRailProps) {
  const router = useRouter();

  const filtered = filter === "all" ? threads : threads.filter((t) => t.group === filter);

  /* group by group field; threads without a group fall under "earlier" */
  const grouped = GROUP_ORDER.map((g) => ({
    key: g,
    label: GROUP_LABEL[g],
    rows: filtered.filter((t) => (t.group ?? "earlier") === g),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="threads-rail">
      <div className="threads-rail-head">
        {/* Back to desk */}
        <div className="threads-rail-nav">
          <button
            className="threads-rail-back"
            onClick={() => router.push("/chat/")}
            aria-label="Back to desk"
          >
            <i className="ri-arrow-left-line" />
            Start
          </button>
          <button
            className="threads-rail-board"
            onClick={() => router.push("/chat/?view=board")}
            aria-label="Team board"
            title="Team board"
          >
            <i className="ri-layout-column-line" />
            Board
          </button>
        </div>
        {/* Segmented filter */}
        <div className="seg" role="tablist" aria-label="Thread filter">
          <button
            className={filter === "all" ? "on" : ""}
            role="tab"
            aria-selected={filter === "all"}
            onClick={() => onFilterChange?.("all")}
          >
            All
          </button>
          <button
            className={filter === "needs_you" ? "on" : ""}
            role="tab"
            aria-selected={filter === "needs_you"}
            onClick={() => onFilterChange?.("needs_you")}
          >
            Needs you
          </button>
          <button
            className={filter === "active" ? "on" : ""}
            role="tab"
            aria-selected={filter === "active"}
            onClick={() => onFilterChange?.("active")}
          >
            Active
          </button>
        </div>
      </div>

      <div className="threads-rail-body">
        {grouped.length === 0 && (
          <div className="small" style={{ color: "var(--muted)", padding: "12px 8px" }}>
            No threads here yet.
          </div>
        )}
        {grouped.map(({ key, label, rows }) => (
          <div key={key} className="thread-group">
            <div className="thread-group-label">{label}</div>
            {rows.map((t) => {
              const dot = dotClass(t.group, t.awaiting_reply);
              const lastAt = t.last_at || t.updated_at;
              return (
                <button
                  key={t.id}
                  className={`thread-row${activeThreadId === t.id ? " on" : ""}`}
                  onClick={() => router.push(`/chat/?thread=${t.id}`)}
                  aria-current={activeThreadId === t.id ? "true" : undefined}
                >
                  <span className={`thread-row-dot${dot ? ` ${dot}` : ""}`} />
                  <span className="thread-row-t">
                    <b>{threadTitle(t)}</b>
                    {t.subtitle && <span>{t.subtitle}</span>}
                  </span>
                  {lastAt && (
                    <span className="thread-row-time">{ago(lastAt)}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
