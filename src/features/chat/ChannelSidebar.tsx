import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useChannels } from '../../app/queries'
import { helperColor, radii } from '../../ui/tokens'
import type { Channel } from '../../core/domain/types'

// ── Inline icons ──────────────────────────────────────────────────────────────

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChatsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M2 2.5h11a.5.5 0 0 1 .5.5V9a.5.5 0 0 1-.5.5H5.5L2 12.5V3a.5.5 0 0 1 .5-.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function GoalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="7.5" r="5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function FlowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M2 3h4v3H2zM9 3h4v3H9zM4 6v3M11 6v3M2 9h4v3H2zM9 9h4v3H9z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M3.5 1.5h5.5L12 4.5v9h-9V1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 1.5V4.5H12" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5 7h5M5 9.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function AnalyticsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <rect x="1.5" y="9" width="3" height="4.5" rx=".5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6" y="5.5" width="3" height="8" rx=".5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="10.5" y="2.5" width="3" height="11" rx=".5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      {open ? (
        <path d="M1.5 4.5h11l-1 7h-9l-1-7zM1.5 4.5V3a.5.5 0 0 1 .5-.5h3l1 1h5a.5.5 0 0 1 .5.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      ) : (
        <path d="M1.5 4.5h11v7h-11zM1.5 4.5V3a.5.5 0 0 1 .5-.5h3l1 1h5a.5.5 0 0 1 .5.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      )}
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M4.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ManageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 1v2M7 11v2M1 7h2M11 7h2M3.05 3.05l1.41 1.41M9.54 9.54l1.41 1.41M9.54 4.46L8.12 5.88M4.46 9.54L3.05 10.95" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function ArchivedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M1.5 4h11v1.5H1.5zM2.5 5.5v6.5h9V5.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5 8h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

// ── Static folder / recent data ───────────────────────────────────────────────

const FOLDERS = [
  {
    id: 'q4-launch',
    name: 'Q4 Launch',
    count: 6,
    open: true,
    children: [
      { id: 'ch-1', name: 'Passkey rollout plan', time: 'now' },
      { id: 'ch-2', name: 'Launch day comms', time: '2h' },
      { id: 'ch-3', name: 'Freeze exceptions policy', time: '1d' },
    ],
  },
  { id: 'infra-migration', name: 'Infra migration', count: 3, open: false, children: [] },
  { id: 'incident-reviews', name: 'Incident reviews', count: 2, open: false, children: [] },
]

const RECENTS = [
  { id: 'r1', name: 'October investor update', time: 'now' },
  { id: 'r2', name: 'Vendor renewals owner?', time: '1h' },
  { id: 'r3', name: 'Weekly cross-area summary', time: '3h' },
  { id: 'r4', name: 'Holiday schedule FAQ', time: 'Yesterday' },
  { id: 'r5', name: 'Offsite venue shortlist', time: 'Mon' },
  { id: 'r6', name: 'New hire welcome note', time: 'Oct 18' },
]

// ── Nav item ─────────────────────────────────────────────────────────────────

function SidebarNavItem({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        all: 'unset',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '5px 10px',
        borderRadius: radii.sm,
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'var(--font-sans)',
        fontSize: 13.5,
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--ink)' : 'var(--ink-2)',
        background: active ? 'var(--surface)' : 'transparent',
        boxShadow: active ? '0 1px 3px 0 rgba(0,0,0,.07)' : 'none',
        transition: 'background 100ms ease, color 100ms ease',
        boxSizing: 'border-box',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          const el = e.currentTarget as HTMLButtonElement
          el.style.background = 'var(--hover)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          const el = e.currentTarget as HTMLButtonElement
          el.style.background = 'transparent'
        }
      }}
    >
      <span style={{ color: active ? 'var(--ink-2)' : 'var(--muted)', flexShrink: 0, display: 'flex' }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {count !== undefined && (
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{count}</span>
      )}
    </button>
  )
}

// ── Channel dropdown ──────────────────────────────────────────────────────────

function ChannelDropdown({
  channels,
  activeChannelId,
  onSelect,
  onClose,
}: {
  channels: Channel[]
  activeChannelId: string | undefined
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = channels.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase()),
  )

  // Static extra metadata
  const meta: Record<string, { subtitle: string }> = {
    'ch-general':     { subtitle: 'Default · Chief' },
    'ch-engineering': { subtitle: 'Chief + 3 agents · 24 chats' },
    'ch-marketing':   { subtitle: 'Chief + 2 agents · 18 chats' },
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99,
        }}
      />

      <div
        role="dialog"
        aria-label="Channel switcher"
        style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 8,
          right: 8,
          background: 'var(--surface)',
          border: '1px solid var(--line-strong)',
          borderRadius: radii.lg,
          boxShadow: '0 8px 24px rgba(0,0,0,.12)',
          zIndex: 100,
          overflow: 'hidden',
        }}
      >
        {/* Search */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <span style={{ color: 'var(--muted)', display: 'flex', flexShrink: 0 }}>
            <SearchIcon />
          </span>
          <input
            autoFocus
            type="text"
            placeholder="Find a channel…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              all: 'unset',
              flex: 1,
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--ink)',
            }}
          />
        </div>

        {/* YOUR CHANNELS */}
        <div style={{ padding: '8px 0' }}>
          <div
            style={{
              padding: '2px 14px 6px',
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: 'var(--faint)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Your Channels
          </div>

          {filtered.map((ch) => {
            const isActive = ch.id === activeChannelId
            const dotColor = helperColor[ch.area]
            const m = meta[ch.id]
            return (
              <button
                key={ch.id}
                aria-current={isActive ? 'true' : undefined}
                onClick={() => { onSelect(ch.id); onClose() }}
                style={{
                  all: 'unset',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '7px 14px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  boxSizing: 'border-box',
                  transition: 'background 80ms ease',
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                }}
              >
                {/* Area dot */}
                <span
                  role="presentation"
                  style={{
                    flexShrink: 0,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: dotColor,
                    marginTop: 2,
                    alignSelf: 'flex-start',
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13.5,
                      fontWeight: isActive ? 600 : 400,
                      color: 'var(--ink)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {ch.name}
                  </span>
                  {m && (
                    <span
                      style={{
                        display: 'block',
                        fontSize: 11.5,
                        color: 'var(--muted)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {m.subtitle}
                    </span>
                  )}
                </span>
                {isActive && (
                  <span style={{ color: 'var(--ink)', flexShrink: 0, display: 'flex' }}>
                    <CheckIcon />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Actions */}
        <div style={{ borderTop: '1px solid var(--line)', padding: '4px 0' }}>
          <button
            onClick={onClose}
            style={{
              all: 'unset',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 14px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--ink-2)',
              boxSizing: 'border-box',
              transition: 'background 80ms ease',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            <span style={{ color: 'var(--muted)', display: 'flex' }}><PlusIcon /></span>
            Create channel
          </button>
          <button
            onClick={onClose}
            style={{
              all: 'unset',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 14px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--ink-2)',
              boxSizing: 'border-box',
              transition: 'background 80ms ease',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            <span style={{ color: 'var(--muted)', display: 'flex' }}><ManageIcon /></span>
            Manage channels
          </button>
        </div>
      </div>
    </>
  )
}

// ── Folder row ─────────────────────────────────────────────────────────────────

function FolderRow({
  name,
  count,
  open,
  children,
  onToggle,
}: {
  name: string
  count: number
  open: boolean
  children: React.ReactNode
  onToggle: () => void
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          all: 'unset',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          width: '100%',
          padding: '4px 10px',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          fontSize: 12.5,
          fontWeight: 500,
          color: 'var(--muted)',
          boxSizing: 'border-box',
          borderRadius: radii.xs,
          transition: 'background 80ms ease, color 80ms ease',
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLButtonElement
          el.style.background = 'var(--hover)'
          el.style.color = 'var(--ink-2)'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLButtonElement
          el.style.background = 'transparent'
          el.style.color = 'var(--muted)'
        }}
      >
        <span
          style={{
            display: 'flex',
            transition: 'transform 120ms ease',
            transform: open ? 'rotate(90deg)' : 'none',
            color: 'var(--faint)',
          }}
        >
          <ChevronRightIcon />
        </span>
        <span style={{ display: 'flex', color: 'var(--muted)' }}>
          <FolderIcon open={open} />
        </span>
        <span style={{ flex: 1 }}>{name}</span>
        <span style={{ fontSize: 11, color: 'var(--faint)' }}>{count}</span>
      </button>
      {open && <div style={{ paddingLeft: 18 }}>{children}</div>}
    </div>
  )
}

// ── Session row (inside folder or recent) ─────────────────────────────────────

function SessionRow({
  name,
  time,
  active,
}: {
  name: string
  time?: string
  active?: boolean
}) {
  return (
    <button
      style={{
        all: 'unset',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '4px 10px',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--ink)' : 'var(--ink-2)',
        background: active ? 'var(--surface)' : 'transparent',
        boxSizing: 'border-box',
        borderRadius: radii.sm,
        transition: 'background 80ms ease',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
        }
      }}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </span>
      {time && (
        <span style={{ fontSize: 11, color: 'var(--faint)', flexShrink: 0 }}>{time}</span>
      )}
    </button>
  )
}

// ── ChannelSidebar ────────────────────────────────────────────────────────────

interface ChannelSidebarProps {
  activeChannelId: string | undefined
}

export function ChannelSidebar({ activeChannelId }: ChannelSidebarProps) {
  const { data: channels, isLoading } = useChannels()
  const navigate = useNavigate()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    'q4-launch': true,
  })
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const activeChannel = channels?.find((c) => c.id === activeChannelId)
  const channelName = activeChannel?.name ?? 'General'

  function toggleFolder(id: string) {
    setOpenFolders((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  if (isLoading) {
    return (
      <nav
        aria-label="Channels"
        style={{
          width: 230,
          display: 'flex',
          flexDirection: 'column',
          padding: '12px 8px',
          color: 'var(--muted)',
          fontSize: 13,
          fontFamily: 'var(--font-sans)',
        }}
      >
        Loading…
      </nav>
    )
  }

  return (
    <nav
      aria-label="Channels"
      style={{
        width: 230,
        minWidth: 200,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        position: 'relative',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* ── Header: channel name + switcher ── */}
      <div style={{ padding: '12px 12px 0', position: 'relative' }}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          style={{
            all: 'unset',
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            cursor: 'pointer',
            borderRadius: radii.base,
            padding: '6px 8px',
            boxSizing: 'border-box',
            transition: 'background 100ms ease',
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--ink)',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {channelName}
            </span>
            <span style={{ color: 'var(--muted)', display: 'flex', flexShrink: 0 }}>
              <ChevronDownIcon />
            </span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
            Channel · Chief + 3 agents
          </span>
        </button>

        {/* Channel dropdown */}
        {dropdownOpen && channels && (
          <ChannelDropdown
            channels={channels}
            activeChannelId={activeChannelId}
            onSelect={(id) => {
              void navigate({ to: '/chat/$channelId', params: { channelId: id } })
            }}
            onClose={() => setDropdownOpen(false)}
          />
        )}
      </div>

      {/* ── New chat button ── */}
      <div style={{ padding: '10px 12px 8px' }}>
        <button
          style={{
            all: 'unset',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            width: '100%',
            padding: '7px 12px',
            borderRadius: radii.base,
            background: 'var(--primary)',
            color: 'var(--primary-ink)',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            boxSizing: 'border-box',
            transition: 'background 100ms ease',
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--primary-hover)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--primary)'
          }}
        >
          <PlusIcon />
          New chat
        </button>
      </div>

      {/* ── Nav items ── */}
      <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        <SidebarNavItem icon={<ChatsIcon />} label="Chats" active />
        <SidebarNavItem icon={<GoalIcon />} label="Goals" count={4} />
        <SidebarNavItem icon={<FlowIcon />} label="Flows" />
        <SidebarNavItem icon={<DocIcon />} label="Docs" />
        <SidebarNavItem icon={<AnalyticsIcon />} label="Analytics" />
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: 'var(--line)', margin: '10px 12px 6px' }} />

      {/* ── Folders section ── */}
      <div style={{ padding: '0 8px', flex: 1, overflowY: 'auto' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '2px 10px 4px',
          gap: 4,
        }}>
          <span style={{
            flex: 1,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--faint)',
          }}>
            Folders
          </span>
          <button
            aria-label="New folder"
            style={{
              all: 'unset',
              cursor: 'pointer',
              color: 'var(--faint)',
              display: 'flex',
              borderRadius: radii.xs,
              padding: 2,
              transition: 'color 80ms ease',
            }}
            onMouseEnter={(e) => { ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)' }}
            onMouseLeave={(e) => { ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--faint)' }}
          >
            <PlusIcon />
          </button>
        </div>

        {FOLDERS.map((folder) => (
          <FolderRow
            key={folder.id}
            name={folder.name}
            count={folder.count}
            open={openFolders[folder.id] ?? false}
            onToggle={() => toggleFolder(folder.id)}
          >
            {folder.children.map((child) => (
              <SessionRow
                key={child.id}
                name={child.name}
                time={child.time}
                active={child.name === 'Passkey rollout plan'}
              />
            ))}
            {folder.children.length > 3 && (
              <button
                style={{
                  all: 'unset',
                  fontSize: 12,
                  color: 'var(--muted)',
                  padding: '2px 10px',
                  cursor: 'pointer',
                }}
              >
                Show 3 more
              </button>
            )}
          </FolderRow>
        ))}

        {/* Recent */}
        <div style={{
          padding: '8px 10px 4px',
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: 'var(--faint)',
        }}>
          Recent
        </div>

        {RECENTS.map((r) => (
          <SessionRow key={r.id} name={r.name} time={r.time} />
        ))}

        {/* Archived */}
        <button
          style={{
            all: 'unset',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '5px 10px',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--muted)',
            boxSizing: 'border-box',
            borderRadius: radii.sm,
            transition: 'background 80ms ease',
            marginTop: 4,
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
          }}
        >
          <ArchivedIcon />
          Archived
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--faint)' }}>12</span>
        </button>
      </div>

      {/* ── User row (bottom) ── */}
      <div style={{ borderTop: '1px solid var(--line)', padding: '8px 8px 8px', position: 'relative' }}>
        <button
          onClick={() => setUserMenuOpen((v) => !v)}
          style={{
            all: 'unset',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            width: '100%',
            padding: '6px 10px',
            borderRadius: radii.base,
            cursor: 'pointer',
            boxSizing: 'border-box',
            transition: 'background 80ms ease',
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
          }}
        >
          {/* Avatar */}
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'var(--primary)',
              color: 'var(--primary-ink)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
              letterSpacing: '0.01em',
            }}
          >
            DK
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Dede Kurniawan
            </div>
          </div>
        </button>

        {/* User menu */}
        {userMenuOpen && (
          <>
            <div onClick={() => setUserMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 4px)',
                left: 8,
                right: 8,
                background: 'var(--surface)',
                border: '1px solid var(--line-strong)',
                borderRadius: radii.lg,
                boxShadow: '0 8px 24px rgba(0,0,0,.12)',
                zIndex: 100,
                overflow: 'hidden',
                padding: '6px 0',
              }}
            >
              {[
                { label: 'Account' },
                { label: 'Subscription & billing' },
                { label: 'Settings' },
                { label: 'Notification settings' },
                null,
                { label: 'Help & docs' },
                { label: 'Send feedback' },
                { label: 'Keyboard shortcuts' },
                null,
                { label: 'Log out', danger: true },
              ].map((item, i) =>
                item === null ? (
                  <div key={i} style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
                ) : (
                  <button
                    key={item.label}
                    onClick={() => setUserMenuOpen(false)}
                    style={{
                      all: 'unset',
                      display: 'flex',
                      alignItems: 'center',
                      width: '100%',
                      padding: '6px 16px',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 13,
                      color: item.danger ? 'var(--bad)' : 'var(--ink-2)',
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                      transition: 'background 80ms ease',
                    }}
                    onMouseEnter={(e) => {
                      ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                    }}
                  >
                    {item.label}
                  </button>
                ),
              )}
            </div>
          </>
        )}
      </div>
    </nav>
  )
}
