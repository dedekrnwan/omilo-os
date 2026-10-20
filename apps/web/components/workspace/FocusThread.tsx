"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import ChatThread from "@/components/ChatThread";
import { FullThread } from "@/components/Conversation";
import { menu } from "@/lib/menu";
import { Staff, Thread, api } from "@/lib/api";
import { RunEvent } from "@/components/Run";

/* ------------------------------------------------------------------ participants */

/* Derive participant staff ids from a thread: staff_id + pending + distinct agent authors */
function participantIds(th: FullThread): string[] {
  const seen = new Set<string>();
  const add = (id?: string | null) => { if (id) seen.add(id); };
  add(th.staff_id);
  (th.pending || []).forEach(add);
  for (const m of th.messages) {
    if (m.role === "agent" && m.author) add(m.author);
  }
  return Array.from(seen);
}

/* ------------------------------------------------------------------ head */
function ThreadHead({
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

  const title = thread.scope === "master"
    ? "Chief of Staff"
    : thread.scope === "group"
      ? `# ${thread.title}`
      : thread.title || "Thread";

  const doAdd = async (staffId: string) => {
    setAdding(true);
    setAddOpen(false);
    try { await onAddHelper(staffId); } finally { setAdding(false); }
  };

  return (
    <div className="thread-head">
      <span className="thread-head-title">{title}</span>

      {/* Participants */}
      {shown.length > 0 && (
        <div className="thread-participants">
          {shown.map((s) => (
            <span key={s.id} className="thread-part-av" title={s.name}>
              <Avatar who={s} size={22} />
            </span>
          ))}
          {overflow > 0 && (
            <span className="thread-part-overflow" title={`${overflow} more`}>+{overflow}</span>
          )}
        </div>
      )}

      {/* Add helper button */}
      {notIn.length > 0 && (
        <div style={{ position: "relative" }}>
          <button
            className="thread-add-helper"
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
                right: 0,
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
          {/* Click-away overlay */}
          {addOpen && (
            <div
              style={{ position: "fixed", inset: 0, zIndex: 35 }}
              onClick={() => setAddOpen(false)}
              aria-hidden
            />
          )}
        </div>
      )}

      {/* More menu */}
      <div className="thread-head-acts">
        <button
          className="iconbtn"
          aria-label="Thread options"
          onMouseDown={menu(() => [
            {
              heading: title,
            },
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
  staff,
  events,
  onThread,
  onStartJob,
  onOpenThread,
}: {
  threadId: string;
  staff: Staff[];
  events: RunEvent[];
  onThread?: (th: FullThread | null) => void;
  onStartJob?: (brief: string) => void;
  onOpenThread?: (body: Record<string, string>) => void;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState<FullThread | null>(null);

  const handleThread = (th: FullThread | null) => {
    setCurrent(th);
    onThread?.(th);
  };

  const addHelper = async (staffId: string) => {
    await api(`/threads/${threadId}/add-helper`, { body: { staff_id: staffId } });
    /* ChatThread owns its own poll so the participant update will appear on the next poll cycle */
  };

  return (
    <div className="thread-view">
      {current && (
        <ThreadHead
          thread={current}
          staff={staff}
          onAddHelper={addHelper}
        />
      )}
      <ChatThread
        threadId={threadId}
        staff={staff}
        events={events}
        onThread={handleThread}
        onStartJob={onStartJob}
        onOpenThread={onOpenThread}
        onNavigate={(h) => { router.push(h); }}
        onExpand={() => {}}
      />
    </div>
  );
}
