import type { Message } from '../../core/domain/types'
import { helperColor } from '../tokens'

interface MessageListProps {
  messages: Message[]
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function Avatar({ name, color }: { name: string; color?: string }) {
  const initial = name.charAt(0).toUpperCase()
  return (
    <div
      aria-hidden
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: color ?? 'var(--ink)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '13px',
        fontWeight: 600,
        fontFamily: 'var(--font-sans)',
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  )
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <ol
      aria-label="Messages"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: '16px 0',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      {messages.map(msg => {
        const isYou = msg.author.kind === 'you'
        const accentColor =
          !isYou && msg.author.area
            ? helperColor[msg.author.area]
            : undefined

        return (
          <li
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: isYou ? 'row-reverse' : 'row',
              gap: '10px',
              padding: '0 16px',
              alignItems: 'flex-start',
            }}
          >
            <Avatar
              name={msg.author.name}
              color={isYou ? 'var(--ink)' : accentColor}
            />

            <div
              style={{
                maxWidth: '70%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: isYou ? 'flex-end' : 'flex-start',
                gap: '2px',
              }}
            >
              {/* Author + time */}
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'baseline',
                  flexDirection: isYou ? 'row-reverse' : 'row',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                    color: isYou ? 'var(--ink-2)' : (accentColor ?? 'var(--ink-2)'),
                  }}
                >
                  {msg.author.name}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--faint)',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {formatTime(msg.createdAt)}
                </span>
              </div>

              {/* Bubble */}
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: isYou
                    ? 'var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-lg)'
                    : 'var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg)',
                  background: isYou ? 'var(--primary)' : 'var(--soft)',
                  border: isYou ? 'none' : '1px solid var(--line-strong)',
                  borderLeft: !isYou && accentColor
                    ? `3px solid ${accentColor}`
                    : undefined,
                  color: isYou ? 'var(--primary-ink)' : 'var(--ink)',
                  fontSize: '14px',
                  lineHeight: 1.55,
                  fontFamily: 'var(--font-sans)',
                  wordBreak: 'break-word',
                }}
              >
                {msg.content}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
