import { useNavigate, useRouterState } from '@tanstack/react-router'
import { helperColor, radii } from '../../ui/tokens'

// ── Inline icons ──────────────────────────────────────────────────────────────

function GoalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="7.5" r="5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function InboxIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path
        d="M1.5 9.5h3l1.5 2h3l1.5-2h3V12a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V9.5z"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
      />
      <path d="M1.5 9.5L3.5 2.5h8L13.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function FlowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <rect x="1.5" y="2" width="4" height="3" rx=".5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="2" width="4" height="3" rx=".5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="1.5" y="10" width="4" height="3" rx=".5" stroke="currentColor" strokeWidth="1.3" />
      <rect x="9.5" y="10" width="4" height="3" rx=".5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.5 5v2.5H7.5M11.5 5v2.5H7.5M3.5 10V7.5M11.5 10V7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function RoutineIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <circle cx="7.5" cy="7.5" r="5.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7.5 4.5v3.25l2.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
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

// ── Nav item ──────────────────────────────────────────────────────────────────

function SidebarNavItem({
  icon,
  label,
  count,
  active,
  onClick,
  'aria-current': ariaCurrent,
}: {
  icon: React.ReactNode
  label: string
  count?: number
  active?: boolean
  onClick?: () => void
  'aria-current'?: 'true' | undefined
}) {
  return (
    <button
      aria-current={ariaCurrent}
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
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            color: active ? 'var(--primary-ink)' : 'var(--muted)',
            background: active ? 'var(--primary)' : 'transparent',
            borderRadius: radii.pill,
            padding: active ? '1px 6px' : '0',
            minWidth: 18,
            textAlign: 'center',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// ── Area row ──────────────────────────────────────────────────────────────────

const AREAS = [
  { id: 'all',         label: 'All areas',  count: 14, color: 'var(--muted)' },
  { id: 'ops',         label: 'General',    count: 2,  color: helperColor.ops },
  { id: 'dev',         label: 'Engineering',count: 5,  color: helperColor.dev },
  { id: 'marketing',   label: 'Marketing',  count: 4,  color: helperColor.marketing },
  { id: 'finance',     label: 'Business',   count: 3,  color: helperColor.finance },
]

function AreaRow({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: string
}) {
  return (
    <button
      style={{
        all: 'unset',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '4px 10px',
        borderRadius: radii.sm,
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
      {/* Dot */}
      <span
        role="presentation"
        style={{
          flexShrink: 0,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
        }}
      />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--faint)' }}>{count}</span>
    </button>
  )
}

// ── OfficeSidebar ─────────────────────────────────────────────────────────────

export function OfficeSidebar() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const isInboxActive = pathname.startsWith('/office/inbox')

  return (
    <nav
      aria-label="Office"
      style={{
        width: 230,
        minWidth: 200,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* ── Header ── */}
      <div style={{ padding: '14px 12px 8px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>
          Sahabat Warga
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Office · 5 areas
        </div>
      </div>

      {/* ── Nav items ── */}
      <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        <SidebarNavItem icon={<GoalIcon />} label="Goals" />
        <SidebarNavItem
          icon={<InboxIcon />}
          label="Inbox"
          count={isInboxActive ? undefined : 5}
          active={isInboxActive}
          aria-current={isInboxActive ? 'true' : undefined}
          onClick={() => navigate({ to: '/office/inbox' })}
        />
        <SidebarNavItem icon={<FlowIcon />} label="Flows" />
        <SidebarNavItem icon={<RoutineIcon />} label="Routines" />
        <SidebarNavItem icon={<DocIcon />} label="Docs" />
        <SidebarNavItem icon={<AnalyticsIcon />} label="Analytics" />
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: 'var(--line)', margin: '10px 12px 6px' }} />

      {/* ── Areas section ── */}
      <div style={{ padding: '0 8px', flex: 1, overflowY: 'auto' }}>
        <div style={{
          padding: '2px 10px 4px',
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: 'var(--faint)',
        }}>
          Areas
        </div>

        {AREAS.map((area) => (
          <AreaRow
            key={area.id}
            label={area.label}
            count={area.count}
            color={area.color}
          />
        ))}
      </div>
    </nav>
  )
}
