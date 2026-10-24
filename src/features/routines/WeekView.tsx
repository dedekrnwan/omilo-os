import { CalendarCheck, CircleX, Moon, Sparkles, User } from 'lucide-react'
import { Button } from '../../ui/ds/Button'
import { Mascot } from '../../ui/ds/Mascot'
import { AGENTS, FAILED_RUN, TODAY_INDEX, WEEK_DAYS, colorOf, type Banner, type WeekChip, type WeekLane } from './data'

const AGENT_COL = 150
/** Absolute x of a day column start, as CSS: 150px + (100% − 150px) · i/7 */
const colX = (i: number) => `calc(${AGENT_COL}px + (100% - ${AGENT_COL}px) * ${i} / 7)`
const colW = (n: number) => `calc((100% - ${AGENT_COL}px) * ${n} / 7)`

const BANNER_LOOK = {
  info: { bg: '#EEF2FF', line: '#C7D2FE', desc: '#4338CA' },
  bad: { bg: 'var(--color-bad-tint)', line: '#FECACA', desc: 'var(--color-bad)' },
  ok: { bg: 'var(--color-ok-tint)', line: '#BBF7D0', desc: 'var(--color-ok)' },
}

/** pen `Chief Banner` (NHEbG): r12 · p10/12 · gap12 · Chief 28/r8. */
export function ChiefBanner({ banner, onReview }: { banner: Banner; onReview?: () => void }) {
  const look = BANNER_LOOK[banner.tone]
  return (
    <section
      aria-label="Chief summary"
      className="flex w-full shrink-0 items-center gap-[12px] rounded-lg px-[12px] py-[10px] outline-1 -outline-offset-1"
      style={{ background: look.bg, outlineColor: look.line }}
    >
      <Mascot size={28} radius={8} area="brand" />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13.5px] font-semibold text-ink">{banner.title}</span>
        <span className="text-[12.5px]" style={{ color: look.desc }}>
          {banner.desc}
        </span>
      </div>
      {banner.review && (
        <Button variant="secondary" height={28} icon={Sparkles} onClick={onReview}>
          Review suggestion
        </Button>
      )}
    </section>
  )
}

function Chip({ chip, agentId, onOpen }: { chip: WeekChip; agentId: string; onOpen: (id: string) => void }) {
  const c = colorOf(agentId)
  return (
    <button
      type="button"
      onClick={() => onOpen(chip.routineId)}
      className="absolute flex h-[24px] items-center gap-[6px] overflow-hidden rounded-sm px-[8px] text-left outline-1 -outline-offset-1"
      style={{
        left: `calc(${colX(chip.day)} + 4px)`,
        width: `calc(${colW(chip.span)} - 8px)`,
        top: 8 + chip.row * 28,
        background: `${c}1F`,
        outlineColor: `${c}59`,
      }}
    >
      <span className="h-[12px] w-[3px] shrink-0 rounded-[2px]" style={{ background: c }} />
      <span className="shrink-0 text-[11px] font-semibold whitespace-nowrap text-ink">{chip.time}</span>
      <span className="truncate text-[11px] text-ink-2">{chip.label}</span>
    </button>
  )
}

function Lane({
  lane,
  last,
  failed,
  onOpen,
  onFailed,
}: {
  lane: WeekLane
  last: boolean
  failed: boolean
  onOpen: (id: string) => void
  onFailed?: () => void
}) {
  const agent = AGENTS[lane.agentId]
  return (
    <div
      role="group"
      aria-label={agent.name}
      className={`relative w-full shrink-0 ${last ? '' : 'border-b border-line'}`}
      style={{ height: lane.height }}
    >
      <div
        className="absolute top-0 bg-[#EEF2FF80]"
        style={{ left: colX(TODAY_INDEX), width: colW(1), height: '100%' }}
      />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="absolute top-0 h-full w-px bg-[#F0EFED]" style={{ left: colX(i) }} />
      ))}
      <div className="absolute left-[14px] flex items-center gap-[8px]" style={{ top: (lane.height - 28) / 2 }}>
        <Mascot size={28} radius={8} area={agent.area} />
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-ink">{agent.name}</span>
          <span className="text-[11px] text-muted">{lane.count} routines</span>
        </div>
      </div>
      {lane.chips.map((chip) => (
        <Chip key={chip.id} chip={chip} agentId={lane.agentId} onOpen={onOpen} />
      ))}
      {failed && (
        <button
          type="button"
          data-failed-run
          aria-label="Invoice chaser failed — details"
          onClick={onFailed}
          className="absolute flex h-[24px] items-center gap-[6px] rounded-sm bg-[#FEE2E2] px-[8px] outline-1 -outline-offset-1 outline-[#FCA5A5]"
          style={{
            left: `calc(${colX(FAILED_RUN.day)} + 4px)`,
            width: `calc(${colW(1)} - 8px)`,
            top: 8 + FAILED_RUN.row * 28,
          }}
        >
          <CircleX size={12} aria-hidden className="text-bad" />
          <span className="text-[11px] font-semibold whitespace-nowrap text-bad">{FAILED_RUN.label}</span>
        </button>
      )}
    </div>
  )
}

/** pen `Week Grid` (fxjD6) + `Legend` (VFDxP). */
export function WeekView({
  lanes,
  failed = false,
  onOpen,
  onFailed,
}: {
  lanes: WeekLane[]
  failed?: boolean
  onOpen: (id: string) => void
  onFailed?: () => void
}) {
  return (
    <>
      <div
        role="region"
        aria-label="Routines this week"
        className="flex w-full shrink-0 flex-col overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-line-strong"
      >
        <div className="relative h-[36px] w-full shrink-0 border-b border-line bg-soft">
          <div className="absolute top-0 h-full bg-[#EEF2FF]" style={{ left: colX(TODAY_INDEX), width: colW(1) }} />
          <span className="absolute top-[11px] left-[14px] text-[10.5px] font-medium tracking-[0.8px] text-faint">AGENT</span>
          {WEEK_DAYS.map((d, i) => {
            const today = i === TODAY_INDEX
            return (
              <span
                key={d}
                className={`absolute top-[11px] text-[10.5px] tracking-[0.6px] whitespace-nowrap ${
                  today ? 'font-semibold text-[#4338CA]' : 'font-medium text-faint'
                }`}
                style={{ left: `calc(${colX(i)} + 10px)` }}
              >
                {today ? `${d} · TODAY` : d}
              </span>
            )
          })}
        </div>
        {lanes.map((lane, i) => (
          <Lane
            key={lane.agentId}
            lane={lane}
            last={i === lanes.length - 1}
            failed={failed && lane.agentId === FAILED_RUN.agentId}
            onOpen={onOpen}
            onFailed={onFailed}
          />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-[16px]">
        {[
          { icon: CalendarCheck, t: 'Set by Chief' },
          { icon: User, t: 'Set by you · 3' },
          { icon: Moon, t: 'Quiet hours 21:00–08:00 respected' },
        ].map(({ icon: I, t }) => (
          <span key={t} className="flex items-center gap-[6px]">
            <I size={13} aria-hidden className="text-muted" />
            <span className="text-[12px] text-muted">{t}</span>
          </span>
        ))}
      </div>
    </>
  )
}
