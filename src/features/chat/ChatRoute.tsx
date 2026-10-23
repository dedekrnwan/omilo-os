import { useParams, notFound } from '@tanstack/react-router'
import { useState } from 'react'
import type { Model } from '../../core/domain/types'
import { ChannelSidebar } from './ChannelSidebar'
import { ChatSession } from '../../ui/ChatSession/ChatSession'
import { Composer } from '../../ui/ChatSession/Composer'
import { DEFAULT_MODEL } from '../../ui/ChatSession/ModelMenu'
import { useChannel } from '../../app/queries'
import { radii } from '../../ui/tokens'

// ── Channel id → display name ─────────────────────────────────────────────────

const CHANNEL_NAMES: Record<string, string> = {
  'ch-general':     'General',
  'ch-engineering': 'Engineering',
  'ch-marketing':   'Marketing',
}

// ── Static goal pills for the hero (visual-only) ─────────────────────────────

const GOALS = [
  { label: 'Close October books', pct: 70, color: 'var(--ok)' },
  { label: 'Launch referral program', pct: 35, color: 'var(--helper-marketing)' },
  { label: 'Plan Q1 offsite', pct: 10, color: 'var(--helper-brand)' },
] as const

// ── NewChatHero ───────────────────────────────────────────────────────────────

/**
 * Hero displayed in the center pane when a channel has no active sessions.
 * Matches the pen.dev "New chat (General)" reference design.
 */
function NewChatHero({ channelName }: { channelName: string }) {
  const [selectedModel, setSelectedModel] = useState<Model>(DEFAULT_MODEL)

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--app)',
        padding: '0 24px 40px',
        gap: 0,
        overflowY: 'auto',
      }}
    >
      {/* Vertically-centered column */}
      <div
        style={{
          width: '100%',
          maxWidth: 540,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
        }}
      >
        {/* Mascot */}
        <img
          src="/chief-mascot.png"
          alt="Chief mascot"
          width={64}
          height={64}
          style={{
            marginBottom: 20,
            borderRadius: radii.md,
            objectFit: 'contain',
          }}
        />

        {/* Headline */}
        <h1
          style={{
            margin: '0 0 10px',
            fontSize: 30,
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            color: 'var(--ink)',
            textAlign: 'center',
            lineHeight: 1.2,
            letterSpacing: '-0.01em',
          }}
        >
          Morning, Dede. What are we figuring out?
        </h1>

        {/* Subline */}
        <p
          style={{
            margin: '0 0 28px',
            fontSize: 14,
            fontFamily: 'var(--font-sans)',
            color: 'var(--muted)',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          {`You're in ${channelName}. Switch channel to give Chief focused context for one area.`}
        </p>

        {/* Composer card */}
        <div style={{ width: '100%', marginBottom: 20 }}>
          <Composer
            sessionId={`hero-${channelName}`}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            placeholder="Ask a helper, or type / for commands"
          />
        </div>

        {/* Goal pills section */}
        <p
          style={{
            margin: '0 0 10px',
            fontSize: 12,
            fontFamily: 'var(--font-sans)',
            color: 'var(--muted)',
            textAlign: 'center',
          }}
        >
          Or start from a goal in <strong style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{channelName}</strong>
        </p>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            justifyContent: 'center',
          }}
        >
          {GOALS.map((goal) => (
            <button
              key={goal.label}
              type="button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 12px',
                borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--line-strong)',
                background: 'var(--surface)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                color: 'var(--ink-2)',
                whiteSpace: 'nowrap',
              }}
            >
              {/* Status dot */}
              <span
                aria-hidden
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: goal.color,
                  flexShrink: 0,
                }}
              />
              {goal.label}
              {/* Percentage */}
              <span
                style={{
                  marginLeft: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: goal.color,
                }}
              >
                {goal.pct}%
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── ChannelView ───────────────────────────────────────────────────────────────

/** Shown when a $channelId is selected but no $sessionId yet. */
function ChannelView({ channelId }: { channelId: string }) {
  const { data: channel, isLoading: channelLoading } = useChannel(channelId)

  if (channelLoading) {
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

  // Always show the new-chat hero — sessions are navigated via the sidebar
  return <NewChatHero channelName={channel.name} />
}

// ── NoChatSelected ────────────────────────────────────────────────────────────

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
        <ChatSession
          sessionId={sessionId}
          channelName={channelId ? (CHANNEL_NAMES[channelId] ?? channelId) : undefined}
        />
      ) : channelId ? (
        <ChannelView channelId={channelId} />
      ) : (
        <NoChatSelected />
      )}
    </div>
  )
}
