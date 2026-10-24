import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, CircleCheck, Ellipsis, FoldVertical, Globe, MessageCircle, PanelRight, ScrollText, ShieldCheck, Target, UserPlus, X } from 'lucide-react'
import type { Model, SessionParticipant } from '../../core/domain/types'
import { useChannel, useChannelFolders, useMessages, useSession } from '../../app/queries'
import { Button, IconButton } from '../ds/Button'
import { Topbar } from '../ds/Frame'
import { Mascot } from '../ds/Mascot'
import { MessageList } from './MessageList'
import { DEFAULT_MODEL } from './ModelMenu'
import { Composer } from './Composer'
import type { ComposerMenu } from './Composer'
import type { ComposerPopoverKind } from './ComposerPopovers'
import { ShareDialog } from './ShareDialog'
import { ChatMenu } from './ChatMenu'
import { ResultsPanel } from './ResultsPanel'
import { BrowserPanel } from './BrowserPanel'
import { RoutineCreatedThread } from './RoutineFromChat'

const CHIEF: SessionParticipant = { name: 'Chief', area: 'brand' }

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Screen states of the session (pen frames), reachable with `?state=<name>`:
 * mention · command · context · model · thinking · context-menu · almost-full ·
 * compacted · share · chat-menu · tasks · results · results-drop · results-preview ·
 * browser · browser-takeover · routine.
 */
export type SessionScreenState =
  | 'mention'
  | 'command'
  | 'context'
  | 'model'
  | 'thinking'
  | 'context-menu'
  | 'almost-full'
  | 'compacted'
  | 'share'
  | 'chat-menu'
  | 'tasks'
  | 'results'
  | 'results-drop'
  | 'results-preview'
  | 'browser'
  | 'browser-takeover'
  | 'routine'

function readScreenState(): SessionScreenState | null {
  if (typeof window === 'undefined') return null
  return (new URLSearchParams(window.location.search).get('state') as SessionScreenState | null) ?? null
}

const COMPOSER_STATE: Partial<Record<SessionScreenState, { text?: string; popover?: ComposerPopoverKind; menu?: ComposerMenu }>> = {
  mention: { text: 'Can you ask @bu', popover: 'mention' },
  command: { text: '/lo', popover: 'command' },
  context: { text: 'Compare with #pass', popover: 'context' },
  model: { menu: 'model' },
  thinking: { menu: 'thinking' },
  'context-menu': { menu: 'context' },
}

interface ChatSessionProps {
  sessionId: string
  /** Channel name used in the composer footer. Falls back to the session's channel. */
  channelName?: string
}

/** pen `Checkbox/Off` (qswGP): 16px · radius 4 · 1px #A8A29E. */
function Checkbox() {
  return <span aria-hidden className="size-[16px] shrink-0 rounded-[4px] bg-surface outline-1 -outline-offset-1 outline-[#A8A29E]" />
}

const CREATED_TASKS = [
  { label: 'Ship WebAuthn on web + iOS', meta: 'Dev · Nov 14' },
  { label: 'Password fallback for legacy Android', meta: 'Dev · Nov 20' },
  { label: 'Write rollout comms for residents', meta: 'Grower · Nov 18' },
]

/** pen `Tasks created` (n9NI9G): card under Chief's offer, replacing the suggested actions. */
function TasksCreated({ goal, onUndo }: { goal: string; onUndo: () => void }) {
  return (
    <div className="flex w-[680px] max-w-[calc(100%-48px)] flex-col gap-[8px] pl-[34px]">
      <div
        role="status"
        className="flex w-full flex-col items-start gap-[8px] rounded-md bg-surface px-[14px] py-[12px] outline-1 -outline-offset-1 outline-line-strong"
      >
        <div className="flex w-full items-center gap-[8px]">
          <CircleCheck size={15} aria-hidden className="shrink-0 text-ok" />
          <span className="text-[13px] font-semibold text-ink">3 tasks added to &ldquo;{goal}&rdquo;</span>
          <span className="h-px flex-1" />
          <button type="button" onClick={onUndo} className="text-[12.5px] text-link hover:underline">
            Undo
          </button>
        </div>
        {CREATED_TASKS.map((t) => (
          <div key={t.label} className="flex w-full items-center gap-[8px]">
            <Checkbox />
            <span className="flex-1 text-[13px] text-ink-2">{t.label}</span>
            <span className="text-[12px] text-muted">{t.meta}</span>
          </div>
        ))}
        <button
          type="button"
          className="inline-flex h-[28px] items-center gap-[6px] rounded-btn bg-surface px-[14px] text-[13px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
        >
          <ArrowUpRight size={16} aria-hidden />
          Open goal
        </button>
      </div>
    </div>
  )
}

/** pen `Toast` (LZRbW) — top-right confirmation. */
function Toast({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return createPortal(
    <div
      role="status"
      className="fixed top-[60px] right-[24px] z-50 flex w-[360px] gap-[10px] rounded-lg bg-surface py-[12px] pr-[8px] pl-[14px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_10px_24px_#0C0A0929]"
    >
      <CircleCheck size={18} aria-hidden className="shrink-0 text-ok" />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[14px] font-medium text-ink">{title}</span>
        <span className="text-[13px] leading-[1.45] text-muted">{body}</span>
      </div>
      <IconButton icon={X} size={14} aria-label="Dismiss" onClick={onClose} />
    </div>,
    document.body,
  )
}

/** pen `Compacted marker` (GNF2E): hairline pill + "What Chief kept" summary, top of the thread. */
function CompactedMarker() {
  return (
    <div className="flex w-[680px] max-w-[calc(100%-48px)] flex-col gap-[8px]">
      <div role="note" aria-label="Context compacted" className="flex w-full items-center gap-[10px]">
        <span className="h-px flex-1 bg-line" />
        <span className="flex items-center gap-[6px] rounded-pill bg-soft px-[10px] py-[4px] outline-1 -outline-offset-1 outline-line">
          <FoldVertical size={12} aria-hidden className="text-muted" />
          <span className="text-[11.5px] whitespace-nowrap text-muted">
            Context compacted · 38 messages summarised · 164k → 36k
          </span>
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="flex w-full flex-col gap-[6px] rounded-md bg-soft px-[12px] py-[10px]">
        <div className="flex w-full items-center gap-[6px]">
          <ScrollText size={13} aria-hidden className="text-muted" />
          <span className="text-[12.5px] font-semibold text-ink">What Chief kept</span>
          <span className="h-px flex-1" />
          <button type="button" className="text-[12px] text-link hover:underline">
            View full history
          </button>
        </div>
        <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">
          Goal: passkeys for 80% of users by Nov 28 · Dev owns web + iOS (Nov 14) and Android fallback (Nov 20) ·
          Grower drafts resident comms · 3 decisions and 2 files kept word-for-word.
        </p>
      </div>
    </div>
  )
}

/**
 * Side panels (Results / Browser) are their own cards next to the chat's Inset
 * (pen `Main` gap 6). The Inset belongs to the layout, so the panel is portalled
 * into the Inset's <main> wrapper, after the chat card.
 */
function BesideInset({ anchor, children }: { anchor: React.RefObject<HTMLElement | null>; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null | undefined>(undefined)
  // useEffect (not layout): the anchor's ref is attached after this child's layout effects.
  useEffect(() => {
    setHost(anchor.current?.closest('main') ?? null)
  }, [anchor])
  if (host === undefined) return null
  // No Inset around us (tests, embeds): render in place.
  if (host === null) return <>{children}</>
  return createPortal(children, host)
}

/**
 * Shared chat-session surface (Chat mode and Office inbox) — pen `Chat · Session` (b3vqC5):
 * Topbar → Thread → Composer area. Rendered inside an <Inset>.
 */
export function ChatSession({ sessionId, channelName }: ChatSessionProps) {
  const [screen] = useState(readScreenState)
  const { data: messages, isLoading } = useMessages(sessionId)
  const { data: session } = useSession(sessionId)
  const channelId = session?.channelId ?? ''
  const { data: channel } = useChannel(channelId)
  const { data: folders = [] } = useChannelFolders(channelId)

  // Model state keyed to sessionId — reset whenever sessionId changes
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL)
  const prevSessionId = useRef(sessionId)
  useEffect(() => {
    if (prevSessionId.current !== sessionId) {
      prevSessionId.current = sessionId
      setSelectedModel(DEFAULT_MODEL)
    }
  }, [sessionId])

  const [shareOpen, setShareOpen] = useState(screen === 'share')
  const [resultsOpen, setResultsOpen] = useState(screen?.startsWith('results') ?? false)
  const [browserOpen, setBrowserOpen] = useState(screen?.startsWith('browser') ?? false)
  const [isDraggingOver, setIsDraggingOver] = useState(screen === 'results-drop')
  const [tasksCreated, setTasksCreated] = useState(screen === 'tasks')
  const [toast, setToast] = useState(screen === 'tasks')

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const area = channelName ?? channel?.name ?? 'channel'
  const folder = folders.find((f) => f.id === session?.folderId)
  const meta = [channel?.name, folder?.name].filter(Boolean).join(' / ')
  const participants = session?.participants?.length ? session.participants : [CHIEF]
  const composerState = screen ? COMPOSER_STATE[screen] : undefined
  const contextUsed = screen === 'almost-full' ? 94 : screen === 'compacted' ? 18 : 42
  const browser = browserOpen
  const panelOpen = resultsOpen || browserOpen
  // With the 600px browser beside it the thread and composer keep 28px gutters (pen E5554m).
  const col = browser ? 'w-[680px] max-w-[calc(100%-56px)]' : 'w-[680px] max-w-[calc(100%-48px)]'

  function createTasks() {
    setTasksCreated(true)
    setToast(true)
  }

  return (
    <div
      ref={rootRef}
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={() => {
        setIsDraggingOver(true)
        setResultsOpen(true)
        setBrowserOpen(false)
      }}
    >
      <Topbar
        icon={MessageCircle}
        title={session?.title ?? ''}
        meta={meta || undefined}
        actions={
          <div className="flex items-center gap-[10px]">
            {!browser && (
              <div aria-label="In this chat" className="flex items-center -space-x-[6px]">
                {participants.map((p) => (
                  <Mascot key={p.name} size={24} radius={6.72} area={p.area} title={p.name} />
                ))}
              </div>
            )}
            {session?.goal && !browser && (
              <span
                aria-label={`Linked goal: ${session.goal}`}
                className="inline-flex items-center gap-[6px] rounded-pill bg-soft px-[10px] py-[5px] outline-1 -outline-offset-1 outline-line-strong"
              >
                <Target size={13} aria-hidden className="text-ok" />
                <span className="text-[12px] font-medium whitespace-nowrap text-ink-2">{session.goal}</span>
              </span>
            )}
            <Button variant="secondary" icon={UserPlus} onClick={() => setShareOpen(true)}>
              Share
            </Button>
            <ChatMenu defaultOpen={screen === 'chat-menu'}>
              <button
                type="button"
                aria-label="More options"
                className="flex items-center justify-center rounded-xs text-muted hover:text-ink-2"
              >
                <Ellipsis size={18} aria-hidden />
              </button>
            </ChatMenu>
            <div className="flex items-center gap-[2px] pr-[2px] pl-[6px]">
              <IconButton
                icon={Globe}
                aria-label="Browser panel"
                aria-pressed={browserOpen}
                onClick={() => {
                  setBrowserOpen((v) => !v)
                  if (!browserOpen) setResultsOpen(false)
                }}
                className={browserOpen ? 'bg-hover text-ink' : ''}
              />
              <IconButton
                icon={PanelRight}
                aria-label="Results panel"
                aria-pressed={resultsOpen}
                onClick={() => {
                  setResultsOpen((v) => !v)
                  if (!resultsOpen) setBrowserOpen(false)
                }}
                className={resultsOpen ? 'bg-hover text-ink' : ''}
              />
            </div>
          </div>
        }
      />

      {/* Thread */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {screen === 'routine' ? (
          <RoutineCreatedThread />
        ) : isLoading ? null : !messages || messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-[6px] px-[24px] text-center">
            <Mascot size={40} radius={11} />
            <p className="m-0 mt-[6px] text-[13.5px] font-medium text-ink">No messages yet</p>
            <p className="m-0 text-[13px] text-muted">Start the conversation below.</p>
          </div>
        ) : (
          <MessageList
            messages={messages}
            columnClass={col}
            before={screen === 'compacted' ? <CompactedMarker /> : undefined}
            onTasksAction={createTasks}
            replaceActions={
              tasksCreated && session?.goal ? (
                <TasksCreated goal={session.goal} onUndo={() => setTasksCreated(false)} />
              ) : undefined
            }
          />
        )}
      </div>

      {/* Composer area */}
      <div className="flex shrink-0 flex-col items-center gap-[8px] pt-[4px] pb-[13px]">
        <div className={col}>
          <Composer
            key={screen ?? 'base'}
            sessionId={sessionId}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            contextUsed={contextUsed}
            contextAlmostFull={screen === 'almost-full'}
            initialText={composerState?.text}
            initialPopover={composerState?.popover}
            initialMenu={composerState?.menu}
            placeholder={`Reply — ${joinNames(participants.map((p) => p.name))} ${
              participants.length > 1 ? 'are' : 'is'
            } in this chat`}
          />
        </div>
        <p className="m-0 flex items-center gap-[6px] text-[12px] text-faint">
          <ShieldCheck size={13} aria-hidden />
          Agents here only read {area} goals, docs and chats
        </p>
      </div>

      {/* Drop overlay over the chat card while files are dragged in (Zdjc7) */}
      {resultsOpen && isDraggingOver && (
        <ResultsPanel.DropOverlay onDone={() => setIsDraggingOver(false)} />
      )}

      {panelOpen && (
        <BesideInset anchor={rootRef}>
          {resultsOpen && (
            <ResultsPanel
              onClose={() => setResultsOpen(false)}
              highlightFiles={isDraggingOver}
              initialPreview={screen === 'results-preview'}
            />
          )}
          {browserOpen && (
            <BrowserPanel onClose={() => setBrowserOpen(false)} initialTakenOver={screen === 'browser-takeover'} />
          )}
        </BesideInset>
      )}

      {toast && (
        <Toast
          title="3 tasks added to the goal"
          body="Dev and Grower got them in Office mode."
          onClose={() => setToast(false)}
        />
      )}

      <ShareDialog title={session?.title ?? 'this chat'} open={shareOpen} onOpenChange={setShareOpen} />
    </div>
  )
}
