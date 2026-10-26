import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  Archive,
  CalendarSync,
  ChartLine,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Ellipsis,
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
import { useUIStore, useChatStore } from '../../app/store'
import { useAreas, useFolders, useSessions, useGoals } from '../../app/queries'
import { AreaBadgeButton, AreaTile, FolderIconButton } from './LookControls'
import { Button } from '../../ui/ds/Button'
import { ChatRow, FolderRow, GroupLabel, NavGroup, NavLink, SidebarFrame } from '../../ui/ds/Sidebar'
import { CreateChannelDialog } from '../chat/CreateChannelDialog'
import { CreateFolderDialog } from './CreateFolderDialog'
import { DEFAULT_OPEN_FOLDERS } from '../chat/data'

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
function ActiveFolderRow({ folder, onToggle }: { folder: { id: string; name: string }; onToggle: () => void }) {
  const name = folder.name
  return (
    <div aria-current="page" className="flex h-[28px] w-full items-center gap-[6px] rounded-sm bg-hover pr-[8px] pl-[6px]">
      <button
        type="button"
        aria-expanded
        aria-label={`Collapse ${name}`}
        onClick={onToggle}
        className="flex items-center"
      >
        <ChevronDown size={12} aria-hidden className="text-faint" />
      </button>
      <FolderIconButton folder={folder} open active />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{name}</span>
      </button>
      <button type="button" aria-label={`${name} options`} className="text-muted hover:text-ink">
        <Ellipsis size={14} aria-hidden />
      </button>
    </div>
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
  const { data: folders = [] } = useFolders(areaId)
  const { data: sessions = [] } = useSessions(areaId)
  const { data: goals = [] } = useGoals(areaId)
  const { createFolder } = useChatStore()
  const [popoverOpen, setPopoverOpen] = useState(state === 'switcher')
  const [createAreaOpen, setCreateAreaOpen] = useState(state === 'create-channel')
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const isChat = mode === 'chat'
  const area = areaId ? areas.find((c) => c.id === areaId) : undefined
  const activeSession = sessions.find((s) => s.id === sessionId)

  const byFolder = useMemo(() => {
    const map: Record<string, Session[]> = {}
    for (const s of sessions) if (s.folderId) (map[s.folderId] ??= []).push(s)
    return map
  }, [sessions])
  const recent = sessions.filter((s) => !s.folderId)

  const isOpen = (id: string) =>
    toggled[id] ?? (activeSession?.folderId === id || folderId === id || DEFAULT_OPEN_FOLDERS.has(id))

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
      <div className="flex w-full items-center gap-[8px] rounded-base px-[8px] py-[6px] transition-colors hover:bg-hover">
        {area ? <AreaBadgeButton area={area} size={24} /> : <AllAreasIcon size={24} />}
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
        <Button icon={Plus} className="w-full" onClick={() => void navigate({ to: '/chat' })}>
          New chat
        </Button>
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
                  <ActiveFolderRow folder={f} onToggle={() => setToggled((t) => ({ ...t, [f.id]: !open }))} />
                ) : (
                  <FolderRow
                    name={f.name}
                    count={f.count}
                    open={open}
                    iconSlot={<FolderIconButton folder={f} open={open} />}
                    onToggle={() => {
                      setToggled((t) => ({ ...t, [f.id]: !open }))
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
        labelClassName="text-muted"
        active={activeNav === 'Archived'}
        onClick={() => navTo('Archived')}
      />

      <CreateChannelDialog open={createAreaOpen} onOpenChange={setCreateAreaOpen} />
      <CreateFolderDialog
        open={createFolderOpen}
        onOpenChange={setCreateFolderOpen}
        onConfirm={(name) => createFolder(areaId ?? 'ch-general', name)}
      />
    </SidebarFrame>
  )
}
