/**
 * sweep/goals-routines — mock-mode behaviour for routines + goals.
 *
 * Keeps the offline demo believable: a few more routines across helpers,
 * run history, a schedule expanded from each routine's cadence, run detail,
 * clash preview, Chief suggestions and goal status/due/period fields.
 * Mutates the shared fixtures once at import (idempotent).
 */
import type {
  Goal,
  GoalDetail,
  Routine,
  RoutinePreview,
  RoutineRunDetail,
  RoutineRunSummary,
  RoutineSchedule,
  RoutineScheduleItem,
  RoutineSuggestion,
  Session,
} from '../../core/domain/types'
import { goals, helpers, routines } from './fixtures'

const DAY = 86_400_000

// ── Extra demo routines + goal fields ─────────────────────────────────────────

const base = (r: Partial<Routine> & Pick<Routine, 'id' | 'helperId' | 'name' | 'freq' | 'at'>): Routine => ({
  companyId: 'cmp-1',
  subtitle: '',
  instructions: '',
  days: [],
  monthly: null,
  timezone: 'Asia/Jakarta',
  cron: '',
  sendsTo: [],
  enabled: true,
  paused: false,
  managedByChief: true,
  nextAt: null,
  lastAt: null,
  goalIds: [],
  createdBy: 'operator',
  allowChiefShift: true,
  skipHolidays: false,
  askBeforeSending: false,
  pausedUntil: null,
  ...r,
})

const EXTRA: Routine[] = [
  base({ id: 'rtn-nightly-build', helperId: 'h-dev', name: 'Nightly build check', freq: 'weekdays', at: '01:00',
    instructions: 'Check last night’s CI runs and flag anything red.' }),
  base({ id: 'rtn-deps', helperId: 'h-dev', name: 'Dependency updates', freq: 'weekly', days: [0], at: '10:00',
    instructions: 'Open PRs for safe dependency bumps.' }),
  base({ id: 'rtn-ig-report', helperId: 'h-growth', name: 'Instagram report', freq: 'weekly', days: [0], at: '09:15',
    instructions: 'Roll up last week’s posts, reach and saves.', managedByChief: false }),
  base({ id: 'rtn-social-plan', helperId: 'h-growth', name: 'Social plan', freq: 'weekly', days: [0], at: '09:30',
    instructions: 'Draft this week’s social calendar.' }),
]

let seeded = false

/** Per-routine run history, oldest → newest. */
export const mockRuns: Record<string, RoutineRunSummary[]> = {}

function seed() {
  if (seeded) return
  seeded = true
  for (const r of EXTRA) if (!routines.some((x) => x.id === r.id)) routines.push(r)
  for (const r of routines) {
    r.allowChiefShift ??= true
    r.skipHolidays ??= false
    r.askBeforeSending ??= false
    r.pausedUntil ??= null
    r.nextAt = nextFireOf(r, new Date())?.toISOString() ?? r.nextAt
    // 8 past runs; the dev deps job failed twice to give the UI a failure.
    const fires = pastFires(r, 8)
    mockRuns[r.id] = fires.map((at, i) => {
      const fail = r.id === 'rtn-deps' && i === fires.length - 1
      const skip = r.id === 'rtn-weekly-report' && i === 5
      return {
        id: `rrn-${r.id}-${i}`,
        routineId: r.id,
        jobId: skip ? null : `job-${r.id}-${i}`,
        at: at.toISOString(),
        outcome: fail ? 'fail' : skip ? 'skip' : 'ok',
        duration: skip ? null : 60 + ((i * 17) % 90),
        costCredits: skip ? 0 : 2 + (i % 3),
        tokens: skip ? 0 : 14_000 + (i % 3) * 6_500,
        trigger: 'schedule',
        error: fail ? 'GitHub connection expired — no PRs were opened.' : skip ? 'a public holiday' : null,
        feedback: null,
      }
    })
    r.lastAt = mockRuns[r.id].at(-1)?.at ?? r.lastAt
    r.runs = mockRuns[r.id].slice(-8)
  }
  const extras: Record<string, Partial<Goal>> = {
    'g-books': { status: 'on_track', due: '2026-11-07', period: '2026-Q4', measuredBy: 'Accounts reconciled', target: '100%' },
    'g-referral': { status: 'at_risk', due: '2026-11-20', period: '2026-Q4', target: '500 referrals' },
    'g-passkeys': { status: 'needs_you', due: '2026-12-15', period: '2026-Q4', helperIds: ['h-dev'] },
    'g-pg16': { status: 'blocked', due: '2026-11-30', period: '2026-Q4', helperIds: ['h-dev'] },
    'g-ci': { status: 'on_track', period: '2026-Q4' },
    'g-uptime': { status: 'on_track', period: '2026-Q4', measuredBy: 'API uptime (30d)', target: '99.95%' },
  }
  for (const g of goals) Object.assign(g, { status: 'on_track', period: '2026-Q4' }, extras[g.id] ?? {})
}

// ── Cadence (local-time approximation of the backend's cron maths) ────────────

const norm = (f: string) => f.toLowerCase()
const minutes = (at: string) => {
  const [h, m] = at.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function lastWorkingDay(y: number, m: number): number {
  const d = new Date(y, m + 1, 0)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
  return d.getDate()
}

function firesOn(r: Pick<Routine, 'freq' | 'days' | 'monthly'>, d: Date): boolean {
  const wd = (d.getDay() + 6) % 7 // 0 = Mon
  const f = norm(r.freq)
  if (f === 'weekdays') return wd < 5
  if (f === 'weekly') return (r.days.length ? r.days : [0]).includes(wd)
  if (f === 'monthly') {
    return (r.monthly ?? 'date').replace('-', '_') === 'last_working_day'
      ? d.getDate() === lastWorkingDay(d.getFullYear(), d.getMonth())
      : d.getDate() === 1
  }
  return true
}

function at(d: Date, hhmm: string): Date {
  const x = new Date(d)
  x.setHours(0, minutes(hhmm), 0, 0)
  return x
}

function fires(r: Pick<Routine, 'freq' | 'days' | 'monthly' | 'at'>, from: Date, to: Date): Date[] {
  const out: Date[] = []
  const d = new Date(from)
  d.setHours(0, 0, 0, 0)
  while (d <= to) {
    if (firesOn(r, d)) {
      const t = at(d, r.at)
      if (t > from && t <= to) out.push(t)
    }
    d.setDate(d.getDate() + 1)
  }
  return out
}

function nextFireOf(r: Pick<Routine, 'freq' | 'days' | 'monthly' | 'at'>, after: Date): Date | null {
  return fires(r, after, new Date(after.getTime() + 400 * DAY))[0] ?? null
}

function pastFires(r: Routine, n: number): Date[] {
  const now = new Date()
  return fires(r, new Date(now.getTime() - 120 * DAY), now).slice(-n)
}

seed()

// ── Repo reads ─────────────────────────────────────────────────────────────────

export function mockSchedule(from: string, to: string): RoutineSchedule {
  const start = new Date(from)
  const end = new Date(to)
  const now = new Date()
  const items: RoutineScheduleItem[] = []
  for (const r of routines) {
    if (!r.enabled) continue
    const runs = mockRuns[r.id] ?? []
    const used = new Set<string>()
    for (const t of fires(r, new Date(start.getTime() - 1000), end)) {
      const match = runs.find((x) => !used.has(x.id) && x.at && Math.abs(new Date(x.at).getTime() - t.getTime()) < 15 * 60_000)
      if (match) used.add(match.id)
      items.push({
        routineId: r.id,
        helperId: r.helperId,
        name: r.name,
        at: t.toISOString(),
        status: match ? match.outcome : t <= now ? 'ok' : r.paused ? 'paused' : 'scheduled',
        runId: match?.id ?? null,
        trigger: 'schedule',
      })
    }
    for (const x of runs) {
      if (used.has(x.id) || !x.at) continue
      const t = new Date(x.at)
      if (t < start || t > end || x.trigger === 'schedule') continue
      items.push({ routineId: r.id, helperId: r.helperId, name: r.name, at: x.at, status: x.outcome, runId: x.id, trigger: x.trigger ?? 'manual' })
    }
  }
  items.sort((a, b) => a.at.localeCompare(b.at))
  return { from, to, items }
}

export function mockRunDetail(routineId: string, runId: string): RoutineRunDetail | null {
  const r = routines.find((x) => x.id === routineId)
  const run = (mockRuns[routineId] ?? []).find((x) => x.id === runId)
  if (!r || !run) return null
  const h = helpers.find((x) => x.id === r.helperId)
  const t0 = run.at ? new Date(run.at) : new Date()
  const t = (s: number) => new Date(t0.getTime() + s * 1000).toISOString()
  const ok = run.outcome === 'ok'
  const fail = run.outcome === 'fail'
  return {
    run,
    routine: { id: r.id, name: r.name, helperId: r.helperId, helperName: h?.name ?? 'Helper', sendsTo: r.sendsTo },
    job: run.jobId
      ? {
          id: run.jobId,
          status: fail ? 'failed' : 'done',
          error: run.error,
          attempts: fail ? 2 : 1,
          costCredits: run.costCredits,
          tokensIn: 1200,
          tokensOut: 340,
          startedAt: t(0),
          endedAt: t(run.duration ?? 0),
        }
      : null,
    running: false,
    steps: run.outcome === 'skip'
      ? [{ at: t(0), text: `Skipped — ${run.error ?? 'nothing to do'}`, error: false }]
      : [
          { at: t(0), text: `Run started · ${run.trigger === 'schedule' ? 'schedule' : 'manual'} trigger`, error: false },
          { at: t(2), text: 'Read sources', error: false },
          fail
            ? { at: t(run.duration ?? 8), text: run.error ?? 'Run failed', error: true }
            : { at: t(run.duration ?? 60), text: 'Produced output', error: false },
        ],
    logs: [
      { at: t(1), level: 'info', text: 'status: started' },
      ...(fail ? [{ at: t(run.duration ?? 8), level: 'error' as const, text: `failed: ${run.error ?? ''}` }] : []),
    ],
    output: ok
      ? {
          headline: `${r.name} — done`,
          bodyMd: `- ${r.instructions || r.name}\n- Everything ran on schedule.`,
          lines: [r.instructions || r.name, 'Everything ran on schedule.'],
        }
      : null,
    sources: ok ? [{ title: 'Goals' }, { title: 'Inbox' }] : [],
    delivery: { sendsTo: r.sendsTo, delivered: false, note: ok ? 'Saved to the activity log' : null },
  }
}

export function mockSuggestions(): RoutineSuggestion[] {
  const out: RoutineSuggestion[] = []
  const active = routines.filter((r) => r.enabled && !r.paused && norm(r.freq) !== 'monthly')
  const seen = new Set<string>()
  for (const a of active) {
    for (const b of active) {
      if (a === b || a.helperId !== b.helperId || seen.has(b.id) || seen.has(a.id)) continue
      if (minutes(b.at) < minutes(a.at) || Math.abs(minutes(a.at) - minutes(b.at)) >= 30) continue
      if (!(b.allowChiefShift ?? true)) continue
      const sameDay = [0, 1, 2, 3, 4, 5, 6].some((wd) => {
        const d = new Date(2026, 0, 5 + wd) // a Monday-anchored week
        return firesOn(a, d) && firesOn(b, d)
      })
      if (!sameDay) continue
      const to = minutes(a.at) + 60
      const toAt = `${String(Math.floor(to / 60)).padStart(2, '0')}:${String(to % 60).padStart(2, '0')}`
      const id = `sug-clash-${b.id}-${toAt}`
      if (dismissed.has(id)) continue
      seen.add(b.id)
      const h = helpers.find((x) => x.id === b.helperId)?.name ?? 'This helper'
      out.push({
        id,
        kind: 'clash',
        title: `${h} has two routines at the same time`,
        desc: `${a.name} and ${b.name} both start around ${a.at}. Moving ${b.name} keeps ${h} free to finish one first.`,
        moves: [{ routineId: b.id, name: b.name, helperId: b.helperId, helperName: h, from: b.at, to: toAt, fromAt: b.at, toAt }],
        note: 'Chief never moves routines you’ve locked (Let Chief move this: off).',
      })
    }
  }
  return out
}

export const dismissed = new Set<string>()

// ── Commands ───────────────────────────────────────────────────────────────────

let seq = 0

export function mockRunNow(id: string, trigger: 'manual' | 'resend' = 'manual'): RoutineRunSummary {
  seq += 1
  const run: RoutineRunSummary = {
    id: `rrn-mock-${seq}`,
    routineId: id,
    jobId: `job-mock-${seq}`,
    at: new Date().toISOString(),
    outcome: 'ok',
    duration: 42,
    costCredits: 2,
    tokens: 12_400,
    trigger,
    error: null,
    feedback: null,
  }
  ;(mockRuns[id] ??= []).push(run)
  const r = routines.find((x) => x.id === id)
  if (r) {
    r.lastAt = run.at
    r.runs = mockRuns[id].slice(-8)
  }
  return run
}

export function mockSkip(id: string): string | null {
  const r = routines.find((x) => x.id === id)
  if (!r) return null
  const cur = r.nextAt ? new Date(r.nextAt) : new Date()
  r.nextAt = nextFireOf(r, cur)?.toISOString() ?? null
  return r.nextAt
}

export function mockRecompute(r: Routine) {
  r.nextAt = nextFireOf(r, new Date())?.toISOString() ?? null
}

export function mockPreview(input: { freq: string; at: string; days?: number[]; monthly?: string | null; helperId?: string; excludeId?: string }): RoutinePreview {
  const cand = { freq: input.freq, at: input.at, days: input.days ?? [], monthly: input.monthly ?? null }
  const now = new Date()
  const next = fires(cand, now, new Date(now.getTime() + 400 * DAY)).slice(0, 3)
  const others = routines.filter((r) => r.id !== input.excludeId && (!input.helperId || r.helperId === input.helperId) && !r.paused)
  const horizon = new Date(now.getTime() + 14 * DAY)
  const clashWith = (c: typeof cand) =>
    others.filter((o) => {
      const of = fires(o, now, horizon)
      return fires(c, now, horizon).some((f) => of.some((g) => Math.abs(g.getTime() - f.getTime()) < 30 * 60_000))
    })
  const clashes = clashWith(cand).map((o) => ({
    routineId: o.id, name: o.name, helperId: o.helperId, at: o.at, cadence: `${o.freq} · ${o.at}`, when: o.nextAt ?? '',
  }))
  const slots = clashes.length
    ? [30, 60, -60, 90].flatMap((delta) => {
        const m = minutes(input.at) + delta
        const atStr = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        const alt = { ...cand, at: atStr }
        return clashWith(alt).length ? [] : [{ ...alt, label: atStr, nextAt: null, recommended: false, reason: delta > 0 ? `Right after ${clashes[0].name}` : `Before ${clashes[0].name}` }]
      }).slice(0, 3).map((s, i) => ({ ...s, recommended: i === 0 }))
    : []
  return { nextAt: next[0]?.toISOString() ?? null, nextDates: next.map((d) => d.toISOString()), label: `${input.freq} · ${input.at}`, clashes, suggestedSlots: slots }
}

export function mockGoalDetail(id: string): GoalDetail | null {
  const g = goals.find((x) => x.id === id)
  if (!g) return null
  return {
    goal: g,
    jobs: [
      { id: `job-${id}-plan`, origin: 'goal', status: 'done', helperId: 'h-chief', brief: `Plan goal: ${g.target ?? g.title}`, parentJobId: null, goalId: id },
      { id: `job-${id}-1`, origin: 'delegation', status: g.progress >= 50 ? 'done' : 'running', helperId: g.helperIds?.[0] ?? 'h-dev', brief: `Step 1 toward: ${g.title}`, parentJobId: `job-${id}-plan`, goalId: id },
      { id: `job-${id}-2`, origin: 'delegation', status: 'queued', helperId: g.helperIds?.[0] ?? 'h-growth', brief: `Step 2 toward: ${g.title}`, parentJobId: `job-${id}-plan`, goalId: id },
    ],
    proposals: [],
  }
}

const goalSessions: Record<string, Session> = {}

export function mockGoalSession(goalId: string): Session {
  const g = goals.find((x) => x.id === goalId)
  if (!goalSessions[goalId]) {
    seq += 1
    goalSessions[goalId] = { id: `ses-goal-${seq}`, title: g?.title ?? 'Goal', channelId: g?.channelId, updated: 'now', goal: g?.title }
    if (g) g.sessionId = goalSessions[goalId].id
  }
  return goalSessions[goalId]
}
