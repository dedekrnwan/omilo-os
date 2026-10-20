"use client";
import React, { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import ChatThread from "@/components/ChatThread";
import { useEvents } from "@/components/Run";
import { FullThread } from "@/components/Conversation";
import { Staff, Thread, api, ago } from "@/lib/api";
import { navItemFor } from "@/components/nav";

/* Page-aware v2 chat drawer. Opened by the FAB (Task 6) via { open, onClose }.
   Preserves: ESC-to-close, body-scroll-lock, ⌘J handling (owned by ChatLauncher).
   New: Thread switcher dropdown (HELPERS/TEAM/JOBS), Context row ("Looking at {page}"),
        Empty state (CoS intro + Suggestions + recents), Pool status row, Job Card header. */

/* ──────────────────────────────── types ──────────────────────────────── */
type ThreadFocus = {
  progress: { label: string; status: string }[];
  files: { title: string; kind: string; ref: string }[];
  cost: { usd: number; tokens: number; minutes: number } | null;
};

/* ──────────────────────────────── helpers ──────────────────────────────── */
function threadLabel(th: Thread | FullThread, staff: Staff[]): string {
  const name = (id: string) => staff.find((s) => s.id === id)?.name || id;
  if (th.scope === "master") return "Chief of Staff";
  if (th.scope === "staff") return name(th.staff_id);
  if (th.scope === "group") return `# ${th.title}`;
  return th.title;
}

function threadSubtitle(th: Thread, staff: Staff[]): string {
  if (th.subtitle) return th.subtitle;
  if (th.task_status) {
    const staffName = staff.find((s) => s.id === th.staff_id)?.name || "";
    return `${staffName}${staffName ? " · " : ""}${th.task_status}`;
  }
  if (th.awaiting_reply) return "Thinking…";
  return "Idle";
}

function threadStatusLine(th: Thread | null): string {
  if (!th) return "Idle · can see this page";
  if (th.awaiting_reply) return "Thinking… · can see this page";
  return "Idle · can see this page";
}

function threadIcon(th: Thread): string {
  if (th.scope === "master") return "ri-user-star-line";
  if (th.scope === "staff") return "ri-user-line";
  if (th.scope === "group") return "ri-team-line";
  if (th.scope === "task") return "ri-task-line";
  return "ri-chat-3-line";
}

function fmtMinutes(mins: number): string {
  if (mins < 1) return "< 1m";
  if (mins < 60) return `${Math.round(mins)}m`;
  return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
}

/* ──────────────────────────────── subcomponents ──────────────────────────────── */

/* Context row: "Looking at {page}" chip with dismiss × */
function ContextRow({ onDismiss }: { onDismiss: () => void }) {
  const path = usePathname();
  const item = navItemFor(path);
  return (
    <div className="chat-drawer-ctx">
      <i className="ri-eye-line" />
      <span>Looking at</span>
      <span className="chat-ctx-chip">
        <i className={item.icon} />
        {item.label}
      </span>
      <span className="sp" />
      <button type="button" className="iconbtn" aria-label="Dismiss context" onClick={onDismiss}>
        <i className="ri-close-line" style={{ fontSize: 13 }} />
      </button>
    </div>
  );
}

/* Empty state: CoS avatar + intro text + Suggestions + recent threads */
function EmptyState({
  chief,
  recentThreads,
  staff,
  onPickThread,
}: {
  chief: Staff | undefined;
  recentThreads: Thread[];
  staff: Staff[];
  onPickThread: (th: Thread) => void;
}) {
  const SUGGESTIONS = [
    "Walk me through the open proposals",
    "What's on today?",
    "What are my helpers working on?",
  ];

  return (
    <div className="chat-drawer-empty ws-scroll">
      <div className="chat-drawer-empty-greeting">
        <Avatar who={chief} size={32} />
        <div className="chat-drawer-empty-body">
          <p>Hi — I&apos;m your Chief of Staff. I can see what&apos;s happening across your workspace and help you act on it fast.</p>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>Ask me anything, or pick a suggestion below.</p>
        </div>
      </div>

      <div>
        <div className="chat-drawer-empty-label" style={{ marginBottom: 6 }}>Suggestions</div>
        <div className="chat-drawer-recents">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className="chat-drawer-recent-item"
              onClick={() => {
                // pre-fill composer via the omilo:settext event
                window.dispatchEvent(new CustomEvent("omilo:settext", { detail: { text: s } }));
              }}
            >
              <i className="ri-sparkling-line" />
              <span>{s}</span>
            </button>
          ))}
        </div>
      </div>

      {recentThreads.length > 0 && (
        <div>
          <div className="chat-drawer-empty-label" style={{ marginBottom: 6 }}>Pick up where you left off</div>
          <div className="chat-drawer-recents">
            {recentThreads.slice(0, 5).map((th) => (
              <button
                key={th.id}
                type="button"
                className="chat-drawer-recent-item"
                onClick={() => onPickThread(th)}
              >
                <i className={threadIcon(th)} />
                <span>{threadLabel(th, staff)}</span>
                <span style={{ color: "var(--faint)", fontSize: 12, flexShrink: 0 }}>{ago(th.last_at || th.updated_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* Job card shown above messages when active thread is a job (has task_id) */
function JobCard({
  thread,
  staff,
  focus,
}: {
  thread: Thread;
  staff: Staff[];
  focus: ThreadFocus | null;
}) {
  const staffMember = staff.find((s) => s.id === thread.staff_id);
  const isDone = thread.task_status === "done" || thread.task_status === "completed";
  const briefText = thread.subtitle || thread.title;

  return (
    <div className="chat-job-card">
      <div className="chat-job-card-head">
        <i className="ri-repeat-line" style={{ fontSize: 13, color: "var(--muted)" }} />
        <b>Regular job</b>
        <span className="sp" style={{ flex: 1 }} />
        {isDone && <span className="chip run" style={{ fontSize: 11 }}>Done</span>}
        {!isDone && thread.task_status && (
          <span className="chip" style={{ fontSize: 11 }}>{thread.task_status}</span>
        )}
      </div>

      <div style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {thread.title}
      </div>

      {briefText && briefText !== thread.title && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12.5, color: "var(--ink-2)" }}>
          <i className="ri-double-quotes-l" style={{ flexShrink: 0, marginTop: 2, color: "var(--muted)" }} />
          <span style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
            {briefText}
          </span>
        </div>
      )}

      {focus?.cost && (
        <div className="chat-job-card-meta">
          {focus.cost.minutes > 0 && (
            <>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <i className="ri-time-line" />
                {fmtMinutes(focus.cost.minutes)}
              </span>
              <span className="chat-job-sep" />
            </>
          )}
          {focus.cost.usd > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <i className="ri-coin-line" />
              ${focus.cost.usd.toFixed(2)}
            </span>
          )}
          {staffMember && (
            <>
              <span className="chat-job-sep" />
              <span>{staffMember.name}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* Thread menu dropdown: search + HELPERS / TEAM / JOBS groups + New chat */
function ThreadMenu({
  threads,
  staff,
  activeId,
  onSelect,
  onNewChat,
  onClose,
}: {
  threads: Thread[];
  staff: Staff[];
  activeId: string | null;
  onSelect: (th: Thread) => void;
  onNewChat: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Group threads by scope/task
  const helpers = threads.filter((t) => t.scope === "master" || t.scope === "staff");
  const team = threads.filter((t) => t.scope === "group");
  const jobs = threads.filter((t) => t.scope === "task" || !!t.task_id);

  const filter = (list: Thread[]) =>
    q.trim()
      ? list.filter((t) =>
          threadLabel(t, staff).toLowerCase().includes(q.toLowerCase()) ||
          (t.subtitle || "").toLowerCase().includes(q.toLowerCase())
        )
      : list;

  const renderItem = (th: Thread) => (
    <button
      key={th.id}
      type="button"
      className="menu-item"
      onClick={() => { onSelect(th); onClose(); }}
    >
      <Avatar who={th.scope === "master" ? staff.find((s) => s.is_chief) : th.scope === "staff" ? staff.find((s) => s.id === th.staff_id) : null} size={22} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ display: "block", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {threadLabel(th, staff)}
        </b>
        <span style={{ display: "block", fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {threadSubtitle(th, staff)}
        </span>
      </span>
      {th.id === activeId && <i className="ri-check-line" style={{ fontSize: 13, color: "var(--primary)", flexShrink: 0 }} />}
    </button>
  );

  const hf = filter(helpers);
  const tf = filter(team);
  const jf = filter(jobs);
  const hasResults = hf.length + tf.length + jf.length > 0;

  return (
    <div className="chat-drawer-menu" role="listbox" aria-label="Switch thread">
      <div className="chat-drawer-menu-search">
        <i className="ri-search-line" style={{ fontSize: 13, color: "var(--muted)", flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a chat"
          aria-label="Search threads"
          style={{ flex: 1, width: "100%" }}
        />
      </div>

      {hf.length > 0 && (
        <>
          <div className="menu-label">Helpers</div>
          {hf.map(renderItem)}
        </>
      )}
      {tf.length > 0 && (
        <>
          <div className="menu-label">Team</div>
          {tf.map(renderItem)}
        </>
      )}
      {jf.length > 0 && (
        <>
          <div className="menu-label">Jobs</div>
          {jf.map(renderItem)}
        </>
      )}

      {!hasResults && q.trim() && (
        <div style={{ padding: "8px 10px", fontSize: 13, color: "var(--muted)" }}>No threads match "{q}"</div>
      )}

      <div className="menu-sep" />
      <button type="button" className="menu-item" onClick={() => { onNewChat(); onClose(); }}>
        <i className="ri-add-line" style={{ fontSize: 14, color: "var(--muted)" }} />
        <span style={{ fontSize: 13 }}>New chat</span>
      </button>
    </div>
  );
}

/* ──────────────────────────────── main component ──────────────────────────────── */
export default function ChatSessionsDrawer({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const router = useRouter();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [threads, setThreads] = useState<Thread[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [ctxDismissed, setCtxDismissed] = useState(false);
  const [focus, setFocus] = useState<ThreadFocus | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  /* ESC-to-close + body scroll-lock (mirror Drawer.tsx) */
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (menuOpen) { setMenuOpen(false); return; }
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [open, menuOpen]);

  /* Close menu on outside click */
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (headRef.current && !headRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  /* Load threads + staff */
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setCtxDismissed(false);
    Promise.all([api<Thread[]>("/threads"), api<Staff[]>("/staff")])
      .then(async ([ths, st]) => {
        setStaff(st);
        const sorted = [...ths].sort((a, b) => (b.last_at || b.updated_at || "").localeCompare(a.last_at || a.updated_at || ""));
        setThreads(sorted);

        if (sorted.length > 0) {
          setActiveId(sorted[0].id);
        } else {
          try {
            const master = await api<Thread>("/threads", { body: { scope: "master" } });
            setActiveId(master.id);
            setThreads((prev) => prev.some((t) => t.id === master.id) ? prev : [master, ...prev]);
          } catch { /* no session — empty state */ }
        }
      })
      .catch(() => { /* show empty state */ })
      .finally(() => setLoading(false));
  }, [open]);

  /* Load focus data for job threads */
  useEffect(() => {
    if (!activeId) { setFocus(null); return; }
    const active = threads.find((t) => t.id === activeId);
    if (!active?.task_id && active?.scope !== "task") { setFocus(null); return; }
    api<ThreadFocus>(`/threads/${activeId}/focus`)
      .then(setFocus)
      .catch(() => setFocus(null));
  }, [activeId, threads]);

  const events = useEvents(activeId ? { thread_id: activeId } : null);

  const updateActiveLabel = (th: FullThread | null) => {
    if (!th) return;
    setThreads((prev) => prev.map((t) => t.id === th.id ? { ...t, updated_at: th.updated_at || t.updated_at } : t));
  };

  const switchSession = async (body: Record<string, string>) => {
    try {
      const th = await api<Thread>("/threads", { body });
      setActiveId(th.id);
      setThreads((prev) => prev.some((t) => t.id === th.id) ? prev : [th, ...prev]);
    } catch { /* ignore */ }
  };

  const startNewChat = async () => {
    try {
      const th = await api<Thread>("/threads", { body: { scope: "master" } });
      setActiveId(th.id);
      setThreads((prev) => prev.some((t) => t.id === th.id) ? prev : [th, ...prev]);
    } catch { /* ignore */ }
  };

  const openInWorkspace = () => {
    if (activeId) router.push(`/chat?thread=${activeId}`);
    onClose();
  };

  /* Derived */
  const activeThread = threads.find((t) => t.id === activeId) || null;
  const chief = staff.find((s) => s.is_chief);
  const headerWho = activeThread?.scope === "staff"
    ? staff.find((s) => s.id === activeThread.staff_id)
    : activeThread?.scope === "master"
    ? chief
    : null;

  const isEmpty = !loading && !activeId;
  const isJob = !!(activeThread?.task_id || activeThread?.scope === "task");

  if (!open) return null;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside ref={panelRef} className="drawer dw chat-drawer" role="dialog" aria-modal="true" aria-label="Chat">

        {/* ── Head: Thread Switcher + icon buttons ── */}
        <div className="chat-drawer-head" ref={headRef} style={{ position: "relative" }}>
          <button
            type="button"
            className="chat-drawer-switcher"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Avatar who={headerWho} size={28} />
            <span className="chat-sw-t">
              <b>{activeThread ? threadLabel(activeThread, staff) : loading ? "Loading…" : "New chat"}</b>
              <span>{threadStatusLine(activeThread)}</span>
            </span>
            <i className={`chevron ri-chevron-${menuOpen ? "up" : "down"}-line`} />
          </button>

          <button
            type="button"
            className="iconbtn"
            aria-label="New chat"
            title="New chat"
            onClick={startNewChat}
          >
            <i className="ri-add-line" />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label="Open in Workspace"
            title="Open in Workspace"
            onClick={openInWorkspace}
          >
            <i className="ri-expand-diagonal-line" />
          </button>
          <button className="iconbtn" aria-label="Close" onClick={onClose}>
            <i className="ri-close-line" />
          </button>

          {/* Thread switcher dropdown */}
          {menuOpen && (
            <div ref={menuRef}>
              <ThreadMenu
                threads={threads}
                staff={staff}
                activeId={activeId}
                onSelect={(th) => { setActiveId(th.id); }}
                onNewChat={startNewChat}
                onClose={() => setMenuOpen(false)}
              />
            </div>
          )}
        </div>

        {/* ── Context row: "Looking at {page}" ── */}
        {!ctxDismissed && <ContextRow onDismiss={() => setCtxDismissed(true)} />}

        {/* ── Body ── */}
        <div className="chat-drawer-body">
          {isEmpty && (
            <EmptyState
              chief={chief}
              recentThreads={threads}
              staff={staff}
              onPickThread={(th) => setActiveId(th.id)}
            />
          )}

          {activeId && (
            <>
              {/* Job Card header (job-thread variant) */}
              {isJob && activeThread && (
                <JobCard thread={activeThread} staff={staff} focus={focus} />
              )}

              <ChatThread
                threadId={activeId}
                staff={staff}
                events={events}
                inDrawer
                onThread={updateActiveLabel}
                onOpenThread={switchSession}
                onNavigate={(h) => { router.push(h); onClose(); }}
                onStartJob={() => { router.push("/chat/?view=work"); onClose(); }}
                onExpand={openInWorkspace}
              />
            </>
          )}
        </div>

        {/* ── Pool status row ── */}
        <PoolRow onClose={onClose} />
      </aside>
    </>
  );
}

/* ──────────────────────────────── Pool status row ──────────────────────────────── */
/* Sits at the bottom of the drawer. Shows "Claude Code pool · N/N ready" + ⌘J to close hint.
   Imports useMeter from PoolMeter to avoid re-fetching; falls back gracefully if meter is null. */
import { useMeter } from "@/components/PoolMeter";

function PoolRow({ onClose }: { onClose: () => void }) {
  const m = useMeter();
  const label = m ? `Claude Code pool · ${m.ready}/${m.total} ready` : "Claude Code pool";
  return (
    <div className="chat-drawer-pool">
      <span
        style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: m && m.ready > 0 ? "var(--ok)" : m ? "var(--warn)" : "var(--line-strong)",
        }}
      />
      <span className="chat-pool-label">{label}</span>
      <kbd className="chat-pool-kbd" onClick={onClose} style={{ cursor: "pointer" }}>⌘J</kbd>
    </div>
  );
}
