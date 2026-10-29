/**
 * ChiefDm — the private Chief drawer, mounted once in the Shell.
 *
 * pen states:
 *   closed  ozMOv  → Chat FAB (BVgZF) + "Talk to Chief ⌘J" hint on hover — the resting state
 *   nudge   pHj0k  → proactive nudge card above the FAB
 *   open    nkqAN  → 400×628 drawer, FAB turns into a dark chevron-down
 *   full    N30qNb → 1040 wide panel over a scrim
 *   threads hM9k9  → the drawer listing private chats
 *
 * ⌘/Ctrl-J toggles the drawer. `?chief=<state>` opens a state directly
 * (deep links + screenshots); `window.dispatchEvent(new Event('omilo:chief-nudge'))` shows the nudge.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, History, Lock, Maximize2, Pin, Search, SquarePen, Trash2, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import type { ChiefNudge, Message, Model, Session } from '../../core/domain/types'
import { Composer } from '../../ui/ChatSession/Composer'
import { DEFAULT_MODEL, MODELS } from '../../ui/ChatSession/ModelMenu'
import { usePickerSource } from '../../ui/ChatSession/usePickerSource'
import { useCommands } from '../../app/CommandsProvider'
import {
  useChiefNudges,
  useChiefThreads,
  useDeleteSession,
  useDismissChiefNudge,
  useInbox,
  useMessages,
  useStartChat,
} from '../../app/queries'
import { notify } from '../../ui/ds/Toaster'
import { useFabHidden } from './fabStore'
import { QUICK_PROMPTS, THREADS_NOTE } from './data'
import type { ChiefMessage } from './data'

export type ChiefDmState = 'closed' | 'nudge' | 'open' | 'full' | 'threads'
const STATES: ChiefDmState[] = ['closed', 'nudge', 'open', 'full', 'threads']

function initialState(): ChiefDmState {
  if (typeof window === 'undefined') return 'closed'
  const s = new URLSearchParams(window.location.search).get('chief') as ChiefDmState | null
  return s && STATES.includes(s) ? s : 'closed'
}

// ── Bits ──────────────────────────────────────────────────────────────────────

/** pen `Icon Button` (u1cQLT), optionally active (fill hover, ink icon). */
function HeadButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  size = 28,
  iconSize = 16,
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  active?: boolean
  size?: number
  iconSize?: number
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      onClick={onClick}
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-hover ${
        active ? 'bg-hover text-ink' : 'text-muted'
      }`}
    >
      <Icon size={iconSize} aria-hidden />
    </button>
  )
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-label={`${count} unread`}
      className="absolute top-[-2px] left-[34px] flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-warn px-[5px] font-mono text-[10.5px] font-semibold text-white shadow-[inset_0_0_0_2px_var(--color-surface)]"
    >
      {count}
    </span>
  )
}

/** Closed: pen `Chat FAB` (BVgZF) + hover hint (d2naq8). */
function Fab({ unread, onOpen }: { unread: number; onOpen: () => void }) {
  return (
    <div className="group fixed right-[24px] bottom-[24px] z-40 size-[52px]">
      <span
        role="tooltip"
        className="pointer-events-none absolute top-[12px] right-[60px] flex h-[28px] items-center gap-[8px] rounded-base bg-primary pr-[8px] pl-[10px] whitespace-nowrap opacity-0 shadow-[0_4px_12px_#0C0A0929] transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span className="text-[12.5px] font-medium text-white">Talk to Chief</span>
        <span className="flex h-[18px] items-center rounded-xs bg-[#FFFFFF1F] px-[5px] font-mono text-[10.5px] text-on-ink-2">
          ⌘ J
        </span>
      </span>
      <button
        type="button"
        aria-label="Talk to Chief"
        onClick={onOpen}
        className="flex size-[52px] items-center justify-center rounded-[26px] bg-surface shadow-[0_6px_18px_#0C0A0924] outline-1 -outline-offset-1 outline-line-strong transition-transform active:scale-95"
      >
        <Mascot size={34} radius={10} area="brand" helper />
      </button>
      <UnreadBadge count={unread} />
    </div>
  )
}

/** Open: dark FAB with chevron-down (CbjuE) — collapses the drawer. */
function FabOpen({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close Chief"
      onClick={onClose}
      className="fixed right-[24px] bottom-[24px] z-40 flex size-[52px] items-center justify-center rounded-[26px] bg-primary text-white shadow-[0_6px_18px_#0C0A0929] transition-colors hover:bg-primary-hover"
    >
      <ChevronDown size={20} aria-hidden />
    </button>
  )
}

/** pen Nudge (Yjkrc). */
function Nudge({
  nudge,
  onDismiss,
  onAccept,
  onLater,
}: {
  nudge: ChiefNudge
  onDismiss: () => void
  onAccept: () => void
  onLater: () => void
}) {
  return (
    <div
      role="dialog"
      aria-label="Chief nudge"
      className="fixed right-[24px] bottom-[88px] z-40 flex w-[320px] flex-col gap-[10px] rounded-[14px] bg-surface p-[14px] shadow-[0_12px_32px_#0C0A091F] outline-1 -outline-offset-1 outline-line-strong"
    >
      <div className="flex w-full items-center gap-[8px]">
        <Mascot size={24} radius={7} area="brand" helper />
        <span className="text-[13px] font-semibold text-ink">Chief</span>
        <span className="flex items-center gap-[3px] text-muted">
          <Lock size={11} aria-hidden />
          <span className="text-[11.5px]">Just you</span>
        </span>
        <span className="h-px flex-1" />
        <HeadButton icon={X} label="Dismiss" onClick={onDismiss} size={24} iconSize={14} />
      </div>
      <p className="m-0 text-[13px] leading-[1.5] text-ink-2">{nudge.body}</p>
      <div className="flex gap-[6px]">
        <button
          type="button"
          onClick={onAccept}
          className="inline-flex h-[28px] items-center rounded-btn bg-primary px-[10px] text-[12.5px] font-medium text-primary-ink outline-1 -outline-offset-1 outline-primary transition-colors hover:bg-primary-hover"
        >
          {nudge.primary}
        </button>
        <button
          type="button"
          onClick={onLater}
          className="inline-flex h-[28px] items-center rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
        >
          {nudge.secondary}
        </button>
      </div>
    </div>
  )
}

/** Drawer header (ww3Y7): mini Chief · who · 3 icon buttons. */
function Header({ title, sub, actions }: { title: string; sub: string; actions: ReactNode }) {
  return (
    <div className="flex w-full shrink-0 items-center gap-[10px] py-[12px] pr-[10px] pl-[14px] shadow-[inset_0_-1px_0_var(--color-line)]">
      <Mascot size={24} radius={7} area="brand" helper />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-[13px] font-semibold text-ink">{title}</span>
        <span className="flex items-center gap-[4px] text-muted">
          <Lock size={11} aria-hidden className="shrink-0" />
          <span className="truncate text-[11.5px]">{sub}</span>
        </span>
      </div>
      {actions}
    </div>
  )
}

function Message({ msg }: { msg: ChiefMessage }) {
  if (msg.kind === 'user') {
    return (
      <div className="flex w-full justify-end">
        <div className={`rounded-[16px_16px_4px_16px] bg-app px-[12px] py-[8px] ${msg.pending ? 'opacity-60' : ''}`}>
          <p className="m-0 max-w-[280px] text-[13px] leading-[1.55] whitespace-pre-wrap text-ink">{msg.text}</p>
        </div>
      </div>
    )
  }
  return (
    <p className="m-0 w-full text-[13px] leading-[1.55] whitespace-pre-wrap text-ink-2">{msg.text}</p>
  )
}

function Messages({
  messages,
  wide,
  dayLabel,
  thinking,
  loading,
}: {
  messages: ChiefMessage[]
  wide: boolean
  dayLabel?: string
  thinking?: boolean
  loading?: boolean
}) {
  const end = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    end.current?.scrollIntoView?.({ behavior: 'smooth' })
  }, [messages.length])
  return (
    <div
      className={`flex min-h-0 w-full flex-1 flex-col gap-[14px] overflow-y-auto ${
        wide ? 'px-[160px] py-[24px]' : 'px-[14px] py-[12px]'
      }`}
    >
      {dayLabel && (
        <div className="flex w-full justify-center">
          <span className="font-mono text-[10.5px] text-faint">{dayLabel}</span>
        </div>
      )}
      {loading && <p className="m-0 text-[12.5px] text-muted">Loading…</p>}
      {!loading && messages.length === 0 && (
        <p className="m-0 text-[13px] leading-[1.55] text-muted">
          Think out loud — only you and Chief see this. Nothing is posted or done unless you ask.
        </p>
      )}
      {messages.map((m) => (
        <Message key={m.id} msg={m} />
      ))}
      {thinking && <p className="m-0 text-[12.5px] text-muted">Chief is thinking…</p>}
      <div ref={end} />
    </div>
  )
}

function Suggestions({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div className="flex w-full shrink-0 gap-[6px] px-[14px] pb-[8px]">
      {QUICK_PROMPTS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          className="inline-flex h-[26px] items-center rounded-pill px-[10px] text-[12px] whitespace-nowrap text-ink-2 outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
        >
          {p}
        </button>
      ))}
    </div>
  )
}

function ThreadRow({
  thread,
  active,
  onOpen,
  onDelete,
}: {
  thread: Session
  active: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex w-full gap-[10px] rounded-base px-[10px] py-[9px] text-left transition-colors hover:bg-hover ${
        active ? 'bg-hover' : ''
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="flex w-full items-center gap-[6px]">
          {thread.pinned && <Pin size={12} aria-hidden className="shrink-0 text-muted" />}
          <span
            className={`min-w-0 flex-1 truncate text-[13px] text-ink ${thread.unread ? 'font-semibold' : 'font-medium'}`}
          >
            {thread.title}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-faint">{thread.updated}</span>
        </span>
        <span className="flex w-full items-center gap-[8px]">
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{thread.goal ?? 'Private chat with Chief'}</span>
          <span
            role="button"
            tabIndex={0}
            aria-label={`Delete “${thread.title}”`}
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onDelete() } }}
            className="hidden shrink-0 text-faint hover:text-bad group-hover:inline-flex"
          >
            <Trash2 size={12} aria-hidden />
          </span>
          {thread.unread && (
            <span aria-label="Unread" className="size-[7px] shrink-0 rounded-pill bg-warn" />
          )}
        </span>
      </span>
    </button>
  )
}

/** Activity label → TODAY ("now", "2h", "14:03") or EARLIER. */
function groupOf(t: Session): 'TODAY' | 'EARLIER' {
  return /^(now|\d+[mh]|\d{1,2}:\d{2})$/.test(t.updated) ? 'TODAY' : 'EARLIER'
}

function Threads({
  threads,
  loading,
  activeId,
  onOpen,
  onDelete,
}: {
  threads: Session[]
  loading: boolean
  activeId: string | null
  onOpen: (id: string) => void
  onDelete: (t: Session) => void
}) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const list = threads.filter((t) => !query || t.title.toLowerCase().includes(query))
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-[2px] overflow-y-auto px-[8px] py-[10px]">
      <div className="w-full px-[6px] pb-[8px]">
        <label className="flex h-[32px] w-full items-center gap-[8px] rounded-base bg-soft px-[10px] outline-1 -outline-offset-1 outline-line-strong">
          <Search size={14} aria-hidden className="shrink-0 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search private chats"
            aria-label="Search private chats"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
        </label>
      </div>
      {loading && <p className="m-0 px-[10px] text-[12.5px] text-muted">Loading…</p>}
      {!loading && list.length === 0 && (
        <p className="m-0 px-[10px] text-[12.5px] text-muted">{query ? 'No private chats match.' : 'No private chats yet.'}</p>
      )}
      {(['TODAY', 'EARLIER'] as const).map((g) => {
        const rows = list.filter((t) => groupOf(t) === g)
        if (!rows.length) return null
        return (
          <div key={g} className="contents">
            <div className="px-[10px] pt-[10px] pb-[4px] text-[10.5px] leading-[1.21] font-semibold tracking-[1px] text-faint">
              {g}
            </div>
            {rows.map((t) => (
              <ThreadRow key={t.id} thread={t} active={t.id === activeId} onOpen={() => onOpen(t.id)} onDelete={() => onDelete(t)} />
            ))}
          </div>
        )
      })}
      <div className="flex w-full gap-[8px] px-[10px] pt-[16px] pb-[4px]">
        <Lock size={12} aria-hidden className="mt-[2px] shrink-0 text-faint" />
        <p className="m-0 flex-1 text-[11.5px] leading-[1.45] text-muted">{THREADS_NOTE}</p>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

function clock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function dayLabel(iso?: string): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  const today = new Date().toDateString() === d.toDateString()
  return `${today ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${clock(iso)}`
}

function toChiefMessage(m: Message): ChiefMessage {
  return { id: m.id, kind: m.author.kind === 'you' ? 'user' : 'chief', text: m.content, time: clock(m.createdAt) }
}

/** A thread title from the first thing said. */
function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
}

const NUDGE_SEEN_KEY = 'omilo.chief.nudge-shown'
const LATER_MS = 3 * 60 * 60 * 1000

export function ChiefDm({ initial, hideFab = false }: { initial?: ChiefDmState; hideFab?: boolean } = {}) {
  const [state, setState] = useState<ChiefDmState>(() => initial ?? initialState())
  const fabHidden = useFabHidden((s) => s.count > 0)
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState<Model>(DEFAULT_MODEL)
  /** Thread on screen; null = latest thread, 'new' = a fresh chat. */
  const [activeThread, setActiveThread] = useState<string | null>(null)
  const [pending, setPending] = useState<ChiefMessage | null>(null)
  const [seen, setSeen] = useState(false)
  const isOpen = state === 'open' || state === 'full' || state === 'threads'

  const queryClient = useQueryClient()
  const commands = useCommands()
  const startChat = useStartChat()
  const deleteSession = useDeleteSession()
  const dismissNudge = useDismissChiefNudge()
  const { data: threads = [], isLoading: threadsLoading } = useChiefThreads(isOpen)
  const { data: nudges = [] } = useChiefNudges()
  const nudge = nudges[0]
  const threadId = activeThread === 'new' ? null : activeThread ?? threads[0]?.id ?? null
  const thread = threads.find((t) => t.id === threadId)
  const { data: rawMessages = [], isLoading: messagesLoading } = useMessages(threadId ?? '')
  const messages = useMemo(() => {
    const list = threadId ? rawMessages.map(toChiefMessage) : []
    return pending && !list.some((m) => m.text === pending.text && m.kind === 'user') ? [...list, pending] : list
  }, [rawMessages, threadId, pending])
  const pickerSource = usePickerSource(null)

  // ⌘/Ctrl-J toggles; Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        setState((s) => (s === 'open' || s === 'full' || s === 'threads' ? 'closed' : 'open'))
      } else if (e.key === 'Escape') {
        setState((s) => (s === 'full' ? 'open' : s === 'closed' ? s : 'closed'))
      }
    }
    function onNudge() {
      setState((s) => (s === 'closed' ? 'nudge' : s))
    }
    /** Command menu "Ask Chief" / "Talk to Chief privately": open a fresh chat, prefill the question. */
    function onAsk(e: Event) {
      const text = (e as CustomEvent<string>).detail
      if (text) {
        setDraft(text)
        setActiveThread('new')
      }
      setState('open')
    }
    /** Command menu: open one private chat. */
    function onThread(e: Event) {
      const id = (e as CustomEvent<string>).detail
      if (id) setActiveThread(id)
      setState('open')
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('omilo:chief-nudge', onNudge)
    window.addEventListener('omilo:chief-ask', onAsk)
    window.addEventListener('omilo:chief-thread', onThread)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('omilo:chief-nudge', onNudge)
      window.removeEventListener('omilo:chief-ask', onAsk)
      window.removeEventListener('omilo:chief-thread', onThread)
    }
  }, [])

  useEffect(() => {
    if (isOpen) setSeen(true)
  }, [isOpen])

  // Proactive nudge: once per browser session, a few seconds after something needs you.
  useEffect(() => {
    if (!nudge || state !== 'closed') return
    let shown = false
    try {
      shown = sessionStorage.getItem(NUDGE_SEEN_KEY) === '1'
    } catch {
      shown = false
    }
    if (shown) return
    const t = window.setTimeout(() => {
      try {
        sessionStorage.setItem(NUDGE_SEEN_KEY, '1')
      } catch {
        // storage unavailable — the nudge may show again next load
      }
      setState((s) => (s === 'closed' ? 'nudge' : s))
    }, 4000)
    return () => window.clearTimeout(t)
  }, [nudge, state])

  // Real "needs you" count: inbox items awaiting the user (decisions/mentions
  // flagged needsYou). Once the drawer is opened (`seen`), the badge clears.
  const { data: inboxItems } = useInbox()
  const needsYouCount = (inboxItems ?? []).filter((i) => i.needsYou).length
  const unread = seen ? 0 : needsYouCount

  async function send(text: string, forceNew = false) {
    const target = forceNew ? null : threadId
    const now = new Date().toISOString()
    setPending({ id: `pending-${now}`, kind: 'user', text, time: clock(now), pending: true })
    if (state === 'threads') setState('open')
    try {
      if (target) {
        await commands.sendMessage(target, text, { model: model.id })
        await queryClient.invalidateQueries({ queryKey: ['messages', target] })
        void queryClient.invalidateQueries({ queryKey: ['sessions', 'chief'] })
      } else {
        const session = await startChat.mutateAsync({
          input: { kind: 'chief_private', title: titleFrom(text), model: model.id },
          text,
        })
        setActiveThread(session.id)
        await queryClient.invalidateQueries({ queryKey: ['messages', session.id] })
      }
    } catch {
      notify('Couldn’t reach Chief — try again')
      setDraft(text)
    } finally {
      setPending(null)
    }
  }

  function removeThread(t: Session) {
    deleteSession.mutate(t.id, {
      onSuccess: () => notify('Private chat deleted'),
      onError: () => notify('Couldn’t delete the chat — try again'),
    })
    if (t.id === threadId) setActiveThread('new')
  }

  if (state === 'closed' || state === 'nudge') {
    return (
      <>
        {state === 'nudge' && nudge && (
          <Nudge
            nudge={nudge}
            onDismiss={() => {
              dismissNudge.mutate({ id: nudge.id })
              setState('closed')
            }}
            onAccept={() => {
              dismissNudge.mutate({ id: nudge.id })
              setDraft(nudge.prompt)
              setActiveThread('new')
              setState('open')
            }}
            onLater={() => {
              dismissNudge.mutate({ id: nudge.id, snoozeUntil: new Date(Date.now() + LATER_MS).toISOString() })
              setState('closed')
            }}
          />
        )}
        {!hideFab && !fabHidden && <Fab unread={unread} onOpen={() => setState('open')} />}
      </>
    )
  }

  const full = state === 'full'
  const showThreads = state === 'threads'
  const busy = pending !== null

  const panel = (
    <section
      role="dialog"
      aria-label={showThreads ? 'Private chats with Chief' : 'Chief — private chat'}
      className={`fixed z-50 flex flex-col overflow-hidden rounded-[16px] bg-surface shadow-[0_16px_40px_#0C0A0926] outline-1 -outline-offset-1 outline-line-strong ${
        full
          ? 'top-[24px] bottom-[24px] left-1/2 w-[min(1040px,calc(100vw-48px))] -translate-x-1/2'
          : 'right-[24px] bottom-[88px] h-[min(628px,calc(100vh-112px))] w-[400px]'
      }`}
    >
      {showThreads ? (
        <Header
          title="Private chats"
          sub={`${threads.length} with Chief · only you see these`}
          actions={
            <>
              <HeadButton icon={History} label="Back to chat" active onClick={() => setState('open')} />
              <HeadButton
                icon={SquarePen}
                label="New chat"
                onClick={() => {
                  setActiveThread('new')
                  setState('open')
                }}
              />
              <HeadButton icon={X} label="Close" onClick={() => setState('closed')} />
            </>
          }
        />
      ) : (
        <Header
          title={thread?.title ?? 'Chief'}
          sub="Private · not in any channel"
          actions={
            <>
              <HeadButton icon={History} label="Private chats" onClick={() => setState('threads')} />
              <HeadButton
                icon={Maximize2}
                label={full ? 'Back to drawer' : 'Open full screen'}
                onClick={() => setState(full ? 'open' : 'full')}
              />
              <HeadButton icon={X} label="Close" onClick={() => setState('closed')} />
            </>
          }
        />
      )}
      {showThreads ? (
        <Threads
          threads={threads}
          loading={threadsLoading}
          activeId={threadId}
          onOpen={(id) => {
            setActiveThread(id)
            setState('open')
          }}
          onDelete={removeThread}
        />
      ) : (
        <>
          <Messages
            messages={messages}
            wide={full}
            dayLabel={dayLabel(rawMessages[0]?.createdAt)}
            thinking={busy}
            loading={Boolean(threadId) && messagesLoading}
          />
          <Suggestions onPick={setDraft} />
        </>
      )}
      <div className="w-full shrink-0 px-[12px] pb-[12px]">
        <Composer
          key={`chief-dm-${draft}`}
          sessionId={threadId ?? 'chief-dm-new'}
          selectedModel={MODELS.find((m) => m.id === thread?.model) ?? model}
          onModelChange={setModel}
          placeholder={busy ? 'Chief is thinking…' : showThreads ? 'Start a new private chat…' : 'Think out loud with Chief…'}
          compact={!full}
          initialText={draft}
          pickerSource={pickerSource}
          onSend={(text) => {
            if (busy) return
            if (showThreads) setActiveThread('new')
            setDraft('')
            void send(text, showThreads)
          }}
        />
      </div>
    </section>
  )

  return (
    <>
      {full && (
        <div aria-hidden className="fixed inset-0 z-50 bg-[#0C0A0933]" onClick={() => setState('open')} />
      )}
      {panel}
      {!full && <FabOpen onClose={() => setState('closed')} />}
    </>
  )
}
