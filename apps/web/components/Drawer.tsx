"use client";
import { ReactNode, useEffect, useRef } from "react";

/* The right-side panel used for every "add" and "edit" in Omilo (same look as Hire a specialist):
   a header with a title, a scrolling body, and a footer that stays in view with the main buttons. */
export default function Drawer({ open, title, sub, icon, onClose, footer, children, wide = false }: {
  open: boolean; title: ReactNode; sub?: ReactNode; icon?: ReactNode; onClose: () => void; footer?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  // Keep the latest onClose without making it an effect dependency: callers pass an inline
  // arrow (new identity every render), and if the effect below re-ran on that it would re-focus
  // the first field on every keystroke — stealing the cursor back to it while you type.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // put the cursor in the first field once, when the drawer opens, so typing can start right away
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([type=checkbox]), textarea, select")?.focus(), 60);
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; clearTimeout(t); };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside ref={panel} className={`drawer dw ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <div className="dw-head">
          {icon && <span className="dw-icon">{icon}</span>}
          <div className="dw-title"><b>{title}</b>{sub && <span>{sub}</span>}</div>
          <button className="iconbtn" aria-label="Close" onClick={onClose}><i className="ri-close-line" /></button>
        </div>
        <div className="dw-body">{children}</div>
        {footer && <div className="dw-foot">{footer}</div>}
      </aside>
    </>
  );
}
