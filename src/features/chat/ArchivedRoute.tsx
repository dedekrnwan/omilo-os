import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import * as Dialog from '@radix-ui/react-dialog'
import { Archive, ArchiveRestore, MessageCircle, Search, Trash2, X } from 'lucide-react'
import type { Session } from '../../core/domain/types'
import {
  useArchivedSessions,
  useArea,
  useDeleteArchivedSessions,
  useDeleteSession,
  useUpdateSession,
} from '../../app/queries'
import { useUIStore } from '../../app/store'
import { IconButton } from '../../ui/ds/Button'
import { notify } from '../../ui/ds/Toaster'
import { NewChatHero } from './ChatRoute'

// ── Archived chats (pen `Chat · Archived chats` PHRy6 → Drawer xZuqV) ───────

interface ArchivedChat {
  id: string
  title: string
  helper: string
  archivedAt: string
}

/** "Sep 30" from the archive timestamp (falls back to the activity label). */
function archivedLabel(s: Session): string {
  if (!s.archivedAt) return s.updated
  const d = new Date(s.archivedAt)
  if (Number.isNaN(d.getTime())) return s.updated
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric' })
}

function toArchivedChat(s: Session): ArchivedChat {
  return {
    id: s.id,
    title: s.title,
    helper: s.participants?.find((p) => p.name !== 'Chief')?.name ?? s.participants?.[0]?.name ?? 'Chief',
    archivedAt: archivedLabel(s),
  }
}

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
  areaId = null,
  open,
  onOpenChange,
  highlightFirst = false,
}: {
  channelName: string
  /** Area whose archived chats are listed (null = all areas). */
  areaId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Show the first row in its hover state (design reference). */
  highlightFirst?: boolean
}) {
  const [query, setQuery] = useState('')
  const { data: archived = [], isLoading, isError } = useArchivedSessions(areaId)
  const updateSession = useUpdateSession()
  const deleteSession = useDeleteSession()
  const deleteAll = useDeleteArchivedSessions()
  const q = query.trim().toLowerCase()

  const allChats = archived.map(toArchivedChat).filter((c) => c.title.toLowerCase().includes(q))
  const highlightId = highlightFirst ? allChats[0]?.id : undefined
  const count = archived.length

  function restore(chat: ArchivedChat) {
    updateSession.mutate(
      { id: chat.id, input: { archived: false } },
      {
        onSuccess: () => notify(`“${chat.title}” restored`),
        onError: () => notify('Couldn’t restore the chat — try again'),
      },
    )
  }
  function remove(chat: ArchivedChat) {
    deleteSession.mutate(chat.id, {
      onSuccess: () => notify('Chat deleted'),
      onError: () => notify('Couldn’t delete the chat — try again'),
    })
  }

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
              {isLoading ? (
                <p className="m-0 px-[8px] py-[10px] text-[13px] text-muted">Loading archived chats…</p>
              ) : isError ? (
                <p role="alert" className="m-0 px-[8px] py-[10px] text-[13px] text-bad">Couldn’t load archived chats.</p>
              ) : allChats.length === 0 ? (
                <p className="m-0 px-[8px] py-[10px] text-[13px] text-muted">
                  {q ? 'No archived chats match.' : 'No archived chats.'}
                </p>
              ) : (
                allChats.map((chat) => (
                  <ArchivedChatRow
                    key={chat.id}
                    chat={chat}
                    highlighted={chat.id === highlightId}
                    onRestore={() => restore(chat)}
                    onDelete={() => remove(chat)}
                  />
                ))
              )}
            </div>
            <p className="m-0 text-[12px] text-faint">
              Archived chats are deleted after 180 days unless restored.
            </p>
          </div>

          <div className="flex w-full shrink-0 items-center gap-[8px] shadow-[inset_0_1px_0_var(--color-line)] px-[20px] py-[12px]">
            <DrawerButton
              quiet
              icon={Trash2}
              onClick={() => {
                if (count === 0) return
                deleteAll.mutate(areaId ?? undefined, {
                  onSuccess: (r) => notify(`${r.deleted} archived chat${r.deleted === 1 ? '' : 's'} deleted`),
                  onError: () => notify('Couldn’t delete archived chats — try again'),
                })
              }}
            >
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
  const areaId = useUIStore((s) => s.areaId)
  const navigate = useNavigate()
  // `?state=hover` shows the hovered-row state from the design reference
  const { state } = useSearch({ strict: false }) as { state?: string }
  const { data: channel } = useArea(areaId ?? '')
  const name = areaId ? channel?.name ?? 'All areas' : 'All areas'

  return (
    <>
      <NewChatHero channel={areaId ? channel ?? null : null} />
      <ArchivedDrawer
        channelName={name}
        areaId={areaId}
        open
        highlightFirst={state === 'hover'}
        onOpenChange={(o) => {
          if (!o) void navigate({ to: '/chat' })
        }}
      />
    </>
  )
}
