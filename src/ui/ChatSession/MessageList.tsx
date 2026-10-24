import { Fragment } from 'react'
import { ArrowUpRight, FileText, ListChecks } from 'lucide-react'
import type { Message } from '../../core/domain/types'
import { Button } from '../ds/Button'
import { Mascot } from '../ds/Mascot'

/** "10:41" — 24h clock, the way the design prints message times. */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** Thread column: 680px, centred (shrinks with the window). */
const col = 'w-[680px] max-w-[calc(100%-48px)]'

/** pen `User Message` (p7b22O): right-aligned app-grey bubble, radius 16 16 4 16. */
function UserMessage({ message }: { message: Message }) {
  return (
    <div className={`${col} flex justify-end`}>
      <div className="max-w-[444px] rounded-[16px_16px_4px_16px] bg-app px-[12px] py-[8px]">
        <p className="m-0 text-[13.5px] leading-[1.55] whitespace-pre-wrap text-ink">{message.content}</p>
      </div>
    </div>
  )
}

/** pen `Agent Message` (gkzJ4): 24px mascot · name/role/time · body 13.5/1.55 ink-2. */
function AgentMessage({ message }: { message: Message }) {
  const { author } = message
  return (
    <div className={`${col} flex gap-[10px]`}>
      <Mascot size={24} radius={7} area={author.area ?? 'brand'} />
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <div className="flex items-center gap-[8px]">
          <span className="text-[12.5px] font-semibold text-ink">{author.name}</span>
          {author.role && <span className="text-[11.5px] text-muted">{author.role}</span>}
          <time dateTime={message.createdAt} className="text-[11.5px] text-faint">
            {formatTime(message.createdAt)}
          </time>
        </div>
        <p className="m-0 text-[13.5px] leading-[1.55] whitespace-pre-wrap text-ink-2">{message.content}</p>
      </div>
    </div>
  )
}

/** pen `Event · Mention`: hairlines either side of a mascot + muted caption. */
function EventLine({ message }: { message: Message }) {
  return (
    <div role="note" className={`${col} flex items-center justify-center gap-[8px]`}>
      <div className="h-px flex-1 bg-line-strong" />
      <div className="flex items-center gap-[6px]">
        <Mascot size={16} radius={4.48} area={message.author.area ?? 'brand'} />
        <span className="text-[12px] whitespace-nowrap text-muted">{message.content}</span>
      </div>
      <div className="h-px flex-1 bg-line-strong" />
    </div>
  )
}

/** pen `Attachment · Doc`: 360px card indented under the message body (34px). */
function DocCard({ title, meta }: { title: string; meta: string }) {
  return (
    <div className={`${col} pl-[34px]`}>
      <button
        type="button"
        className="flex w-[360px] max-w-full items-center gap-[12px] rounded-md outline-1 -outline-offset-1 outline-line-strong p-[9px] text-left transition-colors hover:bg-soft"
      >
        <span className="flex size-[36px] shrink-0 items-center justify-center rounded-base outline-1 -outline-offset-1 outline-line-strong bg-soft">
          <FileText size={18} aria-hidden className="text-ink-2" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="truncate text-[12.5px] font-semibold text-ink">{title}</span>
          <span className="truncate text-[12px] text-muted">{meta}</span>
        </span>
        <ArrowUpRight size={16} aria-hidden className="shrink-0 text-muted" />
      </button>
    </div>
  )
}

/** pen `Suggested Actions`: primary (list-checks) + secondary, h-28, indented 34px. */
function SuggestedActions({
  actions,
  onTasksAction,
}: {
  actions: NonNullable<Message['actions']>
  onTasksAction?: () => void
}) {
  return (
    <div className={`${col} flex gap-[8px] pl-[34px]`}>
      {actions.map((a) =>
        a.primary ? (
          <Button key={a.label} height={28} icon={ListChecks} onClick={onTasksAction}>
            {a.label}
          </Button>
        ) : (
          <Button key={a.label} height={28} variant="secondary">
            {a.label}
          </Button>
        ),
      )}
    </div>
  )
}

interface MessageListProps {
  messages: Message[]
  onTasksAction?: () => void
}

/** pen `Thread`: centred column · gap 20 · padding 23 0 13 0. */
export function MessageList({ messages, onTasksAction }: MessageListProps) {
  return (
    <div role="log" aria-label="Messages" className="flex flex-col items-center gap-[20px] pt-[23px] pb-[13px]">
      {messages.map((m) => (
        <Fragment key={m.id}>
          {m.system ? (
            <EventLine message={m} />
          ) : m.author.kind === 'you' ? (
            <UserMessage message={m} />
          ) : (
            <AgentMessage message={m} />
          )}
          {m.attachment && <DocCard {...m.attachment} />}
          {m.actions && m.actions.length > 0 && (
            <SuggestedActions actions={m.actions} onTasksAction={onTasksAction} />
          )}
        </Fragment>
      ))}
    </div>
  )
}
