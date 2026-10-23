import { useNavigate, useRouterState } from '@tanstack/react-router'
import { radii } from '../../ui/tokens'

export function OfficeSidebar() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  const isInboxActive = pathname.startsWith('/office/inbox')

  return (
    <nav
      aria-label="Office"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 8px',
        gap: 2,
        width: 220,
        minWidth: 180,
      }}
    >
      <div
        style={{
          padding: '4px 8px 8px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        Office
      </div>

      <button
        aria-current={isInboxActive ? 'true' : undefined}
        onClick={() => navigate({ to: '/office/inbox' })}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '7px 10px',
          border: 'none',
          borderRadius: radii.sm,
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          fontWeight: isInboxActive ? 600 : 400,
          color: isInboxActive ? 'var(--ink-1)' : 'var(--ink-2)',
          background: isInboxActive ? 'var(--surface)' : 'transparent',
          boxShadow: isInboxActive ? '0 1px 3px 0 rgba(0,0,0,.08)' : 'none',
          transition: 'background 100ms ease, color 100ms ease',
        }}
        onMouseEnter={(e) => {
          if (!isInboxActive) {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'
          }
        }}
        onMouseLeave={(e) => {
          if (!isInboxActive) {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
          }
        }}
      >
        {/* Inbox icon dot */}
        <span
          role="presentation"
          style={{
            flexShrink: 0,
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--ink-2)',
          }}
        />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Inbox
        </span>
      </button>
    </nav>
  )
}
