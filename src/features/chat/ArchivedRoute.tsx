import { useState } from 'react'
import { notFound, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import * as Dialog from '@radix-ui/react-dialog'
import { Archive, ArchiveRestore, MessageCircle, Search, Trash2, X } from 'lucide-react'
import { useChannel } from '../../app/queries'
import { useChatStore } from '../../app/store'
import { IconButton } from '../../ui/ds/Button'
import { NewChatHero } from './ChatRoute'

// ── Archived chats (pen `Chat · Archived chats` PHRy6 → Drawer xZuqV) ───────

interface ArchivedChat {
  id: string
  title: string
  helper: string
  archivedAt: string
}

const STATIC_ARCHIVED_CHATS: ArchivedChat[] = [
  { id: 'a-1', title: 'Sprint 41 planning',       helper: 'Chief',   archivedAt: 'Sep 30' },
  { id: 'a-2', title: 'Old CI runner migration',  helper: 'Dev',     archivedAt: 'Sep 22' },
  { id: 'a-3', title: 'Logo refresh feedback',    helper: 'Grower',  archivedAt: 'Sep 18' },
  { id: 'a-4', title: 'Q3 hiring plan',           helper: 'Chief',   archivedAt: 'Sep 10' },
  { id: 'a-5', title: 'Status page outage notes', helper: 'Dev',     archivedAt: 'Aug 29' },
  { id: 'a-6', title: 'Vendor invoice dispute',   helper: 'Finance', archivedAt: 'Aug 21' },
]

/** pen Button/Secondary (sqbAw) / Button/Quiet (p38fT): h-28/32 · radius 7 · gap 6 · px 14 · label 13. */
function DrawerButton({
  quiet,
  icon: Icon,
  height = 32,
  children,
  onClick,
  label,
}: {
  quiet?: boolean
  icon?: typeof Archive
  height?: 28 | 32
  children: string
  onClick?: () => void
  label?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{ height }}
      className={`inline-flex shrink-0 items-center justify-center gap-[6px] rounded-btn px-[14px] text-[13px] whitespace-nowrap transition-colors ${
        quiet
          ? 'text-muted hover:bg-hover'
          : 'bg-surface font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft'
      }`}
    >
      {Icon && <Icon size={16} aria-hidden className={quiet ? 'text-muted' : 'text-ink'} />}
      {children}
    </button>
  )
}

/** One archived chat (radius 8 · gap 10 · padding 10/8); hover reveals Restore + Delete. */
function ArchivedChatRow({
  chat,
  highlighted,
  onRestore,
  onDelete,
}: {
  chat: ArchivedChat
  highlighted?: boolean
  onRestore?: () => void
  onDelete?: () => void
}) {
  return (
    <div
      data-highlighted={highlighted || undefined}
      className="group flex min-h-[52px] w-full items-center gap-[10px] rounded-base px-[8px] py-[10px] transition-colors hover:bg-hover data-[highlighted]:bg-hover"
    >
      <MessageCircle size={14} aria-hidden className="shrink-0 text-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[13px] font-medium text-ink">{chat.title}</span>
        <span className="text-[12px] text-muted">
          {chat.helper} · archived {chat.archivedAt}
        </span>
      </div>
      <div className="hidden shrink-0 items-center gap-[10px] group-hover:flex group-data-[highlighted]:flex">
        <DrawerButton icon={ArchiveRestore} height={28} label={`Restore "${chat.title}"`} onClick={onRestore}>
          Restore
        </DrawerButton>
        <IconButton icon={Trash2} aria-label={`Delete "${chat.title}"`} onClick={onDelete} />
      </div>
    </div>
  )
}

/** Right-side drawer listing a channel's archived chats. */
export function ArchivedDrawer({
  channelName,
  open,
  onOpenChange,
  highlightId,
}: {
  channelName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Row shown in its hover state (design reference). */
  highlightId?: string
}) {
  const [query, setQuery] = useState('')
  const { archived, removedStaticIds, restoreSession, deleteArchived, deleteAllArchived } = useChatStore()
  const q = query.trim().toLowerCase()

  // Merge: static list + dynamic store entries. Dynamic ones go at top.
  // Static entries that are in removedStaticIds (restored or deleted) are hidden.
  const dynamicIds = new Set(archived.map(a => a.id))
  const staticChats: ArchivedChat[] = STATIC_ARCHIVED_CHATS.filter(
    c => !dynamicIds.has(c.id) && !removedStaticIds.has(c.id)
  )
  const dynamicChats: ArchivedChat[] = archived.map(a => ({
    id: a.id,
    title: a.title,
    helper: 'Chief',
    archivedAt: a.archivedAt,
  }))
  const allChats = [...dynamicChats, ...staticChats].filter(c => c.title.toLowerCase().includes(q))

  const count = allChats.length

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0C0A0926]" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed top-[8px] right-[8px] bottom-[8px] z-50 flex w-[460px] flex-col overflow-hidden rounded-lg bg-surface shadow-[-8px_0_48px_#1C19173D] outline-1 -outline-offset-1 outline-line-strong focus:outline-none"
        >
          <div className="flex w-full shrink-0 items-center gap-[12px] shadow-[inset_0_-1px_0_var(--color-line)] py-[14px] pr-[12px] pl-[20px]">
            <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line">
              <Archive size={16} aria-hidden className="text-ink-2" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <Dialog.Title className="m-0 text-[16px] font-semibold text-ink">
                Archived · {channelName}
              </Dialog.Title>
              <p className="m-0 text-[12.5px] text-muted">
                {count} chats · helpers don't reply in archived chats
              </p>
            </div>
            <Dialog.Close asChild>
              <IconButton icon={X} aria-label="Close" />
            </Dialog.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto p-[20px]">
            <label className="flex h-[36px] w-full shrink-0 items-center gap-[8px] rounded-base bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong">
              <Search size={16} aria-hidden className="shrink-0 text-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search archived"
                aria-label="Search archived chats"
                className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
              />
            </label>
            <div className="flex flex-col">
              {allChats.map((chat) => (
                <ArchivedChatRow
                  key={chat.id}
                  chat={chat}
                  highlighted={chat.id === highlightId}
                  onRestore={() => {
                    // Dynamic entries: restore to active sessions. Static entries: just hide from archived view.
                    if (dynamicIds.has(chat.id)) restoreSession(chat.id)
                    else deleteArchived(chat.id)
                  }}
                  onDelete={() => deleteArchived(chat.id)}
                />
              ))}
            </div>
            <p className="m-0 text-[12px] text-faint">
              Archived chats are deleted after 180 days unless restored.
            </p>
          </div>

          <div className="flex w-full shrink-0 items-center gap-[8px] shadow-[inset_0_1px_0_var(--color-line)] px-[20px] py-[12px]">
            <DrawerButton quiet icon={Trash2} onClick={() => deleteAllArchived(staticChats.map(c => c.id))}>
              Delete all
            </DrawerButton>
            <div className="h-px flex-1" />
            <Dialog.Close asChild>
              <DrawerButton>Close</DrawerButton>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Route: /chat/$channelId/archived — the new-chat hero with the Archived drawer
 * open over it. Closing the drawer returns to the hero.
 */
export function ArchivedRoute() {
  const params = useParams({ strict: false })
  const channelId = params.channelId ?? 'ch-general'
  const navigate = useNavigate()
  // `?state=hover` shows the hovered-row state from the design reference
  const { state } = useSearch({ strict: false }) as { state?: string }
  const { data: channel, isLoading } = useChannel(channelId)

  if (isLoading) return null
  if (!channel) throw notFound()

  return (
    <>
      <NewChatHero channel={channel} />
      <ArchivedDrawer
        channelName={channel.name}
        open
        highlightId={state === 'hover' ? 'a-2' : undefined}
        onOpenChange={(o) => {
          if (!o) void navigate({ to: '/chat/$channelId', params: { channelId } })
        }}
      />
    </>
  )
}
