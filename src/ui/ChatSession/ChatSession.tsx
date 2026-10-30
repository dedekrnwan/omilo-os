import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, CircleCheck, Ellipsis, FoldVertical, Globe, MessageCircle, PanelRight, ScrollText, ShieldCheck, Target, UserPlus, X } from 'lucide-react'
import type { HelperArea, Message, MessageAuthor, Model, SessionParticipant } from '../../core/domain/types'
import {
  useChannel,
  useChannelFolders,
  useChannelGoals,
  useDeleteSession,
  useFolderFiles,
  useMessages,
  useSession,
  useUpdateSession,
} from '../../app/queries'
import { useCommands } from '../../app/CommandsProvider'
import { takeFirstMessage, useChatStream } from '../../app/chatStream'
import { notify } from '../ds/Toaster'
import { usePickerSource } from './usePickerSource'
import { Button, IconButton } from '../ds/Button'
import { Topbar } from '../ds/Frame'
import { Mascot } from '../ds/Mascot'
import { MessageList } from './MessageList'
import { DEFAULT_MODEL, MODELS } from './ModelMenu'
import { Composer } from './Composer'
import type { ComposerMenu } from './Composer'
import type { ComposerPopoverKind } from './ComposerPopovers'
import { ShareDialog } from './ShareDialog'
import { ChatMenu } from './ChatMenu'
import { ResultsPanel } from './ResultsPanel'
import { BrowserPanel } from './BrowserPanel'
import { RoutineCreatedThread } from './RoutineFromChat'
import { capture } from '../../telemetry'
import { EmptyState } from '../ds/EmptyState'

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

/** pen `Tasks created` (n9NI9G): card under Chief's offer, replacing the suggested actions.
 *  Chief re-plans the linked goal (POST /v1/goals/{id}/replan); the tasks land on the goal. */
function TasksCreated({ goal, onDismiss }: { goal: string; onDismiss: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="flex w-[680px] max-w-[calc(100%-48px)] flex-col gap-[8px] pl-[34px]">
      <div
        role="status"
        className="flex w-full flex-col items-start gap-[8px] rounded-md bg-surface px-[14px] py-[12px] outline-1 -outline-offset-1 outline-line-strong"
      >
        <div className="flex w-full items-center gap-[8px]">
          <CircleCheck size={15} aria-hidden className="shrink-0 text-ok" />
          <span className="text-[13px] font-semibold text-ink">Chief is turning this into tasks under &ldquo;{goal}&rdquo;</span>
          <span className="h-px flex-1" />
          <button type="button" onClick={onDismiss} className="text-[12.5px] text-link hover:underline">
            Dismiss
          </button>
        </div>
        <span className="text-[13px] text-ink-2">
          Tasks show up on the goal as Chief assigns them to helpers.
        </span>
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

  // Rename / move / pin / goal / archive / delete persist through the API.
  const updateSession = useUpdateSession()
  const deleteSession = useDeleteSession()
  const commands = useCommands()
  const effectiveTitle = session?.title ?? ''
  const effectiveGoal = session?.goal
  const pickerSource = usePickerSource(channelId || null, sessionId)
  const { data: folderFiles = [] } = useFolderFiles(session?.folderId ?? '')

  // Model: the session's stored model (falls back to the default); a pick is saved.
  const sessionModel = MODELS.find((m) => m.id === session?.model)
  // A pick belongs to the chat it was made in: switching sessionId resets it.
  const [pick, setPick] = useState<{ sid: string; model: Model | null }>({ sid: sessionId, model: null })
  const pickedModel = pick.sid === sessionId ? pick.model : null
  const setPickedModel = (m: Model) => setPick({ sid: sessionId, model: m })
  const selectedModel: Model = pickedModel ?? sessionModel ?? DEFAULT_MODEL
  function changeModel(m: Model) {
    setPickedModel(m)
    if (session && m.id !== session.model) updateSession.mutate({ id: sessionId, input: { model: m.id } })
  }
  function patch(input: Parameters<typeof updateSession.mutate>[0]['input'], done?: string) {
    updateSession.mutate(
      { id: sessionId, input },
      {
        onSuccess: done ? () => setActionToast(done) : undefined,
        onError: () => notify('Couldn’t save that change — try again'),
      },
    )
  }

  const [shareOpen, setShareOpen] = useState(screen === 'share')
  const [resultsOpen, setResultsOpen] = useState(screen?.startsWith('results') ?? false)
  const [browserOpen, setBrowserOpen] = useState(screen?.startsWith('browser') ?? false)
  const [isDraggingOver, setIsDraggingOver] = useState(screen === 'results-drop')
  const [tasksCreated, setTasksCreated] = useState(screen === 'tasks')
  const [toast, setToast] = useState(screen === 'tasks')
  const [draft, setDraft] = useState<string | undefined>(undefined)

  // Chat menu dialog states
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const [goalPickerOpen, setGoalPickerOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [actionToast, setActionToast] = useState<string | null>(null)
  const [autoCompact, setAutoCompact] = useState(true)

  // Live-mode streaming state
  const [streamedMessages, setStreamedMessages] = useState<Message[]>([])
  const [isSending, setIsSending] = useState(false)
  const [sendNotice, setSendNotice] = useState<string | null>(null)
  // Active socket handle — guards against concurrent sockets (approach a: deny new send while in-flight)
  const socketRef = useRef<{ close(): void } | null>(null)


  // ── Live turns stream over SSE (VITE_USE_HTTP=1) ─────────────────────────
  // POST /v1/sessions/{id}/messages/stream: the owner's message comes back
  // saved, then the reply arrives word by word into a live bubble, then the
  // saved reply replaces it. Mock mode keeps the static thread.
  const isLiveMode = import.meta.env.VITE_USE_HTTP === '1'
  const streamTurn = useChatStream()
  const [live, setLive] = useState<{ author: MessageAuthor; text: string; activity: string | null } | null>(null)

  const handleSend = useCallback((text: string, model?: string) => {
    if (!isLiveMode) return
    if (socketRef.current) return // one turn at a time
    capture('message_sent', {}) // content-free
    const ctrl = new AbortController()
    socketRef.current = { close: () => ctrl.abort() }
    setIsSending(true)
    setSendNotice(null)
    const first = session?.participants?.[0] ?? CHIEF
    setLive({ author: { kind: 'helper', name: first.name, area: first.area }, text: '', activity: null })
    const append = (m: Message) =>
      setStreamedMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
    void streamTurn(sessionId, text, {
      model: model ?? selectedModel.id,
      signal: ctrl.signal,
      onUser: append,
      onHelper: (author) => setLive((l) => (l ? { ...l, author } : l)),
      onActivity: (label) => setLive((l) => (l ? { ...l, activity: label } : l)),
      onText: (delta) => setLive((l) => (l ? { ...l, text: l.text + delta, activity: null } : l)),
      onDone: (m) => {
        if (m) append(m)
      },
      onError: (error, m) => {
        if (m) append(m)
        setSendNotice(error)
      },
    }).finally(() => {
      socketRef.current = null
      setLive(null)
      setIsSending(false)
    })
  }, [isLiveMode, sessionId, selectedModel, streamTurn, session])

  // A chat started from /chat: send its first message here so it streams.
  useEffect(() => {
    if (!isLiveMode) return
    const first = takeFirstMessage(sessionId)
    if (first) handleSend(first.text, first.model)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Leaving the chat mid-answer doesn't cancel the turn: the server finishes and
  // saves the reply in the background, and the thread shows it when you return.

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

  // ── Composer context meter — real-state-driven ────────────────────────────
  // Screen-state overrides take priority (for design preview frames).
  // Otherwise: coarse proxy from message count + total content chars.
  //   Assumption: ~200k char context window, each char ≈ 0.25 token → ~50k tokens.
  //   We estimate fill% = totalChars / 200_000 clamped to [0, 99].
  //   Streamed messages (in-flight turn) are included for immediacy.
  //   Note: this is an approximation — the exact token count lives server-side.
  //   When a run_event carries token data in the future, switch to that signal.
  const contextUsed: number = useMemo(() => {
    if (screen === 'almost-full') return 94
    if (screen === 'compacted') return 18
    const allMsgs = [...(messages ?? []), ...streamedMessages]
    const totalChars = allMsgs.reduce((sum, m) => sum + (m.content?.length ?? 0), 0)
    return Math.min(99, Math.round((totalChars / 200_000) * 100))
  }, [screen, messages, streamedMessages])
  const browser = browserOpen
  const panelOpen = resultsOpen || browserOpen
  // With the 600px browser beside it the thread and composer keep 28px gutters (pen E5554m).
  const col = browser ? 'w-[680px] max-w-[calc(100%-56px)]' : 'w-[680px] max-w-[calc(100%-48px)]'

  const isPinned = Boolean(session?.pinned)
  const chatFiles = [
    ...new Set([
      ...(messages ?? []).flatMap((m) => (m.attachment ? [m.attachment.title] : [])),
      ...folderFiles.map((f) => f.name),
    ]),
  ]

  /** "Turn this into tasks": Chief re-plans the linked goal into tasks. */
  function createTasks() {
    const goalId = session?.goalId
    if (!goalId) {
      setGoalPickerOpen(true)
      setActionToast('Link this chat to a goal first')
      return
    }
    commands.replanGoal(goalId).then(
      () => {
        setTasksCreated(true)
        setToast(true)
      },
      () => notify('Couldn’t plan the tasks — try again'),
    )
  }

  /** Ask a helper in this chat (prefills the composer with an @mention). */
  function askHelper(name: string, _area?: HelperArea, about?: string) {
    setDraft(`@${name} ${about ? `can you change something in “${about}”? ` : ''}`)
  }

  // ── ChatMenu handlers ────────────────────────────────────────────────────────

  function handleRename() {
    setRenameValue(effectiveTitle)
    setRenameOpen(true)
  }

  function commitRename() {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== effectiveTitle) patch({ title: trimmed })
    setRenameOpen(false)
  }

  function handleMoveToFolder() {
    setFolderPickerOpen(true)
  }

  function handleLinkToGoal() {
    setGoalPickerOpen(true)
  }

  function handlePinToSidebar() {
    patch({ pinned: !isPinned }, isPinned ? 'Unpinned from sidebar' : 'Pinned to sidebar')
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
    updateSession.mutate(
      { id: sessionId, input: { archived: true } },
      {
        onSuccess: () => notify('Chat archived', () => updateSession.mutate({ id: sessionId, input: { archived: false } })),
        onError: () => notify('Couldn’t archive the chat — try again'),
      },
    )
    void navigate({ to: '/archived' })
  }

  function handleDelete() {
    setDeleteConfirmOpen(true)
  }

  function confirmDelete() {
    deleteSession.mutate(sessionId, {
      onSuccess: () => notify('Chat deleted'),
      onError: () => notify('Couldn’t delete the chat — try again'),
    })
    setDeleteConfirmOpen(false)
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
                  onClick={() => { patch({ folderId: f.id }, `Moved to "${f.name}"`); setFolderPickerOpen(false) }}
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
                  onClick={() => { patch({ goalId: g.id }, `Linked to "${g.title}"`); setGoalPickerOpen(false) }}
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
        ) : isLoading ? null : (
          (() => {
            // Merge server messages with in-flight streamed messages (deduped by id)
            const serverMsgs = messages ?? []
            const serverIds = new Set(serverMsgs.map(m => m.id))
            const combined = [
              ...serverMsgs,
              ...streamedMessages.filter(m => !serverIds.has(m.id)),
              ...(live
                ? [{
                    id: 'live-reply',
                    sessionId,
                    author: live.author,
                    content: live.text || `_${live.activity ?? 'Thinking…'}_`,
                    createdAt: new Date().toISOString(),
                  } satisfies Message]
                : []),
            ]
            if (combined.length === 0) {
              return (
                <div className="flex h-full items-center justify-center">
                  <EmptyState
                    title="No messages yet"
                    description="Ask Chief anything below — it answers, or hands the work to the right helper."
                  />
                </div>
              )
            }
            return (
              <MessageList
                messages={combined}
                columnClass={col}
                before={screen === 'compacted' ? <CompactedMarker onViewFullHistory={() => setActionToast('Loading full history…')} /> : undefined}
                onTasksAction={createTasks}
                replaceActions={
                  tasksCreated && effectiveGoal ? (
                    <TasksCreated goal={effectiveGoal} onDismiss={() => setTasksCreated(false)} />
                  ) : undefined
                }
              />
            )
          })()
        )}
      </div>

      {/* Composer area */}
      <div className="flex shrink-0 flex-col items-center gap-[8px] pt-[4px] pb-[13px]">
        <div className={col}>
          {/* Non-blocking notice: the AI couldn't answer / the answer was cut off */}
          {sendNotice && (
            <div
              role="status"
              className="mb-[6px] flex items-center gap-[8px] rounded-base bg-soft px-[10px] py-[6px] text-[12px] text-muted outline-1 -outline-offset-1 outline-line"
            >
              <span className="flex-1">{sendNotice}</span>
              <button
                type="button"
                aria-label="Dismiss notice"
                onClick={() => setSendNotice(null)}
                className="text-muted hover:text-ink-2"
              >
                ×
              </button>
            </div>
          )}
          <Composer
            key={`${screen ?? 'base'}-${draft ?? ''}`}
            sessionId={sessionId}
            selectedModel={selectedModel}
            onModelChange={changeModel}
            pickerSource={pickerSource}
            contextUsed={contextUsed}
            contextAlmostFull={screen === 'almost-full' || contextUsed >= 90}
            autoCompact={autoCompact}
            onAutoCompactToggle={() => setAutoCompact(v => !v)}
            onCompactNow={() => setActionToast('Context compacted')}
            initialText={draft ?? composerState?.text}
            initialPopover={composerState?.popover}
            initialMenu={composerState?.menu}
            placeholder={
              isSending
                ? 'Chief is thinking…'
                : `Reply — ${joinNames(participants.map((p) => p.name))} ${
                    participants.length > 1 ? 'are' : 'is'
                  } in this chat`
            }
            onSend={isLiveMode ? (text) => { setDraft(undefined); handleSend(text) } : undefined}
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
              sessionId={sessionId}
              onClose={() => setResultsOpen(false)}
              highlightFiles={isDraggingOver}
              initialPreview={screen === 'results-preview'}
              contextUsed={contextUsed}
              modelLabel={selectedModel.label}
              onCompact={() => setActionToast('Context compacted')}
              files={chatFiles}
              goal={effectiveGoal}
              onAskChange={(helper, title) => askHelper(helper, undefined, title)}
            />
          )}
          {browserOpen && <BrowserPanel sessionId={sessionId} onClose={() => setBrowserOpen(false)} />}
        </BesideInset>
      )}

      {toast && (
        <Toast
          title="Chief is planning the tasks"
          body="They land on the goal in Office mode as helpers pick them up."
          onClose={() => setToast(false)}
        />
      )}

      <ShareDialog
        title={session?.title ?? 'this chat'}
        target={{ kind: 'session', id: sessionId }}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  )
}
