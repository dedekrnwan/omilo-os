"use client";
import { useEffect, useMemo, useRef } from "react";
import { mascotSVG, lookFor, useLooks, type Look } from "@/components/Avatar";
import { Staff } from "@/lib/api";

/* A composer that shows @mentions as inline mascot chips, while its value stays a plain "@Name" string so the
   send path, slash menu and server are unchanged. It is a contenteditable whose child DOM we manage by hand
   (React must not reconcile a contenteditable's children). The DOM is kept flat — text nodes (newlines as "\n"
   under white-space: pre-wrap) and atomic chip spans (contentEditable=false) — so serialisation and caret maths
   stay simple. */

export type MentionHandle = {
  el: HTMLDivElement | null;
  getValue: () => string;
  getCaret: () => number;
  focus: () => void;
  setCaret: (pos: number) => void;
};

type Name = { id: string; name: string; role?: string; is_chief?: boolean };
const htmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const chipText = (name: string) => `@${name}`;

type Seg = { t: "text"; s: string } | { t: "chip"; id: string; name: string };

/* Split a plain "@Name" string into text / chip segments. Mirrors markMentions's matcher (same pattern) so the
   composer and the bubble agree on what counts as a mention. */
function splitMentions(value: string, names: Name[]): Seg[] {
  if (!names.length || !value.includes("@")) return value ? [{ t: "text", s: value }] : [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sorted = [...names].sort((a, b) => b.name.length - a.name.length);
  const re = new RegExp(`(^|[\\s(])@(${sorted.map((s) => esc(s.name)).join("|")})(?![\\w-])`, "gi");
  const out: Seg[] = [];
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    const at = m.index + m[1].length;
    if (at > last) out.push({ t: "text", s: value.slice(last, at) });
    const who = sorted.find((s) => s.name.toLowerCase() === m![2].toLowerCase())!;
    out.push({ t: "chip", id: who.id, name: who.name });
    last = re.lastIndex;
  }
  if (last < value.length) out.push({ t: "text", s: value.slice(last) });
  return out;
}

const isChip = (n: Node | null): n is HTMLElement => !!n && n.nodeType === 1 && (n as HTMLElement).classList.contains("mention");
const nodeLen = (n: Node): number => n.nodeType === 3 ? (n.nodeValue || "").length : isChip(n) ? chipText((n as HTMLElement).dataset.name || "").length : (n.textContent || "").length;

/** DOM → the plain "@Name" string. */
function serialize(el: HTMLElement): string {
  let out = "";
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3) out += n.nodeValue || "";
    else if (isChip(n)) out += chipText((n as HTMLElement).dataset.name || "");
    else if ((n as HTMLElement).tagName === "BR") out += "\n";
    else out += (n.textContent || ""); // stray element (e.g. from paste) — take its text
  }
  return out;
}

/** The plain "@Name" string → flat DOM (text nodes + chip spans). */
function renderDom(el: HTMLElement, value: string, names: Name[], looks: Record<string, Look>) {
  el.textContent = "";
  for (const seg of splitMentions(value, names)) {
    if (seg.t === "text") { el.appendChild(document.createTextNode(seg.s)); continue; }
    const who = names.find((s) => s.id === seg.id)!;
    const span = document.createElement("span");
    span.className = "mention";
    span.contentEditable = "false";
    span.dataset.staff = seg.id;
    span.dataset.name = seg.name;
    span.innerHTML = mascotSVG(lookFor(who, looks[seg.id])) + `<span class="mention-name">${htmlEsc(chipText(seg.name))}</span>`;
    el.appendChild(span);
  }
}

/** Current caret position as an offset into the serialized string. */
function getCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !el.contains(sel.getRangeAt(0).endContainer)) return serialize(el).length;
  const r = sel.getRangeAt(0);
  const kids = Array.from(el.childNodes);
  if (r.endContainer === el) {
    let o = 0; for (let i = 0; i < r.endOffset; i++) o += nodeLen(kids[i]); return o;
  }
  let offset = 0;
  for (const n of kids) {
    if (n === r.endContainer) return offset + r.endOffset;
    if (n.nodeType === 1 && (n as HTMLElement).contains(r.endContainer)) return offset + nodeLen(n); // inside a chip → after it
    offset += nodeLen(n);
  }
  return offset;
}

/** Place the caret at a string offset. */
function applyCaret(el: HTMLElement, pos: number) {
  const sel = window.getSelection(); if (!sel) return;
  const r = document.createRange();
  let remaining = pos, placed = false;
  for (const n of Array.from(el.childNodes)) {
    const len = nodeLen(n);
    if (n.nodeType === 3) {
      if (remaining <= len) { r.setStart(n, remaining); placed = true; break; }
      remaining -= len;
    } else {
      if (remaining < len) { r.setStartBefore(n); placed = true; break; }
      if (remaining === len) { r.setStartAfter(n); placed = true; break; }
      remaining -= len;
    }
  }
  if (!placed) { r.selectNodeContents(el); r.collapse(false); } else r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
}

export default function MentionBox({ value, onChange, staff, placeholder, ariaExpanded, onKeyDown, handleRef }: {
  value: string; onChange: (v: string) => void; staff: Staff[]; placeholder?: string;
  ariaExpanded?: boolean; onKeyDown?: (e: React.KeyboardEvent) => void; handleRef: React.RefObject<MentionHandle | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const looks = useLooks();
  const last = useRef<string>("");
  const names = useMemo<Name[]>(() => staff.map((s) => ({ id: s.id, name: s.name, role: (s as any).role, is_chief: s.is_chief })), [staff]);

  const emit = () => { const el = ref.current; if (!el) return; const v = serialize(el); last.current = v; onChange(v); };

  // Re-render the DOM only when the value changed from outside (pick, quote, clear-after-send) so our own
  // keystrokes never trigger a rebuild (which would drop the caret). When idle, also refresh to pick up looks.
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (value !== last.current) { renderDom(el, value, names, looks); last.current = value; }
    // idle refresh only for mention-bearing text while unfocused, so plain typing is never rebuilt under the user
    else if (value.includes("@") && document.activeElement !== el) renderDom(el, value, names, looks);
  }, [value, names, looks]);

  // Expose the handle; methods read ref.current lazily so there is no mount-order race with the parent's hooks.
  useEffect(() => {
    handleRef.current = {
      el: ref.current,
      getValue: () => last.current,
      getCaret: () => (ref.current ? getCaretOffset(ref.current) : last.current.length),
      focus: () => ref.current?.focus(),
      setCaret: (pos) => { const el = ref.current; if (el) applyCaret(el, pos); },
    };
    return () => { handleRef.current = null; };
  });

  const insertText = (str: string) => {
    const sel = window.getSelection(), el = ref.current; if (!sel || !sel.rangeCount || !el) return;
    const r = sel.getRangeAt(0); r.deleteContents();
    const tn = document.createTextNode(str);
    r.insertNode(tn); r.setStartAfter(tn); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
    emit();
  };

  const onKey = (e: React.KeyboardEvent) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); insertText("\n"); return; }
    if (e.key === "Backspace" || e.key === "Delete") {
      const sel = window.getSelection(), el = ref.current; if (!sel || !sel.rangeCount || !el) return;
      const r = sel.getRangeAt(0); if (!r.collapsed) return; // let the browser delete a real selection
      let chip: Node | null = null;
      // a click can resolve the caret onto a chip or its inner svg/name — target the whole chip in that case
      const near = r.endContainer.nodeType === 1 ? (r.endContainer as Element) : r.endContainer.parentElement;
      const onChip = near?.closest?.(".mention") || null;
      if (onChip && el.contains(onChip)) chip = onChip;
      else if (e.key === "Backspace") {
        if (r.endContainer === el) chip = el.childNodes[r.endOffset - 1] || null;
        else if (r.endContainer.nodeType === 3 && r.endOffset === 0) chip = r.endContainer.previousSibling;
      } else {
        if (r.endContainer === el) chip = el.childNodes[r.endOffset] || null;
        else if (r.endContainer.nodeType === 3 && r.endOffset === (r.endContainer.nodeValue || "").length) chip = r.endContainer.nextSibling;
      }
      if (isChip(chip)) { e.preventDefault(); (chip as HTMLElement).remove(); emit(); }
    }
  };

  const onPaste = (e: React.ClipboardEvent) => { e.preventDefault(); insertText(e.clipboardData.getData("text/plain")); };

  return (
    <div ref={ref} className="mentionbox" contentEditable role="textbox" aria-multiline="true"
      aria-expanded={ariaExpanded} aria-haspopup="listbox" data-placeholder={placeholder || ""} suppressContentEditableWarning
      onInput={emit} onKeyDown={onKey} onPaste={onPaste} />
  );
}
