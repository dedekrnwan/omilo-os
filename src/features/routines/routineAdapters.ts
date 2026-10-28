/**
 * Pure adapter functions: map backend `Routine` domain type to the rich UI
 * display types used by ListView, Drawers, and WeekView.
 *
 * The backend `Routine` shape (P8-T1) is flat and does not yet expose:
 *   - sendsTo   (TODO: backend will expose delivery channels)
 *   - runs      (TODO: backend will expose run history)
 *   - nextRun   (TODO: backend will expose human-readable next-run label)
 *   - lastRun   (TODO: backend will expose human-readable last-run label)
 *   - cost      (TODO: backend will expose per-run cost estimate)
 *
 * Each stub is marked with a comment so they are easy to replace when the
 * backend adds the field.
 */

import type { Routine } from '../../core/domain/types'
import type { Frequency, RoutineDetail, RoutineGroup, RoutineRow, RunResult } from './data'

// ── helpers ───────────────────────────────────────────────────────────────────

/** Map a backend freq string to the UI Frequency type. */
function mapFreq(freq: string): Frequency {
  const f = freq.toLowerCase()
  if (f === 'daily') return 'Daily'
  if (f === 'weekdays') return 'Weekdays'
  if (f === 'weekly') return 'Weekly'
  if (f === 'monthly') return 'Monthly'
  // Capitalise first letter as fallback
  return (freq.charAt(0).toUpperCase() + freq.slice(1)) as Frequency
}

/** Format an ISO timestamp to a short human label like "Mon 07:30". */
function formatAt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${wd} ${h}:${m}`
}

/** Produce 8 stub "none" run results — will be replaced when backend exposes history. */
function stubRuns(): RunResult[] {
  // TODO: replace with real run history from the backend
  return Array<RunResult>(8).fill('none')
}

// ── public adapters ───────────────────────────────────────────────────────────

/**
 * Map a backend `Routine` to the `RoutineDetail` shape expected by `RoutineDrawer`
 * and `RoutineDetailRoute`.
 */
export function routineToDetail(r: Routine): RoutineDetail {
  return {
    id: r.id,
    name: r.name,
    agentId: r.helperId,
    subtitle: r.subtitle,
    frequency: mapFreq(r.freq),
    at: r.at,
    zone: r.timezone,
    instructions: r.instructions,
    // TODO: backend will expose delivery channels
    sendsTo: [],
    // TODO: backend will expose human-readable next-run label
    nextRun: formatAt(r.nextAt),
    // TODO: backend will expose human-readable last-run label
    lastRun: r.lastAt ? formatAt(r.lastAt) : '—',
    // TODO: backend will expose per-run cost estimate
    cost: '—',
    // TODO: backend will expose run history
    runs: [],
    days: r.days.length > 0 ? r.days : undefined,
    monthly: (r.monthly as RoutineDetail['monthly']) ?? undefined,
    managedByChief: r.managedByChief,
  }
}

/**
 * Map a backend `Routine` to the `RoutineRow` shape expected by `ListView`.
 */
export function routineToRow(r: Routine): RoutineRow {
  return {
    id: r.id,
    name: r.name,
    agentId: r.helperId,
    when: `${mapFreq(r.freq)} · ${r.at}`,
    next: formatAt(r.nextAt),
    paused: r.paused,
    // TODO: backend will expose run history; stub 8 "none" bars for now
    runs: stubRuns(),
    by: r.managedByChief ? 'chief' : 'you',
  }
}

/**
 * Group a list of backend `Routine`s into the `RoutineGroup[]` shape expected
 * by `ListView`.  Groups by `helperId`; order follows first occurrence.
 */
export function routinesToGroups(routines: Routine[]): RoutineGroup[] {
  const order: string[] = []
  const map = new Map<string, RoutineRow[]>()

  for (const r of routines) {
    const key = r.helperId
    if (!map.has(key)) {
      order.push(key)
      map.set(key, [])
    }
    map.get(key)!.push(routineToRow(r))
  }

  return order.map(agentId => ({
    agentId,
    count: map.get(agentId)!.length,
    rows: map.get(agentId)!,
  }))
}
