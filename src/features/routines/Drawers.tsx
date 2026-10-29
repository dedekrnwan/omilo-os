import { useMemo, useState } from 'react'
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
  CircleX,
  Clock,
  Coins,
  Globe,
  Hash,
  Inbox,
  Loader,
  MessageCircle,
  Pause,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from 'lucide-react'
import { IconButton } from '../../ui/ds/Button'
import { Mascot } from '../../ui/ds/Mascot'
import { useRoutinePreview } from '../../app/queries'
import type { RoutineRunDetail } from '../../core/domain/types'
import {
  FREQUENCIES,
  asArea,
  browserTimeZone,
  fmtClock,
  fmtCredits,
  fmtDayDate,
  fmtDuration,
  fmtMonthDay,
  fmtShort,
  freqToApi,
  toDateInput,
  type Frequency,
  type RoutineDetail,
  type RoutineDrawerState,
  type RunDetail,
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
import { useHelperLookup } from './useHelperLookup'
import { guessCadence, guessHelper, nameFromPrompt } from './guess'

const SEND_ICON: Record<string, LucideIcon> = { 'message-circle': MessageCircle, hash: Hash }

const toMonthlyApi = (m: RoutineDetail['monthly']) => (m === 'last-working-day' ? 'last_working_day' : 'date')

/** "Next: Mon 27 · Thu 30 · Mon Nov 3" from preview ISO dates. */
function nextLabel(dates: string[] | undefined): string | undefined {
  if (!dates || dates.length === 0) return undefined
  const now = new Date()
  return `Next: ${dates
    .map((iso) => {
      const d = new Date(iso)
      return d.getMonth() === now.getMonth() ? fmtDayDate(iso) : fmtMonthDay(iso).replace(',', '')
    })
    .join(' · ')}`
}

// ── Sections ─────────────────────────────────────────────────────────────────

function StatusTiles({ r }: { r: RoutineDetail }) {
  const tiles: { icon: LucideIcon; k: string; v: string; ok?: boolean }[] = [
    { icon: CalendarClock, k: 'Next run', v: r.nextRun },
    { icon: CircleCheck, k: 'Last run', v: r.lastRun, ok: r.lastRun !== '—' },
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

export function DayPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  const sel = new Set(days)
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
            onClick={() => {
              const n = new Set(sel)
              if (n.has(i)) n.delete(i)
              else n.add(i)
              // Keep at least one day selected.
              if (n.size > 0) onChange([...n].sort())
            }}
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

interface ScheduleDraft {
  freq: Frequency
  at: string
  days: number[]
  monthly: NonNullable<RoutineDetail['monthly']>
  move: boolean
  skip: boolean
}

function Schedule({
  zone,
  holidays,
  next,
  draft,
  onDraft,
}: {
  zone: string
  holidays: boolean
  next?: string
  draft: ScheduleDraft
  onDraft: (patch: Partial<ScheduleDraft>) => void
}) {
  return (
    <section className="flex w-full shrink-0 flex-col gap-[10px]">
      <SectionLabel>Schedule</SectionLabel>
      <Segmented items={FREQUENCIES} value={draft.freq} onChange={(f) => onDraft({ freq: f })} fill label="Frequency" />
      {draft.freq === 'Weekly' && <DayPicker days={draft.days} onChange={(days) => onDraft({ days })} />}
      {draft.freq === 'Monthly' && (
        <div className="flex w-full gap-[8px]">
          <OptionTile
            icon={CalendarDays}
            title="A date"
            desc="The 1st of each month"
            selected={draft.monthly === 'date'}
            onClick={() => onDraft({ monthly: 'date' })}
          />
          <OptionTile
            icon={CalendarCheck}
            title="Last working day"
            desc="Skips weekends & holidays"
            selected={draft.monthly === 'last-working-day'}
            onClick={() => onDraft({ monthly: 'last-working-day' })}
          />
        </div>
      )}
      <div className="flex w-full gap-[10px]">
        <Field label="At" icon={Clock} value={draft.at} onChange={(at) => onDraft({ at })} className="flex-1" />
        <Field label="Time zone" icon={Globe} value={zone} className="flex-1" />
      </div>
      <ToggleRow
        title="Let Chief move this"
        desc="Chief may shift it up to 1 hour to avoid clashes."
        on={draft.move}
        onChange={(move) => onDraft({ move })}
      />
      {holidays && (
        <ToggleRow
          title="Skip public holidays"
          desc="Uses the Indonesian national holiday calendar (fixed-date holidays)."
          on={draft.skip}
          onChange={(skip) => onDraft({ skip })}
        />
      )}
      {next && (
        <span className="flex items-center gap-[6px]">
          <CalendarClock size={13} aria-hidden className="text-muted" />
          <span className="text-[12px] text-muted">{next}</span>
        </span>
      )}
    </section>
  )
}

function WhatItDoes({
  r,
  ask,
  askOn,
  onAsk,
  instructions,
  onInstructions,
}: {
  r: RoutineDetail
  ask: boolean
  askOn: boolean
  onAsk: (v: boolean) => void
  instructions: string
  onInstructions: (v: string) => void
}) {
  return (
    <section className="flex w-full shrink-0 flex-col gap-[10px]">
      <SectionLabel>What it does</SectionLabel>
      <textarea
        aria-label="What it does"
        value={instructions}
        onChange={(e) => onInstructions(e.target.value)}
        className="h-[64px] w-full resize-none rounded-base bg-surface px-[10px] py-[8px] text-[12.5px] leading-[1.5] text-ink-2 outline-1 -outline-offset-1 outline-line-strong focus:outline-ink"
      />
      <div className="flex w-full items-center gap-[6px]">
        <span className="text-[12px] text-muted">Sends to</span>
        {r.sendsTo.length === 0 ? (
          <Chip icon={Inbox} label="Activity log" />
        ) : (
          r.sendsTo.map((s) => <Chip key={s.label} icon={SEND_ICON[s.icon]} label={s.label} />)
        )}
      </div>
      {ask && (
        <ToggleRow
          title="Ask before sending"
          desc="Outputs to customers or the public wait in your Inbox first. Off for internal briefs."
          on={askOn}
          onChange={onAsk}
        />
      )}
    </section>
  )
}

function RecentRuns({ r, onOpenRun }: { r: RoutineDetail; onOpenRun?: (runId: string) => void }) {
  return (
    <section className="flex w-full shrink-0 flex-col gap-[10px]">
      <SectionLabel>Recent runs</SectionLabel>
      {r.runs.length === 0 ? (
        <p className="m-0 rounded-md bg-soft p-[12px] text-[12.5px] text-muted">No runs yet. Use Run now to try it.</p>
      ) : (
        <ul className="m-0 flex w-full list-none flex-col overflow-hidden rounded-md p-0 outline-1 -outline-offset-1 outline-line-strong">
          {r.runs.map((run, i) => (
            <li key={run.id} className={i < r.runs.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}>
              <button
                type="button"
                onClick={run.skipped ? undefined : () => onOpenRun?.(run.id)}
                className="flex w-full items-center gap-[10px] px-[12px] py-[9px] text-left hover:bg-soft"
              >
                {run.skipped ? (
                  <CircleMinus size={14} aria-hidden className="shrink-0 text-faint" />
                ) : run.failed ? (
                  <CircleX size={14} aria-hidden className="shrink-0 text-bad" />
                ) : (
                  <CircleCheck size={14} aria-hidden className="shrink-0 text-ok" />
                )}
                <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="text-[12.5px] font-medium text-ink">{run.when}</span>
                  <span className="truncate text-[12px] text-muted">{run.outcome}</span>
                </span>
                <span className="text-[12px] text-faint">{run.duration}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
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

function elapsed(from: string | null | undefined, to: string | null | undefined): string {
  if (!from) return '0:00'
  const secs = Math.max(0, Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 1000))
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

/** Live run box: polls the run detail while the job is going. */
function RunningBox({ detail, onSeeOutput }: { detail: RoutineRunDetail | null | undefined; onSeeOutput?: () => void }) {
  const running = !detail || detail.running
  const failed = detail?.run.outcome === 'fail'
  const steps = detail?.steps ?? []
  const total = running ? steps.length + 1 : Math.max(steps.length, 1)
  const progress = running ? steps.length / total : 1
  const title = !detail
    ? 'Starting…'
    : running
      ? `Running now · step ${steps.length + 1} of ${total}`
      : failed
        ? `Run failed — ${detail.job?.error ?? detail.run.error ?? 'see the run'}`
        : 'Run finished'
  return (
    <section
      aria-label="Running now"
      className="flex w-full shrink-0 flex-col gap-[8px] rounded-lg bg-info-tint p-[12px] outline-1 -outline-offset-1 outline-info-line"
    >
      <div className="flex w-full items-center gap-[8px]">
        {running ? <Spinner /> : failed ? <CircleX size={14} aria-hidden className="text-bad" /> : <CircleCheck size={14} aria-hidden className="text-ok" />}
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-info">{title}</span>
        <span className="font-mono text-[12px] text-info">{elapsed(detail?.job?.startedAt, detail?.job?.endedAt)}</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-[6px] w-full overflow-hidden rounded-pill bg-[#DBEAFE]"
      >
        <div className="h-full bg-info" style={{ width: `${progress * 100}%` }} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-[8px]">
            {s.error ? (
              <CircleX size={13} aria-hidden className="text-bad" />
            ) : (
              <CircleCheck size={13} aria-hidden className="text-ok" />
            )}
            <span className="text-[12.5px] text-ink-2">{s.text}</span>
          </li>
        ))}
        {running && (
          <li className="flex items-center gap-[8px]">
            <Loader size={13} aria-hidden className="text-info" />
            <span className="text-[12.5px] text-ink-2">Working…</span>
          </li>
        )}
        {!running && !failed && detail?.output && onSeeOutput && (
          <li className="flex items-center gap-[8px]">
            <Circle size={13} aria-hidden className="text-faint" />
            <button type="button" onClick={onSeeOutput} className="text-[12.5px] font-medium text-link hover:underline">
              See output
            </button>
          </li>
        )}
      </ul>
    </section>
  )
}

function PausedBox({
  pausedUntil,
  onUntil,
  onResume,
}: {
  pausedUntil: string | null
  onUntil: (isoDate: string) => void
  onResume: () => void
}) {
  const [today] = useState(() => toDateInput(new Date().toISOString()))
  return (
    <section
      aria-label="Paused"
      className="flex w-full shrink-0 flex-col gap-[10px] rounded-lg bg-warn-tint p-[12px] outline-1 -outline-offset-1 outline-warn-line"
    >
      <div className="flex w-full items-center gap-[8px]">
        <CirclePause size={16} aria-hidden className="shrink-0 text-warn" />
        <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <span className="text-[13px] font-semibold text-[#92400E]">
            {pausedUntil ? `Paused until ${fmtMonthDay(pausedUntil)}` : 'Paused'}
          </span>
          <span className="text-[12px] text-[#92400E]">
            {pausedUntil ? 'It resumes on its own that day — runs before then are skipped.' : 'No runs until you resume it.'}
          </span>
        </div>
      </div>
      <div className="flex w-full items-center gap-[8px]">
        <label className="flex h-[36px] min-w-0 flex-1 items-center gap-[8px] rounded-base bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong">
          <Calendar size={16} aria-hidden className="shrink-0 text-muted" />
          <span className="sr-only">Paused until</span>
          <input
            type="date"
            aria-label="Paused until"
            value={toDateInput(pausedUntil)}
            min={today}
            onChange={(e) => e.target.value && onUntil(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none"
          />
        </label>
        <PrimaryButton icon={Play} onClick={onResume}>
          Resume now
        </PrimaryButton>
      </div>
    </section>
  )
}

function WhoDoesIt({
  who,
  onWho,
  open: initialOpen,
  routineCount,
}: {
  who: string
  onWho: (id: string) => void
  open: boolean
  routineCount: (helperId: string) => number
}) {
  const [open, setOpen] = useState(initialOpen)
  const { helpers, info } = useHelperLookup()
  const agent = info(who)
  const others = helpers.filter((h) => h.id !== who)
  const pick = others.length
    ? others.reduce((a, b) => (routineCount(b.id) < routineCount(a.id) ? b : a)).id
    : null
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
          {helpers.map((h) => {
            const sel = h.id === who
            const n = routineCount(h.id)
            return (
              <li key={h.id} role="option" aria-selected={sel}>
                <button
                  type="button"
                  onClick={() => {
                    onWho(h.id)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-[10px] rounded-btn p-[8px] text-left hover:bg-hover ${sel ? 'bg-hover' : ''}`}
                >
                  <Mascot size={22} radius={6} area={asArea(h.area)} />
                  <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
                    <span className="text-[13px] font-medium text-ink">{h.name}</span>
                    <span className="text-[11.5px] text-muted">
                      {n} routine{n === 1 ? '' : 's'}
                      {h.role ? ` · ${h.role}` : ''}
                    </span>
                  </span>
                  {h.id === pick && (
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

/** The editable fields a routine Save persists. */
export interface RoutineSavePatch {
  instructions: string
  /** API value: daily | weekdays | weekly | monthly */
  freq: string
  at: string
  days: number[]
  monthly: string | null
  helperId: string
  allowChiefShift: boolean
  skipHolidays: boolean
  askBeforeSending: boolean
}

export function RoutineDrawer({
  routine: r,
  state,
  run,
  routineCount,
  onClose,
  onRunNow,
  onPause,
  onPauseUntil,
  onResume,
  onStop,
  onSave,
  onOpenRun,
  onSeeOutput,
}: {
  routine: RoutineDetail
  state: Exclude<RoutineDrawerState, 'output'>
  /** The run shown in the running state (polled). */
  run?: RoutineRunDetail | null
  routineCount: (helperId: string) => number
  onClose: () => void
  onRunNow: () => void
  onPause: () => void
  onPauseUntil: (isoDate: string) => void
  onResume: () => void
  onStop: () => void
  onSave: (patch: RoutineSavePatch) => void
  onOpenRun: (runId: string) => void
  onSeeOutput?: () => void
}) {
  const editor = r.frequency === 'Weekly' || r.frequency === 'Monthly'
  const plain = state === 'detail' && !editor
  const subtitle = state === 'paused' ? r.subtitle.replace(/managed by Chief|set by you/, 'paused') : r.subtitle

  // Editable draft, lifted so Save can persist the whole patch.
  const [instructions, setInstructions] = useState(r.instructions)
  const [who, setWho] = useState(r.agentId)
  const [ask, setAsk] = useState(r.askBeforeSending)
  const [draft, setDraft] = useState<ScheduleDraft>({
    freq: r.frequency,
    at: r.at,
    days: r.days ?? [0],
    monthly: r.monthly ?? 'date',
    move: r.allowChiefShift,
    skip: r.skipHolidays,
  })
  const onDraft = (p: Partial<ScheduleDraft>) => setDraft((d) => ({ ...d, ...p }))

  const preview = useRoutinePreview(
    editor
      ? {
          freq: freqToApi(draft.freq),
          at: draft.at,
          days: draft.days,
          monthly: toMonthlyApi(draft.monthly),
          timezone: r.zone,
          helperId: who,
          excludeId: r.id,
        }
      : null,
  )

  const footer =
    state === 'running' ? (
      <>
        <span className="h-px flex-1" />
        {run && !run.running ? (
          <SecondaryButton icon={RotateCcw} onClick={onRunNow}>
            Run again
          </SecondaryButton>
        ) : (
          <DangerButton icon={Square} onClick={onStop}>
            Stop run
          </DangerButton>
        )}
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
        <PrimaryButton
          onClick={() =>
            onSave({
              instructions,
              freq: freqToApi(draft.freq),
              at: draft.at,
              days: draft.freq === 'Weekly' ? draft.days : [],
              monthly: draft.freq === 'Monthly' ? toMonthlyApi(draft.monthly) : null,
              helperId: who,
              allowChiefShift: draft.move,
              skipHolidays: draft.skip,
              askBeforeSending: ask,
            })
          }
        >
          Save
        </PrimaryButton>
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
      {state === 'running' && <RunningBox detail={run} onSeeOutput={onSeeOutput} />}
      {state === 'paused' && <PausedBox pausedUntil={r.pausedUntil} onUntil={onPauseUntil} onResume={onResume} />}
      {(editor || state === 'reassign') && (
        <WhoDoesIt who={who} onWho={setWho} open={state === 'reassign'} routineCount={routineCount} />
      )}
      <Schedule
        zone={r.zone}
        holidays={!plain}
        next={editor ? nextLabel(preview.data?.nextDates) : undefined}
        draft={draft}
        onDraft={onDraft}
      />
      {!editor && (
        <WhatItDoes r={r} ask={plain} askOn={ask} onAsk={setAsk} instructions={instructions} onInstructions={setInstructions} />
      )}
      {(plain || state === 'paused') && <RecentRuns r={r} onOpenRun={onOpenRun} />}
    </Drawer>
  )
}

// ── Run output drawer (SHLKI) ────────────────────────────────────────────────

function sourceLabel(s: unknown): string {
  if (typeof s === 'string') return s
  const o = (s ?? {}) as Record<string, unknown>
  return String(o.title ?? o.label ?? o.name ?? o.ref ?? 'Source')
}

export function RunOutputDrawer({
  detail,
  loading,
  onClose,
  onOpenRoutine,
  onResend,
  onDiscuss,
  onVote,
}: {
  detail: RoutineRunDetail | null | undefined
  loading?: boolean
  onClose: () => void
  onOpenRoutine: () => void
  onResend: () => void
  onDiscuss: () => void
  onVote: (vote: 'up' | 'down' | null) => void
}) {
  const vote = detail?.run.feedback ?? null
  const d = detail
  const title = d ? `${d.routine.name} · ${fmtDayDate(d.run.at)}` : 'Run output'
  const subtitle = d
    ? `Ran ${fmtClock(d.run.at).slice(0, 5)} · ${fmtDuration(d.run.duration)} · ${fmtCredits(d.run.costCredits)} · by ${d.routine.helperName || 'Helper'}`
    : ''
  const targets = (d?.delivery.sendsTo ?? []).map(sourceLabel)
  return (
    <Drawer
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <span className="h-px flex-1" />
          <SecondaryButton icon={Send} onClick={onResend} disabled={!d}>Re-send</SecondaryButton>
          <PrimaryButton onClick={onOpenRoutine}>Open routine</PrimaryButton>
        </>
      }
    >
      {!d ? (
        <p className="m-0 text-[13px] text-muted">{loading ? 'Loading run…' : 'This run has no output yet.'}</p>
      ) : (
        <>
          <div className="flex w-full shrink-0 items-center gap-[8px]">
            {d.delivery.delivered ? (
              <Chip tone="ok" icon={Check} label="Delivered" />
            ) : d.run.outcome === 'fail' ? (
              <Chip tone="bad" icon={TriangleAlert} label="Failed" />
            ) : (
              <Chip icon={Inbox} label="Saved" />
            )}
            <span className="text-[12px] whitespace-pre text-muted">
              {targets.length ? targets.join('  ·  ') : d.delivery.note ?? 'Activity log'}
            </span>
          </div>
          <article className="flex w-full shrink-0 flex-col gap-[10px] rounded-lg bg-soft p-[16px] outline-1 -outline-offset-1 outline-line">
            <h3 className="m-0 text-[14px] font-semibold text-ink">{d.output?.headline ?? 'No output'}</h3>
            {(d.output?.lines ?? []).map((b, i) => (
              <div key={i} className="flex w-full gap-[8px]">
                <span className="text-[13px] text-muted">•</span>
                <span className="min-w-0 flex-1 text-[13px] leading-[1.5] text-ink-2">{b}</span>
              </div>
            ))}
          </article>
          {d.sources.length > 0 && (
            <section className="flex w-full shrink-0 flex-col gap-[8px]">
              <SectionLabel tracking={false}>Read from</SectionLabel>
              <div className="flex flex-wrap gap-[6px]">
                {d.sources.map((s, i) => (
                  <Chip key={i} icon={Inbox} label={sourceLabel(s)} />
                ))}
              </div>
            </section>
          )}
          <div className="flex w-full shrink-0 items-center gap-[8px] pt-[4px]">
            <span className="min-w-0 flex-1 text-[12.5px] text-muted">Was this useful?</span>
            <IconButton icon={ThumbsUp} aria-label="Useful" aria-pressed={vote === 'up'} onClick={() => onVote(vote === 'up' ? null : 'up')} />
            <IconButton icon={ThumbsDown} aria-label="Not useful" aria-pressed={vote === 'down'} onClick={() => onVote(vote === 'down' ? null : 'down')} />
            <SecondaryButton height={30} fontSize={12} icon={MessageCircle} onClick={onDiscuss}>
              Discuss
            </SecondaryButton>
          </div>
        </>
      )}
    </Drawer>
  )
}

// ── Run detail drawer (Last-8 bar click) ─────────────────────────────────────

const RUN_CHIP = {
  ok: { tone: 'ok' as const, icon: Check },
  fail: { tone: 'bad' as const, icon: TriangleAlert },
  skip: { tone: 'neutral' as const, icon: CircleMinus },
  none: { tone: 'neutral' as const, icon: Circle },
}

function RunStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-[3px] rounded-md bg-soft p-[10px]">
      <span className="text-[11.5px] text-muted">{k}</span>
      <span className="text-[13px] font-semibold text-ink">{v}</span>
    </div>
  )
}

/** Focused view of one run: status, stats, outcome/error, step timeline and raw logs. */
export function RunDetailDrawer({
  detail: d,
  routineName,
  onClose,
  onOpenRoutine,
  onRerun,
}: {
  detail: RunDetail
  routineName: string
  onClose: () => void
  onOpenRoutine: () => void
  onRerun: () => void
}) {
  const chip = RUN_CHIP[d.result]
  const { info } = useHelperLookup()
  const agent = info(d.agentId)
  return (
    <Drawer
      title={`Run — ${d.whenLong}`}
      subtitle={`${routineName} · ${agent.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="h-px flex-1" />
          <SecondaryButton onClick={onOpenRoutine}>Open routine</SecondaryButton>
          {d.result !== 'skip' && d.result !== 'none' && (
            <PrimaryButton icon={RotateCcw} onClick={onRerun}>
              Re-run now
            </PrimaryButton>
          )}
        </>
      }
    >
      <div className="flex w-full shrink-0 items-center gap-[8px]">
        <Chip tone={chip.tone} icon={chip.icon} label={d.status} />
        <span className="text-[12.5px] text-muted">{d.whenShort}</span>
      </div>

      <div className="grid w-full shrink-0 grid-cols-2 gap-[10px]">
        <RunStat k="Duration" v={d.duration} />
        <RunStat k="Triggered by" v={d.triggeredBy} />
        <RunStat k="Cost" v={d.cost} />
        <RunStat k="Attempts" v={d.attempts} />
      </div>

      {d.error ? (
        <section className="flex w-full shrink-0 flex-col gap-[8px]">
          <SectionLabel>Why it failed</SectionLabel>
          <p className="m-0 rounded-md bg-bad-tint p-[12px] text-[12.5px] leading-[1.5] text-bad outline-1 -outline-offset-1 outline-bad-line">
            {d.error}
          </p>
        </section>
      ) : d.output ? (
        <section className="flex w-full shrink-0 flex-col gap-[8px]">
          <SectionLabel>Output</SectionLabel>
          <article className="flex w-full flex-col gap-[8px] rounded-lg bg-soft p-[14px] outline-1 -outline-offset-1 outline-line">
            {d.output.map((b, i) => (
              <div key={i} className="flex w-full gap-[8px]">
                <span className="text-[13px] text-muted">•</span>
                <span className="min-w-0 flex-1 text-[13px] leading-[1.5] text-ink-2">{b}</span>
              </div>
            ))}
          </article>
        </section>
      ) : (
        <p className="m-0 w-full rounded-md bg-soft p-[12px] text-[12.5px] leading-[1.5] text-muted">{d.outcome}</p>
      )}

      {d.steps.length > 0 && (
        <section className="flex w-full shrink-0 flex-col gap-[8px]">
          <SectionLabel>Timeline</SectionLabel>
          <ul className="m-0 flex list-none flex-col p-0">
            {d.steps.map((s, i) => (
              <li
                key={i}
                className={`flex gap-[10px] py-[7px] text-[12.5px] ${i < d.steps.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}
              >
                <span className="w-[62px] shrink-0 font-mono text-[11.5px] text-faint">{s.t}</span>
                <span className={s.error ? 'font-medium text-bad' : 'text-ink-2'}>{s.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.logs.length > 0 && (
        <section className="flex w-full shrink-0 flex-col gap-[8px]">
          <SectionLabel>Logs</SectionLabel>
          <pre className="m-0 max-h-[160px] w-full overflow-auto rounded-md bg-[#1C1917] p-[12px] font-mono text-[11.5px] leading-[1.6] text-[#D6D3D1]">
            {d.logs.map((l, i) => (
              <div key={i} className={l.level === 'error' ? 'text-[#FCA5A5]' : l.level === 'warn' ? 'text-[#FCD34D]' : ''}>
                {l.text}
              </div>
            ))}
          </pre>
        </section>
      )}
    </Drawer>
  )
}

// ── New routine drawer (F4RGvz · oY6x7) ──────────────────────────────────────

/** The data a New routine create submits. */
export interface NewRoutineData {
  prompt: string
  name: string
  helperId: string
  freq: string
  at: string
  days: number[]
  monthly: string | null
  timezone: string
  allowChiefShift: boolean
}

function cadenceText(freq: Frequency, at: string, days: number[], monthly: string): string {
  const plural = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
  const short = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  if (freq === 'Daily') return `Every day · ${at}`
  if (freq === 'Weekdays') return `Weekdays · ${at}`
  if (freq === 'Monthly') return `${monthly === 'last-working-day' ? 'Last working day' : 'The 1st of each month'} · ${at}`
  const ds = days.length ? days : [0]
  return ds.length === 1 ? `${plural[ds[0]]} · ${at}` : `${ds.map((d) => short[d]).join(' & ')} · ${at}`
}

export function NewRoutineDrawer({
  onClose,
  onCreate,
  avgCost,
  busy = false,
}: {
  onClose: () => void
  onCreate: (data: NewRoutineData) => void
  /** Average credits per run for a helper's routines (cost estimate), or null. */
  avgCost: (helperId: string) => number | null
  busy?: boolean
}) {
  const { helpers, info } = useHelperLookup()
  const timezone = useMemo(() => browserTimeZone(), [])
  const [prompt, setPrompt] = useState('')
  const [move, setMove] = useState(true)
  const [editingWhen, setEditingWhen] = useState(false)
  const [editingWho, setEditingWho] = useState(false)
  // Chief "picks who and when" from the description until you change them.
  const [whenOverride, setWhenOverride] = useState<ReturnType<typeof guessCadence> | null>(null)
  const [whoOverride, setWho] = useState<string | null>(null)
  const when = whenOverride ?? guessCadence(prompt)
  const who = whoOverride ?? guessHelper(prompt, helpers)?.id ?? ''
  const setWhen = (fn: (w: ReturnType<typeof guessCadence>) => ReturnType<typeof guessCadence>) => setWhenOverride(fn(when))

  const helper = who ? info(who) : null
  const preview = useRoutinePreview(
    who
      ? {
          freq: freqToApi(when.freq),
          at: when.at,
          days: when.freq === 'Weekly' ? when.days : [],
          monthly: when.freq === 'Monthly' ? toMonthlyApi(when.monthly) : null,
          timezone,
          helperId: who,
        }
      : null,
  )
  const clashes = preview.data?.clashes ?? []
  const slots = preview.data?.suggestedSlots ?? []
  const cost = who ? avgCost(who) : null
  const label = cadenceText(when.freq, when.at, when.days, when.monthly)
  const canCreate = prompt.trim().length > 0 && !!who && /^\d{1,2}:\d{2}$/.test(when.at) && !busy

  const rows: { k: string; v: React.ReactNode; edit?: 'who' | 'when' }[] = [
    {
      k: 'Who',
      v: helper ? (
        <>
          <Mascot size={18} radius={5} area={helper.area} />
          {helper.name}
        </>
      ) : (
        'No helpers yet'
      ),
      edit: 'who',
    },
    { k: 'When', v: label, edit: 'when' },
    { k: 'Next run', v: preview.data?.nextAt ? fmtShort(preview.data.nextAt) : '—' },
    { k: 'Sends to', v: 'Activity log' },
    { k: 'Cost', v: cost != null ? `~${fmtCredits(cost)} a run` : 'Shown after the first run' },
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
          <PrimaryButton
            icon={Check}
            disabled={!canCreate}
            onClick={() =>
              onCreate({
                prompt: prompt.trim(),
                name: nameFromPrompt(prompt.trim()),
                helperId: who,
                freq: freqToApi(when.freq),
                at: when.at,
                days: when.freq === 'Weekly' ? when.days : [],
                monthly: when.freq === 'Monthly' ? toMonthlyApi(when.monthly) : null,
                timezone,
                allowChiefShift: move,
              })
            }
          >
            Create routine
          </PrimaryButton>
        </>
      }
    >
      <label className="flex w-full shrink-0 flex-col gap-[6px]">
        <span className="text-[13px] font-medium text-ink-2">What should happen, and how often?</span>
        <textarea
          aria-label="What should happen, and how often?"
          value={prompt}
          placeholder="e.g. Every Friday afternoon, check which invoices are overdue and send me a short summary."
          onChange={(e) => setPrompt(e.target.value)}
          className="h-[84px] w-full resize-none rounded-base bg-surface px-[10px] py-[8px] text-[13.5px] leading-[1.55] text-ink outline-1 -outline-offset-1 outline-line-strong placeholder:text-faint focus:outline-ink"
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
            <div key={row.k} className={`flex w-full flex-col py-[8px] ${i < rows.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}>
              <div className="flex w-full items-center gap-[10px]">
                <dt className="w-[90px] shrink-0 text-[12.5px] text-muted">{row.k}</dt>
                <dd className="m-0 flex min-w-0 flex-1 items-center gap-[6px] text-[12.5px] font-medium text-ink">{row.v}</dd>
                {row.edit && (
                  <button
                    type="button"
                    aria-label={`Change ${row.k.toLowerCase()}`}
                    className="text-[12px] font-medium text-link hover:underline"
                    onClick={() => (row.edit === 'who' ? setEditingWho((o) => !o) : setEditingWhen((o) => !o))}
                  >
                    {(row.edit === 'who' ? editingWho : editingWhen) ? 'Done' : 'Change'}
                  </button>
                )}
              </div>
              {row.edit === 'who' && editingWho && (
                <select
                  aria-label="Who does it"
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                  className="mt-[8px] h-[32px] rounded-base bg-surface px-[8px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong"
                >
                  {helpers.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              )}
              {row.edit === 'when' && editingWhen && (
                <div className="mt-[8px] flex w-full flex-col gap-[8px]">
                  <Segmented
                    items={FREQUENCIES}
                    value={when.freq}
                    onChange={(f) => {
                      setWhen((w) => ({ ...w, freq: f, days: f === 'Weekly' && w.days.length === 0 ? [0] : w.days }))
                    }}
                    fill
                    label="Frequency"
                  />
                  {when.freq === 'Weekly' && (
                    <DayPicker
                      days={when.days}
                      onChange={(days) => {
                        setWhen((w) => ({ ...w, days }))
                      }}
                    />
                  )}
                  {when.freq === 'Monthly' && (
                    <Segmented
                      items={['The 1st', 'Last working day'] as const}
                      value={when.monthly === 'last-working-day' ? 'Last working day' : 'The 1st'}
                      onChange={(m) => {
                        setWhen((w) => ({ ...w, monthly: m === 'Last working day' ? 'last-working-day' : 'date' }))
                      }}
                      fill
                      label="Day of month"
                    />
                  )}
                  <input
                    type="time"
                    aria-label="Set time"
                    value={when.at}
                    onChange={(e) => {
                      setWhen((w) => ({ ...w, at: e.target.value }))
                    }}
                    className="h-[32px] w-[120px] rounded-base bg-surface px-[8px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong"
                  />
                </div>
              )}
            </div>
          ))}
        </dl>
        {clashes.length > 0 ? (
          <div className="flex w-full flex-col gap-[8px]">
            <span className="flex items-center gap-[6px]">
              <TriangleAlert size={13} aria-hidden className="text-warn" />
              <span className="text-[12px] font-medium text-warn">
                {label} clashes with {clashes[0].name}
              </span>
            </span>
            {slots.length > 0 ? (
              <>
                <span className="text-[12px] text-ink-2">
                  Chief found {slots.length} open slot{slots.length === 1 ? '' : 's'}:
                </span>
                <div className="flex w-full flex-col gap-[6px]" role="group" aria-label="Open slots">
                  {slots.map((s) => (
                    <OptionTile
                      key={s.at}
                      icon={s.recommended ? Sparkles : CalendarClock}
                      title={`${cadenceText(when.freq, s.at, when.days, when.monthly)}${s.recommended ? ' — recommended' : ''}`}
                      desc={s.reason}
                      selected={false}
                      onClick={() => {
                        setWhen((w) => ({ ...w, at: s.at }))
                      }}
                    />
                  ))}
                </div>
              </>
            ) : (
              <span className="text-[12px] text-ink-2">No free slot nearby — pick another time.</span>
            )}
          </div>
        ) : helper && preview.data ? (
          <span className="flex items-center gap-[6px]">
            <CircleCheck size={13} aria-hidden className="text-ok" />
            <span className="text-[12px] text-ok">
              No clashes — {helper.name} is free at {when.at}
            </span>
          </span>
        ) : null}
      </section>
      <ToggleRow title="Let Chief move this" desc="Chief may shift it up to 1 hour to avoid clashes." on={move} onChange={setMove} />
    </Drawer>
  )
}
