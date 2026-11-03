import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  Archive,
  CalendarSync,
  ChevronsDownUp,
  ChevronsUpDown as ExpandIcon,
  FolderInput,
  FolderOpen,
  Link,
  Palette,
  Pencil,
  Pin,
  PinOff,
  SquarePen,
  Trash2,
  ChartLine,
  Check,
  ChevronDown,
  ChevronsUpDown,
  FileText,
  Inbox,
  Layers,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  Target,
  Workflow,
} from 'lucide-react'
import type { Channel, Session } from '../../core/domain/types'
import type { Mode } from '../../app/store'
import { useUIStore } from '../../app/store'
import {
  useAreas,
  useCreateFolder,
  useDeleteFolder,
  useDeleteSession,
  useFolders,
  useGoals,
  useSessions,
  useUpdateFolder,
  useUpdateSession,
} from '../../app/queries'
import { AreaBadgeButton, AreaTile, FolderIconButton } from './LookControls'
import { ChatRow, FolderRow, GroupLabel, NavGroup, NavLink, SidebarFrame } from '../../ui/ds/Sidebar'
import { ContextMenuArea, MoreMenu, copyText } from '../../ui/ds/ItemMenu'
import type { MenuEntries } from '../../ui/ds/ItemMenu'
import { notify } from '../../ui/ds/Toaster'
import { CreateChannelDialog } from '../chat/CreateChannelDialog'
import { CreateFolderDialog } from './CreateFolderDialog'

/** Chats listed under an open folder before "Show N more". */
const FOLDER_PREVIEW = 3

export type AppNav = 'Primary' | 'Goals' | 'Flows' | 'Routines' | 'Docs' | 'Analytics' | 'Archived'

function areaSwitcherMeta(c: Channel) {
  return c.isDefault ? 'Default area · Chief' : `Area · Chief + ${c.agentCount} agents`
}
function areaPopoverMeta(c: Channel) {
  return c.isDefault ? 'Default · Chief' : `Chief + ${c.agentCount} agents · ${c.chatCount} chats`
}

/** Coloured square with the area glyph (24px in the switcher, 26px in the popover). */
export function AreaIcon({ channel, size }: { channel: Channel; size: 24 | 26 }) {
  return <AreaTile area={channel} size={size} aria-hidden />
}

/** Neutral glyph for the "All areas" row. */
function AllAreasIcon({ size }: { size: 24 | 26 }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center bg-wire-strong text-ink-2"
      style={{ width: size, height: size, borderRadius: size === 24 ? 6 : 7 }}
    >
      <Layers size={size === 24 ? 13 : 14} />
    </span>
  )
}

/** Area switcher popover — "All areas" + one row per area. */
function AreaPopover({
  areas,
  activeId,
  onSelect,
  onClose,
  onCreate,
  onManage,
}: {
  areas: Channel[]
  activeId: string | null
  onSelect: (id: string | null) => void
  onClose: () => void
  onCreate: () => void
  onManage: () => void
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

  const filtered = areas.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
  const showAllAreas = 'all areas'.includes(query.trim().toLowerCase())

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Area switcher"
      className="absolute top-[54px] left-[8px] z-40 flex w-[280px] flex-col gap-[2px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[6px] shadow-[0_12px_32px_#0C0A0924]"
    >
      <label className="flex items-center gap-[8px] shadow-[inset_0_-1px_0_var(--color-line)] px-[7px] py-[8px]">
        <Search size={14} aria-hidden className="text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an area…"
          aria-label="Find an area"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
        />
      </label>
      <div className="px-[7px] pt-[7px] pb-[4px]">
        <span className="text-[11px] font-medium tracking-[1px] text-faint">YOUR AREAS</span>
      </div>
      {showAllAreas && (
        <button
          type="button"
          aria-current={activeId === null ? 'true' : undefined}
          onClick={() => onSelect(null)}
          className={`flex w-full items-center gap-[10px] rounded-base px-[8px] py-[7px] text-left transition-colors hover:bg-hover ${
            activeId === null ? 'bg-hover' : ''
          }`}
        >
          <AllAreasIcon size={26} />
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="text-[12.5px] font-medium text-ink">All areas</span>
            <span className="text-[11.5px] text-muted">Everything across the company</span>
          </span>
          {activeId === null && <Check size={15} aria-hidden className="text-ink" />}
        </button>
      )}
      {filtered.map((c) => {
        const selected = c.id === activeId
        return (
          <button
            key={c.id}
            type="button"
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelect(c.id)}
            className={`flex w-full items-center gap-[10px] rounded-base px-[8px] py-[7px] text-left transition-colors hover:bg-hover ${
              selected ? 'bg-hover' : ''
            }`}
          >
            <AreaIcon channel={c} size={26} />
            <span className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="text-[12.5px] font-medium text-ink">{c.name}</span>
              <span className="text-[11.5px] text-muted">{areaPopoverMeta(c)}</span>
            </span>
            {selected && <Check size={15} aria-hidden className="text-ink" />}
          </button>
        )
      })}
      <div className="h-px w-full bg-line-strong" />
      <button
        type="button"
        onClick={() => { onClose(); onCreate() }}
        className="flex w-full items-center gap-[10px] rounded-base px-[7px] py-[8px] text-left transition-colors hover:bg-hover"
      >
        <Plus size={15} aria-hidden className="text-ink-2" />
        <span className="text-[12.5px] text-ink-2">Create area</span>
      </button>
      <button
        type="button"
        onClick={onManage}
        className="flex w-full items-center gap-[10px] rounded-base px-[7px] py-[8px] text-left transition-colors hover:bg-hover"
      >
        <Settings2 size={15} aria-hidden className="text-ink-2" />
        <span className="text-[12.5px] text-ink-2">Manage areas</span>
      </button>
    </div>
  )
}

/** Folder row in its active/open state (its page is open). */
function ActiveFolderRow({
  folder,
  onToggle,
  menu,
  pickerOpen,
  onPickerOpenChange,
}: {
  folder: { id: string; name: string }
  onToggle: () => void
  menu: MenuEntries
  pickerOpen: boolean
  onPickerOpenChange: (open: boolean) => void
}) {
  const name = folder.name
  return (
    <ContextMenuArea items={menu} label={`${name} actions`}>
      <div aria-current="page" className="flex h-[28px] w-full items-center gap-[6px] rounded-sm bg-hover pr-[6px] pl-[6px]">
        <button
          type="button"
          aria-expanded
          aria-label={`Collapse ${name}`}
          onClick={onToggle}
          className="flex items-center"
        >
          <ChevronDown size={12} aria-hidden className="text-faint" />
        </button>
        <FolderIconButton folder={folder} open active pickerOpen={pickerOpen} onPickerOpenChange={onPickerOpenChange} />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center text-left"
        >
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{name}</span>
        </button>
        <MoreMenu items={menu} label={`${name} options`} size={20} />
      </div>
    </ContextMenuArea>
  )
}

interface AppSidebarProps {
  mode: Mode
  /** Session open in the main pane (highlights its row). */
  sessionId?: string
  /** Folder whose page is open (highlights its row). */
  folderId?: string
  /** Which top nav item is active. */
  activeNav?: AppNav
}

/**
 * Unified sidebar for both modes. Identical skeleton — Area switcher on top,
 * a mode-specific primary entry (Chats vs Inbox), the shared platform nav,
 * Folders, Recents, Archived. The Area filter lives in the shared UI store.
 */
export function AppSidebar({ mode, sessionId, folderId, activeNav }: AppSidebarProps) {
  const navigate = useNavigate()
  const { state } = useSearch({ strict: false }) as { state?: string }
  const { areaId, setArea } = useUIStore()
  const { data: areas = [] } = useAreas()
  const { data: baseFolders = [] } = useFolders(areaId)
  const { data: baseSessions = [] } = useSessions(areaId)
  const { data: goals = [] } = useGoals(areaId)
  const updateSession = useUpdateSession()
  const deleteSession = useDeleteSession()
  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()
  const deleteFolder = useDeleteFolder()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [chatQuery, setChatQuery] = useState('')
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null)
  const [areaPickerOpen, setAreaPickerOpen] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(state === 'switcher')
  const [createAreaOpen, setCreateAreaOpen] = useState(state === 'create-channel')
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const isChat = mode === 'chat'
  const area = areaId ? areas.find((c) => c.id === areaId) : undefined
  // Rename / move / pin / archive / delete persist through the API (optimistic).
  const folders = baseFolders
  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders])
  const sessions = useMemo(
    () =>
      baseSessions.map((x) => ({
        ...x,
        folderId: x.folderId && folderIds.has(x.folderId) ? x.folderId : undefined,
        pinned: Boolean(x.pinned),
      })),
    [baseSessions, folderIds],
  )
  const patchSession = (id: string, input: Parameters<typeof updateSession.mutate>[0]['input']) =>
    updateSession.mutate({ id, input }, { onError: () => notify('Couldn’t save that change — try again') })

  const byFolder = useMemo(() => {
    const map: Record<string, Session[]> = {}
    for (const s of sessions) if (s.folderId && !s.pinned) (map[s.folderId] ??= []).push(s)
    return map
  }, [sessions])
  const activeSession = sessions.find((s) => s.id === sessionId)
  // Inline chat filter (the composer search row). Matches a chat's title or any
  // helper in it; when active, folders with no match are hidden and opened.
  const chatQ = chatQuery.trim().toLowerCase()
  const matchesQuery = (s: Session) =>
    !chatQ ||
    s.title.toLowerCase().includes(chatQ) ||
    (s.participants ?? []).some((p) => p.name.toLowerCase().includes(chatQ))
  const pinned = sessions.filter((s) => s.pinned && matchesQuery(s))
  const recent = sessions.filter((s) => !s.folderId && !s.pinned && matchesQuery(s))

  function chatMenu(s: Session & { pinned?: boolean }): MenuEntries {
    const moveTargets = folders.filter((f) => f.id !== s.folderId)
    return [
      { label: 'Open', icon: MessageSquare, onSelect: () => openSession(s.id) },
      { type: 'separator' },
      { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(s.id) },
      s.pinned
        ? { label: 'Unpin', icon: PinOff, onSelect: () => patchSession(s.id, { pinned: false }) }
        : { label: 'Pin to top', icon: Pin, onSelect: () => patchSession(s.id, { pinned: true }) },
      {
        type: 'sub',
        label: 'Move to folder',
        icon: FolderInput,
        items: [
          ...moveTargets.map((f) => ({
            label: f.name,
            icon: FolderOpen,
            onSelect: () => {
              patchSession(s.id, { folderId: f.id })
              notify(`Moved to ${f.name}`, () => patchSession(s.id, { folderId: s.folderId ?? null }))
            },
          })),
          s.folderId ? { type: 'separator' as const } : null,
          s.folderId ? { label: 'Remove from folder', onSelect: () => patchSession(s.id, { folderId: null }) } : null,
          moveTargets.length === 0 && !s.folderId ? { label: 'No folders yet', disabled: true, onSelect: () => {} } : null,
        ],
      },
      { label: 'Copy link', icon: Link, onSelect: () => { copyText(`${location.origin}/chat/${s.id}`); notify('Link copied') } },
      { type: 'separator' },
      {
        label: 'Archive',
        icon: Archive,
        onSelect: () => {
          patchSession(s.id, { archived: true })
          if (s.id === sessionId) void navigate({ to: '/chat' })
          notify('Chat archived', () => patchSession(s.id, { archived: false }))
        },
      },
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onSelect: () => {
          deleteSession.mutate(s.id, { onError: () => notify('Couldn’t delete the chat — try again') })
          if (s.id === sessionId) void navigate({ to: '/chat' })
          notify('Chat deleted')
        },
      },
    ]
  }

  function folderMenu(f: { id: string; name: string }, open: boolean): MenuEntries {
    return [
      { label: 'Open folder', icon: FolderOpen, onSelect: () => openFolder(f.id) },
      { label: 'New chat here', icon: SquarePen, onSelect: () => void navigate({ to: '/chat', search: { folder: f.id } } as never) },
      { type: 'separator' },
      { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(f.id) },
      { label: 'Change icon…', icon: Palette, onSelect: () => setTimeout(() => setIconPickerFor(f.id), 0) },
      open
        ? { label: 'Collapse', icon: ChevronsDownUp, onSelect: () => setToggled((t) => ({ ...t, [f.id]: false })) }
        : { label: 'Expand', icon: ExpandIcon, onSelect: () => setToggled((t) => ({ ...t, [f.id]: true })) },
      { label: 'Copy link', icon: Link, onSelect: () => { copyText(`${location.origin}/folder/${f.id}`); notify('Link copied') } },
      { type: 'separator' },
      {
        label: 'Delete folder',
        icon: Trash2,
        danger: true,
        onSelect: () => {
          deleteFolder.mutate(f.id, { onError: () => notify('Couldn’t delete the folder — try again') })
          if (f.id === folderId) void navigate({ to: '/chat' })
          notify(`Folder deleted — its chats moved to Recent`)
        },
      },
    ]
  }

  const areaMenu: MenuEntries = area
    ? [
        { label: 'Change icon…', icon: Palette, onSelect: () => setTimeout(() => setAreaPickerOpen(true), 0) },
        { label: 'New chat in this area', icon: SquarePen, onSelect: () => void navigate({ to: '/chat' }) },
        { label: 'Area settings', icon: Settings2, onSelect: () => void navigate({ to: '/control-panel/$section', params: { section: 'channels' } }) },
        { type: 'separator' },
        { label: 'Show all areas', icon: Layers, onSelect: () => setArea(null) },
      ]
    : [{ label: 'Manage areas', icon: Settings2, onSelect: () => void navigate({ to: '/control-panel/$section', params: { section: 'channels' } }) }]

  function renameChat(id: string, next: string | null) {
    setRenaming(null)
    if (next) patchSession(id, { title: next })
  }
  function renameFolder(id: string, next: string | null) {
    setRenaming(null)
    if (next) updateFolder.mutate({ id, input: { name: next } }, { onError: () => notify('Couldn’t rename the folder — try again') })
  }

  function row(s: Session & { pinned?: boolean }) {
    return (
      <ChatRow
        key={s.id}
        title={s.title}
        time={s.updated}
        unread={s.unread}
        pinned={s.pinned}
        active={s.id === sessionId}
        onClick={() => openSession(s.id)}
        menu={chatMenu(s)}
        renaming={renaming === s.id}
        onRename={(v) => renameChat(s.id, v)}
        participants={s.participants}
      />
    )
  }

  const isOpen = (id: string) =>
    toggled[id] ?? (activeSession?.folderId === id || folderId === id)

  // ── Navigation (mode-neutral; mode lives in the store, not the URL) ──
  function openSession(id: string) {
    void navigate({ to: '/chat/$sessionId', params: { sessionId: id } })
  }
  function openFolder(id: string) {
    void navigate({ to: '/folder/$folderId', params: { folderId: id } })
  }
  function navTo(nav: AppNav) {
    switch (nav) {
      case 'Primary': return void navigate({ to: isChat ? '/chat' : '/inbox' })
      case 'Goals': return void navigate({ to: '/goals' })
      case 'Flows': return void navigate({ to: '/flows' })
      case 'Routines': return void navigate({ to: '/routines' })
      case 'Docs': return void navigate({ to: '/docs' })
      case 'Analytics': return void navigate({ to: '/analytics' })
      case 'Archived': return void navigate({ to: '/archived' })
    }
  }

  const goalCount = goals.length || undefined

  return (
    <SidebarFrame label={isChat ? 'Chat' : 'Office'}>
      {/* Area switcher — the icon badge is its own control (opens the icon picker) */}
      <ContextMenuArea items={areaMenu} label="Area actions">
      <div className="flex w-full items-center gap-[8px] rounded-base px-[8px] py-[6px] transition-colors hover:bg-hover data-[state=open]:bg-hover">
        {area ? <AreaBadgeButton area={area} size={24} open={areaPickerOpen} onOpenChange={setAreaPickerOpen} /> : <AllAreasIcon size={24} />}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={popoverOpen}
          aria-label={area ? `Switch area — ${area.name}` : 'Switch area — All areas'}
          onClick={() => setPopoverOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-[8px] text-left outline-none"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="truncate text-[13.5px] font-semibold text-ink">{area?.name ?? 'All areas'}</span>
            <span className="truncate text-[11.5px] text-muted">
              {area ? areaSwitcherMeta(area) : 'Everything across the company'}
            </span>
          </span>
          <ChevronsUpDown size={14} aria-hidden className="text-faint" />
        </button>
      </div>
      </ContextMenuArea>

      {popoverOpen && (
        <AreaPopover
          areas={areas}
          activeId={areaId}
          onSelect={(id) => {
            setArea(id)
            setPopoverOpen(false)
            setToggled({})
          }}
          onClose={() => setPopoverOpen(false)}
          onCreate={() => setCreateAreaOpen(true)}
          onManage={() => {
            setPopoverOpen(false)
            void navigate({ to: '/control-panel/$section', params: { section: 'channels' } })
          }}
        />
      )}

      {isChat && (
        <label className="flex h-[30px] w-full items-center gap-[6px] rounded-btn bg-surface px-[8px] outline-1 -outline-offset-1 outline-line-strong focus-within:outline-ink">
          <Search size={14} aria-hidden className="shrink-0 text-faint" />
          <input
            type="text"
            value={chatQuery}
            onChange={(e) => setChatQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink placeholder:text-muted focus:outline-none"
          />
        </label>
      )}

      <NavGroup>
        {isChat ? (
          <NavLink
            icon={MessageSquare}
            label="Chats"
            active={activeNav === 'Primary' || (activeNav === undefined && Boolean(sessionId))}
            onClick={() => navTo('Primary')}
          />
        ) : (
          <NavLink
            icon={Inbox}
            label="Inbox"
            active={activeNav === 'Primary'}
            onClick={() => navTo('Primary')}
          />
        )}
        <NavLink icon={Target} label="Goals" count={goalCount} active={activeNav === 'Goals'} onClick={() => navTo('Goals')} />
        <NavLink icon={Workflow} label="Flows" active={activeNav === 'Flows'} onClick={() => navTo('Flows')} />
        <NavLink icon={CalendarSync} label="Routines" active={activeNav === 'Routines'} onClick={() => navTo('Routines')} />
        <NavLink icon={FileText} label="Docs" active={activeNav === 'Docs'} onClick={() => navTo('Docs')} />
        <NavLink icon={ChartLine} label="Analytics" active={activeNav === 'Analytics'} onClick={() => navTo('Analytics')} />
      </NavGroup>

      {/* Folders + Recent scroll together when the window is short */}
      <div className="-mx-[8px] flex min-h-0 flex-1 flex-col gap-[12px] overflow-y-auto px-[8px]">
        {pinned.length > 0 && (
          <NavGroup>
            <GroupLabel label="PINNED" />
            {pinned.map((s) => row(s))}
          </NavGroup>
        )}

        <NavGroup>
          <GroupLabel label="FOLDERS" action={{ label: 'New folder', onClick: () => setCreateFolderOpen(true) }} />
          {folders.map((f) => {
            const chats = (byFolder[f.id] ?? []).filter(matchesQuery)
            // While searching: hide folders with no hit, and open the rest so the matches show.
            if (chatQ && chats.length === 0) return null
            const open = chatQ ? true : isOpen(f.id)
            const showAll = expanded[f.id] || Boolean(chatQ)
            const shown = showAll ? chats : chats.slice(0, FOLDER_PREVIEW)
            const more = chatQ ? 0 : Math.max(f.count, chats.length) - shown.length
            return (
              <div key={f.id} className="flex flex-col gap-px">
                {f.id === folderId ? (
                  <ActiveFolderRow
                    folder={f}
                    menu={folderMenu(f, open)}
                    pickerOpen={iconPickerFor === f.id}
                    onPickerOpenChange={(o) => setIconPickerFor(o ? f.id : null)}
                    onToggle={() => setToggled((t) => ({ ...t, [f.id]: !open }))}
                  />
                ) : (
                  <FolderRow
                    name={f.name}
                    count={f.count}
                    open={open}
                    iconSlot={
                      <FolderIconButton
                        folder={f}
                        open={open}
                        pickerOpen={iconPickerFor === f.id}
                        onPickerOpenChange={(o) => setIconPickerFor(o ? f.id : null)}
                      />
                    }
                    menu={folderMenu(f, open)}
                    renaming={renaming === f.id}
                    onRename={(v) => renameFolder(f.id, v)}
                    onToggle={() => {
                      setToggled((t) => ({ ...t, [f.id]: !open }))
                      if (!open) openFolder(f.id)
                    }}
                  />
                )}
                {open && (
                  <div className="pb-[2px] pl-[20px]">
                    <div className="flex flex-col gap-px shadow-[inset_1px_0_0_var(--color-line-strong)] pl-[6px]">
                      {shown.map((s) => row(s))}
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
          {recent.map((s) => row(s))}
        </NavGroup>
      </div>

      <NavLink
        icon={Archive}
        label="Archived"
        labelClassName="text-muted"
        active={activeNav === 'Archived'}
        onClick={() => navTo('Archived')}
      />

      <CreateChannelDialog open={createAreaOpen} onOpenChange={setCreateAreaOpen} />
      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        onConfirm={(name) => {
          // "All areas" files new folders under the default area.
          const channelId = areaId ?? areas.find((a) => a.isDefault)?.id ?? areas[0]?.id
          if (!channelId) return
          createFolder.mutate(
            { channelId, name },
            {
              onSuccess: (f) => openFolder(f.id),
              onError: () => notify('Couldn’t create the folder — try again'),
            },
          )
        }}
      />
    </SidebarFrame>
  )
}
