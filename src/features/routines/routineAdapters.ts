/**
 * Pure adapters: backend `Routine` (+ its runs) → the view shapes used by
 * ListView, Drawers and WeekView.
 */
import type { Routine } from '../../core/domain/types'
import {
  fmtTokens,
  fmtDayTime,
  fmtDuration,
  fmtShort,
  lastEight,
  type Frequency,
  type PastRun,
  type RoutineDetail,
  type RoutineGroup,
  type RoutineRow,
  type SendTarget,
} from './data'

/** Map a backend freq string to the UI Frequency type. */
export function mapFreq(freq: string): Frequency {
  const f = freq.toLowerCase()
  if (f === 'weekdays') return 'Weekdays'
  if (f === 'weekly') return 'Weekly'
  if (f === 'monthly') return 'Monthly'
  return 'Daily'
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_PLURAL = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']

/** "Weekdays · 07:30", "Mon & Thu · 09:00", "Last working day · 09:00" */
export function cadenceLabel(r: Pick<Routine, 'freq' | 'at' | 'days' | 'monthly'>): string {
  const f = mapFreq(r.freq)
  if (f === 'Daily') return `Every day · ${r.at}`
  if (f === 'Weekdays') return `Weekdays · ${r.at}`
  if (f === 'Monthly') {
    return (r.monthly ?? '').replace('-', '_') === 'last_working_day'
      ? `Last working day · ${r.at}`
      : `Monthly · ${r.at}`
  }
  const days = [...new Set(r.days.length ? r.days : [0])].sort()
  if (days.length === 1) return `${DAY_PLURAL[days[0]]} · ${r.at}`
  return `${days.map((d) => DAY_NAMES[d]).join(' & ')} · ${r.at}`
}

/** sends_to entries are free-form JSON: {channel,id} | {kind,label} | string. */
export function sendTargets(sendsTo: unknown[]): SendTarget[] {
  return sendsTo.map((s) => {
    if (typeof s === 'string') return { icon: s.startsWith('#') ? 'hash' : 'message-circle', label: s }
    const o = (s ?? {}) as Record<string, unknown>
    const label = String(o.label ?? o.name ?? o.channel ?? o.kind ?? 'Destination')
    const channel = String(o.channel ?? o.kind ?? '')
    const pretty = channel === 'whatsapp' ? 'WhatsApp' : channel === 'chat' || channel === 'area' ? `#${o.name ?? label}` : label
    return { icon: pretty.startsWith('#') ? 'hash' : 'message-circle', label: o.label ? label : pretty }
  })
}

function pastRuns(r: Routine): PastRun[] {
  // Detail endpoint returns newest first; list rows are oldest → newest.
  const runs = [...(r.runs ?? [])].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  return runs.slice(0, 5).map((run) => ({
    id: run.id,
    when: fmtShort(run.at),
    outcome:
      run.outcome === 'skip'
        ? `Skipped — ${run.error ?? 'nothing to do'}`
        : run.outcome === 'fail'
          ? `Failed — ${run.error ?? 'see run'}`
          : run.outcome === 'running'
            ? 'Running…'
            : `Done · ${fmtTokens((run.tokens ?? 0))}`,
    duration: fmtDuration(run.duration),
    skipped: run.outcome === 'skip',
    failed: run.outcome === 'fail',
  }))
}

function avgTokens(r: Routine): string {
  const paid = (r.runs ?? []).filter((x) => x.outcome === 'ok' && (x.tokens ?? 0) > 0)
  if (paid.length === 0) return '—'
  const avg = Math.round(paid.reduce((s, x) => s + (x.tokens ?? 0), 0) / paid.length)
  return `~${fmtTokens(avg)} a run`
}

function lastRunLabel(r: Routine): string {
  const runs = [...(r.runs ?? [])].filter((x) => x.outcome !== 'skip').sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  const last = runs[0]
  if (!last) return r.lastAt ? fmtDayTime(r.lastAt) : '—'
  const day = fmtDayTime(last.at).split(' ')[0]
  return last.duration != null ? `${day} · ${fmtDuration(last.duration)}` : day
}

/**
 * Map a backend `Routine` to the `RoutineDetail` shape expected by `RoutineDrawer`.
 * `helperName` builds the subtitle when the backend has none.
 */
export function routineToDetail(r: Routine, helperName = 'Helper'): RoutineDetail {
  const sorted = [...(r.runs ?? [])].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  const latest = sorted.find((x) => x.jobId) ?? sorted[0]
  return {
    id: r.id,
    name: r.name,
    agentId: r.helperId,
    subtitle:
      r.subtitle ||
      `${helperName} · ${cadenceLabel(r).toLowerCase().replace(' · ', ' at ')} · ${r.managedByChief ? 'managed by Chief' : 'set by you'}`,
    frequency: mapFreq(r.freq),
    at: r.at,
    zone: r.timezone,
    instructions: r.instructions,
    sendsTo: sendTargets(r.sendsTo ?? []),
    nextRun: r.paused ? 'Paused' : fmtDayTime(r.nextAt),
    nextAt: r.nextAt,
    lastRun: lastRunLabel(r),
    cost: avgTokens(r),
    runs: pastRuns(r),
    days: r.days.length > 0 ? r.days : undefined,
    monthly: r.monthly ? ((r.monthly.replace(/_/g, '-') as RoutineDetail['monthly'])) : undefined,
    managedByChief: r.managedByChief,
    paused: r.paused,
    pausedUntil: r.pausedUntil ?? null,
    allowChiefShift: r.allowChiefShift ?? true,
    skipHolidays: r.skipHolidays ?? false,
    askBeforeSending: r.askBeforeSending ?? false,
    latestRunId: latest?.id ?? null,
    latestJobId: latest?.jobId ?? null,
  }
}

/** Map a backend `Routine` to the `RoutineRow` shape expected by `ListView`. */
export function routineToRow(r: Routine): RoutineRow {
  const { results, refs } = lastEight(
    [...(r.runs ?? [])].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')),
  )
  return {
    id: r.id,
    name: r.name,
    agentId: r.helperId,
    when: cadenceLabel(r),
    next: r.paused ? 'Paused' : fmtDayTime(r.nextAt),
    nextAt: r.nextAt,
    paused: r.paused,
    runs: results,
    runRefs: refs,
    by: r.managedByChief ? 'chief' : 'you',
  }
}

/** Group routines by `helperId`; order follows first occurrence. */
export function routinesToGroups(routines: Routine[]): RoutineGroup[] {
  const order: string[] = []
  const map = new Map<string, RoutineRow[]>()
  for (const r of routines) {
    if (!map.has(r.helperId)) {
      order.push(r.helperId)
      map.set(r.helperId, [])
    }
    map.get(r.helperId)!.push(routineToRow(r))
  }
  return order.map((agentId) => ({ agentId, count: map.get(agentId)!.length, rows: map.get(agentId)! }))
}
