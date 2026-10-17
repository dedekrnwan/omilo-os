"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { Attachments, Markdown } from "@/components/Markdown";
import { Run, RunCard, RunEvent, toRuns, useEvents } from "@/components/Run";
import { Err } from "@/components/ui";
import { Staff, Thread, api, when } from "@/lib/api";
import { helperItems } from "@/lib/actions";
import { MenuItem, copy, menu, sep } from "@/lib/menu";
import { visibleThreads } from "@/lib/open";
import { kick, usePoll } from "@/lib/poll";

/* A conversation with a helper: messages, live run cards and clickable choices. Used by the Workspace and by the
   job / chat drawers that open from anywhere. */

export type Msg = { id: string; role: string; author: string; text: string; at: string; blocks?: { type: string; options?: string[]; id?: string; name?: string; mime?: string }[] };
export type FullThread = Thread & { messages: Msg[] };

export function Choices({ m, messages, busy, onPick }: { m: Msg; messages: Msg[]; busy: boolean; onPick: (o: string) => void }) {
  const [sent, setSent] = useState<string | null>(null);
  const idx = messages.findIndex((x) => x.id === m.id);
  const answer = messages.slice(idx + 1).find((x) => x.role === "owner");
  const chosen = sent || answer?.text || null;
  const open = !answer && !sent;
  return (
    <>
      {m.blocks?.filter((b) => b.type === "choices").map((b, i) => (
        <div key={i} className="choices">{(b.options || []).map((o) => (
          <button key={o} type="button" className={`pick ${chosen === o ? "on" : ""}`} disabled={!open || busy}
            title={open && busy ? "Wait until the helper finishes this turn" : undefined}
            onClick={() => { setSent(o); onPick(o); }}>{o}</button>
        ))}</div>
      ))}
      {open && busy && m.blocks?.some((b) => b.type === "choices") && <div className="small" style={{ marginTop: 4 }}>You can pick as soon as the helper finishes this turn.</div>}
    </>
  );
}

const plain = (md: string) => md.replace(/```[\s\S]*?```/g, (b) => b.replace(/```\w*\n?/g, "")).replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/[*_`~]+/g, "").replace(/^#+\s*/gm, "").replace(/^>\s?/gm, "").trim();

/** Put a quote of a message into the reply box of the chat that shows it. */
export const quote = (threadId: string, text: string) =>
  window.dispatchEvent(new CustomEvent("omilo:quote", { detail: { threadId, text: text.trim().split("\n").map((l) => `> ${l}`).join("\n") + "\n\n" } }));

/** Let a composer receive quotes for its thread. */
export function useQuote(threadId: string | undefined | null, setText: (f: (t: string) => string) => void, focus?: () => void) {
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent).detail; if (d.threadId !== threadId) return; setText((t) => (t.trim() ? t.trimEnd() + "\n\n" : "") + d.text); focus?.(); };
    window.addEventListener("omilo:quote", on);
    return () => window.removeEventListener("omilo:quote", on);
  }, [threadId]); // eslint-disable-line react-hooks/exhaustive-deps
}

function msgItems(th: FullThread, m: Msg, who: string, staff: Staff[]): MenuItem[] {
  const h = staff.find((s) => s.id === m.author);
  return [
    { heading: m.role === "owner" ? "Your message" : m.role === "system" ? "Note" : who },
    { label: "Quote in reply", icon: "ri-double-quotes-l", onSelect: () => quote(th.id, m.text) },
    { label: "Copy text", icon: "ri-file-copy-line", onSelect: () => copy(plain(m.text)) },
    { label: "Copy as Markdown", icon: "ri-markdown-line", onSelect: () => copy(m.text) },
    m.role === "agent" && { label: "Ask again", icon: "ri-restart-line", hint: "puts your question back in the box", onSelect: () => {
      const last = th.messages.slice(0, th.messages.findIndex((x) => x.id === m.id)).reverse().find((x) => x.role === "owner");
      if (last) window.dispatchEvent(new CustomEvent("omilo:quote", { detail: { threadId: th.id, text: last.text } }));
    } },
    ...(h ? [sep, ...helperItems(h)] : []),
  ].filter(Boolean) as MenuItem[];
}

export function Conversation({ th, staff, events, onSend, busy }: { th: FullThread; staff: Staff[]; events: RunEvent[]; onSend: (t: string) => void; busy: boolean }) {
  const runs = toRuns(events);
  const name = (id: string) => staff.find((s) => s.id === id)?.name || id;
  // place each run before the first agent/system message that came after it started
  type Row = { kind: "msg"; m: Msg } | { kind: "run"; r: Run };
  const rows: Row[] = [];
  let ri = 0;
  for (const m of th.messages) {
    while (ri < runs.length && runs[ri].start <= m.at && m.role !== "owner") { rows.push({ kind: "run", r: runs[ri++] }); }
    rows.push({ kind: "msg", m });
  }
  while (ri < runs.length) rows.push({ kind: "run", r: runs[ri++] });
  return (
    <div className="conv">
      {th.messages.length === 0 && runs.length === 0 && (
        <div className="sysmsg">Ask anything: what needs you, what someone did, or tell a helper what to do.</div>
      )}
      {rows.map((row) => row.kind === "run" ? <RunCard key={`r${row.r.id}`} run={row.r} /> : (
        row.m.role === "owner" ? <div key={row.m.id} className="bubble" onContextMenu={menu(() => msgItems(th, row.m, "", staff))}><Markdown text={row.m.text} /><Attachments blocks={row.m.blocks} /></div>
          : row.m.role === "system" ? <div key={row.m.id} className="sysmsg" onContextMenu={menu(() => msgItems(th, row.m, "", staff))}><Markdown text={row.m.text} /></div>
          : (
            <div key={row.m.id} className="agentmsg" onContextMenu={menu(() => msgItems(th, row.m, name(row.m.author), staff))}>
              <Avatar who={staff.find((x) => x.id === row.m.author) || { id: row.m.author, name: name(row.m.author) }} size={30} />
              <div className="body">
                <div className="who">{name(row.m.author)} · {when(row.m.at)}</div>
                <Markdown text={row.m.text} />
                <Attachments blocks={row.m.blocks} />
                <Choices m={row.m} messages={th.messages} busy={busy} onPick={onSend} />
              </div>
            </div>
          )
      ))}
      {th.awaiting_reply && !runs.some((r) => r.state === "running") && (
        <div className="agentmsg"><Avatar who={staff.find((x) => x.id === th.staff_id)} size={30} state="working" /><div className="body"><span className="shimmer" style={{ fontWeight: 500 }}>Starting…</span></div></div>
      )}
    </div>
  );
}


/** A self-contained chat with one thread (for drawers): loads, polls while the helper answers, and sends. */
export function ChatPane({ threadId, staff, placeholder }: { threadId: string; staff: Staff[]; placeholder?: string }) {
  const [th, setTh] = useState<FullThread | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const awaiting = useRef(false);
  awaiting.current = !!th?.awaiting_reply;
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useQuote(threadId, setText, () => box.current?.focus());
  useEffect(() => { visibleThreads.add(threadId); return () => { visibleThreads.delete(threadId); }; }, [threadId]);
  const load = useCallback(async () => { try { setTh(await api<FullThread>(`/threads/${threadId}`)); } catch (e: any) { setErr(e.message); } }, [threadId]);
  usePoll(load, () => (awaiting.current ? 1500 : 10000), [load], (n) => n?.url?.includes(threadId));
  const events = useEvents({ thread_id: threadId });
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [th?.messages.length, events.length]);
  const send = async (t: string) => {
    if (!t.trim()) return;
    setText("");
    try { setTh(await api<FullThread>(`/threads/${threadId}/messages`, { body: { text: t } })); awaiting.current = true; kick(threadId); }
    catch (e: any) { setErr(e.message); setText(t); }
  };
  if (!th) return <p className="small" style={{ padding: 16 }}>{err || "Loading…"}</p>;
  return (
    <div className="cpane">
      <div className="cpane-msgs"><Conversation th={th} staff={staff} events={events} onSend={send} busy={th.awaiting_reply} /><div ref={end} /></div>
      <form className="composer cpane-box" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder || "Message the helper…"} rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
        <div className="row"><span className="small">{th.awaiting_reply ? "Working on it…" : "Enter to send"}</span><span className="sp" />
          <button className="btn primary sm" type="submit" disabled={!text.trim() || th.awaiting_reply}><i className="ri-arrow-up-line" />Send</button></div>
      </form>
      <Err error={err} />
    </div>
  );
}
