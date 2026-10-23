import { useNavigate } from '@tanstack/react-router'
import { useUIStore } from '../app/store'

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function ActivityIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <polyline
        points="1.5 9 5 3.5 8 12.5 11 6.5 13.5 9 16.5 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function DotsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="4.5" cy="9" r="1.25" fill="currentColor" />
      <circle cx="9" cy="9" r="1.25" fill="currentColor" />
      <circle cx="13.5" cy="9" r="1.25" fill="currentColor" />
    </svg>
  )
}

function ChatBubbleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M3 3.5h12a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H6l-3 3V4.5a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect
        x="3.5" y="8" width="11" height="8" rx="1.5"
        stroke="currentColor" strokeWidth="1.4"
      />
      <path
        d="M5.5 8V6a3.5 3.5 0 0 1 7 0v2"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"
      />
      <circle cx="9" cy="12" r="1" fill="currentColor" />
    </svg>
  )
}

// ── Shared button style helper ────────────────────────────────────────────────

function RailIconBtn({
  label,
  onClick,
  children,
  active = false,
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        all: 'unset',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        borderRadius: 8,
        cursor: onClick ? 'pointer' : 'default',
        color: active ? 'var(--ink)' : 'var(--muted)',
        background: active ? 'var(--hover)' : 'transparent',
        transition: 'background 100ms ease, color 100ms ease',
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement
        if (!active) {
          el.style.background = 'var(--hover)'
          el.style.color = 'var(--ink-2)'
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement
        if (!active) {
          el.style.background = 'transparent'
          el.style.color = 'var(--muted)'
        }
      }}
    >
      {children}
    </button>
  )
}

// ── Company icon (rounded square with letter) ─────────────────────────────────

function CompanyIcon({
  letter,
  color,
  active,
  label,
  onClick,
}: {
  letter: string
  color: string
  active?: boolean
  label: string
  onClick?: () => void
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        all: 'unset',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        borderRadius: active ? 10 : 8,
        background: color,
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: 'var(--font-sans)',
        fontWeight: 700,
        fontSize: 15,
        color: '#fff',
        flexShrink: 0,
        boxShadow: active ? '0 0 0 2px var(--surface), 0 0 0 3.5px rgba(0,0,0,.18)' : 'none',
        transition: 'border-radius 120ms ease',
        userSelect: 'none',
      }}
    >
      {letter}
    </button>
  )
}

// ── AddCompanyBtn ─────────────────────────────────────────────────────────────

function AddCompanyBtn() {
  return (
    <button
      aria-label="Add company"
      title="Add company"
      style={{
        all: 'unset',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 36,
        height: 36,
        borderRadius: 8,
        border: '1.5px dashed var(--line-strong)',
        cursor: 'pointer',
        color: 'var(--muted)',
        fontSize: 18,
        fontWeight: 300,
        flexShrink: 0,
        transition: 'border-color 100ms ease, color 100ms ease',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.borderColor = 'var(--faint)'
        el.style.color = 'var(--ink-2)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.borderColor = 'var(--line-strong)'
        el.style.color = 'var(--muted)'
      }}
    >
      +
    </button>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function UserAvatar({ initials }: { initials: string }) {
  return (
    <div
      aria-label="User menu"
      role="button"
      tabIndex={0}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        borderRadius: '50%',
        background: 'var(--primary)',
        color: 'var(--primary-ink)',
        fontFamily: 'var(--font-sans)',
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: '0.02em',
        cursor: 'pointer',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {initials}
    </div>
  )
}

// ── Rail ──────────────────────────────────────────────────────────────────────

/**
 * Narrow company rail (56px).
 * Top: active company icon (orange "S"), secondary company (blue "K"), "+" add.
 * Bottom: activity/bell, "…", chat glyph, lock/settings, round user avatar.
 * The Chat↔Office toggle is embedded as the chat bubble icon at the bottom.
 */
export function Rail() {
  const navigate = useNavigate()
  const { mode, toggleTarget } = useUIStore()

  function handleModeToggle() {
    const target = toggleTarget()
    void navigate({ to: target.path })
  }

  const isChatMode = mode === 'chat'

  return (
    <nav
      aria-label="main rail"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: 56,
        background: 'var(--soft)',
        borderRight: '1px solid var(--line-strong)',
        padding: '10px 0 12px',
        gap: 4,
        flexShrink: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {/* ── Company icons (top) ── */}
      {/* Active company — orange "S" */}
      <CompanyIcon
        letter="S"
        color="#F97316"
        active
        label="Sahabat Warga (active)"
      />

      {/* Second company — blue "K" */}
      <CompanyIcon
        letter="K"
        color="#6366F1"
        label="Koperasi"
      />

      {/* Add company */}
      <AddCompanyBtn />

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* ── Bottom controls ── */}
      <RailIconBtn label="Activity">
        <ActivityIcon />
      </RailIconBtn>

      <RailIconBtn label="More">
        <DotsIcon />
      </RailIconBtn>

      {/* Mode toggle — chat bubble icon; aria-label encodes current mode so tests can find it */}
      <RailIconBtn
        label={isChatMode ? 'Chat' : 'Office'}
        onClick={handleModeToggle}
        active={isChatMode}
      >
        <ChatBubbleIcon />
      </RailIconBtn>

      <RailIconBtn label="Settings">
        <LockIcon />
      </RailIconBtn>

      {/* User avatar */}
      <div style={{ marginTop: 4 }}>
        <UserAvatar initials="DK" />
      </div>
    </nav>
  )
}
