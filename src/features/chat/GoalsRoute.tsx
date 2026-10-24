import { useState } from 'react'
import { MessageSquare, Plus, Target } from 'lucide-react'
import { useParams } from '@tanstack/react-router'
import { useChannel } from '../../app/queries'
import { Button } from '../../ui/ds/Button'
import { Inset, Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'
import { ChannelSidebar } from './ChannelSidebar'

const DEFAULT_CHANNEL_ID = 'ch-general'

// ── static goal data matching SdvDS.png ──────────────────────────────────────

type GoalStatus = 'On track' | 'At risk' | 'Ahead'

interface SubTask {
  id: string
  title: string
  owner: string
  time: string
}

interface GoalRow {
  id: string
  title: string
  status: GoalStatus
  progress: number
  chats: number
  lastActive: string
  area: 'brand' | 'dev' | 'ops'
  subtasks?: SubTask[]
}

const GOALS: GoalRow[] = [
  {
    id: 'g-passkeys',
    title: 'Passwordless login by Q4',
    status: 'On track',
    progress: 40,
    chats: 6,
    lastActive: '2m ago',
    area: 'brand',
    subtasks: [
      { id: 'st-1', title: 'Passkey rollout plan',          owner: 'Chief, Dev', time: 'now' },
      { id: 'st-2', title: 'Android WebAuthn fallback',      owner: 'Dev',        time: 'Yesterday' },
      { id: 'st-3', title: 'Comms copy for passkey launch',  owner: 'Chief',      time: 'Oct 19' },
    ],
  },
  {
    id: 'g-p95',
    title: 'Cut p95 API latency to 250ms',
    status: 'On track',
    progress: 65,
    chats: 4,
    lastActive: '1h ago',
    area: 'dev',
  },
  {
    id: 'g-pg16',
    title: 'Postgres 16 upgrade',
    status: 'At risk',
    progress: 20,
    chats: 3,
    lastActive: '3h ago',
    area: 'dev',
  },
  {
    id: 'g-oncall',
    title: 'On-call load under 5 pages/week',
    status: 'Ahead',
    progress: 90,
    chats: 2,
    lastActive: 'Yesterday',
    area: 'ops',
  },
]

const STATUS_STYLE: Record<GoalStatus, { bg: string; ink: string }> = {
  'On track': { bg: 'var(--color-ok-tint)',  ink: 'var(--color-ok)' },
  'At risk':  { bg: 'var(--color-warn-tint)', ink: 'var(--color-warn)' },
  'Ahead':    { bg: 'var(--color-info-tint)', ink: 'var(--color-info)' },
}

const RING_COLOR: Record<GoalStatus, string> = {
  'On track': 'var(--color-ok)',
  'At risk':  'var(--color-warn)',
  'Ahead':    'var(--color-helper-brand)',
}

// ── StatusRing: ContextRing with coloured arc per status ─────────────────────

function StatusRing({ value, status }: { value: number; status: GoalStatus }) {
  const size = 28
  const outer = size / 2
  const width = outer * 0.28
  const r = outer - width / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value)) / 100
  const color = RING_COLOR[status]
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      <circle
        cx={outer} cy={outer} r={r}
        fill="none" stroke="var(--color-line-strong)" strokeWidth={width}
      />
      <circle
        cx={outer} cy={outer} r={r}
        fill="none" stroke={color} strokeWidth={width}
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${outer} ${outer})`}
      />
    </svg>
  )
}

// ── GoalItem ─────────────────────────────────────────────────────────────────

function GoalItem({ goal, expanded, onToggle }: { goal: GoalRow; expanded: boolean; onToggle: () => void }) {
  const st = STATUS_STYLE[goal.status]
  return (
    <div className="flex flex-col">
      {/* Main row */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-[12px] rounded-base px-[12px] py-[10px] text-left transition-colors hover:bg-soft"
        aria-expanded={expanded}
      >
        <StatusRing value={goal.progress} status={goal.status} />

        <span className="min-w-0 flex-1 flex flex-col gap-[2px]">
          <span className="text-[13.5px] font-medium text-ink truncate">{goal.title}</span>
          <span className="text-[11.5px] text-muted">
            {goal.chats} chats · active {goal.lastActive}
          </span>
        </span>

        {/* Status chip */}
        <span
          className="inline-flex h-[20px] shrink-0 items-center rounded-pill px-[8px] text-[11.5px] font-medium"
          style={{ background: st.bg, color: st.ink }}
        >
          {goal.status}
        </span>

        {/* Progress label */}
        <span className="w-[34px] shrink-0 text-right text-[12px] text-muted">{goal.progress}%</span>

        {/* Owner avatar */}
        <Mascot size={22} radius={6} area={goal.area} title={goal.area} />

        {/* Chat button */}
        <Button variant="secondary" height={28} icon={MessageSquare}>
          Chat
        </Button>
      </button>

      {/* Expanded subtask rows */}
      {expanded && goal.subtasks && (
        <div className="flex flex-col gap-px pl-[52px] pb-[4px]">
          <div className="flex flex-col gap-px shadow-[inset_1px_0_0_var(--color-line-strong)] pl-[12px]">
            {goal.subtasks.map((st) => (
              <div
                key={st.id}
                className="flex items-center gap-[10px] py-[5px] pr-[12px]"
              >
                <Target size={13} aria-hidden className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{st.title}</span>
                <span className="text-[11.5px] text-muted shrink-0">{st.owner}</span>
                <span className="text-[11.5px] text-faint shrink-0">{st.time}</span>
              </div>
            ))}

            {/* "New chat about this goal" row */}
            <button
              type="button"
              className="flex items-center gap-[8px] py-[5px] pr-[12px] text-[12px] text-muted hover:text-ink-2 transition-colors"
            >
              <Plus size={13} aria-hidden />
              New chat about this goal
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── GoalsPage ─────────────────────────────────────────────────────────────────

function GoalsPage({ channelName }: { channelName: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(GOALS[0].id)

  return (
    <>
      <Topbar
        icon={Target}
        title="Goals"
        meta={`in ${channelName}`}
        actions={
          <Button icon={Plus}>
            New goal
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[24px] py-[20px]">
        <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">
          What {channelName} is pushing on
        </h2>
        <p className="mt-[6px] mb-[20px] text-[13.5px] text-muted">
          Each goal keeps its own chats. Open a goal to continue the conversation, or ask Chief to break it into tasks for Office mode.
        </p>

        <div className="flex flex-col divide-y divide-line">
          {GOALS.map((goal) => (
            <GoalItem
              key={goal.id}
              goal={goal}
              expanded={expandedId === goal.id}
              onToggle={() => setExpandedId((prev) => (prev === goal.id ? null : goal.id))}
            />
          ))}
        </div>
      </div>
    </>
  )
}

// ── GoalsRoute ────────────────────────────────────────────────────────────────

export function GoalsRoute() {
  const params = useParams({ strict: false })
  const channelId = params.channelId ?? DEFAULT_CHANNEL_ID
  const { data: channel } = useChannel(channelId)

  return (
    <>
      <ChannelSidebar channelId={channelId} activeNav="Goals" />
      <Inset label="Goals">
        <GoalsPage channelName={channel?.name ?? '…'} />
      </Inset>
    </>
  )
}
