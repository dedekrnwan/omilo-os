"use client";
import { useEffect, useRef, useState } from "react";
import ComposerTools, { Attached } from "@/components/ComposerTools";
import { SlashAction, useSlash } from "@/components/SlashMenu";
import { useMentions } from "@/components/Mentions";
import MentionBox, { type MentionHandle } from "@/components/MentionBox";
import PoolMeter from "@/components/PoolMeter";
import { Err } from "@/components/ui";
import { Staff } from "@/lib/api";
import { confirmDialog } from "@/lib/dialog";
import { useFileUpload } from "@/lib/upload";

/* External handle exposed via handleRef so callers (e.g. ChatThread) can set text and focus the
   box programmatically — mirroring the MentionHandle pattern. */
export type ComposerHandle = {
  setText: (v: string) => void;
  /** Apply a functional updater to the current text (mirrors React's setState(fn) — for useQuote). */
  updateText: (fn: (current: string) => string) => void;
  /** Append a mention string to whatever is currently in the box. */
  appendMention: (name: string) => void;
  focus: () => void;
  /** Whether the slash menu is showing a /job brief (used by ChatThread to gate start-job). */
  getJobBrief: () => string | null;
  /** Pass a list of files to the upload handler (for drag-and-drop from a DropCatcher parent). */
  uploadFiles: (files: File[]) => void;
};

/* A self-contained rich composer: MentionBox + SlashMenu + ComposerTools (+ / @ / Enter).
   Used in both ChatThread (session) and on the Desk start screen.

   Props:
   - staff            — list of helpers for @-mention and /talk completions
   - threadId         — current thread id, or null when on the start screen (ComposerTools renders
                        in "no-thread" mode — the + button still works for file attach)
   - placeholder      — text shown when the box is empty
   - awaitingReply    — true while a helper is composing its reply (disables input + shows Stop)
   - error            — error string to surface (controlled by the caller)
   - handleRef        — optional ref; on mount exposes a ComposerHandle for external text/focus control
   - onSend           — called with (text, files, mentionedIds) — caller owns thread creation / posting
   - onSlash          — optional extra handler for slash-command dispatch (called instead of defaults)
   - onStop           — called when the user confirms Stop; caller fires the cancel API
   - showPoolMeter    — render the <PoolMeter /> below the form (default true)
*/
export default function Composer({
  staff,
  threadId = null,
  placeholder = "@ to mention · / for commands · Enter to send",
  awaitingReply = false,
  error = null,
  handleRef,
  onSend,
  onSlash: onSlashExtra,
  onStop,
  showPoolMeter = true,
}: {
  staff: Staff[];
  threadId?: string | null;
  placeholder?: string;
  awaitingReply?: boolean;
  error?: string | null;
  handleRef?: React.RefObject<ComposerHandle | null>;
  onSend: (text: string, files: Attached[], mentions: string[]) => void;
  onSlash?: (a: SlashAction, rest: string) => void;
  onStop?: () => void;
  showPoolMeter?: boolean;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [stopping, setStopping] = useState(false);
  const box = useRef<MentionHandle>(null);
  /* refs used inside slash handler to avoid stale-closure issues */
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onSlashExtraRef = useRef(onSlashExtra);
  onSlashExtraRef.current = onSlashExtra;
  const mentionedRef = useRef<(t: string) => string[]>(() => []);

  const { upload, uploading, err: uploadErr } = useFileUpload(files, setFiles);

  const onSlashInner = (a: SlashAction, rest: string) => {
    const focus = () =>
      setTimeout(() => {
        const h = box.current;
        if (h) { h.focus(); h.setCaret(h.getValue().length); }
      }, 0);
    if (onSlashExtraRef.current) { onSlashExtraRef.current(a, rest); return; }
    // default behaviours (no-thread / Desk context)
    if (a.kind === "insert") { setText(a.text + rest); focus(); }
    else if (a.kind === "send") {
      const t = rest.trim() ? `${a.text}\n\n${rest}` : a.text;
      setText("");
      setFiles((cur) => { onSendRef.current(t, cur, mentionedRef.current(t)); return []; });
    }
    else if (a.kind === "composer") { setText(""); window.dispatchEvent(new CustomEvent("omilo:composer", { detail: { action: a.action, kind: a.sub, id: a.id } })); focus(); }
    else if (a.kind === "job") { setText("/job "); focus(); }
    else if (a.kind === "go") { setText(""); window.location.href = a.href; }
    else if (a.kind === "pause") {
      setText("");
      confirmDialog({ title: "Pause all helpers?", body: "Running jobs finish their current step; nothing new starts until you resume.", confirm: "Pause everyone", mood: "worried" })
        .then((ok) => { if (ok) import("@/lib/api").then(({ api }) => api("/system", { body: { paused: true } })); });
    }
    // "talk" is not handled in default mode — callers with an openThread callback pass onSlash
  };

  const slash = useSlash(text, staff, onSlashInner);
  const mention = useMentions(text, setText, staff, box);
  // keep mentionedRef in sync so onSlashInner can call it without a stale closure
  mentionedRef.current = mention.mentioned;

  /* Expose a handle so ChatThread (and any future caller) can setText / focus / read jobBrief. */
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      setText: (v: string) => { setText(v); setTimeout(() => box.current?.focus(), 0); },
      updateText: (fn: (current: string) => string) => { setText((cur) => fn(cur)); setTimeout(() => box.current?.focus(), 0); },
      appendMention: (name: string) => {
        // Read current serialised text from the MentionBox DOM (avoids stale React state)
        const raw = box.current?.getValue() ?? "";
        const cur = raw.trim() === "" ? "" : /\s$/.test(raw) ? raw : raw + " ";
        const next = `${cur}@${name} `;
        setText(next);
        setTimeout(() => { const h = box.current; if (h) { h.focus(); h.setCaret(next.length); } }, 0);
      },
      focus: () => box.current?.focus(),
      getJobBrief: () => slash.jobBrief,
      uploadFiles: (fs: File[]) => upload(fs),
    };
    return () => { if (handleRef) handleRef.current = null; };
  });

  const handleSend = () => {
    if (!text.trim() && !files.length) return;
    onSend(text, files, mention.mentioned(text));
    setText("");
    setFiles([]);
  };

  const handleStop = async () => {
    if (!(await confirmDialog({ title: "Stop this reply?", body: "The helper stops after its current step. What it already wrote stays.", confirm: "Stop", cancel: "Let it finish", danger: true }))) return;
    setStopping(true);
    try { await onStop?.(); } finally { setStopping(false); }
  };

  return (
    <div className="ws-composer-inner">
      <form
        className="composer"
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
      >
        {slash.menu}
        {mention.menu}
        <MentionBox
          handleRef={box}
          value={text}
          onChange={setText}
          staff={staff}
          placeholder={placeholder}
          ariaExpanded={slash.open || mention.open}
          onKeyDown={(e) => {
            if (mention.onKeyDown(e) || slash.onKeyDown(e)) return;
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
        />
        <div className="row">
          <ComposerTools
            threadId={threadId}
            files={files}
            setFiles={setFiles}
            disabled={awaitingReply}
            upload={upload}
            uploading={uploading}
            err={uploadErr}
          />
          <span className="small hide-sm">
            {awaitingReply
              ? "Working on it…"
              : slash.jobBrief !== null
                ? "Enter starts a job for the Chief of Staff"
                : "@ to mention · / for commands · Enter to send"}
          </span>
          <span className="sp" />
          {awaitingReply && (
            <button
              type="button"
              className="btn sm danger"
              disabled={stopping}
              onClick={handleStop}
            >
              <i className="ri-stop-circle-line" />Stop
            </button>
          )}
          <button
            className="btn primary sm"
            type="submit"
            disabled={(!text.trim() && !files.length) || awaitingReply}
          >
            <i className="ri-arrow-up-line" />Send
          </button>
        </div>
      </form>
      {showPoolMeter && <PoolMeter />}
      <Err error={error} />
    </div>
  );
}
