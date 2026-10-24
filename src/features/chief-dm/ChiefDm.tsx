/**
 * ChiefDm — self-contained floating Chief DM widget.
 *
 * States (all internal):
 *   closed   → floating "Talk to Chief" button (ozMOv.png)
 *   nudge    → proactive nudge bubble above the button (pHj0k.png)
 *   panel    → 360×520 DM panel, bottom-right (nkqAN.png)
 *   expanded → full-screen dialog (N30qNb.png)
 *   threads  → threads list replacing the message list (hM9k9.png)
 *
 * Mount once in the Shell: <ChiefDm />  (no props required).
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowUp,
  ChevronDown,
  History,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { CHIEF_MESSAGES, CHIEF_THREADS, NUDGE, QUICK_PROMPTS } from './data'
import type { ChiefMessage, ChiefThread } from './data'

// ── Types ────────────────────────────────────────────────────────────────────

type PanelState = 'closed' | 'nudge' | 'panel' | 'expanded' | 'threads'

// ── Sub-components ────────────────────────────────────────────────────────────

/** Floating "Talk to Chief" button with optional unread badge (ozMOv.png). */
function FloatingButton({
  unreadCount,
  onClick,
}: {
  unreadCount: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label="Talk to Chief"
      onClick={onClick}
      className="relative inline-flex h-[36px] items-center gap-[8px] rounded-pill bg-primary pl-[10px] pr-[12px] text-primary-ink shadow-[0_4px_16px_#0000002A] transition-all hover:bg-primary-hover active:scale-95"
    >
      <Mascot size={22} radius={7} area="brand" tile={false} />
      <span className="text-[13px] font-medium">Talk to Chief</span>
      {unreadCount > 0 && (
        <span
          aria-label={`${unreadCount} unread`}
          className="absolute -top-[6px] -right-[6px] flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-bad-solid px-[4px] text-[10.5px] font-semibold text-white"
        >
          {unreadCount}
        </span>
      )}
    </button>
  )
}

/** Proactive nudge bubble from Chief (pHj0k.png). */
function NudgeBubble({
  onDismiss,
  onOpen,
  onAction,
}: {
  onDismiss: () => void
  onOpen: () => void
  onAction: (label: string) => void
}) {
  return (
    <div
      role="dialog"
      aria-label="Chief nudge"
      className="w-[320px] rounded-lg bg-surface shadow-[0_8px_32px_#0000001F] outline-1 -outline-offset-1 outline-line-strong"
    >
      {/* Header */}
      <div className="flex items-center gap-[8px] border-b border-line px-[12px] py-[10px]">
        <Mascot size={24} radius={7} area="brand" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[12.5px] font-semibold text-ink">{NUDGE.title}</span>
          <span className="text-[11px] text-faint">{NUDGE.subtitle}</span>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="inline-flex size-[24px] shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      {/* Body */}
      <button
        type="button"
        onClick={onOpen}
        className="w-full cursor-pointer px-[12px] pt-[10px] pb-[8px] text-left transition-colors hover:bg-soft"
      >
        <p className="m-0 text-[13px] leading-[1.5] text-ink-2">{NUDGE.body}</p>
      </button>

      {/* Actions */}
      <div className="flex gap-[6px] px-[12px] pb-[12px]">
        {NUDGE.actions.map((label) => (
          <button
            key={label}
            type="button"
            onClick={() => onAction(label)}
            className="inline-flex h-[28px] items-center rounded-btn px-[10px] text-[12px] font-medium outline-1 -outline-offset-1 outline-line-strong bg-surface text-ink transition-colors hover:bg-soft"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Single message bubble. */
function MessageBubble({ msg }: { msg: ChiefMessage }) {
  if (msg.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[260px] rounded-[14px_14px_4px_14px] bg-app px-[10px] py-[7px]">
          <p className="m-0 text-[13px] leading-[1.5] text-ink whitespace-pre-wrap">{msg.text}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-[8px]">
      <Mascot size={20} radius={6} area="brand" className="mt-[2px] shrink-0" />
      <div className="max-w-[260px]">
        <p className="m-0 text-[13px] leading-[1.5] text-ink-2 whitespace-pre-wrap">{msg.text}</p>
      </div>
    </div>
  )
}

/** Scrollable message list. */
function MessageListPanel({ messages }: { messages: ChiefMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  return (
    <div className="flex flex-1 flex-col gap-[12px] overflow-y-auto px-[12px] py-[14px]">
      {messages.map((m) => (
        <MessageBubble key={m.id} msg={m} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

/** Compact message composer bar. */
function MiniComposer({
  value,
  onChange,
  onSend,
  onKeyDown,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 20), 80)}px`
  }, [value])

  return (
    <div className="flex items-end gap-[6px] rounded-lg border border-line-strong bg-surface px-[10px] py-[8px] shadow-[0_4px_12px_#0000001A]">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Message Chief"
        className="flex-1 resize-none bg-transparent text-[13px] leading-[1.4] text-ink outline-none placeholder:text-faint"
      />
      <button
        type="button"
        aria-label="Send"
        aria-disabled={!value.trim()}
        onClick={onSend}
        className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-btn bg-primary text-primary-ink transition-colors hover:bg-primary-hover disabled:opacity-40"
      >
        <ArrowUp size={14} aria-hidden />
      </button>
    </div>
  )
}

/** Quick prompt chips shown below the messages. */
function QuickPrompts({ onSelect }: { onSelect: (p: string) => void }) {
  return (
    <div className="flex flex-wrap gap-[6px] px-[12px] pb-[6px]">
      {QUICK_PROMPTS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onSelect(p)}
          className="inline-flex h-[26px] items-center rounded-pill border border-line-strong bg-surface px-[10px] text-[11.5px] text-muted transition-colors hover:bg-soft"
        >
          {p}
        </button>
      ))}
    </div>
  )
}

/** Thread row in the threads list (hM9k9.png). */
function ThreadRow({
  thread,
  onOpen,
}: {
  thread: ChiefThread
  onOpen: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(thread.id)}
      className="flex w-full items-start gap-[8px] px-[12px] py-[10px] text-left transition-colors hover:bg-soft"
    >
      {thread.unread && (
        <span
          aria-label="Unread"
          className="mt-[6px] size-[6px] shrink-0 rounded-pill bg-info"
        />
      )}
      {!thread.unread && <span className="mt-[6px] size-[6px] shrink-0" />}
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="truncate text-[12.5px] leading-[1.4] text-ink">{thread.preview}</span>
      </span>
      <span className="shrink-0 text-[11px] text-faint">{thread.time}</span>
    </button>
  )
}

/** Threads list panel (hM9k9.png). */
function ThreadsPanel({
  onClose,
  onSelectThread,
}: {
  onClose: () => void
  onSelectThread: (id: string) => void
}) {
  return (
    <>
      {/* Header */}
      <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[12px]">
        <Mascot size={22} radius={7} area="brand" />
        <span className="flex-1 text-[13px] font-medium text-ink">Private chats</span>
        <button
          type="button"
          aria-label="Search"
          className="inline-flex size-[28px] items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
        >
          <Search size={15} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Settings"
          className="inline-flex size-[28px] items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
        >
          <History size={15} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="inline-flex size-[28px] items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      {/* Label */}
      <div className="px-[12px] py-[6px]">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.6px] text-faint">LATEST</span>
      </div>

      {/* Threads */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {CHIEF_THREADS.map((t) => (
          <ThreadRow key={t.id} thread={t} onOpen={onSelectThread} />
        ))}
        {/* Footer note */}
        <p className="px-[12px] py-[10px] text-[11.5px] text-faint">
          Chief never posts to a channel or acts on them unless you see that you start a private chat.
        </p>
        <button
          type="button"
          className="mx-[12px] mb-[10px] text-left text-[12px] font-medium text-link hover:underline"
        >
          Start a new private chat...
        </button>
      </div>
    </>
  )
}

/** Panel header shared by open panel and full-screen. */
function PanelHeader({
  isExpanded,
  onToggleExpand,
  onShowThreads,
  onClose,
}: {
  isExpanded: boolean
  onToggleExpand: () => void
  onShowThreads: () => void
  onClose: () => void
}) {
  return (
    <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[12px]">
      <Mascot size={22} radius={7} area="brand" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-medium text-ink">Chief</span>
        <span className="text-[11px] text-faint">Private · not in any channel</span>
      </div>
      <button
        type="button"
        aria-label="Conversation history"
        onClick={onShowThreads}
        className="inline-flex size-[28px] items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
      >
        <RotateCcw size={14} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={isExpanded ? 'Collapse' : 'Expand to full screen'}
        onClick={onToggleExpand}
        className="inline-flex size-[28px] items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
      >
        {isExpanded ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="inline-flex size-[28px] items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
      >
        <X size={15} aria-hidden />
      </button>
    </div>
  )
}

// ── Main widget ───────────────────────────────────────────────────────────────

/**
 * Self-contained floating Chief DM widget.
 * Mount once in the Shell as <ChiefDm /> — no props needed.
 */
export function ChiefDm() {
  const [state, setState] = useState<PanelState>('nudge')
  const [messages, setMessages] = useState<ChiefMessage[]>(CHIEF_MESSAGES)
  const [draft, setDraft] = useState('')

  // Show nudge after 3s if still closed — simulate proactive Chief
  useEffect(() => {
    if (state !== 'closed') return
    const t = setTimeout(() => setState('nudge'), 3000)
    return () => clearTimeout(t)
  }, [state])

  const unread = CHIEF_THREADS.filter((t) => t.unread).length

  function send() {
    const text = draft.trim()
    if (!text) return
    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, kind: 'user', text, time }])
    setDraft('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function handleQuickPrompt(p: string) {
    setDraft(p)
  }

  function handleSelectThread(_id: string) {
    // Re-open the chat panel (single-thread mode for now)
    setState('panel')
  }

  // ── Closed state ─────────────────────────────────────────────────────────
  if (state === 'closed') {
    return (
      <div className="fixed bottom-[20px] right-[20px] z-50 flex flex-col items-end gap-[10px]">
        <FloatingButton unreadCount={unread} onClick={() => setState('panel')} />
      </div>
    )
  }

  // ── Nudge state ───────────────────────────────────────────────────────────
  if (state === 'nudge') {
    return (
      <div className="fixed bottom-[20px] right-[20px] z-50 flex flex-col items-end gap-[10px]">
        <NudgeBubble
          onDismiss={() => setState('closed')}
          onOpen={() => setState('panel')}
          onAction={() => setState('panel')}
        />
        <FloatingButton unreadCount={unread} onClick={() => setState('panel')} />
      </div>
    )
  }

  // ── Expanded (full-screen dialog via Radix) ───────────────────────────────
  if (state === 'expanded') {
    return (
      <Dialog.Root open onOpenChange={(open) => !open && setState('panel')}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-label="Chief DM — full screen"
            className="fixed inset-0 z-50 m-auto flex h-[520px] w-[640px] flex-col overflow-hidden rounded-dialog bg-surface shadow-[0_24px_64px_#0000002A] outline-1 -outline-offset-1 outline-line-strong"
          >
            <PanelHeader
              isExpanded
              onToggleExpand={() => setState('panel')}
              onShowThreads={() => setState('threads')}
              onClose={() => setState('closed')}
            />
            <MessageListPanel messages={messages} />
            <div className="shrink-0 px-[16px] pb-[16px] pt-[8px]">
              <QuickPrompts onSelect={handleQuickPrompt} />
              <MiniComposer
                value={draft}
                onChange={setDraft}
                onSend={send}
                onKeyDown={handleKeyDown}
                placeholder="Think out loud with Chief..."
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    )
  }

  // ── Threads list (floats, replacing panel body) ───────────────────────────
  if (state === 'threads') {
    return (
      <div className="fixed bottom-[20px] right-[20px] z-50">
        <div className="flex h-[480px] w-[320px] flex-col overflow-hidden rounded-lg bg-surface shadow-[0_8px_32px_#0000001F] outline-1 -outline-offset-1 outline-line-strong">
          <ThreadsPanel
            onClose={() => setState('closed')}
            onSelectThread={handleSelectThread}
          />
        </div>
        {/* Scroll-to-bottom button shown at bottom edge */}
        <div className="pointer-events-none absolute right-[12px] -bottom-[46px] flex justify-end">
          <button
            type="button"
            aria-label="Back to chat"
            onClick={() => setState('panel')}
            className="pointer-events-auto inline-flex size-[36px] items-center justify-center rounded-pill bg-surface shadow-[0_2px_10px_#0000001A] outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
          >
            <ChevronDown size={16} aria-hidden className="text-muted" />
          </button>
        </div>
      </div>
    )
  }

  // ── Open panel (nkqAN.png) ────────────────────────────────────────────────
  // state === 'panel'
  return (
    <div className="fixed bottom-[20px] right-[20px] z-50">
      <div className="flex h-[480px] w-[320px] flex-col overflow-hidden rounded-lg bg-surface shadow-[0_8px_32px_#0000001F] outline-1 -outline-offset-1 outline-line-strong">
        <PanelHeader
          isExpanded={false}
          onToggleExpand={() => setState('expanded')}
          onShowThreads={() => setState('threads')}
          onClose={() => setState('closed')}
        />
        <MessageListPanel messages={messages} />
        <div className="shrink-0 px-[10px] pb-[10px] pt-[4px]">
          <QuickPrompts onSelect={handleQuickPrompt} />
          <MiniComposer
            value={draft}
            onChange={setDraft}
            onSend={send}
            onKeyDown={handleKeyDown}
            placeholder="Think out loud with Chief..."
          />
        </div>
      </div>
    </div>
  )
}
