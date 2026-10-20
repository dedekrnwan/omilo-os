"use client";
/**
 * CommandPalette — ⌘K palette for Omilo v2.
 *
 * Modes
 *   default   — ASK suggestions / RECENT / JUMP TO / ACTIONS
 *   command   — ">" prefix: HELPERS with inline Pause-all confirm
 *   ask       — Tab or selecting an ASK suggestion; calls POST /ask and renders inline answer
 *   helper    — "@" prefix: filter staff helpers, select → open that helper's chat
 *   chat      — "#" prefix: filter recent threads by title, select → open thread
 *
 * Ask-mode states
 *   idle      — input ready, hint bar shown
 *   loading   — awaiting /ask response; Esc cancels
 *   answer    — inline answer with sources + meta + ⌘↵ continue-in-chat
 *   unavailable — 503 or network error; shows AI-off banner
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { ago, api, ApiError, AskResult, Staff, Thread } from "@/lib/api";
import { useCommand } from "./command";
import { useOverview } from "./Shell";
import { NAV, NavItem } from "./nav";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "default" | "command" | "ask" | "helper" | "chat";
type AskState = "idle" | "loading" | "answer" | "unavailable";

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

/** Max recent threads shown in RECENT group (default mode, no query) */
const RECENT_MAX = 4;

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

  // Ask-mode sub-states
  const [askState, setAskState] = useState<AskState>("idle");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [askQuery, setAskQuery] = useState(""); // the query that produced the current answer
  const abortRef = useRef<AbortController | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // ── Lazy data caches for RECENT / @helper / #chat ─────────────────────────
  // Threads: used by RECENT group (default mode) and # mode
  const [threads, setThreads] = useState<Thread[] | null>(null); // null = not yet fetched
  const threadsFetchedRef = useRef(false);

  // Staff: used by @ mode
  const [staffList, setStaffList] = useState<Staff[] | null>(null);
  const staffFetchedRef = useRef(false);

  /** Fetch threads once (lazy, cached). Degrade silently on failure. */
  const ensureThreads = useCallback(async () => {
    if (threadsFetchedRef.current) return;
    threadsFetchedRef.current = true;
    try {
      const ths = await api<Thread[]>("/threads");
      // Sort most-recent first
      const sorted = [...ths].sort((a, b) =>
        (b.updated_at || "").localeCompare(a.updated_at || "")
      );
      setThreads(sorted);
    } catch {
      setThreads([]); // empty on error — degrade gracefully
    }
  }, []);

  /** Fetch staff once (lazy, cached). Degrade silently on failure. */
  const ensureStaff = useCallback(async () => {
    if (staffFetchedRef.current) return;
    staffFetchedRef.current = true;
    try {
      const st = await api<Staff[]>("/staff");
      setStaffList(st);
    } catch {
      setStaffList([]); // empty on error
    }
  }, []);

  // Focus input on open; reset all state; prefetch threads for RECENT group
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setMode("default");
    setHighlighted(0);
    setConfirmPause(false);
    setBusy(false);
    setAskState("idle");
    setAskResult(null);
    setAskQuery("");
    // Cancel any in-flight ask on reopen
    abortRef.current?.abort();
    abortRef.current = null;
    // Lazily prefetch threads on first open (RECENT group + # mode)
    ensureThreads();
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [isOpen, ensureThreads]);

  // Reset highlight when rows change
  useEffect(() => {
    setHighlighted(0);
  }, [query, mode]);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const doClose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    close();
    setQuery("");
    setMode("default");
    setHighlighted(0);
    setConfirmPause(false);
    setAskState("idle");
    setAskResult(null);
    setAskQuery("");
  }, [close]);

  const navigateTo = useCallback(
    (href: string) => {
      doClose();
      router.push(href);
    },
    [doClose, router]
  );

  /** Open an existing thread directly (RECENT / # mode). */
  const openThread = useCallback(
    (id: string) => {
      doClose();
      router.push(`/chat/?thread=${id}`);
    },
    [doClose, router]
  );

  /** Open (or create) a staff chat thread, then navigate to it (@ mode). */
  const openStaffChat = useCallback(
    async (staffId: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const th = await api<Thread>("/threads", { body: { scope: "staff", staff_id: staffId } });
        doClose();
        router.push(`/chat/?thread=${th.id}`);
      } catch {
        doClose();
        router.push("/chat/");
      } finally {
        setBusy(false);
      }
    },
    [busy, doClose, router]
  );

  const enterAskMode = useCallback((suggestion?: string) => {
    // Cancel any in-flight request when re-entering ask mode
    abortRef.current?.abort();
    abortRef.current = null;
    setMode("ask");
    setQuery(suggestion ?? "");
    setConfirmPause(false);
    setAskState("idle");
    setAskResult(null);
    setAskQuery("");
    setBusy(false);
    setTimeout(() => {
      const inp = inputRef.current;
      if (!inp) return;
      inp.focus();
      // Place caret at end
      const len = inp.value.length;
      inp.setSelectionRange(len, len);
    }, 10);
  }, []);

  /** POST /ask — renders inline answer; on 503/network → unavailable state */
  const submitAsk = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy || askState === "loading") return;
      // Cancel any previous in-flight request
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setBusy(true);
      setAskState("loading");
      setAskResult(null);
      setAskQuery(q);

      try {
        const result = await api<AskResult>("/ask", { body: { q }, signal: ac.signal });
        if (ac.signal.aborted) return;
        setAskResult(result);
        setAskState("answer");
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof ApiError && err.status === 503) {
          setAskState("unavailable");
        } else if (err instanceof Error && err.name === "AbortError") {
          // Cancelled by user (Esc); return to idle
          setAskState("idle");
        } else {
          // Network failure or unexpected error → treat as unavailable
          setAskState("unavailable");
        }
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    },
    [busy, askState]
  );

  /** ⌘↵ / Ctrl+↵ escalation — open Chief of Staff thread and navigate there */
  const continueInChat = useCallback(
    async (text: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const th = await api<Thread>("/threads", { body: { scope: "master" } });
        doClose();
        router.push(`/chat/?thread=${th.id}`);
      } catch {
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
    threads,
    staffList,
    openThread,
    openStaffChat,
  });

  // ── Keyboard handling ─────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (mode === "ask" && (askState === "loading" || askState === "answer" || askState === "unavailable")) {
          // Cancel in-flight request or clear answer — step back to ask-idle
          abortRef.current?.abort();
          abortRef.current = null;
          setBusy(false);
          setAskState("idle");
          setAskResult(null);
          setAskQuery("");
        } else if (mode !== "default") {
          // Step back one mode (covers command, ask, helper, chat)
          setMode("default");
          setQuery("");
          setConfirmPause(false);
        } else {
          doClose();
        }
        return;
      }

      if (e.key === "Tab" && mode !== "ask" && mode !== "helper" && mode !== "chat") {
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

      // ⌘↵ / Ctrl+↵ — "continue in chat" escalation (checked BEFORE plain Enter)
      // No-op in command / helper / chat modes
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && mode !== "command" && mode !== "helper" && mode !== "chat") {
        e.preventDefault();
        continueInChat(mode === "ask" ? query : displayQuery(query, mode));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (mode === "ask" && askState === "idle") {
          submitAsk(query);
        } else if (mode !== "ask") {
          // covers default, command, helper, chat
          const row = rows[highlighted];
          if (row) row.action();
        }
        return;
      }
    },
    [mode, askState, doClose, enterAskMode, rows, highlighted, submitAsk, continueInChat, query]
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
      if (v.startsWith("@")) {
        // Helper mode — lazy-fetch staff on first use
        ensureStaff();
        setMode("helper");
        setQuery(v);
        return;
      }
      if (v.startsWith("#")) {
        // Chat mode — threads already fetched on open; ensure anyway
        ensureThreads();
        setMode("chat");
        setQuery(v);
        return;
      }
      if ((mode === "command" || mode === "helper" || mode === "chat") && v === "") {
        // Backspace cleared the prefix — leave special mode
        setMode("default");
        setQuery("");
        setConfirmPause(false);
        return;
      }
      setMode("default");
      setQuery(v);
    },
    [mode, ensureStaff, ensureThreads]
  );

  // ── Render ───────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  const groups = groupRows(rows);

  // AI status line — reads overview.ai_status when present
  const aiOk = overview?.ai_status?.ok ?? !overview?.paused;
  const aiStatus = overview?.ai_status
    ? overview.ai_status.ok
      ? overview.ai_status.label
      : "AI unavailable"
    : overview?.paused
    ? "Paused · helpers stopped"
    : "AI on · Claude Code pool";

  const inputValue = query;

  const inputPlaceholder =
    mode === "ask"
      ? "What do you want to ask?"
      : mode === "command"
      ? "Type a command…"
      : mode === "helper"
      ? "Filter helpers…"
      : mode === "chat"
      ? "Filter chats…"
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
          {mode === "helper" && <span className="cmd-mode-chip">@</span>}
          {mode === "chat" && <span className="cmd-mode-chip">#</span>}

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

        {/* Ask-mode: idle hint */}
        {mode === "ask" && askState === "idle" && (
          <div className="cmd-ask-hint">
            <i className="ri-information-line" />
            Press <kbd>↵</kbd> to ask Chief of Staff, or <kbd>⌘↵</kbd> to open in chat.
          </div>
        )}

        {/* Ask-mode: loading */}
        {mode === "ask" && askState === "loading" && (
          <div className="cmd-ask-loading">
            <span className="spin" style={{ width: 16, height: 16, flexShrink: 0 }} />
            <span>Asking Chief of Staff…</span>
            <span className="cmd-ask-loading-esc">Press <kbd>Esc</kbd> to cancel</span>
          </div>
        )}

        {/* Ask-mode: AI unavailable */}
        {mode === "ask" && askState === "unavailable" && (
          <div className="cmd-ask-unavailable">
            <i className="ri-error-warning-line" aria-hidden />
            <span>Chief of Staff can't answer right now — AI is unavailable.</span>
            <button
              className="cmd-ask-unavailable-retry btn sm quiet"
              onClick={() => { setAskState("idle"); setAskResult(null); }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Ask-mode: inline answer */}
        {mode === "ask" && askState === "answer" && askResult && (
          <div className="cmd-ask-answer">
            {/* Who answered */}
            <div className="cmd-ask-who">
              <i className="ri-robot-2-line cmd-ask-who-icon" aria-hidden />
              <span className="cmd-ask-who-name">Chief of Staff</span>
              {askResult.sources.length > 0 && (
                <span className="cmd-ask-who-sources">
                  answered from {askResult.sources.length} source{askResult.sources.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Answer text */}
            <div className="cmd-ask-body">{askResult.answer}</div>

            {/* Sources */}
            {askResult.sources.length > 0 && (
              <div className="cmd-ask-sources">
                <span className="cmd-ask-sources-label">Sources</span>
                <div className="cmd-ask-sources-list">
                  {askResult.sources.map((src) => (
                    <span key={src.ref} className="cmd-ask-source-item">
                      {src.url ? (
                        <a
                          href={src.url}
                          className="cmd-ask-source-link"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={doClose}
                        >
                          {src.title}
                        </a>
                      ) : (
                        <span className="cmd-ask-source-title">{src.title}</span>
                      )}
                      <span className={`cmd-ask-surface cmd-ask-surface-${src.surface}`}>
                        {src.surface}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Meta line */}
            <div className="cmd-ask-meta">
              Answered in {askResult.ms >= 1000
                ? `${(askResult.ms / 1000).toFixed(1)}s`
                : `${askResult.ms}ms`} · {askResult.tokens.toLocaleString()} tokens · ${askResult.cost_usd.toFixed(4)}
            </div>

            {/* Actions */}
            <div className="cmd-ask-actions">
              <button
                className="btn sm"
                onClick={() => continueInChat(askQuery)}
                disabled={busy}
              >
                <i className="ri-chat-3-line" aria-hidden />
                Continue in chat
                <kbd className="cmd-ask-action-kbd">⌘↵</kbd>
              </button>
              <button
                className="btn sm quiet"
                onClick={() => { setAskState("idle"); setAskResult(null); setQuery(""); }}
              >
                New question
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        {mode !== "ask" && (
          <div className="cmd-results" role="listbox">
            {rows.length === 0 && !confirmPause && (
              <div className="cmd-empty">
                {(mode === "helper" || mode === "chat") && threads === null && staffList === null
                  ? "Loading…"
                  : `No results for "${displayQuery(query, mode)}"`}
              </div>
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
            {mode !== "ask" && mode !== "helper" && mode !== "chat" && <><kbd>Tab</kbd> ask CoS</>}
            <kbd>⌘↵</kbd> chat
          </span>
          <span className="cmd-ai-status">
            <span className={`cmd-ai-dot${!aiOk ? " paused" : ""}`} />
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
  if (mode === "helper") return raw.replace(/^@/, "").trimStart();
  if (mode === "chat") return raw.replace(/^#/, "").trimStart();
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
  threads: Thread[] | null;
  staffList: Staff[] | null;
  openThread: (id: string) => void;
  openStaffChat: (staffId: string) => void;
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
    threads,
    staffList,
    openThread,
    openStaffChat,
  } = opts;

  const q = displayQuery(query, mode).toLowerCase().trim();

  // ── Helper mode (@) ──────────────────────────────────────────────────────
  if (mode === "helper") {
    if (!staffList || staffList.length === 0) return [];
    const filtered = staffList.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.role.toLowerCase().includes(q)
    );
    return filtered.map((s): Row => ({
      id: `helper-${s.id}`,
      group: "HELPERS",
      label: s.name,
      sub: s.role,
      icon: s.is_chief ? "ri-robot-2-line" : "ri-user-line",
      action: () => openStaffChat(s.id),
    }));
  }

  // ── Chat mode (#) ────────────────────────────────────────────────────────
  if (mode === "chat") {
    if (!threads || threads.length === 0) return [];
    // Show group/chat/staff/master scoped threads
    const filtered = threads.filter(
      (t) => !q || t.title.toLowerCase().includes(q) || t.scope.toLowerCase().includes(q)
    );
    return filtered.map((t): Row => ({
      id: `chat-${t.id}`,
      group: "CHATS",
      label: t.scope === "master" ? "Chief of Staff" : t.scope === "group" ? `# ${t.title}` : t.title,
      sub: t.updated_at ? ago(t.updated_at) : undefined,
      icon: t.scope === "group" ? "ri-hashtag" : t.scope === "master" ? "ri-robot-2-line" : "ri-chat-3-line",
      action: () => openThread(t.id),
    }));
  }

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

  // RECENT group — most-recent N threads (only when no query and threads are loaded)
  if (!q && threads && threads.length > 0) {
    const recentRows = threads.slice(0, RECENT_MAX).map((t): Row => ({
      id: `recent-${t.id}`,
      group: "RECENT",
      label: t.scope === "master" ? "Chief of Staff" : t.scope === "group" ? `# ${t.title}` : t.title,
      sub: t.updated_at ? ago(t.updated_at) : undefined,
      icon: t.scope === "group" ? "ri-hashtag" : t.scope === "master" ? "ri-robot-2-line" : "ri-chat-3-line",
      action: () => openThread(t.id),
    }));
    rows.push(...recentRows);
  }

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
