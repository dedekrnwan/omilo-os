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
        color: 'var(--primary-ink)',
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

/** Centered muted system/event line — e.g. "✓ Chief added Dev to this chat" */
function SystemLine({ content }: { content: string }) {
  return (
    <li
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '4px 16px',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '12px',
          color: 'var(--faint)',
          letterSpacing: '0.01em',
        }}
      >
        ✓ {content}
      </span>
    </li>
  )
}

/** Small bordered doc-attachment card inside a message */
function AttachmentCard({ title, meta }: { title: string; meta: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginTop: 8,
        padding: '8px 12px',
        borderRadius: 'var(--radius-base)',
        border: '1px solid var(--line-strong)',
        background: 'var(--surface)',
        maxWidth: 300,
      }}
    >
      {/* Doc icon */}
      <span
        aria-hidden
        style={{
          fontSize: 18,
          flexShrink: 0,
          color: 'var(--ink-2)',
        }}
      >
        📄
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '11px',
            color: 'var(--faint)',
            marginTop: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {meta}
        </div>
      </div>
      {/* Open-arrow icon */}
      <span
        aria-hidden
        style={{
          fontSize: 13,
          color: 'var(--muted)',
          flexShrink: 0,
        }}
      >
        ↗
      </span>
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
        // System / event line
        if (msg.system) {
          return <SystemLine key={msg.id} content={msg.content} />
        }

        const isYou = msg.author.kind === 'you'
        const accentColor =
          !isYou && msg.author.area
            ? helperColor[msg.author.area]
            : undefined

        if (isYou) {
          // User bubble — dark right-aligned, unchanged
          return (
            <li
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: 'row-reverse',
                gap: '10px',
                padding: '0 16px',
                alignItems: 'flex-start',
              }}
            >
              <Avatar name={msg.author.name} color="var(--ink)" />
              <div
                style={{
                  maxWidth: '70%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: '2px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '6px',
                    alignItems: 'baseline',
                    flexDirection: 'row-reverse',
                  }}
                >
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      fontFamily: 'var(--font-sans)',
                      color: 'var(--ink-2)',
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
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-lg)',
                    background: 'var(--primary)',
                    color: 'var(--primary-ink)',
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
        }

        // Agent/helper message — borderless plain text per ref design
        return (
          <li
            key={msg.id}
            style={{
              display: 'flex',
              flexDirection: 'row',
              gap: '10px',
              padding: '0 16px',
              alignItems: 'flex-start',
            }}
          >
            {/* Colored circular avatar */}
            <Avatar
              name={msg.author.name}
              color={accentColor ?? 'var(--helper-brand)'}
            />

            <div
              style={{
                maxWidth: '70%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '4px',
              }}
            >
              {/* Bold name + muted role + muted time — one line */}
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'baseline',
                }}
              >
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                    color: accentColor ?? 'var(--ink)',
                  }}
                >
                  {msg.author.name}
                </span>
                {msg.author.area && (
                  <span
                    style={{
                      fontSize: '12px',
                      color: 'var(--faint)',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {msg.author.area === 'brand' ? 'Chief of Staff' : `${msg.author.area.charAt(0).toUpperCase() + msg.author.area.slice(1)} agent`}
                  </span>
                )}
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

              {/* Message text — plain paragraph, no card/border/left-bar */}
              <p
                style={{
                  margin: 0,
                  fontSize: '14px',
                  lineHeight: 1.6,
                  fontFamily: 'var(--font-sans)',
                  color: 'var(--ink)',
                  wordBreak: 'break-word',
                }}
              >
                {msg.content}
              </p>

              {/* Optional doc attachment card */}
              {msg.attachment && (
                <AttachmentCard
                  title={msg.attachment.title}
                  meta={msg.attachment.meta}
                />
              )}

              {/* Optional action buttons */}
              {msg.actions && msg.actions.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    gap: '8px',
                    marginTop: '6px',
                    flexWrap: 'wrap',
                  }}
                >
                  {msg.actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '6px 14px',
                        borderRadius: 'var(--radius-btn)',
                        border: action.primary ? 'none' : '1px solid var(--line-strong)',
                        background: action.primary ? 'var(--primary)' : 'transparent',
                        color: action.primary ? 'var(--primary-ink)' : 'var(--ink-2)',
                        fontFamily: 'var(--font-sans)',
                        fontSize: '13px',
                        fontWeight: action.primary ? 500 : 400,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
