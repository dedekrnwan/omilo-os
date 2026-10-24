import { Download } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane } from '../legacyShared'
import { Mascot } from '../../../ui/ds/Mascot'

const FILTERS = ['All', 'Agents', 'People', 'Approvals', 'Settings']

const EVENTS = [
  { time: '10:44', actor: 'Chief', actorType: 'agent' as const, area: 'ops', verb: 'asked you to approve', target: '3 tasks - Passwordless login', channel: 'Engineering' },
  { time: '10:43', actor: 'Dev', actorType: 'agent' as const, area: 'dev', verb: 'drafted', target: 'Passkey rollout — v1', channel: 'Engineering' },
  { time: '09:12', actor: 'Dede', actorType: 'person' as const, area: null, verb: 'approved', target: '$4,800 referral ad budget', channel: 'Marketing' },
  { time: '08:31', actor: 'Ops', actorType: 'agent' as const, area: 'ops', verb: 'ran flow', target: 'Deploy failure triage - #214', channel: 'Engineering' },
]

const EVENTS_YESTERDAY = [
  { time: '17:02', actor: 'Rina', actorType: 'person' as const, area: null, verb: 'changed', target: 'Safety & limits → spend cap Rp 2jt', channel: 'Settings', isSettings: true },
  { time: '16:20', actor: 'Finance', actorType: 'agent' as const, area: 'finance', verb: 'sent', target: 'October close summary', channel: 'Business' },
  { time: '11:05', actor: 'Growth', actorType: 'agent' as const, area: 'marketing', verb: 'was declined', target: 'Post to Instagram', channel: 'Marketing' },
]

function PersonAvatar({ initials }: { initials: string }) {
  return (
    <span className="flex size-[24px] shrink-0 items-center justify-center rounded-full bg-[#D6D3D1] text-[10px] font-semibold text-ink-2">
      {initials}
    </span>
  )
}

function EventRow({
  time,
  actor,
  actorType,
  area,
  verb,
  target,
  channel,
  isSettings,
}: typeof EVENTS[0] & { isSettings?: boolean }) {
  return (
    <div className="flex items-center gap-[10px] px-[16px] py-[10px] border-b border-line last:border-b-0">
      <span className="w-[36px] text-[12px] text-muted">{time}</span>
      {actorType === 'agent' && area ? (
        <Mascot size={20} radius={0} area={area as any} tile={false} />
      ) : (
        <PersonAvatar initials={actor.slice(0, 2).toUpperCase()} />
      )}
      <p className="min-w-0 flex-1 text-[12.5px] text-ink">
        <span className="font-medium">{actor}</span>
        {' '}{verb}{' '}
        <span className="text-ink-2">{target}</span>
      </p>
      <span className={`rounded-pill px-[8px] py-[1px] text-[11px] ${isSettings ? 'text-muted' : 'text-muted border border-line-strong bg-soft'}`}>
        {isSettings ? (
          <span className="flex items-center gap-[4px]">
            <span>⚙</span> {channel}
          </span>
        ) : channel}
      </span>
    </div>
  )
}

export function SectionActivity() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Activity log" />
        <div className="ml-auto">
          <Button variant="secondary" height={28} icon={Download}>Export CSV</Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Activity log</h1>
        <p className="mb-[20px] text-[13px] text-muted">Everything agents and people did — approvals, changes and sends.</p>

        {/* Filters row */}
        <div className="mb-[16px] flex items-center justify-between">
          <div className="flex gap-[4px]">
            {FILTERS.map((f, i) => (
              <button
                key={f}
                type="button"
                className={`rounded-pill px-[10px] py-[4px] text-[12px] transition-colors ${
                  i === 0 ? 'bg-ink text-white' : 'text-muted hover:text-ink hover:bg-hover'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-[6px] rounded-btn border border-line-strong bg-surface px-[10px] py-[4px]">
            <span className="text-[13px]">📅</span>
            <span className="text-[12px] text-ink">Last 7 days</span>
            <svg width="12" height="12" viewBox="0 0 12 12" className="text-muted" aria-hidden>
              <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        {/* Events */}
        <div className="overflow-hidden rounded-lg border border-line-strong bg-surface">
          {/* Today */}
          <div className="border-b border-line bg-soft px-[16px] py-[8px]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.8px] text-faint">Today</span>
          </div>
          {EVENTS.map((e) => <EventRow key={`${e.time}-${e.actor}`} {...e} />)}

          {/* Yesterday */}
          <div className="border-b border-line border-t bg-soft px-[16px] py-[8px]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.8px] text-faint">Yesterday</span>
          </div>
          {EVENTS_YESTERDAY.map((e) => <EventRow key={`${e.time}-${e.actor}`} {...e} isSettings={e.isSettings} />)}
        </div>
      </SectionPane>
    </div>
  )
}
