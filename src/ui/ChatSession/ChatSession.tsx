import { useEffect, useRef, useState } from 'react'
import { Check, Ellipsis, Globe, MessageCircle, PanelRight, ShieldCheck, Target, Undo2, UserPlus } from 'lucide-react'
import type { Model, SessionParticipant } from '../../core/domain/types'
import { useChannel, useChannelFolders, useMessages, useSession } from '../../app/queries'
import { Button, IconButton } from '../ds/Button'
import { Topbar } from '../ds/Frame'
import { Mascot } from '../ds/Mascot'
import { MessageList } from './MessageList'
import { DEFAULT_MODEL } from './ModelMenu'
import { Composer } from './Composer'
import { ShareDialog } from './ShareDialog'
import { ChatMenu } from './ChatMenu'

const CHIEF: SessionParticipant = { name: 'Chief', area: 'brand' }

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

interface ChatSessionProps {
  sessionId: string
  /** Channel name used in the composer footer. Falls back to the session's channel. */
  channelName?: string
}

/** Tasks created confirmation (pen ref n9NI9G) */
function TasksCreatedConfirmation({ goal, onUndo }: { goal: string; onUndo: () => void }) {
  const TASKS = [
    { label: 'Ship WebAuthn on web + iOS',         who: 'Dev',     when: 'Nov 14' },
    { label: 'Password fallback for legacy Android', who: 'Dev',     when: 'Nov 20' },
    { label: 'Write rollout comms for residents',   who: 'Grower', when: 'Nov 16' },
  ]
  return (
    <div
      role="status"
      className="w-[680px] max-w-[calc(100%-48px)] rounded-md bg-ok-tint px-[14px] py-[10px] outline-1 -outline-offset-1 outline-ok-line"
    >
      <div className="flex items-center gap-[8px]">
        <Check size={14} aria-hidden className="shrink-0 text-ok" />
        <span className="flex-1 text-[13px] font-medium text-ok">
          3 tasks added to &ldquo;{goal}&rdquo;
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex items-center gap-[4px] text-[12px] font-medium text-ok hover:underline"
        >
          <Undo2 size={12} aria-hidden />
          Undo
        </button>
      </div>
      <ul className="mt-[8px] flex flex-col gap-[4px] pl-[22px]">
        {TASKS.map((t) => (
          <li key={t.label} className="flex items-center gap-[8px]">
            <span className="size-[6px] shrink-0 rounded-full bg-ok" />
            <span className="flex-1 text-[12.5px] text-ok">{t.label}</span>
            <span className="text-[11.5px] text-ok/70">
              {t.who} · {t.when}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-[6px] pl-[22px] text-[12px] text-ok underline hover:no-underline"
      >
        Open goal
      </button>
    </div>
  )
}

/**
 * Shared chat-session surface (Chat mode and Office inbox) — pen `Chat · Session`:
 * Topbar → Thread → Composer area. Rendered inside an <Inset>.
 */
export function ChatSession({ sessionId, channelName }: ChatSessionProps) {
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

  // Topbar dialog / menu state
  const [shareOpen, setShareOpen] = useState(false)

  // Tasks created confirmation state (n9NI9G)
  const [tasksCreated, setTasksCreated] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const area = channelName ?? channel?.name ?? 'channel'
  const folder = folders.find((f) => f.id === session?.folderId)
  const meta = [channel?.name, folder?.name].filter(Boolean).join(' / ')
  const participants = session?.participants?.length ? session.participants : [CHIEF]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Topbar
        icon={MessageCircle}
        title={session?.title ?? ''}
        meta={meta || undefined}
        actions={
          <div className="flex items-center gap-[10px]">
            <div aria-label="In this chat" className="flex items-center -space-x-[6px]">
              {participants.map((p) => (
                <Mascot key={p.name} size={24} radius={6.72} area={p.area} title={p.name} />
              ))}
            </div>
            {session?.goal && (
              <span
                aria-label={`Linked goal: ${session.goal}`}
                className="inline-flex items-center gap-[6px] rounded-pill outline-1 -outline-offset-1 outline-line-strong bg-soft px-[10px] py-[5px]"
              >
                <Target size={13} aria-hidden className="text-ok" />
                <span className="text-[12px] font-medium whitespace-nowrap text-ink-2">{session.goal}</span>
              </span>
            )}
            {/* Share button → opens ShareDialog */}
            <Button variant="secondary" icon={UserPlus} onClick={() => setShareOpen(true)}>
              Share
            </Button>
            {/* "…" → opens ChatMenu */}
            <ChatMenu>
              <button
                type="button"
                aria-label="More options"
                className="flex items-center justify-center rounded-xs text-muted hover:text-ink-2"
              >
                <Ellipsis size={18} aria-hidden />
              </button>
            </ChatMenu>
            <div className="flex items-center gap-[2px] pr-[2px] pl-[6px]">
              <IconButton icon={Globe} aria-label="Browser" />
              <IconButton icon={PanelRight} aria-label="Results panel" />
            </div>
          </div>
        }
      />

      {/* Thread */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? null : !messages || messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-[6px] px-[24px] text-center">
            <Mascot size={40} radius={11} />
            <p className="m-0 mt-[6px] text-[13.5px] font-medium text-ink">No messages yet</p>
            <p className="m-0 text-[13px] text-muted">Start the conversation below.</p>
          </div>
        ) : (
          <>
            <MessageList messages={messages} onTasksAction={() => setTasksCreated(true)} />
            {tasksCreated && session?.goal && (
              <div className="flex flex-col items-center pb-[13px]">
                <TasksCreatedConfirmation
                  goal={session.goal}
                  onUndo={() => setTasksCreated(false)}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Composer area */}
      <div className="flex shrink-0 flex-col items-center gap-[8px] pt-[4px] pb-[13px]">
        <div className="w-[680px] max-w-[calc(100%-48px)]">
          <Composer
            sessionId={sessionId}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
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

      {/* Share dialog */}
      <ShareDialog
        title={session?.title ?? 'this chat'}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  )
}
