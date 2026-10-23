import { useNavigate } from '@tanstack/react-router'
import { useUIStore } from '../app/store'
import type { Mode } from '../app/store'

/** Icon placeholders — static / non-functional */
function TeamIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 18c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.41 1.41M14.36 14.36l1.41 1.41M14.36 5.64l-1.41 1.41M5.64 14.36l-1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M10 2a6 6 0 0 1 6 6v3l2 2H2l2-2V8a6 6 0 0 1 6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 16a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

const modeLabel: Record<Mode, string> = {
  chat: 'Chat',
  office: 'Office',
}

/**
 * Left rail: company dot, static icon buttons (Team, Gear, Bell), and at the
 * bottom a Chat↔Office mode toggle that navigates to the mode's last-visited
 * (or default) path.
 */
export function Rail() {
  const navigate = useNavigate()
  const { mode, toggleTarget } = useUIStore()

  function handleToggle() {
    const target = toggleTarget()
    void navigate({ to: target.path })
  }

  return (
    <nav
      aria-label="main rail"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: 56,
        background: 'var(--surface)',
        borderRight: '1px solid var(--line-strong)',
        padding: '12px 0',
        gap: 4,
        flexShrink: 0,
      }}
    >
      {/* Company dot */}
      <div
        aria-label="company"
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--primary)',
          marginBottom: 8,
          flexShrink: 0,
        }}
      />

      {/* Static icon buttons */}
      <button
        aria-label="Team"
        title="Team"
        style={{
          all: 'unset',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: 8,
          cursor: 'default',
          color: 'var(--muted)',
        }}
      >
        <TeamIcon />
      </button>

      <button
        aria-label="Settings"
        title="Settings"
        style={{
          all: 'unset',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: 8,
          cursor: 'default',
          color: 'var(--muted)',
        }}
      >
        <GearIcon />
      </button>

      <button
        aria-label="Notifications"
        title="Notifications"
        style={{
          all: 'unset',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: 8,
          cursor: 'default',
          color: 'var(--muted)',
        }}
      >
        <BellIcon />
      </button>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Mode toggle — bottom of rail */}
      <button
        aria-label={modeLabel[mode]}
        title={`Switch to ${mode === 'chat' ? 'Office' : 'Chat'}`}
        onClick={handleToggle}
        style={{
          all: 'unset',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          borderRadius: 10,
          cursor: 'pointer',
          background: 'var(--primary)',
          color: 'var(--primary-ink)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.04em',
          gap: 2,
          userSelect: 'none',
        }}
      >
        <span>{modeLabel[mode]}</span>
      </button>
    </nav>
  )
}
