"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Avatar, { mascotSVG, lookFor, type Look } from "@/components/Avatar";
import { type MentionHandle } from "@/components/MentionBox";
import { Staff } from "@/lib/api";

/* @mentions in a chat box: type @ and pick a helper (arrows, Enter or Tab), or keep typing to filter. The picked
   helper answers in this chat after you send. Names typed by hand (@Marketing) work too: the server reads them. */

type Box = React.RefObject<MentionHandle | null>;

/** The @word being typed right before the caret, if any. */
function token(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])@([\w-]*)$/.exec(before);
  return m ? { start: caret - m[2].length - 1, query: m[2].toLowerCase() } : null;
}

export function useMentions(text: string, setText: (t: string) => void, staff: Staff[], box: Box) {
  const [caret, setCaret] = useState(0);
  const [idx, setIdx] = useState(0);
  const [closedAt, setClosedAt] = useState<string | null>(null);
  const picked = useRef<Set<string>>(new Set());

  useEffect(() => { // follow the caret as the owner types or clicks. selectionchange covers typing, clicks and arrow
    // keys; box.current is read lazily so there is no mount-order race with the MentionBox handle.
    const sync = () => { const h = box.current; if (h?.el && (document.activeElement === h.el || h.el.contains(document.activeElement))) setCaret(h.getCaret()); };
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
  }, [box]);
  useEffect(() => { const h = box.current; if (h?.el && (document.activeElement === h.el || h.el.contains(document.activeElement))) setCaret(h.getCaret()); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const tok = token(text, Math.min(caret, text.length));
  const items = useMemo(() => {
    if (!tok) return [];
    const q = tok.query;
    const people = staff.filter((s) => (s as any).status !== "retired");
    const starts = people.filter((s) => s.name.toLowerCase().startsWith(q) || s.id.startsWith(q));
    const has = people.filter((s) => !starts.includes(s) && s.name.toLowerCase().includes(q));
    return [...starts, ...has].slice(0, 8);
  }, [tok?.query, staff]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setIdx(0), [tok?.query]);
  useEffect(() => { if (!text) picked.current.clear(); }, [text]);

  const open = !!tok && items.length > 0 && closedAt !== `${text}:${caret}`;
  const pick = (s: Staff | undefined) => {
    if (!s || !tok) return;
    const next = `${text.slice(0, tok.start)}@${s.name} ${text.slice(caret)}`;
    picked.current.add(s.id);
    setText(next);
    const pos = tok.start + s.name.length + 2;
    setTimeout(() => { const h = box.current; if (h) { h.focus(); h.setCaret(pos); setCaret(pos); } }, 0);
  };

  /** Returns true when the key was used by the menu. */
  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!open) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => (i + 1) % items.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => (i - 1 + items.length) % items.length); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(items[idx]); return true; }
    if (e.key === "Escape") { e.preventDefault(); setClosedAt(`${text}:${caret}`); return true; }
    return false;
  };

  /** The helpers mentioned in what is about to be sent (picked from the menu and still in the text). */
  const mentioned = (t: string) => staff.filter((s) => picked.current.has(s.id) && t.toLowerCase().includes(`@${s.name.toLowerCase()}`)).map((s) => s.id);

  const menu = open ? (
    <div className="slash mention-menu" role="listbox" aria-label="Mention a helper">
      <div className="sl-group">Mention a helper</div>
      {items.map((s, i) => (
        <button key={s.id} type="button" role="option" aria-selected={i === idx} className={`sl-item ${i === idx ? "on" : ""}`}
          onMouseEnter={() => setIdx(i)} onMouseDown={(e) => { e.preventDefault(); pick(s); }}>
          <Avatar who={s} size={22} />
          <span className="sl-label"><b>{s.name}</b></span>
          <span className="sl-hint">{s.is_chief ? "routes work to the team" : (s as any).role || ""}</span>
        </button>
      ))}
      <div className="sl-foot"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> mention · <kbd>Esc</kbd> close</div>
    </div>
  ) : null;
  return { open, onKeyDown, menu, mentioned };
}

type MentionStaff = { id: string; name: string; role?: string; is_chief?: boolean };
const htmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Highlight @Name of known helpers in rendered message HTML (outside tags and code) as a mascot + name chip. */
export function markMentions(html: string, staff: MentionStaff[], looks?: Record<string, Look>): string {
  if (!staff.length || !html.includes("@")) return html;
  const names = [...staff].sort((a, b) => b.name.length - a.name.length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[\\s(>])@(${names.map((s) => esc(s.name)).join("|")})(?![\\w-])`, "gi");
  // only touch text between tags, and never inside <code>/<pre>
  let inCode = 0;
  return html.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith("<")) {
      if (/^<(code|pre)\b/i.test(part)) inCode++;
      else if (/^<\/(code|pre)>/i.test(part)) inCode = Math.max(0, inCode - 1);
      return part;
    }
    if (inCode) return part;
    return part.replace(re, (_m, pre, name) => {
      const who = names.find((s) => s.name.toLowerCase() === String(name).toLowerCase());
      const label = htmlEsc(who?.name || name);
      const svg = who ? mascotSVG(lookFor(who, looks?.[who.id])) : "";
      return `${pre}<span class="mention" data-staff="${htmlEsc(who?.id || "")}">${svg}<span class="mention-name">@${label}</span></span>`;
    });
  }).join("");
}
