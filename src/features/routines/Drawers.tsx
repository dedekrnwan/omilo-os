import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Calendar,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronUp,
  ChevronsUpDown,
  Circle,
  CircleCheck,
  CircleMinus,
  CirclePause,
  Clock,
  Coins,
  Globe,
  Hash,
  Inbox,
  Loader,
  MessageCircle,
  Pause,
  Play,
  Send,
  Sparkles,
  Square,
  Target,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Workflow,
} from 'lucide-react'
import { IconButton } from '../../ui/ds/Button'
import { Mascot } from '../../ui/ds/Mascot'
import {
  AGENTS,
  FREQUENCIES,
  NEW_ROUTINE,
  PAUSED,
  REASSIGN_OPTIONS,
  RUN_OUTPUT,
  RUNNING,
  type Frequency,
  type RoutineDetail,
  type RoutineDrawerState,
} from './data'
import {
  Chip,
  DangerButton,
  Drawer,
  Field,
  OptionTile,
  PrimaryButton,
  SecondaryButton,
  SectionLabel,
  Segmented,
  ToggleRow,
} from './ui'

const SEND_ICON: Record<string, LucideIcon> = { 'message-circle': MessageCircle, hash: Hash }

// ── Sections ─────────────────────────────────────────────────────────────────

function StatusTiles({ r }: { r: RoutineDetail }) {
  const tiles: { icon: LucideIcon; k: string; v: string; ok?: boolean }[] = [
    { icon: CalendarClock, k: 'Next run', v: r.nextRun },
    { icon: CircleCheck, k: 'Last run', v: r.lastRun, ok: true },
    { icon: Coins, k: 'Cost', v: r.cost },
  ]
  return (
    <div className="flex w-full shrink-0 gap-[10px]">
      {tiles.map((t) => (
        <div key={t.k} className="flex min-w-0 flex-1 flex-col gap-[3px] rounded-md bg-soft p-[10px]">
          <span className="flex items-center gap-[5px]">
            <t.icon size={12} aria-hidden className={t.ok ? 'text-ok' : 'text-muted'} />
            <span className="text-[11.5px] text-muted">{t.k}</span>
          </span>
          <span className="text-[13px] font-semibold text-ink">{t.v}</span>
        </div>
      ))}
    </div>
  )
}

function DayPicker({ days }: { days: number[] }) {
  const [sel, setSel] = useState(() => new Set(days))
  return (
    <div className="flex w-full gap-[6px]" role="group" aria-label="Days">
      {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => {
        const on = sel.has(i)
        return (
          <button
            key={i}
            type="button"
            aria-pressed={on}
            aria-label={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}
            onClick={() =>
              setSel((s) => {
                const n = new Set(s)
                if (n.has(i)) n.delete(i)
                else n.add(i)
                return n
              })
            }
            className={`flex h-[34px] flex-1 items-center justify-center rounded-base text-[12.5px] font-semibold ${
              on ? 'bg-primary text-white' : 'text-ink-2 outline-1 -outline-offset-1 outline-line-strong'
            }`}
          >
            {d}
          </button>
        )
      })}
    </div>
  )
}

function Schedule({ r, holidays, next }: { r: RoutineDetail; holidays: boolean; next?: string }) {
  const [freq, setFreq] = useState<Frequency>(r.frequency)
  const [move, setMove] = useState(true)
  const [skip, setSkip] = useState(true)
  const [monthly, setMonthly] = useState(r.monthly ?? 'date')
  return (
    <section className="flex w-full shrink-0 flex-col gap-[10px]">
      <SectionLabel>Schedule</SectionLabel>
      <Segmented items={FREQUENCIES} value={freq} onChange={setFreq} fill label="Frequency" />
      {freq === 'Weekly' && <DayPicker days={r.days ?? [0]} />}
      {freq === 'Monthly' && (
        <div className="flex w-full gap-[8px]">
          <OptionTile icon={CalendarDays} title="A date" desc="e.g. the 1st" selected={monthly === 'date'} onClick={() => setMonthly('date')} />
          <OptionTile
            icon={CalendarCheck}
            title="Last working day"
            desc="Skips weekends & holidays"
            selected={monthly === 'last-working-day'}
            onClick={() => setMonthly('last-working-day')}
          />
        </div>
      )}
      <div className="flex w-full gap-[10px]">
        <Field label="At" icon={Clock} value={r.at} className="flex-1" />
        <Field label="Time zone" icon={Globe} value={r.zone} chevron className="flex-1" />
      </div>
      <ToggleRow title="Let Chief move this" desc="Chief may shift it up to 1 hour to avoid clashes." on={move} onChange={setMove} />
      {holidays && <ToggleRow title="Skip public holidays" desc="Uses the Indonesian holiday calendar." on={skip} onChange={setSkip} />}
      {next && (
        <span className="flex items-center gap-[6px]">
          <CalendarClock size={13} aria-hidden className="text-muted" />
          <span className="text-[12px] text-muted">{next}</span>
        </span>
      )}
    </section>
  )
}

function WhatItDoes({ r, ask }: { r: RoutineDetail; ask: boolean }) {
  const [askOn, setAskOn] = useState(false)
  return (
    <section className="flex w-full shrink-0 flex-col gap-[10px]">
      <SectionLabel>What it does</SectionLabel>
      <textarea
        aria-label="What it does"
        defaultValue={r.instructions}
        className="h-[64px] w-full resize-none rounded-base bg-surface px-[10px] py-[8px] text-[12.5px] leading-[1.5] text-ink-2 outline-1 -outline-offset-1 outline-line-strong focus:outline-ink"
      />
      <div className="flex w-full items-center gap-[6px]">
        <span className="text-[12px] text-muted">Sends to</span>
        {r.sendsTo.map((s) => (
          <Chip key={s.label} icon={SEND_ICON[s.icon]} label={s.label} />
        ))}
      </div>
      {ask && (
        <ToggleRow
          title="Ask before sending"
          desc="Outputs to customers or the public wait in your Inbox first. Off for internal briefs."
          on={askOn}
          onChange={setAskOn}
        />
      )}
    </section>
  )
}

function RecentRuns({ r, onOpenRun }: { r: RoutineDetail; onOpenRun?: () => void }) {
  return (
    <section className="flex w-full shrink-0 flex-col gap-[10px]">
      <SectionLabel>Recent runs</SectionLabel>
      <ul className="m-0 flex w-full list-none flex-col overflow-hidden rounded-md p-0 outline-1 -outline-offset-1 outline-line-strong">
        {r.runs.map((run, i) => (
          <li key={run.when} className={i < r.runs.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}>
            <button
              type="button"
              onClick={run.skipped ? undefined : onOpenRun}
              className="flex w-full items-center gap-[10px] px-[12px] py-[9px] text-left hover:bg-soft"
            >
              {run.skipped ? (
                <CircleMinus size={14} aria-hidden className="shrink-0 text-faint" />
              ) : (
                <CircleCheck size={14} aria-hidden className="shrink-0 text-ok" />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[12.5px] font-medium text-ink">{run.when}</span>
                <span className="text-[12px] text-muted">{run.outcome}</span>
              </span>
              <span className="text-[12px] text-faint">{run.duration}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** pen `Spinner` (g4C5A): 14 ring, line-strong track, 90° ink arc. */
function Spinner() {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden className="shrink-0 animate-spin motion-reduce:animate-none">
      <circle cx={7} cy={7} r={6} fill="none" stroke="var(--color-line-strong)" strokeWidth={2} />
      <path d="M11.24 2.76A6 6 0 0 1 11.24 11.24" fill="none" stroke="var(--color-ink)" strokeWidth={2} />
    </svg>
  )
}

function RunningBox() {
  const icon = { done: CircleCheck, active: Loader, todo: Circle }
  const tone = { done: 'text-ok', active: 'text-info', todo: 'text-faint' }
  return (
    <section
      aria-label="Running now"
      className="flex w-full shrink-0 flex-col gap-[8px] rounded-lg bg-info-tint p-[12px] outline-1 -outline-offset-1 outline-info-line"
    >
      <div className="flex w-full items-center gap-[8px]">
        <Spinner />
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-info">{RUNNING.title}</span>
        <span className="font-mono text-[12px] text-info">{RUNNING.elapsed}</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(RUNNING.progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-[6px] w-full overflow-hidden rounded-pill bg-[#DBEAFE]"
      >
        <div className="h-full bg-info" style={{ width: `${RUNNING.progress * 100}%` }} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
        {RUNNING.steps.map((s) => {
          const I = icon[s.status]
          return (
            <li key={s.label} className="flex items-center gap-[8px]">
              <I size={13} aria-hidden className={tone[s.status]} />
              <span className={`text-[12.5px] ${s.status === 'todo' ? 'text-muted' : 'text-ink-2'}`}>{s.label}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function PausedBox({ onResume }: { onResume: () => void }) {
  return (
    <section
      aria-label="Paused"
      className="flex w-full shrink-0 flex-col gap-[10px] rounded-lg bg-warn-tint p-[12px] outline-1 -outline-offset-1 outline-warn-line"
    >
      <div className="flex w-full items-center gap-[8px]">
        <CirclePause size={16} aria-hidden className="shrink-0 text-warn" />
        <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <span className="text-[13px] font-semibold text-[#92400E]">{PAUSED.title}</span>
          <span className="text-[12px] text-[#92400E]">{PAUSED.desc}</span>
        </div>
      </div>
      <div className="flex w-full items-center gap-[8px]">
        <Field icon={Calendar} value={PAUSED.until} chevron className="min-w-0 flex-1" />
        <PrimaryButton icon={Play} onClick={onResume}>
          Resume now
        </PrimaryButton>
      </div>
    </section>
  )
}

function WhoDoesIt({ agentId, open: initialOpen }: { agentId: string; open: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const [who, setWho] = useState(agentId)
  const agent = AGENTS[who]
  return (
    <section className="flex w-full shrink-0 flex-col gap-[8px]">
      <SectionLabel tracking={false}>Who does it</SectionLabel>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-[38px] w-full items-center gap-[8px] rounded-base px-[10px] text-left ${
          open ? 'outline-[1.5px] -outline-offset-[1.5px] outline-[#171717]' : 'outline-1 -outline-offset-1 outline-line-strong'
        }`}
      >
        <Mascot size={22} radius={6} area={agent.area} />
        <span className="min-w-0 flex-1 text-[13.5px] font-medium text-ink">{agent.name}</span>
        {open ? (
          <ChevronUp size={14} aria-hidden className="text-muted" />
        ) : (
          <ChevronsUpDown size={14} aria-hidden className="text-muted" />
        )}
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Who does it"
          className="m-0 flex w-full list-none flex-col gap-[1px] rounded-md bg-surface p-[4px] shadow-[0_8px_20px_#0C0A0914] outline-1 -outline-offset-1 outline-line-strong"
        >
          {REASSIGN_OPTIONS.map((o) => {
            const a = AGENTS[o.agentId]
            const sel = o.agentId === who
            return (
              <li key={o.agentId} role="option" aria-selected={sel}>
                <button
                  type="button"
                  onClick={() => {
                    setWho(o.agentId)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-[10px] rounded-btn p-[8px] text-left hover:bg-hover ${sel ? 'bg-hover' : ''}`}
                >
                  <Mascot size={22} radius={6} area={a.area} />
                  <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="text-[13px] font-medium text-ink">{a.name}</span>
                    <span className="text-[11.5px] text-muted">{o.desc}</span>
                  </span>
                  {o.pick && (
                    <span className="rounded-pill bg-[#EEF2FF] px-[7px] py-[2px] text-[11px] font-semibold text-[#4338CA]">
                      Chief’s pick
                    </span>
                  )}
                  {sel && <Check size={14} aria-hidden className="text-ink" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ── Routine drawer (xuAoe · a2xdN · oTi8l · H4Cdpf · rljUL) ─────────────────

export function RoutineDrawer({
  routine: r,
  state,
  onClose,
  onRunNow,
  onPause,
  onResume,
  onStop,
  onSave,
  onOpenRun,
}: {
  routine: RoutineDetail
  state: Exclude<RoutineDrawerState, 'output'>
  onClose: () => void
  onRunNow: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onSave: () => void
  onOpenRun: () => void
}) {
  const editor = r.frequency === 'Weekly' || r.frequency === 'Monthly'
  const plain = state === 'detail' && !editor
  const subtitle = state === 'paused' ? PAUSED.subtitle : r.subtitle

  const footer =
    state === 'running' ? (
      <>
        <span className="h-px flex-1" />
        <DangerButton icon={Square} onClick={onStop}>
          Stop run
        </DangerButton>
      </>
    ) : (
      <>
        <span className="h-px flex-1" />
        {state !== 'paused' && (
          <SecondaryButton icon={Pause} onClick={onPause}>
            Pause
          </SecondaryButton>
        )}
        <SecondaryButton icon={Play} onClick={onRunNow}>
          Run now
        </SecondaryButton>
        <PrimaryButton onClick={onSave}>Save</PrimaryButton>
      </>
    )

  return (
    <Drawer
      title={r.name}
      subtitle={subtitle}
      onClose={onClose}
      footer={footer}
      bodyClass={plain ? 'gap-[14px] px-[24px] py-[16px]' : 'gap-[18px] px-[24px] py-[20px]'}
    >
      {plain && <StatusTiles r={r} />}
      {state === 'running' && <RunningBox />}
      {state === 'paused' && <PausedBox onResume={onResume} />}
      {editor && <WhoDoesIt agentId={r.agentId} open={state === 'reassign'} />}
      <Schedule r={r} holidays={!plain} next={editor ? r.nextDates : undefined} />
      {!editor && <WhatItDoes r={r} ask={plain} />}
      {(plain || state === 'paused') && <RecentRuns r={r} onOpenRun={onOpenRun} />}
    </Drawer>
  )
}

// ── Run output drawer (SHLKI) ────────────────────────────────────────────────

const SOURCE_ICON = { target: Target, inbox: Inbox, workflow: Workflow }

export function RunOutputDrawer({ onClose, onOpenRoutine }: { onClose: () => void; onOpenRoutine: () => void }) {
  const [vote, setVote] = useState<'up' | 'down' | null>(null)
  return (
    <Drawer
      title={RUN_OUTPUT.title}
      subtitle={RUN_OUTPUT.subtitle}
      onClose={onClose}
      footer={
        <>
          <span className="h-px flex-1" />
          <SecondaryButton icon={Send}>Re-send</SecondaryButton>
          <PrimaryButton onClick={onOpenRoutine}>Open routine</PrimaryButton>
        </>
      }
    >
      <div className="flex w-full shrink-0 items-center gap-[8px]">
        <Chip tone="ok" icon={Check} label="Delivered" />
        <span className="text-[12px] whitespace-pre text-muted">{RUN_OUTPUT.delivery}</span>
      </div>
      <article className="flex w-full shrink-0 flex-col gap-[10px] rounded-lg bg-soft p-[16px] outline-1 -outline-offset-1 outline-line">
        <h3 className="m-0 text-[14px] font-semibold text-ink">{RUN_OUTPUT.greeting}</h3>
        {RUN_OUTPUT.bullets.map((b) => (
          <div key={b} className="flex w-full gap-[8px]">
            <span className="text-[13px] text-muted">•</span>
            <span className="min-w-0 flex-1 text-[13px] leading-[1.5] text-ink-2">{b}</span>
          </div>
        ))}
      </article>
      <section className="flex w-full shrink-0 flex-col gap-[8px]">
        <SectionLabel tracking={false}>Read from</SectionLabel>
        <div className="flex gap-[6px]">
          {RUN_OUTPUT.sources.map((s) => (
            <Chip key={s.label} icon={SOURCE_ICON[s.icon]} label={s.label} />
          ))}
        </div>
      </section>
      <div className="flex w-full shrink-0 items-center gap-[8px] pt-[4px]">
        <span className="min-w-0 flex-1 text-[12.5px] text-muted">Was this useful?</span>
        <IconButton icon={ThumbsUp} aria-label="Useful" aria-pressed={vote === 'up'} onClick={() => setVote('up')} />
        <IconButton icon={ThumbsDown} aria-label="Not useful" aria-pressed={vote === 'down'} onClick={() => setVote('down')} />
        <SecondaryButton height={30} fontSize={12} icon={MessageCircle}>
          Discuss
        </SecondaryButton>
      </div>
    </Drawer>
  )
}

// ── New routine drawer (F4RGvz · oY6x7) ──────────────────────────────────────

export function NewRoutineDrawer({ clash, onClose, onCreate }: { clash: boolean; onClose: () => void; onCreate: () => void }) {
  const [move, setMove] = useState(true)
  const [slot, setSlot] = useState(0)
  const who = AGENTS[NEW_ROUTINE.who]
  const rows: { k: string; v: React.ReactNode; edit?: boolean }[] = [
    {
      k: 'Who',
      v: (
        <>
          <Mascot size={18} radius={5} area={who.area} />
          {who.name}
        </>
      ),
    },
    { k: 'When', v: clash ? NEW_ROUTINE.slots[slot].title.replace(' — recommended', '') : NEW_ROUTINE.when, edit: true },
    ...(clash ? [] : [{ k: 'Why then', v: NEW_ROUTINE.why }]),
    { k: 'Sends to', v: NEW_ROUTINE.sendsTo },
    { k: 'Cost', v: NEW_ROUTINE.cost },
  ]
  return (
    <Drawer
      title="New routine"
      subtitle="Describe it — Chief picks who does it and when."
      onClose={onClose}
      footer={
        <>
          <span className="min-w-0 flex-1 text-[12px] text-muted">Nothing runs until you create it</span>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton icon={Check} onClick={onCreate}>
            Create routine
          </PrimaryButton>
        </>
      }
    >
      <label className="flex w-full shrink-0 flex-col gap-[6px]">
        <span className="text-[13px] font-medium text-ink-2">What should happen, and how often?</span>
        <textarea
          defaultValue={NEW_ROUTINE.prompt}
          className="h-[84px] w-full resize-none rounded-base bg-surface px-[10px] py-[8px] text-[13.5px] leading-[1.55] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink"
        />
      </label>
      <section
        aria-label="Chief suggests"
        className="flex w-full shrink-0 flex-col gap-[10px] rounded-lg bg-[#EEF2FF] p-[14px] outline-1 -outline-offset-1 outline-[#C7D2FE]"
      >
        <div className="flex items-center gap-[8px]">
          <Mascot size={20} radius={6} area="brand" />
          <span className="text-[13px] font-semibold text-ink">Chief suggests</span>
        </div>
        <dl className="m-0 flex w-full flex-col gap-[1px] rounded-md bg-surface px-[12px] py-[2px]">
          {rows.map((row, i) => (
            <div key={row.k} className={`flex w-full items-center gap-[10px] py-[8px] ${i < rows.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}>
              <dt className="w-[90px] shrink-0 text-[12.5px] text-muted">{row.k}</dt>
              <dd className="m-0 flex min-w-0 flex-1 items-center gap-[6px] text-[12.5px] font-medium text-ink">{row.v}</dd>
              {row.edit && (
                <button type="button" className="text-[12px] font-medium text-link hover:underline">
                  Change
                </button>
              )}
            </div>
          ))}
        </dl>
        {clash ? (
          <div className="flex w-full flex-col gap-[8px]">
            <span className="flex items-center gap-[6px]">
              <TriangleAlert size={13} aria-hidden className="text-warn" />
              <span className="text-[12px] font-medium text-warn">{NEW_ROUTINE.clash}</span>
            </span>
            <span className="text-[12px] text-ink-2">Chief found 3 open slots:</span>
            <div className="flex w-full flex-col gap-[6px]" role="group" aria-label="Open slots">
              {NEW_ROUTINE.slots.map((s, i) => (
                <OptionTile
                  key={s.title}
                  icon={s.recommended ? Sparkles : CalendarClock}
                  title={s.title}
                  desc={s.desc}
                  selected={slot === i}
                  onClick={() => setSlot(i)}
                />
              ))}
            </div>
          </div>
        ) : (
          <span className="flex items-center gap-[6px]">
            <CircleCheck size={13} aria-hidden className="text-ok" />
            <span className="text-[12px] text-ok">{NEW_ROUTINE.free}</span>
          </span>
        )}
      </section>
      <ToggleRow title="Let Chief move this" desc="Chief may shift it up to 1 hour to avoid clashes." on={move} onChange={setMove} />
    </Drawer>
  )
}
