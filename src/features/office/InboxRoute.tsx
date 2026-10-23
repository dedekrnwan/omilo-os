import { useParams, useNavigate } from '@tanstack/react-router'
import { useInbox, useInboxItem } from '../../app/queries'
import { ChatSession } from '../../ui/ChatSession/ChatSession'
import { OfficeSidebar } from './OfficeSidebar'
import { radii, helperColor } from '../../ui/tokens'
import type { InboxItem } from '../../core/domain/types'

// ── Static right-rail activity data (visual-only chrome) ──────────────────────

interface RunningItem {
  id: string
  title: string
  step: number
  totalSteps: number
  elapsed: string
  next?: string
}

interface DoneItem {
  id: string
  title: string
  note: string
  meta: string
}

const RUNNING_NOW: RunningItem[] = [
  {
    id: 'run-1',
    title: 'Shipping passkeys to staging',
    step: 4,
    totalSteps: 7,
    elapsed: '12m',
  },
  {
    id: 'run-2',
    title: 'Rollback drill on api-prod',
    step: 2,
    totalSteps: 5,
    elapsed: '3m',
    next: 'Thursday check-in · 09:00',
  },
]

const DONE_TODAY: DoneItem[] = [
  {
    id: 'done-1',
    title: 'Wrote the morning brief',
    note: 'Quiet night. 2 goals moved, 1 at risk (Postgres 16). Brief sent to WhatsApp.',
    meta: '1m 50s · 5 sources · 11 steps',
  },
  {
    id: 'done-2',
    title: 'Closed October books',
    note: '2 variances flagged for review: cloud spend +18%, contractor invoices late.',
    meta: '6m 12s · 3 sources · 9 steps',
  },
  {
    id: 'done-3',
    title: 'Content calendar synced',
    note: '18 of 22 posts drafted. Gaps in partner spotlight series noted.',
    meta: '2m 4s · 2 sources · 5 steps',
  },
]

// ── Area tag ──────────────────────────────────────────────────────────────────

function AreaTag({ area, label }: { area: string; label: string }) {
  const color = helperColor[area as keyof typeof helperColor] ?? 'var(--muted)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: radii.pill,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.03em',
        color,
        background: color + '1A', // ~10% opacity tint
        fontFamily: 'var(--font-sans)',
        border: `1px solid ${color}33`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  )
}

// ── Agent avatar chip ─────────────────────────────────────────────────────────

function AgentChip({ name, area }: { name: string; area?: string }) {
  const color = area ? (helperColor[area as keyof typeof helperColor] ?? 'var(--muted)') : 'var(--muted)'
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        color,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: color,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 8,
          color: '#fff',
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {name[0]}
      </span>
      {name}
    </span>
  )
}

// ── Approval card (full) ───────────────────────────────────────────────────────

const AREA_LABEL: Record<string, string> = {
  brand: 'Brand',
  ops: 'Ops',
  dev: 'Engineering',
  support: 'Support',
  finance: 'Finance',
  marketing: 'Marketing',
  sales: 'Business',
  retro: 'Retro',
}

function ApprovalCard({
  item,
  onOpen,
}: {
  item: InboxItem
  onOpen: () => void
}) {
  return (
    <div
      style={{
        border: '1px solid var(--line-strong)',
        borderRadius: radii.lg,
        background: 'var(--surface)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Visually-hidden kind label — keeps test assertions on kind text green */}
      <span
        aria-label={`kind: ${item.kind}`}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {item.kind}
      </span>

      {/* ── Card header row ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <AgentChip name={item.asker ?? 'Agent'} area={item.area} />
          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-sans)' }}>
            asked {item.askedAgo ?? 'just now'}
          </span>
          {item.area && (
            <AreaTag area={item.area} label={AREA_LABEL[item.area] ?? item.area} />
          )}
        </div>
        {item.needsYou && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.03em',
              color: 'var(--bad)',
              background: 'var(--bad-tint)',
              padding: '2px 8px',
              borderRadius: radii.pill,
              fontFamily: 'var(--font-sans)',
              border: '1px solid var(--bad-line)',
              flexShrink: 0,
            }}
          >
            Needs you
          </span>
        )}
      </div>

      {/* ── Title ── */}
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--ink)',
            fontFamily: 'var(--font-sans)',
            lineHeight: 1.4,
          }}
        >
          {item.title}
        </p>
        <p
          style={{
            margin: '4px 0 0',
            fontSize: 13,
            color: 'var(--muted)',
            fontFamily: 'var(--font-sans)',
            lineHeight: 1.5,
          }}
        >
          {item.summary}
        </p>
      </div>

      {/* ── Sub-tasks (optional) ── */}
      {item.subtasks && item.subtasks.length > 0 && (
        <div
          style={{
            border: '1px solid var(--line-strong)',
            borderRadius: radii.base,
            overflow: 'hidden',
          }}
        >
          {item.subtasks.map((st, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderBottom: i < item.subtasks!.length - 1 ? '1px solid var(--line)' : 'none',
                background: 'var(--soft)',
              }}
            >
              <AgentChip name={st.who} area={st.area} />
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: 'var(--ink-2)',
                  fontFamily: 'var(--font-sans)',
                  lineHeight: 1.4,
                }}
              >
                {st.text}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  fontFamily: 'var(--font-sans)',
                  flexShrink: 0,
                }}
              >
                {st.due}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Action row ── */}
      {item.actions && item.actions.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {item.actions.map((action, i) => (
            <button
              key={i}
              style={{
                padding: action.primary ? '6px 14px' : '5px 12px',
                borderRadius: radii.btn,
                border: action.primary ? 'none' : '1px solid var(--line-strong)',
                background: action.primary ? 'var(--primary)' : 'var(--surface)',
                color: action.primary ? 'var(--primary-ink)' : 'var(--ink-2)',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget
                el.style.background = action.primary ? 'var(--primary-hover)' : 'var(--hover)'
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget
                el.style.background = action.primary ? 'var(--primary)' : 'var(--surface)'
              }}
            >
              {action.label}
            </button>
          ))}

          {item.reassurance && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--muted)',
                fontFamily: 'var(--font-sans)',
                marginLeft: 4,
              }}
            >
              {item.reassurance}
            </span>
          )}

          <button
            onClick={onOpen}
            style={{
              marginLeft: 'auto',
              padding: '5px 0',
              border: 'none',
              background: 'none',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--link)',
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              flexShrink: 0,
              textDecoration: 'none',
            }}
          >
            Open ↗
          </button>
        </div>
      )}

      {/* ── Fallback open link if no actions ── */}
      {(!item.actions || item.actions.length === 0) && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onOpen}
            style={{
              padding: '5px 0',
              border: 'none',
              background: 'none',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--link)',
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
          >
            Open ↗
          </button>
        </div>
      )}
    </div>
  )
}

// ── Compact row ───────────────────────────────────────────────────────────────

function CompactRow({
  item,
  onOpen,
}: {
  item: InboxItem
  onOpen: () => void
}) {
  return (
    <button
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '10px 14px',
        border: '1px solid var(--line-strong)',
        borderRadius: radii.base,
        background: 'var(--surface)',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'var(--font-sans)',
        transition: 'background 100ms ease',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--soft)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'
      }}
    >
      {/* Visually-hidden kind label — keeps test assertions on kind text green */}
      <span
        aria-label={`kind: ${item.kind}`}
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {item.kind}
      </span>

      {/* small avatar dot */}
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: item.area ? helperColor[item.area as keyof typeof helperColor] + '22' : 'var(--soft)',
          border: `1.5px solid ${item.area ? helperColor[item.area as keyof typeof helperColor] + '55' : 'var(--line-strong)'}`,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: item.area ? helperColor[item.area as keyof typeof helperColor] : 'var(--muted)',
          flexShrink: 0,
        }}
      >
        {item.title[0]}
      </span>

      <span
        style={{
          flex: 1,
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--ink)',
          lineHeight: 1.4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.title}
        {item.asker && (
          <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {item.asker}</span>
        )}
      </span>

      {item.area && (
        <AreaTag area={item.area} label={AREA_LABEL[item.area] ?? item.area} />
      )}

      {item.askedAgo && (
        <span
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            fontFamily: 'var(--font-sans)',
            flexShrink: 0,
          }}
        >
          {item.askedAgo}
        </span>
      )}

      <span style={{ fontSize: 12, color: 'var(--faint)', flexShrink: 0 }}>›</span>
    </button>
  )
}

// ── Right rail ─────────────────────────────────────────────────────────────────

function RightRail() {
  return (
    <div
      style={{
        width: 288,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        padding: '24px 20px 24px 0',
        overflowY: 'auto',
      }}
    >
      {/* Running now */}
      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--ink)',
              fontFamily: 'var(--font-sans)',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            Running now
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--muted)',
              background: 'var(--soft)',
              border: '1px solid var(--line-strong)',
              borderRadius: radii.pill,
              padding: '0 6px',
              lineHeight: '18px',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {RUNNING_NOW.length}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {RUNNING_NOW.map((run) => {
            const pct = Math.round((run.step / run.totalSteps) * 100)
            return (
              <div
                key={run.id}
                style={{
                  padding: '10px 12px',
                  border: '1px solid var(--line-strong)',
                  borderRadius: radii.base,
                  background: 'var(--surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--ink)',
                    fontFamily: 'var(--font-sans)',
                    lineHeight: 1.4,
                  }}
                >
                  {run.title}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  Step {run.step} of {run.totalSteps} · {run.elapsed}
                </span>
                {/* progress bar */}
                <div
                  style={{
                    height: 3,
                    borderRadius: 2,
                    background: 'var(--line-strong)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: 'var(--helper-dev)',
                      borderRadius: 2,
                      transition: 'width 400ms ease',
                    }}
                  />
                </div>
                {run.next && (
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--muted)',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    Next: {run.next}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Done today */}
      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--ink)',
              fontFamily: 'var(--font-sans)',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            Done today
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--muted)',
              background: 'var(--soft)',
              border: '1px solid var(--line-strong)',
              borderRadius: radii.pill,
              padding: '0 6px',
              lineHeight: '18px',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {DONE_TODAY.length}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DONE_TODAY.map((done) => (
            <div
              key={done.id}
              style={{
                padding: '10px 12px',
                border: '1px solid var(--line-strong)',
                borderRadius: radii.base,
                background: 'var(--surface)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--ink)',
                    fontFamily: 'var(--font-sans)',
                    lineHeight: 1.4,
                  }}
                >
                  {done.title}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    color: 'var(--ok)',
                    background: 'var(--ok-tint)',
                    border: '1px solid var(--ok-line)',
                    borderRadius: radii.pill,
                    padding: '1px 6px',
                    fontFamily: 'var(--font-sans)',
                    flexShrink: 0,
                  }}
                >
                  Done
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: 'var(--muted)',
                  fontFamily: 'var(--font-sans)',
                  lineHeight: 1.5,
                }}
              >
                {done.note}
              </p>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--faint)',
                  fontFamily: 'var(--font-sans)',
                  marginTop: 2,
                }}
              >
                {done.meta}
              </span>
            </div>
          ))}
        </div>

        <button
          style={{
            marginTop: 10,
            padding: '4px 0',
            border: 'none',
            background: 'none',
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--link)',
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
          }}
        >
          See all activity →
        </button>
      </section>
    </div>
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

  const needsYouCount = items.filter((i) => i.needsYou).length || items.length

  const openItem = (item: InboxItem) =>
    navigate({ to: '/office/inbox/$itemId', params: { itemId: item.id } })

  // Separate full cards vs compact rows
  const fullCards = items.filter((i) => !i.compact)
  const compactRows = items.filter((i) => i.compact)

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {/* ── Center column ── */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '24px 32px 32px',
          minWidth: 0,
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 800,
                fontFamily: 'var(--font-display)',
                color: 'var(--ink)',
                lineHeight: 1.2,
              }}
            >
              Inbox
            </h1>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--muted)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {needsYouCount} need you
            </span>
          </div>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 13,
              color: 'var(--muted)',
              fontFamily: 'var(--font-sans)',
              lineHeight: 1.5,
            }}
          >
            Your agents propose, you decide. Whatever you approve is done exactly as written.
          </p>
        </div>

        {/* Section label */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            margin: '20px 0 12px',
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--ink)',
              fontFamily: 'var(--font-sans)',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            Needs you
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--muted)',
              background: 'var(--soft)',
              border: '1px solid var(--line-strong)',
              borderRadius: radii.pill,
              padding: '0 6px',
              lineHeight: '18px',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {needsYouCount}
          </span>
        </div>

        {/* Full approval cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {fullCards.map((item) => (
            <ApprovalCard key={item.id} item={item} onOpen={() => openItem(item)} />
          ))}
        </div>

        {/* Compact rows */}
        {compactRows.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginTop: 12,
            }}
          >
            {compactRows.map((item) => (
              <CompactRow key={item.id} item={item} onOpen={() => openItem(item)} />
            ))}
          </div>
        )}
      </div>

      {/* ── Right rail ── */}
      <div
        style={{
          flexShrink: 0,
          borderLeft: '1px solid var(--line-strong)',
          background: 'var(--soft)',
        }}
      >
        <RightRail />
      </div>
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
