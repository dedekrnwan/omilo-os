import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  Archive,
  ChartLine,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Ellipsis,
  FileText,
  FolderOpen,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  Target,
  Workflow,
} from 'lucide-react'
import type { Channel, Session } from '../../core/domain/types'
import { useChannelFolders, useChannelGoals, useChannelSessions, useChannels } from '../../app/queries'
import { useChatStore } from '../../app/store'
import { Button } from '../../ui/ds/Button'
import { accents } from '../../ui/ds/accents'
import { ChatRow, FolderRow, GroupLabel, NavGroup, NavLink, SidebarFrame } from '../../ui/ds/Sidebar'
import { CreateChannelDialog } from './CreateChannelDialog'
import { ARCHIVED_COUNT, DEFAULT_OPEN_FOLDERS, SIDEBAR_GOAL_COUNT } from './data'

/** Minimal create-folder dialog (local only). */
function CreateFolderDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; onConfirm: (name: string) => void }) {
  const [name, setName] = useState('')
  function submit() {
    const trimmed = name.trim()
    if (trimmed) { onConfirm(trimmed); setName(''); onOpenChange(false) }
  }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0C0A0926]" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 flex w-[360px] -translate-x-1/2 -translate-y-1/2 flex-col gap-[16px] rounded-lg bg-surface p-[24px] outline-1 -outline-offset-1 outline-line-strong shadow-[0_12px_32px_#0C0A0924] focus:outline-none"
        >
          <Dialog.Title className="m-0 text-[16px] font-semibold text-ink">New folder</Dialog.Title>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onOpenChange(false) }}
            placeholder="Folder name"
            aria-label="Folder name"
            className="h-[36px] w-full rounded-base bg-surface px-[9px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong"
          />
          <div className="flex justify-end gap-[8px]">
            <Button variant="secondary" style={{ height: 32 }} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" style={{ height: 32 }} onClick={submit}>Create</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Chats listed under an open folder before "Show N more". */
const FOLDER_PREVIEW = 3

export type ChannelNav = 'Chats' | 'Goals' | 'Flows' | 'Docs' | 'Analytics' | 'Archived'

function channelSidebarMeta(c: Channel) {
  return c.isDefault ? 'Default channel · Chief' : `Channel · Chief + ${c.agentCount} agents`
}

function channelPopoverMeta(c: Channel) {
  return c.isDefault ? 'Default · Chief' : `Chief + ${c.agentCount} agents · ${c.chatCount} chats`
}

/** Coloured square with the channel glyph (24px in the switcher, 26px in the popover). */
export function ChannelIcon({ channel, size }: { channel: Channel; size: 24 | 26 }) {
  const a = accents[channel.accent]
  const Icon = a.icon
  return (
    <span
      aria-hidden
      data-testid="channel-icon"
      className="flex shrink-0 items-center justify-center text-white"
      style={{ width: size, height: size, borderRadius: size === 24 ? 6 : 7, background: a.color }}
    >
      <Icon size={size === 24 ? 13 : 14} />
    </span>
  )
}

// ── Channel popover (pen `Channel Popover` fac5P) ─────────────────────────────

function ChannelPopover({
  channels,
  activeId,
  onSelect,
  onClose,
  onCreateChannel,
  onManageChannels,
}: {
  channels: Channel[]
  activeId: string
  onSelect: (id: string) => void
  onClose: () => void
  onCreateChannel: () => void
  onManageChannels: () => void
}) {
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const filtered = channels.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Channel switcher"
      className="absolute top-[54px] left-[8px] z-40 flex w-[280px] flex-col gap-[2px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[6px] shadow-[0_12px_32px_#0C0A0924]"
    >
      <label className="flex items-center gap-[8px] shadow-[inset_0_-1px_0_var(--color-line)] px-[7px] py-[8px]">
        <Search size={14} aria-hidden className="text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a channel…"
          aria-label="Find a channel"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
        />
      </label>
      <div className="px-[7px] pt-[7px] pb-[4px]">
        <span className="text-[11px] font-medium tracking-[1px] text-faint">YOUR CHANNELS</span>
      </div>
      {filtered.map((c) => {
        const selected = c.id === activeId
        return (
          <button
            key={c.id}
            type="button"
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelect(c.id)}
            className={`flex w-full items-center gap-[10px] rounded-base px-[8px] py-[7px] text-left transition-colors ${
              selected ? 'bg-hover' : 'hover:bg-hover'
            }`}
          >
            <ChannelIcon channel={c} size={26} />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="text-[12.5px] font-medium text-ink">{c.name}</span>
              <span className="text-[11.5px] text-muted">{channelPopoverMeta(c)}</span>
            </span>
            {selected && <Check size={15} aria-hidden className="text-ink" />}
          </button>
        )
      })}
      <div className="h-px w-full bg-line-strong" />
      <button
        type="button"
        onClick={() => { onClose(); onCreateChannel() }}
        className="flex w-full items-center gap-[10px] rounded-base px-[7px] py-[8px] text-left transition-colors hover:bg-hover"
      >
        <Plus size={15} aria-hidden className="text-ink-2" />
        <span className="text-[12.5px] text-ink-2">Create channel</span>
      </button>
      <button
        type="button"
        onClick={onManageChannels}
        className="flex w-full items-center gap-[10px] rounded-base px-[7px] py-[8px] text-left transition-colors hover:bg-hover"
      >
        <Settings2 size={15} aria-hidden className="text-ink-2" />
        <span className="text-[12.5px] text-ink-2">Manage channels</span>
      </button>
    </div>
  )
}

/**
 * pen `Folder Row` (s0CjkQ) in its selected state (Chat · Folder): hover fill,
 * open chevron/icon in ink, label 500, count swapped for the ⋯ "More" icon.
 */
function ActiveFolderRow({ name, onToggle }: { name: string; onToggle: () => void }) {
  return (
    <div
      aria-current="page"
      className="flex h-[28px] w-full items-center gap-[6px] rounded-sm bg-hover pr-[8px] pl-[6px]"
    >
      <button
        type="button"
        aria-expanded
        aria-label={`Collapse ${name}`}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-[6px] text-left"
      >
        <ChevronDown size={12} aria-hidden className="text-faint" />
        <FolderOpen size={15} aria-hidden className="text-ink" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{name}</span>
      </button>
      <button type="button" aria-label={`${name} options`} className="text-muted hover:text-ink">
        <Ellipsis size={14} aria-hidden />
      </button>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface ChannelSidebarProps {
  channelId: string
  sessionId?: string
  /** Folder whose page is open (/chat/$channelId/folder/$folderId) — its row is highlighted. */
  folderId?: string
  /** Which top nav item is active. Defaults to 'Chats' when sessionId is set, else none. */
  activeNav?: ChannelNav
}

/** pen `Chat Sidebar` (XKoGs). */
export function ChannelSidebar({ channelId, sessionId, folderId, activeNav }: ChannelSidebarProps) {
  const navigate = useNavigate()
  // `?state=switcher` / `?state=create-channel` open those states (design screenshots)
  const { state } = useSearch({ strict: false }) as { state?: string }
  const { data: channels = [] } = useChannels()
  const { data: folders = [] } = useChannelFolders(channelId)
  const { data: sessions = [] } = useChannelSessions(channelId)
  const { data: goals = [] } = useChannelGoals(channelId)
  const [popoverOpen, setPopoverOpen] = useState(state === 'switcher')
  const [createChannelOpen, setCreateChannelOpen] = useState(state === 'create-channel')
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const { createFolder } = useChatStore()
  const channel = channels.find((c) => c.id === channelId)
  const activeSession = sessions.find((s) => s.id === sessionId)

  const byFolder = useMemo(() => {
    const map: Record<string, Session[]> = {}
    for (const s of sessions) if (s.folderId) (map[s.folderId] ??= []).push(s)
    return map
  }, [sessions])
  const recent = sessions.filter((s) => !s.folderId)

  const isOpen = (id: string) =>
    toggled[id] ?? (activeSession?.folderId === id || folderId === id || DEFAULT_OPEN_FOLDERS.has(id))

  function openSession(id: string) {
    void navigate({ to: '/chat/$channelId/$sessionId', params: { channelId, sessionId: id } })
  }

  function navTo(nav: ChannelNav) {
    if (nav === 'Chats') {
      void navigate({ to: '/chat/$channelId', params: { channelId } })
    } else if (nav === 'Goals') {
      void navigate({ to: '/chat/$channelId/goals', params: { channelId } })
    } else if (nav === 'Flows') {
      void navigate({ to: '/chat/$channelId/flows', params: { channelId } })
    } else if (nav === 'Docs') {
      void navigate({ to: '/chat/$channelId/docs', params: { channelId } })
    } else if (nav === 'Analytics') {
      void navigate({ to: '/chat/$channelId/analytics', params: { channelId } })
    } else if (nav === 'Archived') {
      void navigate({ to: '/chat/$channelId/archived', params: { channelId } })
    }
  }

  function openFolder(folderId: string) {
    void navigate({ to: '/chat/$channelId/folder/$folderId', params: { channelId, folderId } })
  }

  function selectChannel(id: string) {
    setPopoverOpen(false)
    setToggled({})
    void navigate({ to: '/chat/$channelId', params: { channelId: id } })
  }

  return (
    <SidebarFrame label="Channels">
      {/* Channel switcher */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-label={channel ? `Switch channel — ${channel.name}` : 'Switch channel'}
        onClick={() => setPopoverOpen((v) => !v)}
        className="flex w-full items-center gap-[8px] rounded-base px-[8px] py-[6px] text-left transition-colors hover:bg-hover"
      >
        {channel && <ChannelIcon channel={channel} size={24} />}
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[13.5px] font-semibold text-ink">{channel?.name ?? ' '}</span>
          <span className="truncate text-[11.5px] text-muted">{channel ? channelSidebarMeta(channel) : ' '}</span>
        </span>
        <ChevronsUpDown size={14} aria-hidden className="text-faint" />
      </button>

      {popoverOpen && (
        <ChannelPopover
          channels={channels}
          activeId={channelId}
          onSelect={selectChannel}
          onClose={() => setPopoverOpen(false)}
          onCreateChannel={() => setCreateChannelOpen(true)}
          onManageChannels={() => {
            setPopoverOpen(false)
            void navigate({ to: '/control-panel/$section', params: { section: 'channels' } })
          }}
        />
      )}

      <Button
        icon={Plus}
        className="w-full"
        onClick={() => void navigate({ to: '/chat/$channelId', params: { channelId } })}
      >
        New chat
      </Button>

      <NavGroup>
        <NavLink
          icon={MessageSquare}
          label="Chats"
          active={activeNav === 'Chats' || (activeNav === undefined && Boolean(sessionId))}
          onClick={() => navTo('Chats')}
        />
        <NavLink
          icon={Target}
          label="Goals"
          count={(SIDEBAR_GOAL_COUNT[channelId] ?? goals.length) || undefined}
          active={activeNav === 'Goals'}
          onClick={() => navTo('Goals')}
        />
        <NavLink
          icon={Workflow}
          label="Flows"
          active={activeNav === 'Flows'}
          onClick={() => navTo('Flows')}
        />
        <NavLink
          icon={FileText}
          label="Docs"
          active={activeNav === 'Docs'}
          onClick={() => navTo('Docs')}
        />
        <NavLink
          icon={ChartLine}
          label="Analytics"
          active={activeNav === 'Analytics'}
          onClick={() => navTo('Analytics')}
        />
      </NavGroup>

      {/* Folders + Recent scroll together when the window is short */}
      <div className="-mx-[8px] flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto px-[8px]">
        <NavGroup>
          <GroupLabel label="FOLDERS" action={{ label: 'New folder', onClick: () => setCreateFolderOpen(true) }} />
          {folders.map((f) => {
            const open = isOpen(f.id)
            const chats = byFolder[f.id] ?? []
            const showAll = expanded[f.id]
            const shown = showAll ? chats : chats.slice(0, FOLDER_PREVIEW)
            const more = f.count - shown.length
            return (
              <div key={f.id} className="flex flex-col gap-px">
                {f.id === folderId ? (
                  <ActiveFolderRow
                    name={f.name}
                    onToggle={() => setToggled((t) => ({ ...t, [f.id]: !open }))}
                  />
                ) : (
                  <FolderRow
                    name={f.name}
                    count={f.count}
                    open={open}
                    onToggle={() => {
                      setToggled((t) => ({ ...t, [f.id]: !open }))
                      // Navigate to folder view when opening a folder row
                      if (!open) openFolder(f.id)
                    }}
                  />
                )}
                {open && (
                  <div className="pb-[2px] pl-[20px]">
                    <div className="flex flex-col gap-px shadow-[inset_1px_0_0_var(--color-line-strong)] pl-[6px]">
                      {shown.map((s) => (
                        <ChatRow
                          key={s.id}
                          title={s.title}
                          time={s.updated}
                          unread={s.unread}
                          active={s.id === sessionId}
                          onClick={() => openSession(s.id)}
                        />
                      ))}
                      {!showAll && more > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpanded((e) => ({ ...e, [f.id]: true }))}
                          className="px-[8px] py-[5px] text-left text-[12px] text-muted hover:text-ink-2"
                        >
                          Show {more} more
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </NavGroup>

        <NavGroup>
          <GroupLabel label="RECENT" />
          {recent.map((s) => (
            <ChatRow
              key={s.id}
              title={s.title}
              time={s.updated}
              unread={s.unread}
              active={s.id === sessionId}
              onClick={() => openSession(s.id)}
            />
          ))}
        </NavGroup>
      </div>

      <NavLink
        icon={Archive}
        label="Archived"
        count={ARCHIVED_COUNT}
        labelClassName="text-muted"
        active={activeNav === 'Archived'}
        onClick={() => navTo('Archived')}
      />

      <CreateChannelDialog
        open={createChannelOpen}
        onOpenChange={setCreateChannelOpen}
      />

      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        onConfirm={(name) => {
          createFolder(channelId, name)
        }}
      />
    </SidebarFrame>
  )
}
