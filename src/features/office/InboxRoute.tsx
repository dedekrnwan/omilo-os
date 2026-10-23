import { useParams, useNavigate } from '@tanstack/react-router'
import { useInbox, useInboxItem } from '../../app/queries'
import { ChatSession } from '../../ui/ChatSession/ChatSession'
import { OfficeSidebar } from './OfficeSidebar'
import { radii } from '../../ui/tokens'
import type { InboxItem } from '../../core/domain/types'

// ── Kind badge ────────────────────────────────────────────────────────────────

const kindColor: Record<InboxItem['kind'], string> = {
  decision: 'var(--ink)',
  update:   'var(--muted)',
  mention:  'var(--ink-2)',
}

const kindBg: Record<InboxItem['kind'], string> = {
  decision: 'var(--soft)',
  update:   'var(--line-strong)',
  mention:  'var(--hover)',
}

function KindBadge({ kind }: { kind: InboxItem['kind'] }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: radii.pill,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'capitalize',
        color: kindColor[kind],
        background: kindBg[kind],
        fontFamily: 'var(--font-sans)',
      }}
    >
      {kind}
    </span>
  )
}

// ── InboxList ─────────────────────────────────────────────────────────────────

function InboxList() {
  const navigate = useNavigate()
  const { data: items, isLoading } = useInbox()

  if (isLoading) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)',
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    )
  }

  if (!items || items.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          color: 'var(--muted)',
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          textAlign: 'center',
          padding: '40px 24px',
        }}
      >
        <span style={{ fontSize: 28 }}>📭</span>
        <p style={{ margin: 0, fontWeight: 500, color: 'var(--ink-2)' }}>
          No items in your inbox
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          Items requiring your attention will appear here.
        </p>
      </div>
    )
  }

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '24px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: 20,
          fontWeight: 700,
          fontFamily: 'var(--font-sans)',
          color: 'var(--ink)',
        }}
      >
        Inbox
      </h1>

      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {items.map((item) => (
          <li key={item.id}>
            <button
              onClick={() =>
                navigate({ to: '/office/inbox/$itemId', params: { itemId: item.id } })
              }
              style={{
                display: 'block',
                width: '100%',
                padding: '14px 16px',
                border: '1px solid var(--line-strong)',
                borderRadius: radii.base,
                background: 'var(--soft)',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'var(--font-sans)',
                transition: 'background 100ms ease',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--hover)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--soft)'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--ink)',
                    lineHeight: 1.4,
                  }}
                >
                  {item.title}
                </span>

                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <KindBadge kind={item.kind} />
                  {item.status === 'pending' && (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 7px',
                        borderRadius: radii.pill,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                        color: 'var(--ink-2)',
                        background: 'var(--soft)',
                        fontFamily: 'var(--font-sans)',
                        border: '1px solid var(--line-strong)',
                      }}
                    >
                      pending
                    </span>
                  )}
                </div>
              </div>

              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: 'var(--muted)',
                  lineHeight: 1.5,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {item.summary}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── InboxItemView ─────────────────────────────────────────────────────────────

function InboxItemView({ itemId }: { itemId: string }) {
  const { data: item, isLoading } = useInboxItem(itemId)

  if (isLoading) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)',
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    )
  }

  if (!item) {
    return (
      <div
        role="alert"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          color: 'var(--muted)',
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          textAlign: 'center',
          padding: '40px 24px',
        }}
      >
        <span style={{ fontSize: 28 }}>🔍</span>
        <p style={{ margin: 0, fontWeight: 500, color: 'var(--ink-2)' }}>
          Not found
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          This inbox item does not exist.
        </p>
      </div>
    )
  }

  // Keystone: resolve item → sessionId → render the same ChatSession primitive
  return <ChatSession sessionId={item.sessionId} />
}

// ── InboxRoute ────────────────────────────────────────────────────────────────

/**
 * Bound to /office/inbox and /office/inbox/$itemId routes.
 * Renders OfficeSidebar alongside the appropriate main content.
 */
export function InboxRoute() {
  const { itemId } = useParams({ strict: false })

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Office sidebar */}
      <div
        style={{
          flexShrink: 0,
          borderRight: '1px solid var(--line-strong)',
          background: 'var(--soft)',
          overflowY: 'auto',
        }}
      >
        <OfficeSidebar />
      </div>

      {/* Main content pane */}
      {itemId ? (
        <InboxItemView itemId={itemId} />
      ) : (
        <InboxList />
      )}
    </div>
  )
}
