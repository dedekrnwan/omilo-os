"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import { useOverview } from "@/components/Shell";
import { Thread, api, ago } from "@/lib/api";
import ThreadsRail, { RailThread } from "@/components/workspace/ThreadsRail";
import Composer from "@/components/Composer";
import { Attached } from "@/components/ComposerTools";

/* ------------------------------------------------------------------ helpers */

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* derive a display-friendly first name from a full name / email */
function firstName(who: string): string {
  const n = who.split(/[@\s]/)[0];
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : who;
}

/* chip label → status chip styling */
function statusChip(s: string): { label: string; cls: string } {
  if (s === "needs_you") return { label: "Needs you", cls: "chip warn" };
  if (s === "active" || s === "running") return { label: "Working", cls: "chip run" };
  if (s === "done") return { label: "Done", cls: "chip up" };
  if (s === "idle") return { label: "Idle", cls: "chip idle" };
  return { label: s, cls: "chip" };
}

const SUGGESTIONS = [
  { icon: "ri-search-eye-line", label: "Review what's waiting" },
  { icon: "ri-calendar-check-line", label: "Plan next week" },
  { icon: "ri-money-dollar-circle-line", label: "What did we spend?" },
];

/* ------------------------------------------------------------------ sub-components */

/* DeskComposer: wraps the shared <Composer> and wires the start-screen send path.
   On send: get-or-create the master thread, post the message, then navigate to /chat. */
type OverviewStaff = { id: string; name: string; status: string; is_chief: boolean; running: number };

function DeskComposer({ staff }: { staff: OverviewStaff[] }) {
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const router = useRouter();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSend = async (text: string, files: Attached[], _mentions: string[]) => {
    const trimmed = text.trim();
    if (!trimmed && !files.length) return;
    setErr(null);
    setSending(true);
    try {
      /* get-or-create the master (Chief of Staff) thread */
      const th = await api<{ id: string }>("/threads", { body: { scope: "master" } });
      /* post the message (files already uploaded by Composer; pass block refs) */
      const body: Record<string, unknown> = { text: trimmed || `(attached ${files.length} file${files.length > 1 ? "s" : ""})` };
      if (files.length) body.blocks = files.map((f) => ({ type: "file", ...f }));
      await api(`/threads/${th.id}/messages`, { body });
      router.push(`/chat/?thread=${th.id}`);
    } catch (e: any) {
      setErr(e.message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="desk-composer">
      <Composer
        staff={staff as unknown as import("@/lib/api").Staff[]}
        threadId={null}
        placeholder="Tell me what you need. I'll hand it to the right helper and keep you posted here…"
        awaitingReply={sending}
        error={err}
        onSend={handleSend}
      />
    </div>
  );
}

/* "LATEST FROM CHIEF OF STAFF" — latest CoS message bubble */
function LatestCoS({ threads, staffMap }: { threads: Thread[]; staffMap: Map<string, { id: string; name: string; is_chief: boolean }> }) {
  const chief = Array.from(staffMap.values()).find((s) => s.is_chief);
  const masterThread = threads.find((t) => t.scope === "master");
  const msgs = masterThread?.messages || [];
  const latest = [...msgs].reverse().find((m) => m.role === "agent");

  return (
    <div className="deskcard">
      <div className="deskcard-head">
        <span className="deskcard-label">Latest from Chief of Staff</span>
      </div>
      {latest ? (
        <div className="deskcard-body">
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            {chief && <Avatar who={chief} size={28} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: "1.5", color: "var(--ink)" }}>
                {latest.text?.slice(0, 280)}{latest.text && latest.text.length > 280 ? "…" : ""}
              </p>
              <span style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, display: "block" }}>
                {ago((latest as any).at)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="deskcard-body">
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Nothing yet — send a message to get started.
          </p>
        </div>
      )}
    </div>
  );
}

/* Recent work list */
function RecentWork({ threads, staffMap }: {
  threads: Thread[];
  staffMap: Map<string, { id: string; name: string; is_chief: boolean }>;
}) {
  /* show non-master, non-general threads sorted by last activity */
  const recent = threads
    .filter((t) => t.scope !== "master" && t.ref_id !== "general")
    .sort((a, b) => {
      const aAt = (a as any).last_at || a.updated_at || "";
      const bAt = (b as any).last_at || b.updated_at || "";
      return bAt.localeCompare(aAt);
    })
    .slice(0, 8);

  return (
    <div className="deskcard">
      <div className="deskcard-head">
        <span className="deskcard-label">Your work</span>
      </div>
      {recent.length === 0 ? (
        <div className="deskcard-body">
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            No recent work yet — start a conversation with the Chief of Staff.
          </p>
        </div>
      ) : (
        <div className="desk-recent">
          {recent.map((t) => {
            const helper = staffMap.get(t.staff_id);
            const group = (t as any).group as string | undefined;
            const subtitle = (t as any).subtitle as string | undefined;
            const lastAt = (t as any).last_at || (t as any).updated_at;
            const sc = group === "needs_you"
              ? statusChip("needs_you")
              : group === "active"
                ? statusChip("active")
                : group === "earlier"
                  ? statusChip("done")
                  : statusChip("done");
            const label = t.scope === "group"
              ? `# ${t.title}`
              : t.scope === "staff" && helper
                ? helper.name
                : t.title || "Thread";
            return (
              <a
                key={t.id}
                href={`/chat/?thread=${t.id}`}
                className="desk-recent-item"
              >
                {helper && <Avatar who={helper} size={24} />}
                <div className="desk-ri-t">
                  <b>{label}</b>
                  {subtitle && <span>{subtitle}</span>}
                </div>
                <div className="desk-ri-meta">
                  <span className={sc.cls}>{sc.label}</span>
                  {lastAt && <span>{ago(lastAt)}</span>}
                  <i className="ri-arrow-right-s-line" />
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* Team now right panel */
function TeamNow({ staffMap, threads }: {
  staffMap: Map<string, { id: string; name: string; is_chief: boolean; status: string; running: number }>;
  threads: Thread[];
}) {
  const helpers = Array.from(staffMap.values());
  const nonChief = helpers.filter((s) => !s.is_chief);
  const chief = helpers.find((s) => s.is_chief);

  /* find the most recent active thread for a helper */
  const helperThread = (staffId: string): Thread | undefined =>
    threads
      .filter((t) => t.staff_id === staffId && t.scope !== "master")
      .sort((a, b) => {
        const aAt = (a as any).last_at || a.updated_at || "";
        const bAt = (b as any).last_at || b.updated_at || "";
        return bAt.localeCompare(aAt);
      })[0];

  return (
    <div className="team-now">
      <div className="team-now-head">
        <b>Your team right now</b>
        <span>live</span>
      </div>
      <div className="team-now-scroll">
        {nonChief.map((s) => {
          const active = s.status === "working" || s.running > 0;
          const th = helperThread(s.id);
          const subtitle = th ? ((th as any).subtitle || th.title) : null;
          const sc = active ? statusChip("active") : statusChip("idle");

          return (
            <div key={s.id} className="team-card">
              <div className="team-card-head">
                <Avatar who={s} size={28} />
                <div className="team-card-t">
                  <b>{s.name}</b>
                  {subtitle && <span>{subtitle}</span>}
                </div>
                <span className={sc.cls}>{sc.label}</span>
              </div>
              {active && (
                <div className="team-card-track">
                  <div className="team-card-track-bar">
                    <i style={{ width: "60%" }} />
                  </div>
                  <div className="team-card-track-label">
                    <span>In progress</span>
                  </div>
                </div>
              )}
              {th && (
                <a
                  href={`/chat/?thread=${th.id}`}
                  className="team-card-link"
                >
                  <i className="ri-external-link-line" />
                  Open their work
                </a>
              )}
            </div>
          );
        })}

        {/* Chief of Staff card */}
        {chief && (
          <div className="team-card">
            <div className="team-card-head">
              <Avatar who={chief} size={28} />
              <div className="team-card-t">
                <b>{chief.name}</b>
                <span>Routes work to the team</span>
              </div>
              <span className={chief.running > 0 ? "chip run" : "chip idle"}>
                {chief.running > 0 ? "Working" : "Idle"}
              </span>
            </div>
            <a
              href="#"
              className="team-card-link"
              onClick={async (e) => {
                e.preventDefault();
                try {
                  const th = await api<{ id: string }>("/threads", { body: { scope: "master" } });
                  window.location.href = `/chat/?thread=${th.id}`;
                } catch {
                  window.location.href = "/chat/";
                }
              }}
            >
              <i className="ri-chat-3-line" />
              Open chat
            </a>
          </div>
        )}

        {/* No DMs hint */}
        <div className="team-now-hint">
          <i className="ri-at-line" style={{ marginRight: 5 }} />
          No DMs needed. @mention a helper in any work and they join it.
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Desk (main export) */

export default function Desk() {
  const { overview } = useOverview();
  const [me, setMe] = useState<{ name?: string; email?: string } | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [railFilter, setRailFilter] = useState<"all" | "needs_you" | "active">("all");

  /* load user name */
  useEffect(() => {
    api<{ name?: string; email?: string }>("/auth/me").then(setMe).catch(() => {});
  }, []);

  /* load threads for recent work + CoS latest message + rail */
  useEffect(() => {
    api<Thread[]>("/threads").then(setThreads).catch(() => {});
  }, []);

  const who = firstName(me?.name || me?.email || "there");

  /* build staffMap from overview.staff (id, name, status, is_chief, running) */
  const staffMap = new Map(
    (overview?.staff || []).map((s) => [s.id, s])
  );

  const chief = overview?.staff.find((s) => s.is_chief);

  return (
    <div className="desk">
      {/* Left rail — the threads rail shared with the focus session */}
      <ThreadsRail
        threads={threads as RailThread[]}
        activeThreadId={null}
        filter={railFilter}
        onFilterChange={setRailFilter}
      />

      {/* Center column */}
      <div className="desk-center">
        <div className="desk-scroll">
          <div className="desk-inner">
            {/* Greeting */}
            <div className="desk-greeting">
              {chief && <Avatar who={chief} size={44} />}
              <div className="desk-greeting-text">
                <h1>{greeting()}, {who}</h1>
                <p>Tell me what you need. I&apos;ll hand it to the right helper and keep you posted here.</p>
              </div>
            </div>

            {/* Composer */}
            <DeskComposer staff={overview?.staff ?? []} />

            {/* Suggestions */}
            <div className="desk-suggestions">
              {SUGGESTIONS.map(({ icon, label }) => (
                <button
                  key={label}
                  className="desk-suggestion"
                  type="button"
                  onClick={async () => {
                    if (!chief) return;
                    try {
                      const th = await api<{ id: string }>("/threads", { body: { scope: "master" } });
                      await api(`/threads/${th.id}/messages`, { body: { text: label } });
                      window.location.href = `/chat/?thread=${th.id}`;
                    } catch {
                      /* silently ignore */
                    }
                  }}
                >
                  <i className={icon} />
                  {label}
                </button>
              ))}
            </div>

            {/* Latest from Chief of Staff */}
            <LatestCoS threads={threads} staffMap={staffMap} />

            {/* Recent work */}
            <RecentWork threads={threads} staffMap={staffMap} />
          </div>
        </div>
      </div>

      {/* Right column: Team now */}
      <TeamNow
        staffMap={staffMap as Map<string, { id: string; name: string; is_chief: boolean; status: string; running: number }>}
        threads={threads}
      />
    </div>
  );
}
