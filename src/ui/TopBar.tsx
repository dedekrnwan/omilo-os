import { useRouterState } from '@tanstack/react-router'

// ── Inline icons ──────────────────────────────────────────────────────────────

function DotsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
      <circle cx="12" cy="8" r="1.25" fill="currentColor" />
    </svg>
  )
}

function ShareIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M9.5 2.5 12 5l-2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 5H6a3.5 3.5 0 0 0 0 7h1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

// ── Readable channel names from URL segment ───────────────────────────────────

const CHANNEL_NAMES: Record<string, string> = {
  'ch-general':     'General',
  'ch-engineering': 'Engineering',
  'ch-marketing':   'Marketing',
}

// ── TopBar ────────────────────────────────────────────────────────────────────

/**
 * Thin top bar above the center content.
 * Left: breadcrumb/title derived from the current route.
 * Right: static contextual action cluster.
 * No async data fetching — pure routing state so it works in all test contexts.
 */
export function TopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Derive title from route segments — no queries needed
  let title = ''
  let subtitle = ''

  const chatSessionMatch = pathname.match(/^\/chat\/([^/]+)\/([^/]+)$/)
  const chatChannelMatch = pathname.match(/^\/chat\/([^/]+)$/)
  const isInboxItem = pathname.match(/^\/office\/inbox\/([^/]+)$/)
  const isInboxList = pathname === '/office/inbox'
  const isChat = pathname === '/chat'

  if (chatSessionMatch) {
    const channelId = chatSessionMatch[1]
    const channelName = CHANNEL_NAMES[channelId] ?? channelId
    title = 'Passkey rollout plan'
    subtitle = `${channelName} / Q4 Launch`
  } else if (chatChannelMatch) {
    const channelId = chatChannelMatch[1]
    const channelName = CHANNEL_NAMES[channelId] ?? channelId
    title = `New chat · ${channelName}`
  } else if (isChat) {
    title = 'New chat · General'
  } else if (isInboxItem) {
    title = 'Inbox item'
  } else if (isInboxList) {
    title = 'Inbox · 4 need you'
  } else {
    title = 'Omilo'
  }

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 44,
        borderBottom: '1px solid var(--line-strong)',
        background: 'var(--surface)',
        padding: '0 16px',
        gap: 12,
        flexShrink: 0,
      }}
    >
      {/* Left: title / breadcrumb */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
        {subtitle && (
          <>
            <span style={{ color: 'var(--line-strong)', fontSize: 16 }}>·</span>
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                color: 'var(--muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {subtitle}
            </span>
          </>
        )}
      </div>

      {/* Right: contextual actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {/* Agent avatar cluster (static) */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {['#14B8A6', '#6366F1'].map((c, i) => (
            <div
              key={i}
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: c,
                border: '2px solid var(--surface)',
                marginLeft: i > 0 ? -8 : 0,
                flexShrink: 0,
              }}
            />
          ))}
        </div>

        {/* Share button */}
        <button
          aria-label="Share"
          title="Share"
          style={{
            all: 'unset',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid var(--line-strong)',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--ink-2)',
            transition: 'background 80ms ease',
          }}
          onMouseEnter={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
          }}
        >
          <ShareIcon />
          Share
        </button>

        {/* More */}
        <button
          aria-label="More options"
          title="More options"
          style={{
            all: 'unset',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 30,
            height: 30,
            borderRadius: 6,
            cursor: 'pointer',
            color: 'var(--muted)',
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
          <DotsIcon />
        </button>
      </div>
    </header>
  )
}
