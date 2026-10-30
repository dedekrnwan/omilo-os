/**
 * sweep/goals-routines — snake_case → domain mappers for the routine and goal
 * endpoints added in the sweep. Shared by httpRepos.ts and commands.ts so the
 * shared files only carry small, contiguous call sites.
 */
import type {
  Goal,
  GoalDetail,
  GoalStatus,
  Routine,
  RoutineClash,
  RoutinePreview,
  RoutineRunDetail,
  RoutineRunOutcome,
  RoutineRunSummary,
  RoutineSchedule,
  RoutineScheduleItem,
  RoutineSlot,
  RoutineSuggestion,
} from '../../core/domain/types'

export type RawRoutineRun = {
  id: string
  routine_id: string
  job_id: string | null
  when: string | null
  outcome: string | null
  duration: number | null
  skipped?: boolean
  cost_credits: number
  tokens?: number
  trigger?: string | null
  error?: string | null
  feedback?: string | null
}

export function mapRoutineRun(r: RawRoutineRun): RoutineRunSummary {
  const outcome = (r.skipped ? 'skip' : r.outcome ?? 'ok') as RoutineRunOutcome
  return {
    id: r.id,
    routineId: r.routine_id,
    jobId: r.job_id ?? null,
    at: r.when ?? null,
    outcome: (['ok', 'fail', 'skip', 'running'] as const).includes(outcome) ? outcome : 'ok',
    duration: r.duration ?? null,
    costCredits: r.cost_credits ?? 0,
    tokens: r.tokens ?? 0,
    trigger: (r.trigger ?? null) as RoutineRunSummary['trigger'],
    error: r.error ?? null,
    feedback: (r.feedback ?? null) as RoutineRunSummary['feedback'],
  }
}

/** Fields added to the routine row by the sweep (flags, pause window, runs). */
export type RawRoutineExtras = {
  paused_until?: string | null
  allow_chief_shift?: boolean
  skip_holidays?: boolean
  ask_before_sending?: boolean
  recent_runs?: RawRoutineRun[]
}

export function routineExtras(raw: RawRoutineExtras, runs?: RawRoutineRun[]): Partial<Routine> {
  const src = runs ?? raw.recent_runs
  return {
    pausedUntil: raw.paused_until ?? null,
    allowChiefShift: raw.allow_chief_shift ?? true,
    skipHolidays: raw.skip_holidays ?? false,
    askBeforeSending: raw.ask_before_sending ?? false,
    ...(src ? { runs: src.map(mapRoutineRun) } : {}),
  }
}

/** Write endpoints wrap the row as `{routine: …}`; older callers/tests send it bare. */
export function unwrapRoutine<T>(raw: T | { routine: T }): T {
  return raw && typeof raw === 'object' && 'routine' in (raw as object)
    ? (raw as { routine: T }).routine
    : (raw as T)
}

/** Goal write endpoints wrap as `{goal: …}`; unwrap defensively. */
export function unwrapGoal<T>(raw: T | { goal: T }): T {
  return raw && typeof raw === 'object' && 'goal' in (raw as object)
    ? (raw as { goal: T }).goal
    : (raw as T)
}

/** Goal DTO extras (camelCase from the API; snake_case accepted defensively). */
export function goalExtras(r: Record<string, unknown>): Partial<Goal> {
  const pick = <T,>(...keys: string[]) => {
    for (const k of keys) if (r[k] !== undefined && r[k] !== null) return r[k] as T
    return undefined
  }
  const out: Partial<Goal> = {}
  const status = pick<string>('status')
  if (status && ['on_track', 'at_risk', 'blocked', 'needs_you', 'done'].includes(status)) {
    out.status = status as GoalStatus
  }
  const target = pick<string>('target')
  if (target) out.target = target
  const due = pick<string>('due')
  if (due) out.due = due
  const measuredBy = pick<string>('measuredBy', 'measured_by')
  if (measuredBy) out.measuredBy = measuredBy
  const helperIds = pick<string[]>('helperIds', 'helper_ids')
  if (helperIds) out.helperIds = helperIds
  const period = pick<string>('period')
  if (period) out.period = period
  const sessionId = pick<string>('sessionId', 'session_id')
  if (sessionId) out.sessionId = sessionId
  const statusSetBy = pick<string>('statusSetBy', 'status_set_by')
  if (statusSetBy) out.statusSetBy = statusSetBy as Goal['statusSetBy']
  return out
}

export type RawGoalDetail = {
  goal: Record<string, unknown>
  jobs: GoalDetail['jobs']
  proposals: GoalDetail['proposals']
}

export function mapGoalDetail(raw: RawGoalDetail): GoalDetail {
  const g = raw.goal
  return {
    goal: {
      id: g.id as string,
      channelId: (g.channelId ?? g.channel_id ?? '') as string,
      title: g.title as string,
      progress: (g.progress as number) ?? 0,
      ...goalExtras(g),
    },
    jobs: raw.jobs ?? [],
    proposals: raw.proposals ?? [],
  }
}

export type RawRunDetail = {
  run: RawRoutineRun
  routine: { id: string; name: string; helper_id: string; helper_name: string; sends_to: unknown[] }
  job: {
    id: string
    status: string
    error: string | null
    attempts: number
    cost_credits: number
    tokens_in: number
    tokens_out: number
    started_at: string | null
    ended_at: string | null
  } | null
  running: boolean
  steps: Array<{ at: string | null; text: string; error: boolean }>
  logs: Array<{ at: string | null; level: string; text: string }>
  output: { headline: string; body_md: string; lines: string[] } | null
  sources: unknown[]
  delivery: { sends_to: unknown[]; delivered: boolean; note: string | null }
}

export function mapRunDetail(r: RawRunDetail): RoutineRunDetail {
  return {
    run: mapRoutineRun(r.run),
    routine: {
      id: r.routine.id,
      name: r.routine.name,
      helperId: r.routine.helper_id,
      helperName: r.routine.helper_name,
      sendsTo: r.routine.sends_to ?? [],
    },
    job: r.job
      ? {
          id: r.job.id,
          status: r.job.status,
          error: r.job.error,
          attempts: r.job.attempts,
          costCredits: r.job.cost_credits,
          tokensIn: r.job.tokens_in,
          tokensOut: r.job.tokens_out,
          startedAt: r.job.started_at,
          endedAt: r.job.ended_at,
        }
      : null,
    running: r.running,
    steps: r.steps ?? [],
    logs: (r.logs ?? []).map((l) => ({ ...l, level: (l.level === 'error' || l.level === 'warn' ? l.level : 'info') as 'info' | 'warn' | 'error' })),
    output: r.output ? { headline: r.output.headline, bodyMd: r.output.body_md, lines: r.output.lines ?? [] } : null,
    sources: r.sources ?? [],
    delivery: {
      sendsTo: r.delivery?.sends_to ?? [],
      delivered: r.delivery?.delivered ?? false,
      note: r.delivery?.note ?? null,
    },
  }
}

export type RawSchedule = {
  from: string
  to: string
  items: Array<{
    routine_id: string
    helper_id: string
    name: string
    at: string
    status: string
    run_id: string | null
    trigger: string
  }>
}

export function mapSchedule(r: RawSchedule): RoutineSchedule {
  return {
    from: r.from,
    to: r.to,
    items: r.items.map(
      (i): RoutineScheduleItem => ({
        routineId: i.routine_id,
        helperId: i.helper_id,
        name: i.name,
        at: i.at,
        status: i.status as RoutineScheduleItem['status'],
        runId: i.run_id,
        trigger: i.trigger,
      }),
    ),
  }
}

export type RawPreview = {
  next_at: string | null
  next_dates: string[]
  label: string
  clashes: Array<{ routine_id: string; name: string; helper_id: string; at: string; cadence: string; when: string }>
  suggested_slots: Array<{
    freq: string
    at: string
    days: number[]
    monthly: string | null
    label: string
    next_at: string | null
    recommended: boolean
    reason: string
  }>
}

export function mapPreview(r: RawPreview): RoutinePreview {
  return {
    nextAt: r.next_at,
    nextDates: r.next_dates ?? [],
    label: r.label,
    clashes: (r.clashes ?? []).map(
      (c): RoutineClash => ({
        routineId: c.routine_id,
        name: c.name,
        helperId: c.helper_id,
        at: c.at,
        cadence: c.cadence,
        when: c.when,
      }),
    ),
    suggestedSlots: (r.suggested_slots ?? []).map(
      (s): RoutineSlot => ({
        freq: s.freq,
        at: s.at,
        days: s.days ?? [],
        monthly: s.monthly,
        label: s.label,
        nextAt: s.next_at,
        recommended: s.recommended,
        reason: s.reason,
      }),
    ),
  }
}

export type RawSuggestion = {
  id: string
  kind: string
  title: string
  desc: string
  note: string
  moves: Array<{
    routine_id: string
    name: string
    helper_id: string
    helper_name: string
    from: string
    to: string
    from_at: string
    to_at: string | null
  }>
}

export function mapSuggestion(s: RawSuggestion): RoutineSuggestion {
  return {
    id: s.id,
    kind: s.kind as RoutineSuggestion['kind'],
    title: s.title,
    desc: s.desc,
    note: s.note,
    moves: s.moves.map((m) => ({
      routineId: m.routine_id,
      name: m.name,
      helperId: m.helper_id,
      helperName: m.helper_name,
      from: m.from,
      to: m.to,
      fromAt: m.from_at,
      toAt: m.to_at,
    })),
  }
}
