"use client";
/**
 * Reply.tsx — the agent reply shell
 *
 * Renders one helper's reply as:
 *   avatar + "Who" row (name · role · time) + stacked blocks + hover row
 *
 * The hover row (hover_actions + feedback_bar) is shown on hover via CSS (.reply-hover-row).
 *
 * Consumed by Conversation.tsx (Task 2) and will be re-used by Tasks 5 and 7.
 */

import React, { useState } from "react";
import Avatar from "@/components/Avatar";
import { Markdown, Attachments } from "@/components/Markdown";
import { when, api, type Staff } from "@/lib/api";
import { menu, copy, sep } from "@/lib/menu";
import { helperItems } from "@/lib/actions";
import { quote, plain } from "@/components/Conversation";
import type { FullThread, Msg } from "@/components/Conversation";
import { renderBlocks, type Block, type BlockCtx } from "./blocks";
import type { MenuItem } from "@/lib/menu";

/* ------------------------------------------------------------------ FeedbackBar */

type FeedbackState = "none" | "good" | "bad";
type ExpandedReason = "wrong_facts" | "too_long" | "ignored_rule" | "wrong_tone" | null;

function FeedbackBar({ messageId, helperName }: { messageId: string; helperName: string }) {
  const [state, setState] = useState<FeedbackState>("none");
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState<ExpandedReason>(null);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  const handleGood = () => {
    setState(state === "good" ? "none" : "good");
    setExpanded(false);
  };

  const handleBad = () => {
    if (state === "bad") {
      setState("none");
      setExpanded(false);
    } else {
      setState("bad");
      setExpanded(true);
    }
  };

  const handleSave = async () => {
    try {
      await api(`/messages/${messageId}/feedback`, { body: { rating: state, reason, note } });
    } catch { /* best-effort */ }
    setSaved(true);
    setExpanded(false);
  };

  const REASONS: { key: ExpandedReason; label: string }[] = [
    { key: "wrong_facts", label: "Wrong facts" },
    { key: "too_long", label: "Too long" },
    { key: "ignored_rule", label: "Ignored a rule" },
    { key: "wrong_tone", label: "Wrong tone" },
  ];

  return (
    <div className="reply-feedback-wrap">
      {/* Idle bar: "Was this useful?" + thumbs */}
      <div className="reply-feedback">
        <span className="reply-feedback-label">Was this useful?</span>
        <button type="button" className={state === "good" ? "on" : undefined}
          aria-label="Good response" title="Good response" onClick={handleGood}>
          <i className={state === "good" ? "ri-thumb-up-fill" : "ri-thumb-up-line"} />
        </button>
        <button type="button" className={state === "bad" ? "on" : undefined}
          aria-label="Bad response" title="Bad response" onClick={handleBad}>
          <i className={state === "bad" ? "ri-thumb-down-fill" : "ri-thumb-down-line"} />
        </button>
      </div>
      {/* Expanded: "What went wrong?" card */}
      {expanded && !saved && (
        <div className="reply-feedback-expanded">
          {/* Top row */}
          <div className="reply-fbe-top">
            <i className="ri-thumb-down-line" />
            <span className="reply-fbe-title">What went wrong?</span>
            <span className="sp" />
            <button type="button" className="reply-fbe-close" onClick={() => setExpanded(false)} aria-label="Close feedback">
              <i className="ri-close-line" />
            </button>
          </div>
          {/* Reason pills */}
          <div className="reply-fbe-reasons">
            {REASONS.map(({ key, label }) => (
              <button key={key!} type="button"
                className={reason === key ? "reply-fbe-pill selected" : "reply-fbe-pill"}
                onClick={() => setReason(reason === key ? null : key)}>
                {label}
              </button>
            ))}
          </div>
          {/* Note input row */}
          <div className="reply-fbe-note">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`Tell ${helperName} what to do instead…`}
              className="reply-fbe-input"
            />
            <button type="button" className="btn sm primary" onClick={handleSave}>Save as lesson</button>
          </div>
        </div>
      )}
      {saved && <div className="reply-fbe-saved">Noted.</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ HoverActions */

function HoverActions({
  message,
  thread,
  onReAsk,
}: {
  message: Msg;
  thread: FullThread;
  helperName: string;
  onReAsk?: () => void;
}) {
  const handleCopy = () => copy(message.text);
  // Edit request: re-quote the prior owner message (same as re-ask)
  const handleEdit = () => quote(thread.id, message.text);

  return (
    <div className="reply-hover-row">
      {/* Floating action bar */}
      <div className="reply-hover-bar">
        {/* Copy — wired to existing copy handler */}
        <button type="button" className="reply-hbtn" title="Copy" aria-label="Copy message" onClick={handleCopy}>
          <i className="ri-file-copy-line" />
        </button>
        {/* Retry / Re-ask — wired to existing re-ask handler */}
        <button type="button" className="reply-hbtn" title="Retry" aria-label="Retry" onClick={onReAsk}>
          <i className="ri-loop-left-line" />
        </button>
        {/* Edit request — quotes the message text back into composer */}
        <button type="button" className="reply-hbtn" title="Edit request" aria-label="Edit request" onClick={handleEdit}>
          <i className="ri-pencil-line" />
        </button>
        {/* Pin to Docs — no handler yet; safe no-op */}
        <button type="button" className="reply-hbtn" title="Pin to Docs" aria-label="Pin to Docs">
          <i className="ri-pushpin-line" />
        </button>
        {/* Share — no handler yet; safe no-op */}
        <button type="button" className="reply-hbtn" title="Share" aria-label="Share">
          <i className="ri-share-line" />
        </button>
        {/* Separator */}
        <span className="reply-hbar-sep" aria-hidden="true" />
        {/* More — no handler yet; safe no-op */}
        <button type="button" className="reply-hbtn" title="More" aria-label="More options">
          <i className="ri-more-line" />
        </button>
      </div>
      {/* Feedback bar (idle + expanded) */}
      <FeedbackBar messageId={message.id} helperName={message.author} />
    </div>
  );
}

/* ------------------------------------------------------------------ Reply */

export type ReplyProps = {
  /** The agent message to render */
  m: Msg;
  /** The full thread (needed for choices index, quote, and re-ask) */
  th: FullThread;
  /** All staff (for avatar lookup and helper menu items) */
  staff: Staff[];
  /** All messages in the thread (needed for choices answered-state detection) */
  messages: Msg[];
  /** True when the thread is waiting for a reply (disables choices) */
  busy?: boolean;
  /** Called when the owner picks a choice option */
  onPick?: (text: string) => void;
  /** Called when an access request is decided */
  onDecide?: (requestId: string, scope: "once" | "always" | "deny", note: string) => void;
  /** Called when a proposal is decided */
  onProposal?: (proposalId: string, decision: "approve" | "reject" | "changes", note: string) => void;
  /** Called when a question is answered inline */
  onAnswer?: (itemId: string, answer: string) => void;
  /** Called when the owner clicks stop on a streaming block */
  onStop?: () => void;
  /** Context menu item builder — pass from parent to override */
  contextMenuItems?: () => MenuItem[];
};

/**
 * Reply — the agent reply shell.
 * Avatar · Who row · block stack · hover row (hover actions + feedback bar).
 */
export function Reply({
  m,
  th,
  staff,
  messages,
  busy,
  onPick,
  onDecide,
  onProposal,
  onAnswer,
  onStop,
  contextMenuItems,
}: ReplyProps) {
  const helper = staff.find((s) => s.id === m.author) || { id: m.author, name: m.author, role: "helper" };
  const helperName = (helper as { name?: string }).name || m.author;
  const helperRole = (helper as { role?: string }).role || "helper";
  const people = staff.map((s) => ({ id: s.id, name: s.name }));

  // Build block ctx
  const ctx: BlockCtx = {
    m,
    messages,
    busy,
    onPick,
    onDecide,
    onProposal,
    onAnswer,
    onStop,
    people,
  };

  // Determine which blocks to render: use Message.blocks if present;
  // otherwise fall back to rendering m.text as a markdown block (legacy messages without blocks).
  const rawBlocks = m.blocks as Block[] | undefined;
  const hasTypedBlocks = rawBlocks && rawBlocks.length > 0;
  const displayBlocks: Block[] = hasTypedBlocks ? rawBlocks : [];

  const reAsk = () => {
    const idx = th.messages.findIndex((x) => x.id === m.id);
    const lastOwner = th.messages
      .slice(0, idx)
      .reverse()
      .find((x) => x.role === "owner");
    if (lastOwner) {
      window.dispatchEvent(new CustomEvent("omilo:quote", { detail: { threadId: th.id, text: lastOwner.text } }));
    }
  };

  const ctxMenu = contextMenuItems
    ? menu(contextMenuItems)
    : menu(() => {
        const h = staff.find((s) => s.id === m.author);
        return [
          { heading: helperName },
          { label: "Quote in reply", icon: "ri-double-quotes-l", onSelect: () => quote(th.id, m.text) },
          { label: "Copy text", icon: "ri-file-copy-line", onSelect: () => copy(plain(m.text)) },
          { label: "Copy as Markdown", icon: "ri-markdown-line", onSelect: () => copy(m.text) },
          { label: "Ask again", icon: "ri-restart-line", hint: "puts your question back in the box", onSelect: reAsk },
          ...(h ? [sep, ...helperItems(h)] : []),
        ].filter(Boolean) as MenuItem[];
      });

  return (
    <div className="reply-shell" onContextMenu={ctxMenu}>
      {/* Avatar */}
      <div className="reply-av">
        <Avatar who={helper} size={30} />
      </div>
      <div className="reply-body">
        {/* Who row: name 13/600 $ink · role 12 $muted · time 12 $faint */}
        <div className="reply-who">
          <b>{helperName}</b>
          <span className="reply-role">{helperRole}</span>
          <span className="sp" />
          <span className="reply-time">{when(m.at)}</span>
        </div>

        {/* Content: block stack */}
        <div className="reply-blocks">
          {/* Typed blocks (v2 messages) */}
          {hasTypedBlocks && renderBlocks(displayBlocks, ctx)}

          {/* Message text: render if present AND there's no markdown/streaming typed block */}
          {m.text && (hasTypedBlocks
            ? !displayBlocks.some((b) => b.type === "markdown" || b.type === "streaming")
            : true) && (
            <div className="reply-md">
              <Markdown text={m.text} people={people} />
            </div>
          )}

          {/* File attachments (upload blocks) — only for messages without typed blocks */}
          {!hasTypedBlocks && <Attachments blocks={m.blocks as { type: string; id?: string; name?: string; mime?: string; size?: number }[] | undefined} />}
        </div>

        {/* Footer: hover actions bar + feedback bar — shown on hover */}
        <HoverActions message={m} thread={th} helperName={helperName} onReAsk={reAsk} />
      </div>
    </div>
  );
}
