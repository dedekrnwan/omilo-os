/**
 * Office · Routines (pen diQBZ / I5rrK / VUmu8 / xuAoe + states) — view types
 * and pure helpers. All data comes from the repos/commands ports; nothing in
 * here is fixture data except the starter TEMPLATES offered on the empty state.
 */
import { tokensLabel } from '../../app/tokens'
import type {
  HelperArea,
  RoutineRunDetail,
  RoutineRunSummary,
  RoutineScheduleItem,
} from '../../core/domain/types'
import { helperColor } from '../../ui/tokens'

export type RoutinesView = 'week' | 'list'

/** Interactive states of the Routines screen, reachable with `?state=`. */
export type RoutinesState =
  | 'empty' // diQBZ
  | 'failed' // l6KQtK
  | 'applied' // FcmwG
  | 'menu' // aufEI
  | 'delete' // o05E12
  | 'new' // F4RGvz
  | 'clash' // oY6x7

/** Drawer states of a routine, reachable with `/routines/$routineId?state=`. */
export type RoutineDrawerState = 'detail' | 'running' | 'paused' | 'output' | 'reassign'

/** A helper as the routines screens need it (name + mascot area). */
export interface HelperInfo {
  id: string
  name: string
  area: HelperArea
}

const AREAS: HelperArea[] = ['brand', 'ops', 'dev', 'support', 'finance', 'marketing', 'sales', 'retro']
export const asArea = (a: string | undefined): HelperArea =>
  (AREAS as string[]).includes(a ?? '') ? (a as HelperArea) : 'ops'

export const colorOfArea = (area: HelperArea) => helperColor[area] ?? helperColor.ops

// ── Dates ─────────────────────────────────────────────────────────────────────

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const p2 = (n: number) => String(n).padStart(2, '0')

export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const parse = (iso: string | null | undefined): Date | null => {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

/** "Mon 07:30" */
export function fmtDayTime(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? `${WD[d.getDay()]} ${p2(d.getHours())}:${p2(d.getMinutes())}` : '—'
}

/** "Mon 27" */
export function fmtDayDate(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? `${WD[d.getDay()]} ${d.getDate()}` : '—'
}

/** "Fri 23 · 07:30" */
export function fmtShort(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? `${WD[d.getDay()]} ${d.getDate()} · ${p2(d.getHours())}:${p2(d.getMinutes())}` : '—'
}

/** "Fri 23 Oct, 07:30" */
export function fmtLong(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}, ${p2(d.getHours())}:${p2(d.getMinutes())}` : '—'
}

/** "Mon, Nov 3" */
export function fmtMonthDay(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? `${WD[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()}` : '—'
}

/** "07:30:12" */
export function fmtClock(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}` : '—'
}

/** 110 → "1m 50s" */
export function fmtDuration(secs: number | null | undefined): string {
  if (secs == null) return '—'
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

export const fmtTokens = (t: number | null | undefined) => (t == null ? '—' : tokensLabel(t))

/** Local yyyy-mm-dd for <input type="date">. */
export function toDateInput(iso: string | null | undefined): string {
  const d = parse(iso)
  return d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : ''
}

// ── Week ──────────────────────────────────────────────────────────────────────

export interface WeekRange {
  /** Monday 00:00 local */
  start: Date
  /** next Monday 00:00 local */
  end: Date
  /** "Oct 19 – 25" */
  label: string
  /** "MON 19" … "SUN 25" */
  days: string[]
  /** 0..6 when today is in the week, else -1 */
  todayIndex: number
}

export function weekRange(offset: number, now = new Date()): WeekRange {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7)
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  const last = new Date(end)
  last.setDate(end.getDate() - 1)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return `${WD[d.getDay()].toUpperCase()} ${d.getDate()}`
  })
  const label =
    start.getMonth() === last.getMonth()
      ? `${MO[start.getMonth()]} ${start.getDate()} – ${last.getDate()}`
      : `${MO[start.getMonth()]} ${start.getDate()} – ${MO[last.getMonth()]} ${last.getDate()}`
  const todayIndex = now >= start && now < end ? (now.getDay() + 6) % 7 : -1
  return { start, end, label, days, todayIndex }
}

export interface WeekChip {
  id: string
  routineId: string
  time: string
  label: string
  /** First day column (0 = Mon) */
  day: number
  /** Number of day columns spanned */
  span: number
  /** Stack row inside the lane (0 = top) */
  row: number
  /** Failed run (red chip) */
  failed?: boolean
  runId?: string | null
  /** ISO time of the slot */
  at: string
}

export interface WeekLane {
  agentId: string
  count: number
  height: number
  chips: WeekChip[]
}

const dayIndex = (d: Date, start: Date) => Math.floor((d.getTime() - start.getTime()) / 86_400_000)

/**
 * Group schedule slots into helper lanes. Consecutive days of the same routine
 * at the same time collapse into one spanning chip ("Morning brief · weekdays").
 */
export function buildLanes(
  items: RoutineScheduleItem[],
  range: WeekRange,
  routineCount: (helperId: string) => number,
): WeekLane[] {
  const byHelper = new Map<string, RoutineScheduleItem[]>()
  for (const it of items) {
    if (!byHelper.has(it.helperId)) byHelper.set(it.helperId, [])
    byHelper.get(it.helperId)!.push(it)
  }
  const lanes: WeekLane[] = []
  for (const [helperId, its] of byHelper) {
    const chips: Omit<WeekChip, 'row'>[] = []
    const byRoutine = new Map<string, RoutineScheduleItem[]>()
    for (const it of its) {
      if (!byRoutine.has(it.routineId)) byRoutine.set(it.routineId, [])
      byRoutine.get(it.routineId)!.push(it)
    }
    for (const [routineId, rs] of byRoutine) {
      const sorted = [...rs].sort((a, b) => a.at.localeCompare(b.at))
      let run: { first: RoutineScheduleItem; day: number; span: number; time: string } | null = null
      const flush = () => {
        if (!run) return
        const label =
          run.span >= 7 ? `${run.first.name} · every day` : run.span >= 5 ? `${run.first.name} · weekdays` : run.first.name
        chips.push({
          id: `${routineId}-${run.day}`,
          routineId,
          time: run.time,
          label,
          day: run.day,
          span: run.span,
          at: run.first.at,
          runId: run.first.runId,
        })
        run = null
      }
      for (const it of sorted) {
        const d = new Date(it.at)
        const day = dayIndex(d, range.start)
        if (day < 0 || day > 6) continue
        const time = `${p2(d.getHours())}:${p2(d.getMinutes())}`
        if (it.status === 'fail') {
          flush()
          chips.push({ id: `${routineId}-${day}-fail`, routineId, time, label: 'Failed', day, span: 1, failed: true, runId: it.runId, at: it.at })
          continue
        }
        if (run && run.time === time && run.day + run.span === day && it.trigger === 'schedule') {
          run.span += 1
        } else {
          flush()
          run = { first: it, day, span: 1, time }
        }
      }
      flush()
    }
    // Greedy stacking: first row with no overlap.
    const rows: Array<Array<[number, number]>> = []
    const placed: WeekChip[] = chips
      .sort((a, b) => b.span - a.span || a.day - b.day || a.time.localeCompare(b.time))
      .map((c) => {
        let row = rows.findIndex((occ) => occ.every(([s, e]) => c.day + c.span <= s || c.day >= e))
        if (row < 0) {
          rows.push([])
          row = rows.length - 1
        }
        rows[row].push([c.day, c.day + c.span])
        return { ...c, row }
      })
    lanes.push({
      agentId: helperId,
      count: routineCount(helperId),
      height: Math.max(72, 16 + rows.length * 28),
      chips: placed,
    })
  }
  return lanes
}

// ── Banners ───────────────────────────────────────────────────────────────────

export interface Banner {
  tone: 'info' | 'bad' | 'ok'
  title: string
  desc: string
  review: boolean
}

// ── List view (VUmu8) ────────────────────────────────────────────────────────

export type RunResult = 'ok' | 'skip' | 'fail' | 'none'

export interface RoutineRow {
  id: string
  name: string
  agentId: string
  when: string
  next: string
  /** ISO next fire (for the skip-next hint) */
  nextAt?: string | null
  paused?: boolean
  runs: RunResult[]
  /** Run summaries aligned with `runs` (null where there is no run). */
  runRefs: (RoutineRunSummary | null)[]
  by: 'chief' | 'you'
}

export interface RoutineGroup {
  agentId: string
  count: number
  rows: RoutineRow[]
}

export const RUN_STATUS: Record<RunResult, string> = { ok: 'Success', fail: 'Failed', skip: 'Skipped', none: 'No run' }

export interface RunStep {
  t: string
  text: string
  error?: boolean
}
export interface RunLog {
  text: string
  level?: 'warn' | 'error'
}

export interface RunDetail {
  result: RunResult
  status: string
  /** Short label for the tooltip, e.g. "Fri 23 · 07:30". */
  whenShort: string
  /** Long label for the drawer title, e.g. "Fri 23 Oct, 07:30". */
  whenLong: string
  agentId: string
  duration: string
  triggeredBy: string
  cost: string
  attempts: string
  /** One-line summary — success result, or the reason a run was skipped. */
  outcome: string
  /** Failure reason (fail only). */
  error?: string
  /** What the run produced (success only). */
  output?: string[]
  steps: RunStep[]
  logs: RunLog[]
}

const TRIGGER: Record<string, string> = { schedule: 'Schedule', manual: 'You (Run now)', resend: 'Re-send' }

const asResult = (o: string | undefined): RunResult => (o === 'fail' ? 'fail' : o === 'skip' ? 'skip' : o === 'ok' || o === 'running' ? 'ok' : 'none')

/** Tooltip-level detail from a run summary (no extra fetch). */
export function runSummaryDetail(run: RoutineRunSummary, agentId: string): RunDetail {
  const result = asResult(run.outcome)
  return {
    result,
    status: RUN_STATUS[result],
    whenShort: fmtShort(run.at),
    whenLong: fmtLong(run.at),
    agentId,
    duration: fmtDuration(run.duration),
    triggeredBy: TRIGGER[run.trigger ?? 'schedule'] ?? 'Schedule',
    cost: fmtTokens(run.tokens ?? 0),
    attempts: '—',
    outcome: result === 'skip' ? `Skipped — ${run.error ?? 'nothing to do'}` : result === 'fail' ? 'Failed' : 'Completed',
    ...(result === 'fail' ? { error: run.error ?? 'The run failed.' } : {}),
    steps: [],
    logs: [],
  }
}

/** Full drawer detail from GET /v1/routines/{id}/runs/{runId}. */
export function runDetailFromApi(d: RoutineRunDetail): RunDetail {
  const base = runSummaryDetail(d.run, d.routine.helperId)
  return {
    ...base,
    attempts: d.job ? `${d.job.attempts}` : '—',
    cost: fmtTokens(d.job ? (d.job.tokensIn ?? 0) + (d.job.tokensOut ?? 0) : d.run.tokens ?? 0),
    outcome: d.output?.headline ?? base.outcome,
    ...(base.result === 'fail' ? { error: d.job?.error ?? d.run.error ?? 'The run failed.' } : {}),
    ...(base.result === 'ok' && d.output ? { output: d.output.lines.length ? d.output.lines : [d.output.headline] } : {}),
    steps: d.steps.map((s) => ({ t: fmtClock(s.at), text: s.text, error: s.error })),
    logs: d.logs.map((l) => ({
      text: `${fmtClock(l.at)} ${l.level.toUpperCase().padEnd(5)} ${l.text}`,
      level: l.level === 'info' ? undefined : l.level,
    })),
  }
}

/** Pad to 8 bars, oldest → newest (left → right). */
export function lastEight(runs: RoutineRunSummary[] | undefined): { results: RunResult[]; refs: (RoutineRunSummary | null)[] } {
  const last = (runs ?? []).slice(-8)
  const pad = 8 - last.length
  return {
    results: [...Array<RunResult>(pad).fill('none'), ...last.map((r) => asResult(r.outcome))],
    refs: [...Array<null>(pad).fill(null), ...last],
  }
}

// ── Empty state (diQBZ) ──────────────────────────────────────────────────────

/** Starter routines Chief offers on the empty state (product copy, not demo data). */
export interface Template {
  id: string
  name: string
  /** Preferred helper area; falls back to Chief. */
  area: HelperArea
  freq: 'daily' | 'weekdays' | 'weekly' | 'monthly'
  at: string
  days?: number[]
  when: string
  instructions: string
  checked: boolean
}

export const TEMPLATES: Template[] = [
  { id: 't1', name: 'Morning brief', area: 'brand', freq: 'weekdays', at: '07:30', when: 'Weekdays · 07:30', checked: true,
    instructions: 'Summarise what moved yesterday across goals, flag anything at risk, and list today’s decisions. Max 5 bullets.' },
  { id: 't2', name: 'Weekly retro', area: 'brand', freq: 'weekly', days: [4], at: '16:00', when: 'Fridays · 16:00', checked: true,
    instructions: 'Review the week: wins, misses and follow-ups for next week.' },
  { id: 't3', name: 'On-call digest', area: 'ops', freq: 'daily', at: '08:00', when: 'Every day · 08:00', checked: true,
    instructions: 'Summarise open incidents and alerts from the last 24 hours.' },
  { id: 't4', name: 'Invoice chaser', area: 'finance', freq: 'weekdays', at: '10:00', when: 'Weekdays · 10:00', checked: true,
    instructions: 'Check overdue invoices and draft polite reminders.' },
  { id: 't5', name: 'Social calendar', area: 'marketing', freq: 'weekly', days: [0], at: '09:30', when: 'Mondays · 09:30', checked: false,
    instructions: 'Draft this week’s social posts and schedule.' },
  { id: 't6', name: 'Backup check', area: 'ops', freq: 'weekly', days: [6], at: '03:00', when: 'Sundays · 03:00', checked: false,
    instructions: 'Verify last night’s backups completed and can be restored.' },
]

// ── Routine detail (xuAoe and states) ────────────────────────────────────────

export type Frequency = 'Daily' | 'Weekdays' | 'Weekly' | 'Monthly'
export const FREQUENCIES: Frequency[] = ['Daily', 'Weekdays', 'Weekly', 'Monthly']

/** UI label → API value. */
export const freqToApi = (f: Frequency) => f.toLowerCase() as 'daily' | 'weekdays' | 'weekly' | 'monthly'

export interface PastRun {
  id: string
  when: string
  outcome: string
  duration: string
  skipped?: boolean
  failed?: boolean
}

export interface SendTarget {
  icon: 'message-circle' | 'hash'
  label: string
}

export interface RoutineDetail {
  id: string
  name: string
  agentId: string
  subtitle: string
  frequency: Frequency
  at: string
  zone: string
  instructions: string
  sendsTo: SendTarget[]
  nextRun: string
  nextAt: string | null
  lastRun: string
  cost: string
  runs: PastRun[]
  /** Weekly days selected (0 = Mon) */
  days?: number[]
  monthly?: 'date' | 'last-working-day'
  managedByChief: boolean
  paused: boolean
  pausedUntil: string | null
  allowChiefShift: boolean
  skipHolidays: boolean
  askBeforeSending: boolean
  /** Latest run id (newest), for the running/output states. */
  latestRunId: string | null
  latestJobId: string | null
}

export const DELETE_COPY = {
  body: 'Chief stops running it. Past runs and outputs stay in the activity log. You can’t undo this — pause it instead if you might want it back.',
}
