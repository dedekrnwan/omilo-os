import { MessageCircle, MessageSquare, Plus, Target } from 'lucide-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { HelperArea } from '../../core/domain/types'
import { useChannel } from '../../app/queries'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'

// ── pen `Chat · Goals (Engineering)` (SdvDS) ─────────────────────────────────

type GoalStatus = 'On track' | 'At risk' | 'Ahead'

interface GoalChat {
  id: string
  title: string
  who: string
  time: string
}

interface GoalRow {
  id: string
  title: string
  status: GoalStatus
  progress: number
  meta: string
  owner: { name: string; area: HelperArea }
  chats?: GoalChat[]
}

const GOALS: GoalRow[] = [
  {
    id: 'g-passkeys',
    title: 'Passwordless login by Q4',
    status: 'On track',
    progress: 40,
    meta: '6 chats · active 2m ago',
    owner: { name: 'Chief', area: 'brand' },
    chats: [
      { id: 'c1', title: 'Passkey rollout plan',              who: 'Chief, Dev', time: 'now' },
      { id: 'c2', title: 'Android WebAuthn fallback options', who: 'Dev',        time: 'Yesterday' },
      { id: 'c3', title: 'Comms copy for passkey launch',     who: 'Chief',      time: 'Oct 19' },
    ],
  },
  { id: 'g-p95',    title: 'Cut p95 API latency to 250ms',    status: 'On track', progress: 65, meta: '4 chats · active 1h ago',   owner: { name: 'Dev', area: 'dev' } },
  { id: 'g-pg16',   title: 'Postgres 16 upgrade',             status: 'At risk',  progress: 20, meta: '3 chats · active 3h ago',   owner: { name: 'Dev', area: 'dev' } },
  { id: 'g-oncall', title: 'On-call load under 5 pages/week', status: 'Ahead',    progress: 80, meta: '2 chats · active Yesterday', owner: { name: 'Ops', area: 'ops' } },
]

const STATUS_COLOR: Record<GoalStatus, string> = {
  'On track': 'var(--color-ok)',
  'At risk': 'var(--color-warn)',
  Ahead: 'var(--color-ok)',
}

/** 22px progress ring: track #E7E5E4, inner radius 0.68, arc clockwise from 12 o'clock. */
function ProgressRing({ progress, color }: { progress: number; color: string }) {
  const r = 9.24
  const c = 2 * Math.PI * r
  return (
    <svg width={22} height={22} viewBox="0 0 22 22" aria-label={`${progress}%`} className="shrink-0 -rotate-90">
      <circle cx={11} cy={11} r={r} fill="none" stroke="#E7E5E4" strokeWidth={3.52} />
      <circle
        cx={11}
        cy={11}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={3.52}
        strokeDasharray={`${(c * progress) / 100} ${c}`}
      />
    </svg>
  )
}

function GoalItem({ goal, channelId }: { goal: GoalRow; channelId: string }) {
  const navigate = useNavigate()
  const color = STATUS_COLOR[goal.status]

  function startChatAboutGoal() {
    // Navigate to new chat — no dedicated goal-chat route, so go to the channel new-chat
    void navigate({ to: '/chat/$channelId', params: { channelId } })
  }

  return (
    <li className="flex w-full flex-col gap-[11px] px-[4px] py-[15px] shadow-[inset_0_1px_0_var(--color-line-strong)]">
      <div className="flex w-full items-center gap-[11px]">
        <ProgressRing progress={goal.progress} color={color} />
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-[14px] font-semibold text-ink">{goal.title}</span>
          <span className="flex items-center gap-[8px] text-[12.5px]">
            <span className="font-medium" style={{ color }}>
              {goal.status}
            </span>
            <span className="text-faint">·</span>
            <span className="text-muted">{goal.progress}%</span>
            <span className="text-faint">·</span>
            <span className="text-muted">{goal.meta}</span>
          </span>
        </div>
        <span className="flex items-center gap-[6px]">
          <Mascot size={18} radius={5} area={goal.owner.area} title={goal.owner.name} />
          <span className="text-[12.5px] text-ink-2">{goal.owner.name}</span>
        </span>
        <Button variant="secondary" height={28} icon={MessageCircle} onClick={startChatAboutGoal}>
          Chat
        </Button>
      </div>
      {goal.chats && (
        <div className="flex w-full flex-col gap-[2px] pl-[26px]">
          {goal.chats.map((chat, i) => (
            <button
              key={chat.id}
              type="button"
              className={`flex w-full items-center gap-[10px] rounded-base px-[7px] py-[8px] text-left transition-colors hover:bg-soft ${
                i === 0 ? 'bg-soft' : ''
              }`}
            >
              <MessageSquare size={14} aria-hidden className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{chat.title}</span>
              <span className="text-[12px] text-faint">{chat.who}</span>
              <span className="text-[12px] text-faint">{chat.time}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={startChatAboutGoal}
            className="flex items-center gap-[8px] self-start px-[7px] py-[8px] text-[12.5px] text-muted hover:text-ink-2"
          >
            <Plus size={14} aria-hidden />
            New chat about this goal
          </button>
        </div>
      )}
    </li>
  )
}

/** Route: /chat/$channelId/goals */
export function GoalsRoute() {
  const params = useParams({ strict: false })
  const channelId = params.channelId ?? 'ch-general'
  const { data: channel } = useChannel(channelId)
  const name = channel?.name ?? ''

  return (
    <>
      <Topbar icon={Target} title="Goals" meta={`in ${name}`} actions={<Button icon={Plus}>New goal</Button>} />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto">
        <div className="flex w-[860px] max-w-full flex-col gap-[18px] pt-[26px] pb-[29px]">
          <div className="flex flex-col gap-[6px]">
            <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.5px] text-ink">
              What {name} is pushing on
            </h2>
            <p className="m-0 text-[13px] leading-[1.5] text-muted">
              Each goal keeps its own chats. Open a goal to continue the conversation, or ask Chief to break it
              into tasks for Office mode.
            </p>
          </div>
          <ul className="m-0 flex w-full list-none flex-col p-0">
            {GOALS.map((g) => (
              <GoalItem key={g.id} goal={g} channelId={channelId} />
            ))}
          </ul>
        </div>
      </div>
    </>
  )
}
