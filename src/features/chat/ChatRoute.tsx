import { useParams, useNavigate, notFound } from '@tanstack/react-router'
import { ChannelSidebar } from './ChannelSidebar'
import { ChatSession } from '../../ui/ChatSession/ChatSession'
import { useChannel, useChannelSessions } from '../../app/queries'
import { radii } from '../../ui/tokens'

// ── Sub-components ────────────────────────────────────────────────────────────

/** Shown when a $channelId is selected but no $sessionId yet. */
function ChannelView({ channelId }: { channelId: string }) {
  const navigate = useNavigate()
  const { data: channel, isLoading: channelLoading } = useChannel(channelId)
  const { data: sessions, isLoading: sessionsLoading } = useChannelSessions(channelId)

  if (channelLoading || sessionsLoading) {
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

  // Unknown channel — trigger not-found
  if (!channel) {
    throw notFound()
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: '24px 32px',
        gap: 16,
        background: 'var(--surface)',
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: 20,
          fontWeight: 700,
          fontFamily: 'var(--font-sans)',
          color: 'var(--ink-1)',
        }}
      >
        {channel.name}
      </h1>

      {sessions === undefined || sessions.length === 0 ? (
        // Empty state
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
          }}
        >
          <span style={{ fontSize: 28 }}>💬</span>
          <p style={{ margin: 0, fontWeight: 500, color: 'var(--ink-2)' }}>
            No sessions yet
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>
            Start a new conversation in this channel.
          </p>
        </div>
      ) : (
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                onClick={() =>
                  navigate({
                    to: '/chat/$channelId/$sessionId',
                    params: { channelId, sessionId: session.id },
                  })
                }
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '10px 14px',
                  border: '1px solid var(--line-strong)',
                  borderRadius: radii.base,
                  background: 'var(--soft)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--ink-1)',
                  transition: 'background 100ms ease',
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background =
                    'var(--hover)'
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background =
                    'var(--soft)'
                }}
              >
                {session.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Shown when no channel is selected yet (root /chat). */
function NoChatSelected() {
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
        textAlign: 'center',
      }}
    >
      Select a channel to start chatting.
    </div>
  )
}

// ── ChatRoute ─────────────────────────────────────────────────────────────────

/**
 * Bound to /chat, /chat/$channelId, and /chat/$channelId/$sessionId routes.
 * Renders the channel sidebar alongside the appropriate main content.
 */
export function ChatRoute() {
  const { channelId, sessionId } = useParams({ strict: false })

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Channel sidebar */}
      <div
        aria-label="channel-sidebar"
        style={{
          flexShrink: 0,
          borderRight: '1px solid var(--line-strong)',
          background: 'var(--soft)',
          overflowY: 'auto',
        }}
      >
        <ChannelSidebar activeChannelId={channelId} />
      </div>

      {/* Main content pane */}
      {sessionId ? (
        <ChatSession sessionId={sessionId} />
      ) : channelId ? (
        <ChannelView channelId={channelId} />
      ) : (
        <NoChatSelected />
      )}
    </div>
  )
}
