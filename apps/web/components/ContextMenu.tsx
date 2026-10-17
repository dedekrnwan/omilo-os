"use client";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MenuItem, MenuOpen } from "@/lib/menu";
import { openInDrawer } from "@/lib/open";

/* Renders the right-click menu wherever it was asked for: keyboard (arrows, Enter, Esc), stays on screen, closes on
   click outside, scroll or resize. */
export default function ContextMenuHost() {
  const router = useRouter();
  const [m, setM] = useState<MenuOpen | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [idx, setIdx] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const actionable = (it: MenuItem) => "label" in it && !it.disabled;

  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<MenuOpen>).detail; setM(d); setPos(null); setIdx(-1); };
    window.addEventListener("omilo:menu", on);
    return () => window.removeEventListener("omilo:menu", on);
  }, []);
  useLayoutEffect(() => {
    if (!m || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPos({ x: Math.max(6, Math.min(m.x, window.innerWidth - r.width - 6)), y: Math.max(6, m.y + r.height > window.innerHeight - 6 ? m.y - r.height : m.y) });
    box.current.focus({ preventScroll: true });
  }, [m]);
  useEffect(() => {
    if (!m) return;
    const t0 = Date.now();
    const close = (e: Event) => {
      if ((e.type === "mousedown" || e.type === "scroll") && box.current?.contains(e.target as Node)) return;
      if (e.type === "scroll" && Date.now() - t0 < 250) return; // the scroll that brought the item into view
      setM(null);
    };
    window.addEventListener("mousedown", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("mousedown", close, true); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); window.removeEventListener("blur", close); };
  }, [m]);

  if (!m) return null;
  const run = (it: MenuItem) => {
    if (!("label" in it) || it.disabled) return;
    setM(null);
    if (it.onSelect) { Promise.resolve(it.onSelect()).catch(() => {}); return; }
    if (it.href && !openInDrawer(it.href)) router.push(it.href);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const order = m.items.map((it, i) => (actionable(it) ? i : -1)).filter((i) => i >= 0);
    if (e.key === "Escape") { e.preventDefault(); setM(null); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!order.length) return;
      const at = order.indexOf(idx), step = e.key === "ArrowDown" ? 1 : -1;
      setIdx(at < 0 ? order[step > 0 ? 0 : order.length - 1] : order[(at + step + order.length) % order.length]);
    } else if (e.key === "Enter" && idx >= 0) { e.preventDefault(); run(m.items[idx]); }
  };
  return (
    <div ref={box} className="cmenu" role="menu" tabIndex={-1} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.x ?? m.x, top: pos?.y ?? m.y, visibility: pos ? "visible" : "hidden" }}>
      {m.items.map((it, i) => "sep" in it ? <div key={i} className="cm-sep" role="separator" /> : "heading" in it ? <div key={i} className="cm-h">{it.heading}</div> : (
        <button key={i} type="button" role="menuitem" className={`cm-i ${it.danger ? "danger" : ""} ${i === idx ? "on" : ""}`} disabled={it.disabled}
          onMouseEnter={() => setIdx(i)} onClick={() => run(it)}>
          <i className={it.checked ? "ri-check-line" : it.checked === false ? "ri-checkbox-blank-line cm-blank" : it.icon || "ri-checkbox-blank-line cm-blank"} />
          <span className="cm-l">{it.label}</span>
          {it.hint && <span className="cm-hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}
