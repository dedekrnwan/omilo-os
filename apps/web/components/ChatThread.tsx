"use client";
import { kick, usePoll } from "@/lib/poll";
import { useEffect, useMemo, useRef, useState } from "react";
import { RunEvent } from "@/components/Run";
import ComposerTools, { Attached } from "@/components/ComposerTools";
import PoolMeter from "@/components/PoolMeter";
import Avatar from "@/components/Avatar";
import { Conversation, FullThread, Msg, useQuote } from "@/components/Conversation";
import { SlashAction, useSlash } from "@/components/SlashMenu";
import { useMentions } from "@/components/Mentions";
import MentionBox, { type MentionHandle } from "@/components/MentionBox";
import { Err } from "@/components/ui";
import { Staff, api } from "@/lib/api";
import { confirmDialog } from "@/lib/dialog";
import { useFileUpload } from "@/lib/upload";
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
export default function ChatThread({ threadId, staff, events, inDrawer, onThread, onStartJob, onOpenThread, onNavigate, onExpand }: {
  threadId: string;
  staff: Staff[];
  events: RunEvent[];
  inDrawer?: boolean;
  onThread?: (th: FullThread | null) => void;
  onStartJob?: (brief: string) => void;
  onOpenThread?: (body: Record<string, string>) => void;
  onNavigate?: (href: string) => void;
  onExpand?: () => void;
}) {
  const [current, setCurrent] = useState<FullThread | null>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [stopping, setStopping] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<MentionHandle>(null);

  const chief = staff.find((s) => s.is_chief);
  const { upload, uploading, err: uploadErr } = useFileUpload(files, setFiles);

  // keep the caller's `current` in sync with ours
  const report = useRef(onThread);
  report.current = onThread;
  useEffect(() => { report.current?.(current); }, [current]);
  // a new thread wipes the old one until the poll loads it
  useEffect(() => { setCurrent(null); }, [threadId]);

  // the thread: every 1.5 s while a helper is answering, every 12 s otherwise (and at once when a notice arrives);
  // unchanged threads cost a 304 thanks to the server's ETag
  const awaiting = useRef(false);
  awaiting.current = !!current?.awaiting_reply;
  usePoll(async () => {
    const want = threadId;
    try { const th = await api<FullThread>(`/threads/${want}`); setCurrent((cur) => (want === threadId ? th : cur)); } catch (e: any) { setErr(e.message); }
  }, () => (awaiting.current ? 1500 : 12000), [threadId], (n) => n?.url?.includes(threadId));

  const nMsgs = current?.messages.length || 0;
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [nMsgs, events.length]);

  useQuote(current?.id, setText, () => box.current?.focus());
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
      setText(pending);
      setTimeout(() => box.current?.focus(), 0);
    }
    const on = (e: Event) => {
      _pendingSetText = null; // clear the latch — we're handling it live right now
      setText((e as CustomEvent<{ text: string }>).detail.text);
      setTimeout(() => box.current?.focus(), 0);
    };
    window.addEventListener("omilo:settext", on);
    return () => window.removeEventListener("omilo:settext", on);
  }, []);

  const send = async (t: string) => {
    if (slash.jobBrief !== null && t.startsWith("/job")) { onStartJob?.(slash.jobBrief); return; }
    if ((!t.trim() && !files.length) || !threadId) return;
    const att = files;
    const body = { text: t.trim() || `(attached ${att.length} file${att.length > 1 ? "s" : ""})`,
      blocks: att.length ? att.map((f) => ({ type: "file", ...f })) : undefined, mentions: mention.mentioned(t) };
    setText(""); setFiles([]);
    try { setCurrent(await api<FullThread>(`/threads/${threadId}/messages`, { body })); awaiting.current = true; kick(threadId); } catch (e: any) { setErr(e.message); setText(t); setFiles(att); }
  };

  const onSlash = (a: SlashAction, rest: string) => {
    const focus = () => setTimeout(() => { const h = box.current; if (h) { h.focus(); h.setCaret(h.getValue().length); } }, 0);
    if (a.kind === "insert") { setText(a.text + rest); focus(); }
    else if (a.kind === "send") { setText(""); send(rest.trim() ? `${a.text}\n\n${rest}` : a.text); }
    else if (a.kind === "composer") { setText(""); window.dispatchEvent(new CustomEvent("omilo:composer", { detail: { action: a.action, kind: a.sub, id: a.id } })); focus(); }
    else if (a.kind === "job") { setText("/job "); focus(); }
    else if (a.kind === "talk") { setText(""); const st = staff.find((x) => x.id === a.staffId); onOpenThread?.(st?.is_chief ? { scope: "master" } : { scope: "staff", staff_id: a.staffId }); }
    else if (a.kind === "go") { setText(""); onNavigate?.(a.href); }
    else if (a.kind === "pause") { setText(""); confirmDialog({ title: "Pause all helpers?", body: "Running jobs finish their current step; nothing new starts until you resume.", confirm: "Pause everyone", mood: "worried" }).then((ok) => { if (ok) api("/system", { body: { paused: true } }).catch((e) => setErr(e.message)); }); }
  };
  const slash = useSlash(text, staff, onSlash);
  const mention = useMentions(text, setText, staff, box);

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
    for (const m of current.messages as Msg[]) if (m.role === "agent") add(m.author);
    return order.map((id) => staff.find((s) => s.id === id)).filter(Boolean) as Staff[];
  }, [current, staff]);
  const addMention = (s: Staff) => {
    // read the composer's real value (not just React state), and treat a whitespace-only box as empty so a
    // stray newline left in an "emptied" contenteditable never pushes the mention onto a new line
    const raw = box.current?.getValue() ?? text;
    const cur = raw.trim() === "" ? "" : /\s$/.test(raw) ? raw : raw + " ";
    const next = `${cur}@${s.name} `;
    setText(next);
    setTimeout(() => { const h = box.current; if (h) { h.focus(); h.setCaret(next.length); } }, 0);
  };

  if (!current) return <div className="ws-scroll" ref={scroller}><div className="ws-inner"><p className="small">Loading…</p></div></div>;

  return (
    <DropCatcher onFiles={(fs) => upload(fs)} chief={chief} disabled={current.awaiting_reply}>
      <div className="ws-scroll" ref={scroller}>
        <div className="ws-inner"><Conversation th={current} staff={staff} events={events} onSend={send} busy={current.awaiting_reply} onDecide={decide} onProposal={decideProposal} onAnswer={answerQuestion} /></div>
      </div>
      <div className="ws-composer">
        {related.length > 0 && (
          <div className="chat-people">
            {related.map((s) => (
              <button type="button" key={s.id} className="chip person" aria-label={`Mention ${s.name}`} onClick={() => addMention(s)}>
                <Avatar who={s} size={22} />
              </button>
            ))}
          </div>
        )}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          {slash.menu}
          {mention.menu}
          <MentionBox handleRef={box} value={text} onChange={setText} staff={staff}
            placeholder={`Message ${shortLabel(threadLabel(current))} · ${isGroup ? "@ mention · / commands" : "@ someone · / commands"}`}
            ariaExpanded={slash.open || mention.open}
            onKeyDown={(e) => { if (mention.onKeyDown(e) || slash.onKeyDown(e)) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
          <div className="row">
            <ComposerTools threadId={threadId} files={files} setFiles={setFiles} disabled={current.awaiting_reply} upload={upload} uploading={uploading} err={uploadErr} />
            <span className="small hide-sm">{current.awaiting_reply ? "Working on it…" : slash.jobBrief !== null ? "Enter starts a job for the Chief of Staff"
              : isGroup ? "No @mention: the Chief of Staff answers · Enter to send" : "@ to mention · / for commands · Enter to send"}</span>
            <span className="sp" />
            {current.awaiting_reply && (
              <button type="button" className="btn sm danger" disabled={stopping} onClick={async () => {
                if (!(await confirmDialog({ title: "Stop this reply?", body: "The helper stops after its current step. What it already wrote stays.", confirm: "Stop", cancel: "Let it finish", danger: true }))) return;
                setStopping(true);
                try { await api(`/threads/${current.id}/cancel`, { body: {} }); } catch (e: any) { setErr(e.message); } finally { setStopping(false); }
              }}>
                <i className="ri-stop-circle-line" />Stop
              </button>
            )}
            <button className="btn primary sm" type="submit" disabled={(!text.trim() && !files.length) || current.awaiting_reply}><i className="ri-arrow-up-line" />Send</button>
          </div>
        </form>
        <PoolMeter />
        <Err error={err} />
      </div>
    </DropCatcher>
  );
}
