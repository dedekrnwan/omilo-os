import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, CircleCheck, Ellipsis, FoldVertical, Globe, MessageCircle, PanelRight, ScrollText, ShieldCheck, Target, UserPlus, X } from 'lucide-react'
import type { Model, SessionParticipant } from '../../core/domain/types'
import { useChannel, useChannelFolders, useChannelGoals, useMessages, useSession } from '../../app/queries'
import { useChatStore } from '../../app/store'
import { createCommands } from '../../adapters/http/commands'
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
  const navigate = useNavigate()
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
          onClick={() => void navigate({ to: '/goals' })}
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
function CompactedMarker({ onViewFullHistory }: { onViewFullHistory?: () => void }) {
  const [expanded, setExpanded] = useState(false)
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
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => { setExpanded(v => !v); onViewFullHistory?.() }}
            className="text-[12px] text-link hover:underline"
          >
            {expanded ? 'Collapse' : 'View full history'}
          </button>
        </div>
        <p className="m-0 text-[12.5px] leading-[1.5] text-ink-2">
          Goal: passkeys for 80% of users by Nov 28 · Dev owns web + iOS (Nov 14) and Android fallback (Nov 20) ·
          Grower drafts resident comms · 3 decisions and 2 files kept word-for-word.
        </p>
        {expanded && (
          <p className="m-0 text-[12.5px] leading-[1.5] text-muted">
            (Full history is stored locally — in a real app, older messages would load here.)
          </p>
        )}
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
  const navigate = useNavigate()
  const { data: messages, isLoading } = useMessages(sessionId)
  const { data: session } = useSession(sessionId)
  const channelId = session?.channelId ?? ''
  const { data: channel } = useChannel(channelId)
  const { data: folders = [] } = useChannelFolders(channelId)
  const { data: goals = [] } = useChannelGoals(channelId)

  // Chat store mutations
  const { overrides, patchSession, archiveSession } = useChatStore()
  const override = overrides[sessionId]
  // Effective title: from store override, then session fixture
  const effectiveTitle = override?.title ?? session?.title ?? ''
  // Effective goal: from store override (can be null to clear), then session fixture
  const effectiveGoal = override && 'goal' in override ? override.goal : session?.goal

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

  // Chat menu dialog states
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [goalPickerOpen, setGoalPickerOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [actionToast, setActionToast] = useState<string | null>(null)
  const [autoCompact, setAutoCompact] = useState(true)

  // ── HTTP commands (env-gated) ─────────────────────────────────────────────
  // In http mode, the composer's onSend calls the API to persist the message.
  // In mock mode this is a no-op and the Composer's onSend prop is left unset,
  // preserving the existing mock-mode behaviour exactly.
  const commands = useMemo(() => {
    if (import.meta.env.VITE_USE_HTTP !== '1') return null
    const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
    const getToken = () => localStorage.getItem('omilo_token')
    return createCommands(baseUrl, getToken)
  }, [])

  function handleSend(text: string) {
    if (commands) {
      // Fire-and-forget: the user's message is already in the backend.
      // Optimistic UI is handled by the existing mock-mode path; live WS
      // streaming is wired in a later task (P5+ frontend-gaps).
      commands.sendMessage(sessionId, text).catch(() => {
        // Swallow errors silently in P1 — error feedback is a later task.
      })
    }
  }

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const area = channelName ?? channel?.name ?? 'channel'
  const folder = folders.find((f) => f.id === (override?.folderId ?? session?.folderId))
  const meta = [channel?.name, folder?.name].filter(Boolean).join(' / ')
  const participants = session?.participants?.length ? session.participants : [CHIEF]
  const composerState = screen ? COMPOSER_STATE[screen] : undefined
  const contextUsed = screen === 'almost-full' ? 94 : screen === 'compacted' ? 18 : 42
  const browser = browserOpen
  const panelOpen = resultsOpen || browserOpen
  // With the 600px browser beside it the thread and composer keep 28px gutters (pen E5554m).
  const col = browser ? 'w-[680px] max-w-[calc(100%-56px)]' : 'w-[680px] max-w-[calc(100%-48px)]'

  const isPinned = override?.pinned ?? false

  function createTasks() {
    setTasksCreated(true)
    setToast(true)
  }

  // ── ChatMenu handlers ────────────────────────────────────────────────────────

  function handleRename() {
    setRenameValue(effectiveTitle)
    setRenameOpen(true)
  }

  function commitRename() {
    const trimmed = renameValue.trim()
    if (trimmed) patchSession(sessionId, { title: trimmed })
    setRenameOpen(false)
  }

  function handleMoveToFolder() {
    setFolderPickerOpen(true)
  }

  function handleLinkToGoal() {
    setGoalPickerOpen(true)
  }

  function handlePinToSidebar() {
    patchSession(sessionId, { pinned: !isPinned })
    setActionToast(isPinned ? 'Unpinned from sidebar' : 'Pinned to sidebar')
  }

  function handleExportMarkdown() {
    const title = effectiveTitle || 'chat'
    const lines: string[] = [`# ${title}`, '']
    for (const m of messages ?? []) {
      if (m.system) continue
      const who = m.author.kind === 'you' ? 'You' : m.author.name
      lines.push(`**${who}:** ${m.content}`, '')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/\s+/g, '-').toLowerCase()}.md`
    a.click()
    URL.revokeObjectURL(url)
    setActionToast('Exported as Markdown')
  }

  function handleCopyLink() {
    void navigator.clipboard.writeText(window.location.href)
    setActionToast('Link copied')
  }

  function handleArchive() {
    archiveSession(sessionId, effectiveTitle, channel?.name ?? 'General')
    setActionToast('Chat archived')
    void navigate({ to: '/archived' })
  }

  function handleDelete() {
    setDeleteConfirmOpen(true)
  }

  function confirmDelete() {
    // Mark as archived+deleted in store — simplest mock-only approach
    archiveSession(sessionId, effectiveTitle, channel?.name ?? 'General')
    setDeleteConfirmOpen(false)
    setActionToast('Chat deleted')
    void navigate({ to: '/chat' })
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
      {/* Rename dialog */}
      {renameOpen && (
        <div
          role="dialog"
          aria-label="Rename chat"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0A0926]"
        >
          <div className="flex w-[380px] flex-col gap-[16px] rounded-lg bg-surface p-[24px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_12px_32px_#0C0A0924]">
            <h3 className="m-0 text-[16px] font-semibold text-ink">Rename chat</h3>
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenameOpen(false) }}
              aria-label="Chat title"
              className="h-[36px] w-full rounded-base bg-surface px-[9px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong"
            />
            <div className="flex justify-end gap-[8px]">
              <Button variant="secondary" style={{ height: 32 }} onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button variant="primary" style={{ height: 32 }} onClick={commitRename}>Rename</Button>
            </div>
          </div>
        </div>
      )}

      {/* Folder picker dialog */}
      {folderPickerOpen && (
        <div
          role="dialog"
          aria-label="Move to folder"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0A0926]"
        >
          <div className="flex w-[320px] flex-col gap-[12px] rounded-lg bg-surface p-[16px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_12px_32px_#0C0A0924]">
            <h3 className="m-0 text-[16px] font-semibold text-ink">Move to folder</h3>
            <div className="flex flex-col gap-[4px]">
              {folders.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => { patchSession(sessionId, { folderId: f.id }); setFolderPickerOpen(false); setActionToast(`Moved to "${f.name}"`) }}
                  className="flex w-full items-center gap-[8px] rounded-base px-[8px] py-[6px] text-left text-[13px] text-ink hover:bg-soft"
                >
                  {f.name}
                </button>
              ))}
              {folders.length === 0 && <p className="m-0 text-[13px] text-muted">No folders in this channel.</p>}
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" style={{ height: 32 }} onClick={() => setFolderPickerOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Goal picker dialog */}
      {goalPickerOpen && (
        <div
          role="dialog"
          aria-label="Link to goal"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0A0926]"
        >
          <div className="flex w-[360px] flex-col gap-[12px] rounded-lg bg-surface p-[16px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_12px_32px_#0C0A0924]">
            <h3 className="m-0 text-[16px] font-semibold text-ink">Link to goal</h3>
            <div className="flex flex-col gap-[4px]">
              {goals.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => { patchSession(sessionId, { goal: g.title }); setGoalPickerOpen(false); setActionToast(`Linked to "${g.title}"`) }}
                  className="flex w-full items-center gap-[8px] rounded-base px-[8px] py-[6px] text-left text-[13px] text-ink hover:bg-soft"
                >
                  <Target size={13} aria-hidden className="text-ok" />
                  {g.title}
                </button>
              ))}
              {goals.length === 0 && <p className="m-0 text-[13px] text-muted">No goals in this channel.</p>}
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" style={{ height: 32 }} onClick={() => setGoalPickerOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm dialog */}
      {deleteConfirmOpen && (
        <div
          role="dialog"
          aria-label="Delete chat"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0A0926]"
        >
          <div className="flex w-[360px] flex-col gap-[16px] rounded-lg bg-surface p-[24px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_12px_32px_#0C0A0924]">
            <h3 className="m-0 text-[16px] font-semibold text-ink">Delete chat?</h3>
            <p className="m-0 text-[13px] text-muted">"{effectiveTitle}" will be permanently deleted.</p>
            <div className="flex justify-end gap-[8px]">
              <Button variant="secondary" style={{ height: 32 }} onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
              <Button style={{ height: 32, background: 'var(--color-bad)', color: '#fff' }} onClick={confirmDelete}>Delete</Button>
            </div>
          </div>
        </div>
      )}

      {/* Action toast */}
      {actionToast && (
        <Toast title={actionToast} body="" onClose={() => setActionToast(null)} />
      )}

      <Topbar
        icon={MessageCircle}
        title={effectiveTitle}
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
            {effectiveGoal && !browser && (
              <span
                aria-label={`Linked goal: ${effectiveGoal}`}
                className="inline-flex items-center gap-[6px] rounded-pill bg-soft px-[10px] py-[5px] outline-1 -outline-offset-1 outline-line-strong"
              >
                <Target size={13} aria-hidden className="text-ok" />
                <span className="text-[12px] font-medium whitespace-nowrap text-ink-2">{effectiveGoal}</span>
              </span>
            )}
            <Button variant="secondary" icon={UserPlus} onClick={() => setShareOpen(true)}>
              Share
            </Button>
            <ChatMenu
              defaultOpen={screen === 'chat-menu'}
              onRename={handleRename}
              onMoveToFolder={handleMoveToFolder}
              onLinkToGoal={handleLinkToGoal}
              onPinToSidebar={handlePinToSidebar}
              onExportMarkdown={handleExportMarkdown}
              onCopyLink={handleCopyLink}
              onArchive={handleArchive}
              onDelete={handleDelete}
            >
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
            before={screen === 'compacted' ? <CompactedMarker onViewFullHistory={() => setActionToast('Loading full history…')} /> : undefined}
            onTasksAction={createTasks}
            replaceActions={
              tasksCreated && effectiveGoal ? (
                <TasksCreated goal={effectiveGoal} onUndo={() => setTasksCreated(false)} />
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
            autoCompact={autoCompact}
            onAutoCompactToggle={() => setAutoCompact(v => !v)}
            onCompactNow={() => setActionToast('Context compacted')}
            initialText={composerState?.text}
            initialPopover={composerState?.popover}
            initialMenu={composerState?.menu}
            placeholder={`Reply — ${joinNames(participants.map((p) => p.name))} ${
              participants.length > 1 ? 'are' : 'is'
            } in this chat`}
            onSend={commands ? handleSend : undefined}
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
