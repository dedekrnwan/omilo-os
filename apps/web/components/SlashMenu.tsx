"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Staff, api } from "@/lib/api";

/* Type "/" in the chat box: quick actions, skills, helpers and shortcuts, filtered as you type. */

export type SlashAction =
  | { kind: "insert"; text: string }          // put a prompt in the box to finish
  | { kind: "send"; text: string }            // send a ready prompt
  | { kind: "composer"; action: string; sub?: "folders" | "connectors" | "skills"; id?: string }
  | { kind: "job" }                           // start a job with what follows
  | { kind: "talk"; staffId: string }
  | { kind: "go"; href: string }
  | { kind: "pause" };

export type SlashItem = { key: string; label: string; hint?: string; icon: string; group: string; act: SlashAction };
type Skill = { slug: string; name: string; description: string };

const QUICK: SlashItem[] = [
  { key: "brief", label: "Brief me", hint: "what got done, what needs me, what's next", icon: "ri-sun-line", group: "Quick actions",
    act: { kind: "send", text: "Give me a short brief: what got done today, what is waiting on me, and what happens next." } },
  { key: "status", label: "Who is doing what", hint: "every helper's current work", icon: "ri-team-line", group: "Quick actions",
    act: { kind: "send", text: "What is each helper working on right now, and is anyone stuck?" } },
  { key: "plan", label: "Make a plan", hint: "steps, owners and dates", icon: "ri-list-ordered-2", group: "Quick actions",
    act: { kind: "insert", text: "Make a step-by-step plan (who does what, by when) for: " } },
  { key: "research", label: "Research", hint: "with sources", icon: "ri-search-eye-line", group: "Quick actions",
    act: { kind: "insert", text: "Research this and list the sources you used: " } },
  { key: "delegate", label: "Hand to the right helper", hint: "the Chief picks who", icon: "ri-share-forward-line", group: "Quick actions",
    act: { kind: "insert", text: "Give this to the right helper and tell me who took it: " } },
  { key: "draft", label: "Draft for approval", hint: "nothing is sent without you", icon: "ri-quill-pen-line", group: "Quick actions",
    act: { kind: "insert", text: "Draft this for my approval (do not send anything): " } },
  { key: "review", label: "Review", hint: "what to fix, most important first", icon: "ri-search-2-line", group: "Quick actions",
    act: { kind: "insert", text: "Review this and tell me what to fix, most important first: " } },
  { key: "goal", label: "Set a goal", hint: "finish the prompt", icon: "ri-flag-2-line", group: "Quick actions",
    act: { kind: "insert", text: "Create this goal: " } },
  { key: "job", label: "Start a job", hint: "type the brief after /job", icon: "ri-play-circle-line", group: "Quick actions", act: { kind: "job" } },
  { key: "attach", label: "Add files or photos", icon: "ri-attachment-2", group: "Add to this chat", act: { kind: "composer", action: "attach" } },
  { key: "folder", label: "Folders on this computer", icon: "ri-folder-3-line", group: "Add to this chat", act: { kind: "composer", action: "open", sub: "folders" } },
  { key: "connector", label: "Connectors", icon: "ri-plug-line", group: "Add to this chat", act: { kind: "composer", action: "open", sub: "connectors" } },
  { key: "skills", label: "All skills", icon: "ri-magic-line", group: "Add to this chat", act: { kind: "composer", action: "open", sub: "skills" } },
];
const GO: SlashItem[] = [
  { key: "inbox", label: "Inbox", icon: "ri-inbox-2-line", group: "Go to", act: { kind: "go", href: "/" } },
  { key: "work", label: "Jobs", icon: "ri-list-check-3", group: "Go to", act: { kind: "go", href: "/chat/?view=work" } },
  { key: "hire", label: "Hire a specialist", icon: "ri-user-add-line", group: "Go to", act: { kind: "go", href: "/talent/" } },
  { key: "pool", label: "Harness (Claude Code pool)", icon: "ri-stack-line", group: "Go to", act: { kind: "go", href: "/harness/" } },
  { key: "calendar", label: "Calendar", icon: "ri-calendar-line", group: "Go to", act: { kind: "go", href: "/calendar/" } },
  { key: "settings", label: "Settings", icon: "ri-settings-3-line", group: "Go to", act: { kind: "go", href: "/settings/" } },
  { key: "pause", label: "Pause all helpers", hint: "asks first", icon: "ri-pause-circle-line", group: "Go to", act: { kind: "pause" } },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function useSlash(text: string, staff: Staff[], onPick: (a: SlashAction, rest: string) => void) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const loaded = useRef(false);
  const m = /^\/(\S*)(?:\s([\s\S]*))?$/.exec(text);
  const query = m ? m[1].toLowerCase() : null;
  const rest = m?.[2] ?? "";
  // the menu shows while typing the command itself; after a space only an exact /job keeps it (to start a job)
  const typingCommand = m !== null && m[2] === undefined;

  useEffect(() => {
    if (query === null || loaded.current) return;
    loaded.current = true;
    api<Skill[]>("/skills").then(setSkills).catch(() => {});
  }, [query]);

  const all = useMemo<SlashItem[]>(() => {
    const used = new Set([...QUICK, ...GO].map((x) => x.key));
    const sk: SlashItem[] = skills.map((s) => {
      const k = used.has(s.slug) ? `skill-${s.slug}` : s.slug;
      used.add(k);
      return { key: k, label: s.name, hint: s.description, icon: "ri-magic-line", group: "Skills", act: { kind: "composer", action: "enable", sub: "skills", id: s.slug } };
    });
    const people: SlashItem[] = staff.map((st) => {
      let k = slug(st.name) || st.id;
      if (used.has(k)) k = `talk-${k}`;
      used.add(k);
      return { key: k, label: `Talk to ${st.name}`, hint: st.is_chief ? "routes work to the team" : undefined, icon: st.is_chief ? "ri-star-line" : "ri-user-line",
        group: "Helpers", act: { kind: "talk", staffId: st.id } };
    });
    return [...QUICK, ...sk, ...people, ...GO];
  }, [skills, staff]);

  const items = useMemo(() => {
    if (query === null) return [];
    if (!query) return all;
    const starts = all.filter((x) => x.key.startsWith(query));
    const contains = all.filter((x) => !starts.includes(x) && (x.key.includes(query) || x.label.toLowerCase().includes(query)));
    return [...starts, ...contains];
  }, [all, query]);

  useEffect(() => { setIdx(0); }, [query]);
  useEffect(() => { if (dismissed !== null && text !== dismissed) setDismissed(null); }, [text, dismissed]);

  const open = typingCommand && items.length > 0 && dismissed !== text;
  const pick = (it: SlashItem | undefined) => { if (it) onPick(it.act, rest); };

  /** Returns true when the key was used by the menu. */
  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!open) return false;
    if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => (i + 1) % items.length); return true; }
    if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => (i - 1 + items.length) % items.length); return true; }
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(items[idx]); return true; }
    if (e.key === "Escape") { e.preventDefault(); setDismissed(text); return true; }
    return false;
  };

  const menu = open ? <SlashList items={items} idx={idx} setIdx={setIdx} onPick={pick} /> : null;
  return { open, onKeyDown, menu, jobBrief: m && m[1] === "job" && m[2] !== undefined ? rest : null };
}

function SlashList({ items, idx, setIdx, onPick }: { items: SlashItem[]; idx: number; setIdx: (i: number) => void; onPick: (it: SlashItem) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.querySelector(".sl-item.on")?.scrollIntoView({ block: "nearest" }); }, [idx]);
  let last = "";
  return (
    <div className="slash" ref={box} role="listbox" aria-label="Commands">
      {items.map((it, i) => {
        const head = it.group !== last ? <div className="sl-group">{it.group}</div> : null;
        last = it.group;
        return (
          <div key={`${it.group}-${it.key}`}>
            {head}
            <button type="button" role="option" aria-selected={i === idx} className={`sl-item ${i === idx ? "on" : ""}`}
              onMouseEnter={() => setIdx(i)} onMouseDown={(e) => { e.preventDefault(); onPick(it); }}>
              <i className={it.icon} />
              <span className="sl-key">/{it.key}</span>
              <span className="sl-label">{it.label}</span>
              {it.hint && <span className="sl-hint">{it.hint}</span>}
            </button>
          </div>
        );
      })}
      <div className="sl-foot"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> use · <kbd>Esc</kbd> close</div>
    </div>
  );
}
