"use client";
import React, { useState } from "react";
import { usePoll } from "@/lib/poll";
import { Thread, api } from "@/lib/api";
import Avatar from "@/components/Avatar";
import ChatSessionsDrawer from "@/components/ChatSessionsDrawer";
import { useOverview } from "@/components/Shell";

/** App-wide floating mascot launcher. Renders on every page (mounted in Shell).
 *  Shows the Chief of Staff avatar; clicking opens the ChatSessionsDrawer.
 *  An unread badge counts threads where awaiting_reply === true. */
export default function ChatLauncher(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
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

  return (
    <>
      <button
        className="chat-launcher"
        aria-label="Open chat"
        title="Open chat"
        onClick={() => setOpen(true)}
      >
        <Avatar who={chief} size={36} />
        {unread > 0 && (
          <span className="chat-launcher-badge" aria-label={`${unread} awaiting reply`}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <ChatSessionsDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
