"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import Composer from "@/components/Composer";
import { type MentionGoal } from "@/components/Mentions";
import { Attached } from "@/components/ComposerTools";
import { useOverview } from "@/components/Shell";
import { Staff, Thread, api, ago } from "@/lib/api";

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

function DeskComposer({ staff }: { staff: Staff[] }) {
  const [err, setErr] = useState<string | null>(null);
  const [goals, setGoals] = useState<MentionGoal[]>([]);
  const router = useRouter();

  // active goals for the @-mention picker (resilient: [] on error)
  useEffect(() => { api<MentionGoal[]>("/goals").then(setGoals).catch(() => setGoals([])); }, []);

  /* Reuse the shared Composer (same as /chat/?thread=). On the desk there is no thread
     yet, so sending opens a Chief-of-Staff thread, posts the message there, and navigates
     into it. The usage meter is hidden here (showPoolMeter={false}). */
  const send = useCallback(async (text: string, files: Attached[], mentions: string[], goalIds: string[] = []) => {
    if (!text.trim() && !files.length) return;
    setErr(null);
    try {
      const th = await api<{ id: string }>("/threads", { body: { scope: "master" } });
      await api(`/threads/${th.id}/messages`, {
        body: {
          text: text.trim() || `(attached ${files.length} file${files.length > 1 ? "s" : ""})`,
          blocks: files.length ? files.map((f) => ({ type: "file", ...f })) : undefined,
          mentions,
          goal_ids: goalIds,
        },
      });
      router.push(`/chat/?thread=${th.id}`);
    } catch (e: any) {
      setErr(e.message ?? "Failed to send");
    }
  }, [router]);

  return (
    <div className="desk-composer">
      <Composer
        staff={staff}
        goals={goals}
        threadId={null}
        placeholder="What should the team do next? Type @ to bring in a helper…"
        error={err}
        onSend={send}
        showPoolMeter={false}
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

/* "YOUR WORK" block with counts + Open board + rows + summary footer */
function YourWork({ threads, staffMap, router }: {
  threads: Thread[];
  staffMap: Map<string, { id: string; name: string; is_chief: boolean }>;
  router: ReturnType<typeof useRouter>;
}) {
  /* categorize non-master threads */
  const workThreads = threads
    .filter((t) => t.scope !== "master" && t.ref_id !== "general")
    .sort((a, b) => {
      const aAt = (a as any).last_at || a.updated_at || "";
      const bAt = (b as any).last_at || b.updated_at || "";
      return bAt.localeCompare(aAt);
    });

  /* compute honest counts from thread data */
  const needsYouCount = workThreads.filter((t) => (t as any).group === "needs_you").length;
  const runningCount = workThreads.filter((t) => (t as any).group === "active").length;
  const totalCount = workThreads.length;

  /* show top 5 in the card */
  const shown = workThreads.slice(0, 5);
  const remaining = Math.max(0, totalCount - shown.length);

  const scheduledCount = workThreads.filter((t) => (t as any).group === "scheduled").length;
  const waitingCount = workThreads.filter((t) => (t as any).group === "waiting" || (t as any).group === "idle").length;

  return (
    <div className="deskcard">
      <div className="deskcard-head">
        <span className="deskcard-label">
          Your work
          {totalCount > 0 && (
            <>
              {needsYouCount > 0 && <span className="deskcard-count warn"> · {needsYouCount} need you</span>}
              {runningCount > 0 && <span className="deskcard-count run"> · {runningCount} running</span>}
              <span className="deskcard-count muted"> · {totalCount} in total</span>
            </>
          )}
        </span>
        <a
          href="/chat/?view=board"
          className="btn sm"
          style={{ marginLeft: "auto", flexShrink: 0 }}
          onClick={(e) => { e.preventDefault(); router.push("/chat/?view=board"); }}
        >
          Open board
        </a>
      </div>
      {shown.length === 0 ? (
        <div className="deskcard-body">
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            No recent work yet — start a conversation with the Chief of Staff.
          </p>
        </div>
      ) : (
        <>
          <div className="desk-recent">
            {shown.map((t) => {
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
          {/* Summary footer row */}
          <div className="desk-work-footer">
            <span className="desk-work-footer-text">
              {remaining > 0 && <>{remaining} more on the team board</>}
              {runningCount > 0 && <> · {runningCount} running</>}
              {scheduledCount > 0 && <> · {scheduledCount} scheduled</>}
              {waitingCount > 0 && <> · {waitingCount} waiting</>}
            </span>
            <a
              href="/chat/?view=board"
              className="desk-work-footer-link"
              onClick={(e) => { e.preventDefault(); router.push("/chat/?view=board"); }}
            >
              Open board <i className="ri-arrow-right-line" />
            </a>
          </div>
        </>
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
        <a href="/chat/?view=board" className="team-board-card">
          <span className="team-board-card-tile"><i className="ri-layout-grid-line" /></span>
          <span className="team-board-card-txt">
            <b>Open the team board</b>
            <span>See everyone&apos;s work in columns — by helper or by goal</span>
          </span>
          <i className="ri-arrow-right-line team-board-card-arrow" />
        </a>
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
  const router = useRouter();

  /* load user name */
  useEffect(() => {
    api<{ name?: string; email?: string }>("/auth/me").then(setMe).catch(() => {});
  }, []);

  /* load threads for recent work + CoS latest message */
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
      {/* Center column (no left ThreadsRail — 2-column layout) */}
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
            <DeskComposer
              staff={(overview?.staff || []) as unknown as Staff[]}
            />

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

            {/* Your work */}
            <YourWork threads={threads} staffMap={staffMap} router={router} />
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
