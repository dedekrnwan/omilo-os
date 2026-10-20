"use client";
import React, { useState, useEffect, useCallback } from "react";
import { usePoll } from "@/lib/poll";
import { Thread, InboxItem, api } from "@/lib/api";
import Avatar from "@/components/Avatar";
import ChatSessionsDrawer from "@/components/ChatSessionsDrawer";
import { useOverview } from "@/components/Shell";

/** App-wide floating mascot launcher. Renders on every page (mounted in Shell).
 *  Shows the Chief of Staff avatar; clicking opens the ChatSessionsDrawer.
 *  An unread badge counts threads where awaiting_reply === true.
 *  A nudge bubble appears above the FAB when there is a relevant open proposal or
 *  question in the inbox; dismissible for the session via "Later" or the × button.
 *  ⌘J / Ctrl-J globally toggles the drawer open state (coexists with ⌘K palette). */
export default function ChatLauncher(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [nudgeItem, setNudgeItem] = useState<InboxItem | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("chat-nudge-dismissed") === "1";
  });
  const { overview } = useOverview();

  const chief = overview?.staff.find((s) => s.is_chief) ?? null;

  // Poll /threads for awaiting_reply count (~20 s, matching other list pollers)
  usePoll(
    async () => {
      try {
        const threads = await api<Thread[]>("/threads");
        setUnread(threads.filter((t) => t.awaiting_reply).length);
      } catch {
        /* network errors: keep last count */
      }
    },
    20000,
    []
  );

  // Poll /inbox for a relevant open proposal or question to surface as nudge
  usePoll(
    async () => {
      // Don't fetch if already dismissed for this session
      if (nudgeDismissed) return;
      try {
        const items = await api<InboxItem[]>("/inbox");
        // Pick the most relevant: first blocking item, then first open proposal/question
        const relevant =
          items.find(
            (it) =>
              it.status === "open" &&
              it.blocking &&
              (it.kind === "proposal" || it.kind === "question")
          ) ??
          items.find(
            (it) =>
              it.status === "open" &&
              (it.kind === "proposal" || it.kind === "question")
          ) ??
          null;
        setNudgeItem(relevant);
      } catch {
        /* network errors: keep last nudge */
      }
    },
    30000,
    [nudgeDismissed]
  );

  // ⌘J / Ctrl-J global toggle — does not fire when typing in inputs/textareas
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        const el = document.activeElement;
        const isInputLike =
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          (el instanceof HTMLElement && el.isContentEditable);
        if (isInputLike) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const dismissNudge = useCallback(() => {
    setNudgeDismissed(true);
    setNudgeItem(null);
    sessionStorage.setItem("chat-nudge-dismissed", "1");
  }, []);

  const handleYes = useCallback(() => {
    dismissNudge();
    setOpen(true);
  }, [dismissNudge]);

  const showNudge = !nudgeDismissed && nudgeItem !== null && !open;

  // Determine nudge body text — use pen copy when helpers have proposals, otherwise item title
  const nudgeBody =
    nudgeItem?.kind === "proposal"
      ? "Your helpers proposed their jobs. Want me to walk you through them?"
      : nudgeItem?.title ?? "";

  return (
    <>
      {showNudge && (
        <div className="chat-nudge" role="status" aria-live="polite">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <b style={{ margin: 0 }}>Chief of Staff</b>
            <button
              onClick={dismissNudge}
              aria-label="Dismiss"
              style={{
                background: "transparent",
                border: 0,
                cursor: "pointer",
                padding: "0 0 0 8px",
                color: "var(--muted)",
                lineHeight: 1,
                fontSize: 16,
              }}
            >
              <i className="ri-close-line" aria-hidden="true" />
            </button>
          </div>
          <p>{nudgeBody}</p>
          <div className="chat-nudge-acts">
            <button className="btn btn-primary btn-sm" onClick={handleYes}>
              Yes, show me
            </button>
            <button className="btn btn-ghost btn-sm" onClick={dismissNudge}>
              Later
            </button>
          </div>
        </div>
      )}
      <button
        className="chat-launcher chat-fab"
        aria-label="Open chat"
        title="Open chat (⌘J)"
        onClick={() => setOpen(true)}
      >
        <Avatar who={chief} size={36} />
        {unread > 0 && (
          <span
            className="chat-launcher-badge chat-fab-badge"
            aria-label={`${unread} awaiting reply`}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <ChatSessionsDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
