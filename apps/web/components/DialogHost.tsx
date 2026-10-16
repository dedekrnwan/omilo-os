"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { SagaMascot } from "@/components/Logo";
import type { DialogReq } from "@/lib/dialog";

/* One dialog at a time (others wait in line). The helper it is about looks sad when you are about to do something
   to it, cheers up when you point at "Keep", and sheds a tear when you point at the red button. */
export default function DialogHost() {
  const [queue, setQueue] = useState<DialogReq[]>([]);
  const [lean, setLean] = useState<"yes" | "no" | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const cur = queue[0];

  useEffect(() => {
    const on = (e: Event) => setQueue((q) => [...q, (e as CustomEvent<DialogReq>).detail]);
    window.addEventListener("saga:dialog", on);
    return () => window.removeEventListener("saga:dialog", on);
  }, []);
  const close = useCallback((ok: boolean) => {
    if (!cur) return;
    cur.resolve(ok);
    setLean(null);
    setQueue((q) => q.slice(1));
  }, [cur]);
  useEffect(() => {
    if (!cur) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => (cur.danger ? cancelRef.current : okRef.current)?.focus(), 30);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(false); }
      else if (e.key === "Enter" && !cur.danger && document.activeElement?.tagName !== "BUTTON") { e.preventDefault(); close(true); }
      else if (e.key === "Tab") {  // keep the focus inside the dialog
        const els = [cancelRef.current, okRef.current].filter(Boolean) as HTMLElement[];
        const i = els.indexOf(document.activeElement as HTMLElement);
        e.preventDefault(); els[(i + (e.shiftKey ? els.length - 1 : 1)) % els.length]?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => { clearTimeout(t); window.removeEventListener("keydown", key); prev?.focus?.(); };
  }, [cur, close]);
  if (!cur) return null;

  const base = cur.mood || (cur.danger ? "sad" : cur.who ? "worried" : "worried");
  const mood = lean === "no" ? null : lean === "yes" && cur.danger ? "sad" : base === "happy" ? null : base;
  const face = cur.who ? <Avatar who={cur.who} size={76} mood={mood as any} /> : cur.icon && !cur.danger && base === "happy"
    ? <span className="dlg-icon"><i className={cur.icon} /></span> : <SagaMascot size={76} mood={mood as any} />;
  return (
    <div className="dlg-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <div className={`dlg ${cur.danger ? "danger" : ""} ${lean === "yes" ? "lean-yes" : lean === "no" ? "lean-no" : ""}`} role="alertdialog" aria-modal="true"
        aria-labelledby={`dlg-t-${cur.id}`} aria-describedby={cur.body ? `dlg-b-${cur.id}` : undefined}>
        <div className="dlg-face">{face}</div>
        <h2 id={`dlg-t-${cur.id}`}>{cur.title}</h2>
        {cur.body && <div id={`dlg-b-${cur.id}`} className="dlg-body">{cur.body}</div>}
        <div className="dlg-acts">
          {!cur.alert && (
            <button ref={cancelRef} className="btn dlg-cancel" onClick={() => close(false)} onMouseEnter={() => setLean("no")} onMouseLeave={() => setLean(null)}>{cur.cancel || "Cancel"}</button>
          )}
          <button ref={okRef} className={`btn ${cur.danger ? "danger-solid" : "primary"}`} onClick={() => close(true)}
            onMouseEnter={() => setLean("yes")} onMouseLeave={() => setLean(null)}>
            {cur.confirm || (cur.alert ? "OK" : "Confirm")}</button>
        </div>
        {queue.length > 1 && <span className="small dlg-more">{queue.length - 1} more after this</span>}
      </div>
    </div>
  );
}
