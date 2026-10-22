"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import ChatThread from "@/components/ChatThread";
import { FullThread } from "@/components/Conversation";
import { menu } from "@/lib/menu";
import { Staff, Thread, api } from "@/lib/api";
import { RunEvent } from "@/components/Run";

/* ------------------------------------------------------------------ helpers */

/* Derive participant staff ids from a thread: staff_id + pending + distinct agent authors */
function participantIds(th: FullThread): string[] {
  const seen = new Set<string>();
  const add = (id?: string | null) => { if (id) seen.add(id); };
  add(th.staff_id);
  (th.pending || []).forEach(add);
  for (const m of (th.messages ?? [])) {
    if (m.role === "agent" && m.author) add(m.author);
  }
  return Array.from(seen);
}

/* Needs-you threads in order — used to compute "N of M" and next/prev */
function needsYouThreads(threads: Thread[]): Thread[] {
  return threads.filter((t) => t.group === "needs_you" || t.awaiting_reply);
}

/* ------------------------------------------------------------------ work-nav bar */
function WorkNav({
  thread,
  threads,
}: {
  thread: FullThread;
  threads: Thread[];
}) {
  const router = useRouter();

  /* Determine position among needs-you items */
  const nyThreads = needsYouThreads(threads);
  const isNeedsYou = thread.group === "needs_you" || thread.awaiting_reply;
  const nyIdx = nyThreads.findIndex((t) => t.id === thread.id);
  const nyPos = nyIdx >= 0 ? nyIdx + 1 : null;
  const nyTotal = nyThreads.length;

  /* Next needs-you thread (wraps) */
  const nextThread =
    nyIdx >= 0 && nyTotal > 1
      ? nyThreads[(nyIdx + 1) % nyTotal]
      : null;

  const nextTitle = nextThread
    ? (nextThread.title || "Next").slice(0, 38)
    : null;

  return (
    <div className="work-nav">
      {/* Left: back + status dot + position */}
      <div className="work-nav-left">
        <button
          className="work-nav-back"
          onClick={() => router.push("/chat/?view=board")}
          aria-label="Back to team board"
        >
          <i className="ri-arrow-left-line" />
          Team board
        </button>
        {isNeedsYou && nyPos !== null && (
          <>
            <span className="work-nav-dot" aria-hidden />
            <span className="work-nav-pos">
              Needs you · {nyPos} of {nyTotal}
            </span>
          </>
        )}
      </div>

      {/* Right: next pill + up/down chevrons */}
      {nextThread && nextTitle && (
        <div className="work-nav-right">
          <button
            className="work-nav-next"
            onClick={() => router.push(`/chat/?thread=${nextThread.id}`)}
            aria-label={`Go to next: ${nextTitle}`}
          >
            Next
            <span className="work-nav-next-title">{nextTitle}</span>
            <i className="ri-arrow-right-line" />
          </button>
          {nyTotal > 1 && (
            <div className="work-nav-chevrons">
              <button
                className="iconbtn"
                aria-label="Previous work"
                onClick={() =>
                  nyIdx > 0
                    ? router.push(`/chat/?thread=${nyThreads[nyIdx - 1].id}`)
                    : undefined
                }
                disabled={nyIdx <= 0}
              >
                <i className="ri-arrow-up-s-line" />
              </button>
              <button
                className="iconbtn"
                aria-label="Next work"
                onClick={() =>
                  nyIdx < nyTotal - 1
                    ? router.push(`/chat/?thread=${nyThreads[nyIdx + 1].id}`)
                    : undefined
                }
                disabled={nyIdx >= nyTotal - 1}
              >
                <i className="ri-arrow-down-s-line" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ work header */
function WorkHead({
  thread,
  staff,
  onAddHelper,
}: {
  thread: FullThread;
  staff: Staff[];
  onAddHelper: (staffId: string) => Promise<void>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const partIds = participantIds(thread);
  const participants = partIds.map((id) => staff.find((s) => s.id === id)).filter(Boolean) as Staff[];
  const MAX_SHOWN = 4;
  const shown = participants.slice(0, MAX_SHOWN);
  const overflow = participants.length - MAX_SHOWN;

  /* helpers not yet in this thread — candidates for "add helper" */
  const notIn = staff.filter((s) => !partIds.includes(s.id));

  const title =
    thread.scope === "master"
      ? "Chief of Staff"
      : thread.scope === "group"
        ? `# ${thread.title}`
        : thread.title || "Thread";

  /* Linked goal — populated by thread_extras.enrich when scope=="task" and a TaskGoal link exists */
  const goalTitle = thread.goal?.title || null;

  const isNeedsYou = thread.group === "needs_you" || thread.awaiting_reply;

  const doAdd = async (staffId: string) => {
    setAdding(true);
    setAddOpen(false);
    try { await onAddHelper(staffId); } finally { setAdding(false); }
  };

  return (
    <div className="work-head">
      {/* Title row */}
      <div className="work-head-top">
        <span className="work-head-title">{title}</span>
        {isNeedsYou && (
          <span className="chip warn work-head-chip">
            <i className="ri-time-line" />
            Needs you
          </span>
        )}
      </div>

      {/* Goal line */}
      {goalTitle && (
        <div className="work-head-goal">
          <i className="ri-flag-2-line" />
          <span>Goal · {goalTitle}</span>
        </div>
      )}

      {/* Participants + actions row */}
      <div className="work-head-meta">
        {shown.length > 0 && (
          <div className="work-head-avs">
            {shown.map((s) => (
              <span key={s.id} className="work-head-av" title={s.name}>
                <Avatar who={s} size={22} />
              </span>
            ))}
            {overflow > 0 && (
              <span className="work-head-overflow" title={`${overflow} more`}>
                +{overflow}
              </span>
            )}
          </div>
        )}

        {/* Add helper button */}
        {notIn.length > 0 && (
          <div style={{ position: "relative" }}>
            <button
              className="work-head-add"
              disabled={adding}
              onClick={() => setAddOpen((o) => !o)}
              aria-label="Add helper to this thread"
              aria-expanded={addOpen}
            >
              <i className="ri-user-add-line" />
              Add helper
            </button>
            {addOpen && (
              <div
                className="ctx"
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  zIndex: 36,
                  minWidth: 180,
                  background: "var(--surface)",
                  border: "1px solid var(--line-strong)",
                  borderRadius: "var(--r-lg)",
                  boxShadow: "0 8px 24px -8px rgba(0,0,0,.2)",
                  overflow: "hidden",
                }}
              >
                {notIn.map((s) => (
                  <button
                    key={s.id}
                    className="ctx-item"
                    onClick={() => doAdd(s.id)}
                  >
                    <Avatar who={s} size={18} />
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            {addOpen && (
              <div
                style={{ position: "fixed", inset: 0, zIndex: 35 }}
                onClick={() => setAddOpen(false)}
                aria-hidden
              />
            )}
          </div>
        )}

        <span className="sp" />

        {/* More menu */}
        <button
          className="iconbtn"
          aria-label="Thread options"
          onMouseDown={menu(() => [
            { heading: title },
            {
              label: "Copy thread link",
              icon: "ri-link",
              onSelect: () => {
                try {
                  navigator.clipboard.writeText(
                    `${window.location.origin}/chat/?thread=${thread.id}`
                  );
                } catch { /* ignore */ }
              },
            },
          ])}
        >
          <i className="ri-more-line" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ FocusThread */

export default function FocusThread({
  threadId,
  seed,
  staff,
  events,
  threads,
  onThread,
  onStartJob,
  onOpenThread,
}: {
  threadId: string;
  seed?: FullThread | null;
  staff: Staff[];
  events: RunEvent[];
  /** All threads — used to compute work-nav position and next/prev. */
  threads?: Thread[];
  onThread?: (th: FullThread | null) => void;
  onStartJob?: (brief: string) => void;
  onOpenThread?: (body: Record<string, string>) => void;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<FullThread | null>(seed ?? null);

  const handleThread = (th: FullThread | null) => {
    setCurrent(th);
    onThread?.(th);
  };

  const addHelper = async (staffId: string) => {
    await api(`/threads/${threadId}/add-helper`, { body: { staff_id: staffId } });
    /* ChatThread owns its own poll so the participant update will appear on the next poll cycle */
  };

  /* Helpers in this thread (for the composer hint) */
  const helperCount = current ? participantIds(current).length : 0;
  const composerHint =
    helperCount > 0
      ? `${helperCount} helper${helperCount !== 1 ? "s" : ""} in this work`
      : undefined;

  return (
    <div className="thread-view">
      {current && threads && threads.length > 0 && (
        <WorkNav thread={current} threads={threads} />
      )}
      {current && (
        <WorkHead
          thread={current}
          staff={staff}
          onAddHelper={addHelper}
        />
      )}
      <ChatThread
        threadId={threadId}
        seed={seed}
        staff={staff}
        events={events}
        onThread={handleThread}
        onStartJob={onStartJob}
        onOpenThread={onOpenThread}
        onNavigate={(h) => { router.push(h); }}
        onExpand={() => {}}
        inFocus
        placeholderOverride="Reply here · @ to bring in any helper"
        composerHint={composerHint}
      />
    </div>
  );
}
