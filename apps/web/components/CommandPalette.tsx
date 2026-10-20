"use client";
/**
 * CommandPalette — ⌘K palette for Omilo v2.
 *
 * Modes
 *   default   — ASK suggestions / JUMP TO / ACTIONS
 *   command   — ">" prefix: HELPERS with inline Pause-all confirm
 *   ask       — Tab or selecting an ASK suggestion; submit opens CoS chat thread
 *
 * Gaps (backend gaps; no implementation here):
 *   RECENT group    — omitted; no readily-accessible recent-threads source in this component context
 *   @/ # prefix     — treated as plain text; loading staff/thread lists here is out of scope
 *   Inline AI answer — GAP: needs a backend POST /ask endpoint returning { answer, sources, tokens }
 *   AI-unavailable   — GAP: Overview type needs a pool_down or ai_status field; not present
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { api, Thread } from "@/lib/api";
import { useCommand } from "./command";
import { useOverview } from "./Shell";
import { NAV, NavItem } from "./nav";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "default" | "command" | "ask";

interface Row {
  id: string;
  group: string;
  label: string;
  sub?: string;
  icon?: string;
  spark?: boolean;
  /** Sentinel to render the inline pause-confirm UI instead of a normal row */
  confirmRow?: boolean;
  action: () => void | Promise<void>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ASK_SUGGESTIONS = [
  "What's waiting on me?",
  "What happened overnight?",
  "Why did the 12:20 run fail?",
];

/** All navigable NAV items (have an href, not marked soon) */
const NAV_ITEMS: NavItem[] = NAV.flatMap((g) =>
  g.items.filter((it): it is NavItem & { href: string } => !!it.href && !it.soon)
);

// ─── CommandPalette ───────────────────────────────────────────────────────────

export default function CommandPalette() {
  const { isOpen, close } = useCommand();
  const router = useRouter();
  const { overview, refresh } = useOverview();

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("default");
  const [highlighted, setHighlighted] = useState(0);
  const [confirmPause, setConfirmPause] = useState(false);
  const [busy, setBusy] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on open; reset all state
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setMode("default");
    setHighlighted(0);
    setConfirmPause(false);
    setBusy(false);
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Reset highlight when rows change
  useEffect(() => {
    setHighlighted(0);
  }, [query, mode]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const doClose = useCallback(() => {
    close();
    setQuery("");
    setMode("default");
    setHighlighted(0);
    setConfirmPause(false);
  }, [close]);

  const navigateTo = useCallback(
    (href: string) => {
      doClose();
      router.push(href);
    },
    [doClose, router]
  );

  const enterAskMode = useCallback((suggestion?: string) => {
    setMode("ask");
    setQuery(suggestion ?? "");
    setConfirmPause(false);
    setTimeout(() => {
      const inp = inputRef.current;
      if (!inp) return;
      inp.focus();
      // Place caret at end
      const len = inp.value.length;
      inp.setSelectionRange(len, len);
    }, 10);
  }, []);

  const submitAsk = useCallback(
    async (text: string) => {
      if (!text.trim() || busy) return;
      setBusy(true);
      try {
        // Open the Chief of Staff thread and navigate to it.
        // GAP: inline AI answer requires a backend POST /ask endpoint (does not exist).
        // We create/find the "master" scope thread and navigate there so the user can
        // continue the conversation in the full chat interface ("continue in chat" path).
        const th = await api<Thread>("/threads", { body: { scope: "master" } });
        doClose();
        router.push(`/chat/?thread=${th.id}`);
      } catch {
        // Fallback: open the workspace
        doClose();
        router.push("/chat/");
      } finally {
        setBusy(false);
      }
    },
    [busy, doClose, router]
  );

  const pauseAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/system", { body: { paused: true } });
      refresh();
      doClose();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }, [busy, doClose, refresh]);

  const resumeAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api("/system", { body: { paused: false } });
      refresh();
      doClose();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }, [busy, doClose, refresh]);

  // ── Row building ─────────────────────────────────────────────────────────

  const rows = buildRows({
    query,
    mode,
    confirmPause,
    setConfirmPause,
    enterAskMode,
    navigateTo,
    pauseAll,
    resumeAll,
    paused: overview?.paused ?? false,
  });

  // ── Keyboard handling ─────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (mode !== "default") {
          // Step back one mode
          setMode("default");
          setQuery("");
          setConfirmPause(false);
        } else {
          doClose();
        }
        return;
      }

      if (e.key === "Tab" && mode !== "ask") {
        e.preventDefault();
        enterAskMode();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => (h + 1) % Math.max(1, rows.length));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => (h - 1 + Math.max(1, rows.length)) % Math.max(1, rows.length));
        return;
      }

      // ⌘↵ / Ctrl+↵ — "continue in chat" shortcut (checked BEFORE plain Enter)
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submitAsk(mode === "ask" ? query : displayQuery(query, mode));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (mode === "ask") {
          submitAsk(query);
        } else {
          const row = rows[highlighted];
          if (row) row.action();
        }
        return;
      }
    },
    [mode, doClose, enterAskMode, rows, highlighted, submitAsk, query]
  );

  const handleChange = useCallback(
    (v: string) => {
      if (mode === "ask") {
        setQuery(v);
        return;
      }
      if (v.startsWith(">")) {
        setMode("command");
        setQuery(v);
        return;
      }
      if (mode === "command" && v === "") {
        // Backspace cleared the ">" prefix — leave command mode
        setMode("default");
        setQuery("");
        setConfirmPause(false);
        return;
      }
      setMode("default");
      setQuery(v);
    },
    [mode]
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  const groups = groupRows(rows);

  // AI status line
  // GAP: show AI-unavailable when overview has a pool_down/ai_status field (doesn't exist yet)
  const aiStatus = overview?.paused
    ? "Paused · helpers stopped"
    : "AI on · Claude Code pool";

  const inputValue =
    mode === "ask"
      ? query
      : mode === "command"
      ? query // includes leading ">"
      : query;

  const inputPlaceholder =
    mode === "ask"
      ? "What do you want to ask?"
      : mode === "command"
      ? "Type a command…"
      : "Search, or ask Chief of Staff anything…";

  return (
    <>
      {/* Scrim */}
      <div className="cmd-scrim" aria-hidden onClick={doClose} />

      {/* Dialog */}
      <div className="cmd-dialog" role="dialog" aria-label="Command palette" aria-modal="true">
        {/* Input */}
        <div className="cmd-input">
          <i
            className={
              mode === "ask"
                ? "ri-robot-2-line cmd-search-icon"
                : "ri-search-line cmd-search-icon"
            }
            aria-hidden
          />

          {mode === "ask" && <span className="cmd-mode-chip">Ask</span>}
          {mode === "command" && <span className="cmd-mode-chip cmd-mode-cmd">{">"}</span>}

          <input
            ref={inputRef}
            type="text"
            className="cmd-field"
            placeholder={inputPlaceholder}
            value={inputValue}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
          />

          {busy ? (
            <span className="spin" style={{ width: 14, height: 14, marginRight: 6, flexShrink: 0 }} />
          ) : (
            <kbd className="cmd-esc-kbd" onClick={doClose}>Esc</kbd>
          )}
        </div>

        {/* Ask-mode hint */}
        {mode === "ask" && (
          <div className="cmd-ask-hint">
            <i className="ri-information-line" />
            Press <kbd>↵</kbd> to open Chief of Staff chat, or <kbd>Esc</kbd> to go back.
          </div>
        )}

        {/* Results */}
        {mode !== "ask" && (
          <div className="cmd-results" role="listbox">
            {rows.length === 0 && !confirmPause && (
              <div className="cmd-empty">No results for "{displayQuery(query, mode)}"</div>
            )}

            {groups.map(({ group, items }) => (
              <div key={group} className="cmd-group">
                <div className="cmd-group-label" aria-hidden>
                  {group}
                </div>

                {items.map((row) => {
                  const idx = rows.indexOf(row);
                  const isOn = idx === highlighted;

                  // Inline confirm row for Pause all
                  if (row.confirmRow) {
                    return (
                      <div
                        key={row.id}
                        className={`cmd-item cmd-confirm-row${isOn ? " on" : ""}`}
                        role="option"
                        aria-selected={isOn}
                      >
                        <i className="ri-pause-circle-line cmd-row-icon" style={{ color: "var(--warn)" }} />
                        <span className="cmd-confirm-msg">
                          Pause all {overview?.staff.length ?? ""} helpers? Running steps finish
                          first…
                        </span>
                        <span className="cmd-confirm-acts">
                          <button
                            className="btn sm quiet"
                            onClick={() => setConfirmPause(false)}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn sm danger"
                            onClick={pauseAll}
                            disabled={busy}
                          >
                            Pause all
                          </button>
                        </span>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={row.id}
                      className={`cmd-item${isOn ? " on" : ""}`}
                      role="option"
                      aria-selected={isOn}
                      onMouseEnter={() => setHighlighted(idx)}
                      onClick={() => row.action()}
                    >
                      {row.spark ? (
                        <i className="ri-sparkling-line cmd-spark-icon" aria-hidden />
                      ) : row.icon ? (
                        <i className={`${row.icon} cmd-row-icon`} aria-hidden />
                      ) : (
                        <span className="cmd-row-icon-placeholder" />
                      )}
                      <span className="cmd-item-label">{row.label}</span>
                      {row.sub && <span className="cmd-item-sub">{row.sub}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="cmd-foot">
          <span className="cmd-hints">
            <kbd>↑↓</kbd> move
            <kbd>↵</kbd> open
            {mode !== "ask" && <><kbd>Tab</kbd> ask CoS</>}
            <kbd>⌘↵</kbd> chat
          </span>
          <span className="cmd-ai-status">
            <span className={`cmd-ai-dot${overview?.paused ? " paused" : ""}`} />
            {aiStatus}
          </span>
        </div>
      </div>
    </>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayQuery(raw: string, mode: Mode): string {
  if (mode === "command") return raw.replace(/^>/, "").trimStart();
  return raw;
}

function buildRows(opts: {
  query: string;
  mode: Mode;
  confirmPause: boolean;
  setConfirmPause: (v: boolean) => void;
  enterAskMode: (s?: string) => void;
  navigateTo: (href: string) => void;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  paused: boolean;
}): Row[] {
  const {
    query,
    mode,
    confirmPause,
    setConfirmPause,
    enterAskMode,
    navigateTo,
    pauseAll,
    resumeAll,
    paused,
  } = opts;

  const q = displayQuery(query, mode).toLowerCase().trim();

  // ── Command mode ─────────────────────────────────────────────────────────
  if (mode === "command") {
    if (confirmPause) {
      return [
        {
          id: "pause-confirm",
          group: "HELPERS",
          label: "Confirm pause",
          confirmRow: true,
          action: pauseAll,
        },
      ];
    }

    const cmds: Row[] = paused
      ? [
          {
            id: "resume-all",
            group: "HELPERS",
            label: "Resume all helpers",
            icon: "ri-play-circle-line",
            action: resumeAll,
          },
        ]
      : [
          {
            id: "pause-all",
            group: "HELPERS",
            label: "Pause all helpers",
            sub: "Running steps finish first",
            icon: "ri-pause-circle-line",
            action: () => setConfirmPause(true),
          },
        ];

    return q ? cmds.filter((r) => r.label.toLowerCase().includes(q)) : cmds;
  }

  // ── Ask mode — no result rows ─────────────────────────────────────────────
  if (mode === "ask") {
    return [];
  }

  // ── Default mode ──────────────────────────────────────────────────────────
  const rows: Row[] = [];

  // ASK CHIEF OF STAFF group
  const askRows = ASK_SUGGESTIONS.filter(
    (s) => !q || s.toLowerCase().includes(q)
  ).map(
    (s, i): Row => ({
      id: `ask-sug-${i}`,
      group: "ASK CHIEF OF STAFF",
      label: s,
      spark: true,
      action: () => enterAskMode(s),
    })
  );
  rows.push(...askRows);

  // JUMP TO group — NAV items, filtered
  const jumpRows = NAV_ITEMS.filter((it) => !q || it.label.toLowerCase().includes(q)).map(
    (it): Row => ({
      id: `nav-${it.href}`,
      group: "JUMP TO",
      label: it.label,
      icon: it.icon,
      action: () => navigateTo(it.href!),
    })
  );
  rows.push(...jumpRows);

  // ACTIONS group
  const actionRows: Row[] = [];
  if (!q || "new goal".includes(q) || "plan".includes(q)) {
    actionRows.push({
      id: "action-new-goal",
      group: "ACTIONS",
      label: "New goal",
      icon: "ri-add-circle-line",
      action: () => navigateTo("/plan/"),
    });
  }

  const pauseLabel = paused ? "Resume all helpers" : "Pause all helpers";
  if (!q || pauseLabel.toLowerCase().includes(q) || "helpers".includes(q)) {
    if (confirmPause) {
      actionRows.push({
        id: "action-pause-confirm",
        group: "ACTIONS",
        label: "Confirm pause",
        confirmRow: true,
        action: pauseAll,
      });
    } else {
      actionRows.push({
        id: "action-pause",
        group: "ACTIONS",
        label: pauseLabel,
        icon: paused ? "ri-play-circle-line" : "ri-pause-circle-line",
        action: paused ? resumeAll : () => setConfirmPause(true),
      });
    }
  }

  rows.push(...actionRows);
  return rows;
}

function groupRows(rows: Row[]): { group: string; items: Row[] }[] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.group)) map.set(r.group, []);
    map.get(r.group)!.push(r);
  }
  return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
}
