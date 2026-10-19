"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import ChatThread from "@/components/ChatThread";
import { useEvents } from "@/components/Run";
import { FullThread } from "@/components/Conversation";
import { Staff, Thread, api } from "@/lib/api";

/* A right-side drawer that shows the active chat session and lets you switch between recent ones.
   Mirrors the .drawer/.scrim shell, ESC-to-close, and body-scroll-lock from Drawer.tsx.
   Does NOT wrap Drawer.tsx — the chat needs a composer pinned to the bottom and a switcher row,
   which do not fit Drawer's title/body/footer+autofocus shape. */

function threadLabel(th: Thread | FullThread, staff: Staff[]): string {
  const name = (id: string) => staff.find((s) => s.id === id)?.name || id;
  if (th.scope === "master") return "Chief of Staff";
  if (th.scope === "staff") return name(th.staff_id);
  if (th.scope === "group") return `# ${th.title}`;
  return th.title;
}

function hasMessages(th: Thread): boolean {
  return !!th.messages?.length;
}

export default function ChatSessionsDrawer({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const router = useRouter();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string>("Chat");
  const [loading, setLoading] = useState(false);

  /* ESC-to-close + body scroll-lock (mirror Drawer.tsx lines 15-24) */
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [open]);

  /* Load threads + staff, then pick the active session */
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([api<Thread[]>("/threads"), api<Staff[]>("/staff")])
      .then(async ([ths, st]) => {
        setStaff(st);
        // Sort by updated_at desc
        const sorted = [...ths].sort((a, b) =>
          (b.updated_at || "").localeCompare(a.updated_at || "")
        );
        setThreads(sorted);
        // Pick active: most recent with messages
        const withMsgs = sorted.find(hasMessages);
        if (withMsgs) {
          setActiveId(withMsgs.id);
          setActiveLabel(threadLabel(withMsgs, st));
        } else {
          // Fall back to Chief of Staff thread
          try {
            const master = await api<Thread>("/threads", { body: { scope: "master" } });
            setActiveId(master.id);
            setActiveLabel(threadLabel(master, st));
            // Add it to our list if not already there
            setThreads((prev) => prev.some((t) => t.id === master.id) ? prev : [master, ...prev]);
          } catch {
            // No session available — leave activeId null (empty state)
          }
        }
      })
      .catch(() => { /* ignore — show empty state */ })
      .finally(() => setLoading(false));
  }, [open]);

  const events = useEvents(activeId ? { thread_id: activeId } : null);

  /* Called by ChatThread when the thread loads — update the header label */
  const updateActiveLabel = (th: FullThread | null) => {
    if (!th) return;
    setActiveLabel(threadLabel(th as unknown as Thread, staff));
    // Also refresh this thread in the list (updated_at may have changed after a send)
    setThreads((prev) => prev.map((t) => t.id === th.id ? { ...t, updated_at: (th as any).updated_at || t.updated_at } : t));
  };

  /* Called when the user clicks a chip or ChatThread opens another thread */
  const switchSession = async (body: Record<string, string>) => {
    try {
      const th = await api<Thread>("/threads", { body });
      setActiveId(th.id);
      setActiveLabel(threadLabel(th, staff));
      // Add to list if missing
      setThreads((prev) => prev.some((t) => t.id === th.id) ? prev : [th, ...prev]);
    } catch { /* ignore */ }
  };

  const expand = () => {
    if (activeId) router.push(`/chat/?thread=${activeId}`);
    onClose();
  };

  /* The active thread's staff (for Avatar in header) */
  const activeThread = threads.find((t) => t.id === activeId);
  const headerWho = activeThread?.scope === "staff"
    ? staff.find((s) => s.id === activeThread.staff_id)
    : activeThread?.scope === "master"
    ? staff.find((s) => s.is_chief)
    : null;

  if (!open) return null;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside ref={panelRef} className="drawer dw chat-drawer" role="dialog" aria-modal="true" aria-label="Chat">
        {/* Header */}
        <div className="chat-drawer-head">
          <Avatar who={headerWho} size={28} />
          <span className="chat-drawer-title">{activeLabel}</span>
          <span className="sp" />
          <button className="iconbtn" aria-label="Open full chat" title="Open full chat" onClick={expand}>
            <i className="ri-expand-diagonal-line" />
          </button>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>
            <i className="ri-close-line" />
          </button>
        </div>

        {/* Session switcher */}
        {threads.length > 0 && (
          <div className="chat-switch">
            {threads.map((th) => (
              <button
                key={th.id}
                className={`chat-chip${th.id === activeId ? " on" : ""}`}
                onClick={() => { setActiveId(th.id); setActiveLabel(threadLabel(th, staff)); }}
              >
                {threadLabel(th, staff)}
              </button>
            ))}
          </div>
        )}

        {/* Body: the full chat thread */}
        <div className="chat-drawer-body">
          {loading && !activeId && (
            <div className="ws-scroll"><div className="ws-inner"><p className="small">Loading…</p></div></div>
          )}
          {!loading && !activeId && (
            <div className="ws-scroll"><div className="ws-inner">
              <div className="empty"><b>No chats yet</b><span>Start a conversation to see it here.</span></div>
            </div></div>
          )}
          {activeId && (
            <ChatThread
              threadId={activeId}
              staff={staff}
              events={events}
              inDrawer
              onThread={updateActiveLabel}
              onOpenThread={switchSession}
              onNavigate={(h) => { router.push(h); onClose(); }}
              onStartJob={() => { router.push("/chat/?view=work"); onClose(); }}
              onExpand={expand}
            />
          )}
        </div>
      </aside>
    </>
  );
}
