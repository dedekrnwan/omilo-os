"use client";
import { kick, usePoll } from "@/lib/poll";
import { useEffect, useMemo, useRef, useState } from "react";
import { RunEvent } from "@/components/Run";
import { Attached } from "@/components/ComposerTools";
import Avatar from "@/components/Avatar";
import { Conversation, FullThread, Msg, useQuote } from "@/components/Conversation";
import { SlashAction } from "@/components/SlashMenu";
import Composer, { ComposerHandle } from "@/components/Composer";
import { Staff, api } from "@/lib/api";
import { confirmDialog } from "@/lib/dialog";
import DropCatcher from "@/components/DropCatcher";

/* Module-level latch: holds the most-recent omilo:settext value dispatched before ChatThread was
   mounted. A module-level listener (below) always captures it; the component drains it on mount. */
let _pendingSetText: string | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("omilo:settext", (e: Event) => {
    _pendingSetText = (e as CustomEvent<{ text: string }>).detail.text;
  });
}

/* A single chat thread: the message list, composer, mentions, slash menu, access decisions and Stop.
   Controlled by `threadId`; owns its own poll and reports the loaded thread up via `onThread`.
   Carved out of the /chat page so a later drawer can reuse it. */
export default function ChatThread({ threadId, seed, staff, events, inDrawer, inFocus, placeholderOverride, composerHint, onThread, onStartJob, onOpenThread, onNavigate, onExpand }: {
  threadId: string;
  seed?: FullThread | null;
  staff: Staff[];
  events: RunEvent[];
  inDrawer?: boolean;
  /** When true, adds focus-mode styling to the composer (circular send button, etc.). */
  inFocus?: boolean;
  /** Override the auto-derived placeholder text. */
  placeholderOverride?: string;
  /** Extra hint shown right-aligned in the composer row (e.g. "3 helpers in this work"). */
  composerHint?: string;
  onThread?: (th: FullThread | null) => void;
  onStartJob?: (brief: string) => void;
  onOpenThread?: (body: Record<string, string>) => void;
  onNavigate?: (href: string) => void;
  onExpand?: () => void;
}) {
  const [current, setCurrent] = useState<FullThread | null>(seed ?? null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [stopping, setStopping] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);

  const chief = staff.find((s) => s.is_chief);

  // keep the caller's `current` in sync with ours
  const report = useRef(onThread);
  report.current = onThread;
  useEffect(() => { report.current?.(current); }, [current]);
  // When switching to a different thread, blank so we don't show stale history.
  // Skip blanking when the incoming threadId matches the seed we were given — the seed
  // already carries the correct history for this thread, so painting it immediately
  // eliminates the "Loading…" flash on Inbox → Workspace navigation.
  const seedId = seed?.id ?? null;
  useEffect(() => { if (threadId !== seedId) setCurrent(null); }, [threadId, seedId]);

  // the thread: every 1.5 s while a helper is answering, every 12 s otherwise (and at once when a notice arrives);
  // unchanged threads cost a 304 thanks to the server's ETag
  const awaiting = useRef(false);
  awaiting.current = !!current?.awaiting_reply;
  usePoll(async () => {
    const want = threadId;
    try { const th = await api<FullThread>(`/threads/${want}`); setCurrent((cur) => (want === threadId ? th : cur)); } catch (e: any) { setErr(e.message); }
  }, () => (awaiting.current ? 1500 : 12000), [threadId], (n) => n?.url?.includes(threadId));

  const nMsgs = current?.messages?.length || 0;
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [nMsgs, events.length]);

  useQuote(current?.id, (fn) => { composer.current?.updateText(fn); }, () => composer.current?.focus());
  // side-list context menus ("Brief me", "Mention … in General") prefill the composer after opening a thread.
  // On mount: drain any pending value that was dispatched before this component mounted (e.g. when the
  // user triggered the menu while no thread was open and ChatThread hadn't rendered yet).
  // On live event: the module-level listener above always captures the value into _pendingSetText first,
  // then this handler runs synchronously in the same event cycle — it reads the same value, so no
  // double-apply: we set text once here and immediately clear the latch.
  useEffect(() => {
    // drain the latch on mount (covers the "ChatThread not yet mounted" case)
    if (_pendingSetText !== null) {
      const pending = _pendingSetText;
      _pendingSetText = null;
      composer.current?.setText(pending);
    }
    const on = (e: Event) => {
      _pendingSetText = null; // clear the latch — we're handling it live right now
      composer.current?.setText((e as CustomEvent<{ text: string }>).detail.text);
    };
    window.addEventListener("omilo:settext", on);
    return () => window.removeEventListener("omilo:settext", on);
  }, []);

  const send = async (t: string, files: Attached[], mentions: string[]) => {
    const jobBrief = composer.current?.getJobBrief() ?? null;
    if (jobBrief !== null && t.startsWith("/job")) { onStartJob?.(jobBrief); return; }
    if (!t.trim() && !files.length) return;
    const body = { text: t.trim() || `(attached ${files.length} file${files.length > 1 ? "s" : ""})`,
      blocks: files.length ? files.map((f) => ({ type: "file", ...f })) : undefined, mentions };
    // Composer already cleared optimistically; restore on failure
    try { setCurrent(await api<FullThread>(`/threads/${threadId}/messages`, { body })); awaiting.current = true; kick(threadId); } catch (e: any) { setErr(e.message); composer.current?.setText(t); }
  };

  const onSlash = (a: SlashAction, rest: string) => {
    const focus = () => setTimeout(() => composer.current?.focus(), 0);
    if (a.kind === "insert") { composer.current?.setText(a.text + rest); focus(); }
    else if (a.kind === "send") { composer.current?.setText(""); send(rest.trim() ? `${a.text}\n\n${rest}` : a.text, [], []); }
    else if (a.kind === "composer") { composer.current?.setText(""); window.dispatchEvent(new CustomEvent("omilo:composer", { detail: { action: a.action, kind: a.sub, id: a.id } })); focus(); }
    else if (a.kind === "job") { composer.current?.setText("/job "); focus(); }
    else if (a.kind === "talk") { composer.current?.setText(""); const st = staff.find((x) => x.id === a.staffId); onOpenThread?.(st?.is_chief ? { scope: "master" } : { scope: "staff", staff_id: a.staffId }); }
    else if (a.kind === "go") { composer.current?.setText(""); onNavigate?.(a.href); }
    else if (a.kind === "pause") { composer.current?.setText(""); confirmDialog({ title: "Pause all helpers?", body: "Running jobs finish their current step; nothing new starts until you resume.", confirm: "Pause everyone", mood: "worried" }).then((ok) => { if (ok) api("/system", { body: { paused: true } }).catch((e) => setErr(e.message)); }); }
  };

  const decide = async (requestId: string, scope: "once" | "always" | "deny", note: string) => {
    try {
      await api(`/access/${requestId}/decide`, { body: { scope, note } });
      if (threadId) { const th = await api<FullThread>(`/threads/${threadId}`); setCurrent(th); }
    } catch (e: any) { setErr(e.message); }
  };

  const decideProposal = async (proposalId: string, decision: "approve" | "reject" | "changes", note: string) => {
    try {
      await api(`/proposals/${proposalId}/decide`, { body: { decision, note } });
      if (threadId) { const th = await api<FullThread>(`/threads/${threadId}`); setCurrent(th); }
    } catch (e: any) { setErr(e.message); }
  };

  const answerQuestion = async (itemId: string, answer: string) => {
    try {
      await api(`/inbox/${itemId}/answer`, { body: { answer } });
      if (threadId) { const th = await api<FullThread>(`/threads/${threadId}`); setCurrent(th); }
    } catch (e: any) { setErr(e.message); }
  };

  const name = (id: string) => staff.find((s) => s.id === id)?.name || id;
  const threadLabel = (th: FullThread) => th.scope === "master" ? "Chief of Staff" : th.scope === "staff" ? name(th.staff_id) : th.scope === "group" ? `# ${th.title}` : th.title;
  const shortLabel = (l: string) => l.length > 28 ? `${l.slice(0, 28).trimEnd()}…` : l;
  const isGroup = current?.scope === "group";

  // the helpers tied to this chat: the room's default (Chief in a team chat, the helper in a 1:1),
  // whoever is queued to answer, and everyone who has spoken here, in that order
  const related = useMemo(() => {
    if (!current) return [] as Staff[];
    const order: string[] = [];
    const add = (id?: string) => { if (id && !order.includes(id)) order.push(id); };
    add(current.staff_id);
    (current.pending || []).forEach(add);
    for (const m of (current.messages ?? []) as Msg[]) if (m.role === "agent") add(m.author);
    return order.map((id) => staff.find((s) => s.id === id)).filter(Boolean) as Staff[];
  }, [current, staff]);

  const addMention = (s: Staff) => {
    composer.current?.appendMention(s.name);
  };

  if (!current) return <div className="ws-scroll" ref={scroller}><div className="ws-inner"><p className="small">Loading…</p></div></div>;

  return (
    <DropCatcher onFiles={(fs) => composer.current?.uploadFiles(fs)} chief={chief} disabled={current.awaiting_reply}>
      <div className="ws-scroll" ref={scroller}>
        <div className="ws-inner"><Conversation th={current} staff={staff} events={events} onSend={(t) => send(t, [], [])} busy={current.awaiting_reply} onDecide={decide} onProposal={decideProposal} onAnswer={answerQuestion} /></div>
      </div>
      <div className={`ws-composer${inFocus ? " ws-composer--focus" : ""}`}>
        {related.length > 0 && (
          <div className="chat-people">
            {related.map((s) => (
              <button type="button" key={s.id} className="chip person" aria-label={`Mention ${s.name}`} onClick={() => addMention(s)}>
                <Avatar who={s} size={22} />
              </button>
            ))}
          </div>
        )}
        {composerHint && (
          <div className="chat-composer-hint">{composerHint}</div>
        )}
        <Composer
          handleRef={composer}
          staff={staff}
          threadId={threadId}
          placeholder={placeholderOverride ?? `Message ${shortLabel(threadLabel(current))} · ${isGroup ? "@ mention · / commands" : "@ someone · / commands"}`}
          awaitingReply={current.awaiting_reply}
          error={err}
          onSend={send}
          onSlash={onSlash}
          onStop={async () => { try { await api(`/threads/${current.id}/cancel`, { body: {} }); } catch (e: any) { setErr(e.message); } }}
          showPoolMeter={!inDrawer}
        />
      </div>
    </DropCatcher>
  );
}
