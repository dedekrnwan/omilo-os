"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Err, Markdown } from "@/components/ui";
import { Staff, Thread, api, when } from "@/lib/api";

function ChatInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [current, setCurrent] = useState<Thread | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const tid = params.get("thread");

  const loadList = useCallback(async () => {
    setThreads(await api<Thread[]>("/threads"));
    setStaff(await api<Staff[]>("/staff"));
  }, []);

  const open = useCallback(async (body: Record<string, string>) => {
    try {
      const th = await api<Thread>("/threads", { body });
      router.replace(`/chat/?thread=${th.id}`);
    } catch (e: any) { setErr(e.message); }
  }, [router]);

  useEffect(() => { loadList().catch((e) => setErr(e.message)); }, [loadList]);
  useEffect(() => { if (!tid) open({ scope: "master" }); }, [tid, open]);

  useEffect(() => {
    if (!tid) return;
    let stop = false;
    const tick = async () => {
      try {
        const th = await api<Thread>(`/threads/${tid}`);
        if (!stop) setCurrent(th);
      } catch (e: any) { setErr(e.message); }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [tid]);

  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [current?.messages?.length, current?.awaiting_reply]);

  const send = async () => {
    if (!text.trim() || !tid) return;
    const t = text;
    setText("");
    try { setCurrent(await api<Thread>(`/threads/${tid}/messages`, { body: { text: t } })); loadList(); } catch (e: any) { setErr(e.message); setText(t); }
  };

  const chief = staff.find((s) => s.is_chief);
  const label = (th: Thread) => th.scope === "master" ? "Chief of Staff" : th.scope === "staff" ? `DM · ${th.title}` : `${th.scope} · ${th.title}`;

  return (
    <div>
      <div className="eyebrow">Master entrypoint · talk to your staff</div>
      <h1>Chat</h1>
      <div className="chatwrap">
        <div className="threads">
          {chief && <button className={current?.scope === "master" ? "on" : ""} onClick={() => open({ scope: "master" })}><b>Chief of Staff</b><div className="small">routes work to the team</div></button>}
          <div className="fn small" style={{ padding: "12px 6px 4px" }}>Direct messages</div>
          {staff.filter((s) => !s.is_chief).map((s) => (
            <button key={s.id} className={current?.scope === "staff" && current.staff_id === s.id ? "on" : ""} onClick={() => open({ scope: "staff", staff_id: s.id })}>{s.name}</button>
          ))}
          <div className="fn small" style={{ padding: "12px 6px 4px" }}>Recent threads</div>
          {threads.filter((t) => t.scope === "task" || t.scope === "proposal").slice(0, 12).map((t) => (
            <button key={t.id} className={current?.id === t.id ? "on" : ""} onClick={() => router.replace(`/chat/?thread=${t.id}`)}>
              <span className="small">{label(t)}</span>
            </button>
          ))}
        </div>
        <div className="chat">
          <div className="msgs" ref={box}>
            {!current?.messages?.length && <div className="msg system">Ask about anything: what needs you, what an agent did, or tell someone what to do.</div>}
            {current?.messages?.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                {m.role !== "system" && <div className="who">{m.role === "owner" ? "You" : (staff.find((s) => s.id === m.author)?.name || m.author)} · {when(m.at)}</div>}
                <Markdown text={m.text} />
              </div>
            ))}
            {current?.awaiting_reply && <div className="typing">Thinking…</div>}
          </div>
          <div className="composer">
            <textarea value={text} placeholder={current ? `Message ${label(current)}` : "Message"} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button className="btn primary" onClick={send} disabled={!text.trim() || current?.awaiting_reply}>Send</button>
          </div>
          <Err error={err} />
        </div>
      </div>
    </div>
  );
}

export default function Chat() {
  return <Suspense><ChatInner /></Suspense>;
}
