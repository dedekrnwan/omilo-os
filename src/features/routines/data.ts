/**
 * Mock data for Office · Routines (pen diQBZ / I5rrK / VUmu8 / xuAoe + states).
 * Copy and numbers are taken verbatim from omilo-v2.pen.
 */
import type { HelperArea } from '../../core/domain/types'
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

/** Drawer states of a routine, reachable with `/office/routines/$routineId?state=`. */
export type RoutineDrawerState = 'detail' | 'running' | 'paused' | 'output' | 'reassign'

export interface Agent {
  id: string
  name: string
  area: HelperArea
}

export const AGENTS: Record<string, Agent> = {
  chief: { id: 'chief', name: 'Chief', area: 'brand' },
  dev: { id: 'dev', name: 'Dev', area: 'dev' },
  ops: { id: 'ops', name: 'Ops', area: 'ops' },
  growth: { id: 'growth', name: 'Growth', area: 'marketing' },
  finance: { id: 'finance', name: 'Finance', area: 'finance' },
  support: { id: 'support', name: 'Support', area: 'support' },
}

export const colorOf = (agentId: string) => helperColor[AGENTS[agentId].area]

// ── Week view (I5rrK) ────────────────────────────────────────────────────────

export const WEEK_LABEL = 'Oct 19 – 25'
export const WEEK_DAYS = ['MON 19', 'TUE 20', 'WED 21', 'THU 22', 'FRI 23', 'SAT 24', 'SUN 25']
/** Index of today (Sat 24) in WEEK_DAYS. */
export const TODAY_INDEX = 5

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
}

export interface WeekLane {
  agentId: string
  count: number
  height: number
  chips: WeekChip[]
}

export function weekLanes(applied = false): WeekLane[] {
  return [
    {
      agentId: 'chief',
      count: 4,
      height: 72,
      chips: [
        { id: 'c1', routineId: 'morning-brief', time: '07:30', label: 'Morning brief · weekdays', day: 0, span: 5, row: 0 },
        { id: 'c2', routineId: 'goal-check-ins', time: '09:00', label: 'Check-in', day: 0, span: 1, row: 1 },
        { id: 'c3', routineId: 'goal-check-ins', time: '09:00', label: 'Check-in', day: 3, span: 1, row: 1 },
        { id: 'c4', routineId: 'weekly-retro', time: '16:00', label: 'Retro', day: 4, span: 1, row: 1 },
      ],
    },
    {
      agentId: 'dev',
      count: 2,
      height: 72,
      chips: [
        { id: 'd1', routineId: 'nightly-build', time: '01:00', label: 'Nightly build check · weekdays', day: 0, span: 5, row: 0 },
        { id: 'd2', routineId: 'dependency-updates', time: '10:00', label: 'Deps update', day: applied ? 1 : 0, span: 1, row: 1 },
      ],
    },
    {
      agentId: 'ops',
      count: 2,
      height: 72,
      chips: [
        { id: 'o1', routineId: 'on-call-digest', time: '08:00', label: 'On-call digest · every day', day: 0, span: 7, row: 0 },
        { id: 'o2', routineId: 'backup-check', time: '03:00', label: 'Backups', day: 6, span: 1, row: 1 },
      ],
    },
    {
      agentId: 'growth',
      count: 3,
      height: 98,
      chips: [
        { id: 'g1', routineId: 'instagram-report', time: applied ? '11:00' : '08:00', label: 'IG report', day: 0, span: 1, row: 1 },
        { id: 'g2', routineId: 'social-calendar', time: '09:30', label: 'Social plan', day: 0, span: 1, row: 2 },
        { id: 'g3', routineId: 'ad-spend-review', time: '14:00', label: 'Ad review', day: 2, span: 1, row: 1 },
      ],
    },
    {
      agentId: 'finance',
      count: 2,
      height: 72,
      chips: [
        { id: 'f1', routineId: 'invoice-chaser', time: '10:00', label: 'Invoice chaser · weekdays', day: 0, span: 5, row: 0 },
        { id: 'f2', routineId: 'payout-reconcile', time: '15:00', label: 'Reconcile', day: 4, span: 1, row: 1 },
      ],
    },
    {
      agentId: 'support',
      count: 1,
      height: 72,
      chips: [
        { id: 's1', routineId: 'ticket-triage', time: 'Every 2h', label: 'Ticket triage · 08–20', day: 0, span: 5, row: 0 },
      ],
    },
  ]
}

/** l6KQtK: the failed Invoice chaser run on Fri 23. */
export const FAILED_RUN = {
  agentId: 'finance',
  day: 4,
  row: 0,
  label: '10:00 Failed',
  title: 'Invoice chaser failed',
  meta: 'Fri 23 · 10:00 · after 2 retries',
  why: 'The Xero connection expired, so 3 overdue invoices weren’t chased. Nothing was sent.',
}

export interface Banner {
  tone: 'info' | 'bad' | 'ok'
  title: string
  desc: string
  review: boolean
}

export const BANNERS: Record<'default' | 'failed' | 'applied', Banner> = {
  default: {
    tone: 'info',
    title: 'Chief keeps 15 routines running across 6 agents',
    desc: 'Next: Morning brief, Mon 07:30 · 1 suggestion to spread Monday’s load',
    review: true,
  },
  failed: {
    tone: 'bad',
    title: '1 routine failed this week',
    desc: 'Invoice chaser · Fri 10:00 · Xero connection expired',
    review: true,
  },
  applied: {
    tone: 'ok',
    title: 'Monday is spread out — no clashes this week',
    desc: 'Next: Morning brief, Mon 07:30',
    review: false,
  },
}

// ── List view (VUmu8) ────────────────────────────────────────────────────────

export type RunResult = 'ok' | 'skip' | 'fail' | 'none'

export interface RoutineRow {
  id: string
  name: string
  agentId: string
  when: string
  next: string
  paused?: boolean
  runs: RunResult[]
  by: 'chief' | 'you'
}

export interface RoutineGroup {
  agentId: string
  count: number
  rows: RoutineRow[]
}

const ok8: RunResult[] = ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']

export const LIST_GROUPS: RoutineGroup[] = [
  {
    agentId: 'chief',
    count: 3,
    rows: [
      { id: 'morning-brief', name: 'Morning brief', agentId: 'chief', when: 'Weekdays · 07:30', next: 'Mon 07:30', runs: ok8, by: 'chief' },
      { id: 'goal-check-ins', name: 'Goal check-ins', agentId: 'chief', when: 'Mon & Thu · 09:00', next: 'Mon 09:00', runs: ok8, by: 'you' },
      {
        id: 'weekly-retro',
        name: 'Weekly retro',
        agentId: 'chief',
        when: 'Fridays · 16:00',
        next: 'Fri 16:00',
        runs: ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'skip', 'ok'],
        by: 'chief',
      },
    ],
  },
  {
    agentId: 'ops',
    count: 2,
    rows: [
      {
        id: 'on-call-digest',
        name: 'On-call digest',
        agentId: 'ops',
        when: 'Every day · 08:00',
        next: 'Mon 08:00',
        runs: ['ok', 'ok', 'ok', 'ok', 'fail', 'ok', 'ok', 'ok'],
        by: 'chief',
      },
      { id: 'backup-check', name: 'Backup check', agentId: 'ops', when: 'Sundays · 03:00', next: 'Sun 03:00', runs: ok8, by: 'chief' },
    ],
  },
  {
    agentId: 'growth',
    count: 2,
    rows: [
      { id: 'instagram-report', name: 'Instagram report', agentId: 'growth', when: 'Mondays · 08:00', next: 'Mon 08:00', runs: ok8, by: 'chief' },
      {
        id: 'ad-spend-review',
        name: 'Ad spend review',
        agentId: 'growth',
        when: 'Wednesdays · 14:00',
        next: 'Paused',
        paused: true,
        runs: ['none', 'none', 'none', 'none', 'none', 'none', 'ok', 'ok'],
        by: 'you',
      },
    ],
  },
]

export const LIST_MORE = { text: 'Dev 2 · Finance 2 · Support 1', link: 'Show all 15' }

// ── Last-8 run detail (hover tooltip + focused run drawer) ────────────────────

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

const RUN_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const RUN_MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Sat 24 Oct 2026 — the latest day of WEEK_LABEL. Runs count back from here. */
const runAnchor = () => new Date(2026, 9, 24)

const runTime = (when: string) => when.match(/\d{1,2}:\d{2}/)?.[0] ?? '08:00'

/** 8 believable run dates for a cadence, oldest first (index 0 = leftmost bar). */
function runDates(when: string): Date[] {
  const w = when.toLowerCase()
  const weekdaysOnly = w.includes('weekdays')
  const step = w.includes('every') || w.includes('weekdays') || w.includes('daily') ? 1 : w.includes('&') ? 3 : 7
  const out: Date[] = []
  const d = runAnchor()
  while (out.length < 8) {
    if (!weekdaysOnly || (d.getDay() !== 0 && d.getDay() !== 6)) out.push(new Date(d))
    d.setDate(d.getDate() - step)
  }
  return out.reverse()
}

/** HH:MM + offset seconds → "HH:MM:SS". */
function clock(hhmm: string, secs: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 3600 + m * 60 + secs
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(total / 3600) % 24)}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}`
}

const RUN_OUTCOME: Record<string, string> = {
  'morning-brief': '5 bullets · 1 risk flagged',
  'goal-check-ins': '4 goals reviewed · 2 nudges',
  'weekly-retro': '3 wins · 2 follow-ups',
  'on-call-digest': '14 incidents · 0 paging',
  'backup-check': 'All 6 backups verified',
  'instagram-report': '12 posts · reach +8%',
  'ad-spend-review': 'Spend on track · 1 flag',
}

const RUN_OUTPUT_LINES: Record<string, string[]> = {
  'morning-brief': [
    'Summarised 4 goals and 3 Inbox items.',
    'Flagged the Postgres 16 upgrade as at risk.',
    'Delivered to WhatsApp and #General.',
  ],
  'on-call-digest': [
    'Pulled 14 open incidents from the last 24h.',
    'Grouped by service — none needed paging.',
    'Posted the digest to #ops.',
  ],
  'backup-check': ['Checked all 6 nightly backups.', 'Restored each to a scratch volume and verified.', 'No action needed.'],
  'instagram-report': ['Rolled up 12 posts from the past week.', 'Reach up 8%, saves up 14%.', 'Top post: the referral teaser reel.'],
}

const SKIP_REASON: Record<string, string> = {
  'weekly-retro': 'a public holiday',
  'ad-spend-review': 'the routine was paused',
}

/** Builds the full detail for the i-th bar (left→right) of a routine row. */
export function runDetail(row: RoutineRow, i: number): RunDetail {
  const result = row.runs[i] ?? 'none'
  const date = runDates(row.when)[i]
  const time = runTime(row.when)
  const day = `${RUN_WD[date.getDay()]} ${date.getDate()}`
  const whenShort = `${day} · ${time}`
  const whenLong = `${day} ${RUN_MO[date.getMonth()]}, ${time}`
  const base = {
    result,
    status: RUN_STATUS[result],
    whenShort,
    whenLong,
    agentId: row.agentId,
    triggeredBy: 'Schedule' as const,
  }

  if (result === 'fail') {
    if (row.id === 'on-call-digest')
      return {
        ...base,
        duration: '12s',
        cost: '$0.004',
        attempts: '3 / 3',
        outcome: 'Failed — PagerDuty unreachable',
        error: 'Couldn’t reach PagerDuty — the API timed out after 3 retries. No digest was sent.',
        steps: [
          { t: clock(time, 0), text: 'Run started · schedule trigger' },
          { t: clock(time, 1), text: 'Fetched 14 open incidents from source' },
          { t: clock(time, 12), text: 'PagerDuty API timeout — gave up after retry 3', error: true },
        ],
        logs: [
          { text: `${clock(time, 1)} INFO  fetch incidents ok (14)` },
          { text: `${clock(time, 4)} WARN  pagerduty retry 1/3`, level: 'warn' },
          { text: `${clock(time, 8)} WARN  pagerduty retry 2/3`, level: 'warn' },
          { text: `${clock(time, 12)} ERROR ETIMEDOUT api.pagerduty.com`, level: 'error' },
          { text: `${clock(time, 12)} ERROR run aborted`, level: 'error' },
        ],
      }
    return {
      ...base,
      duration: '8s',
      cost: '$0.002',
      attempts: '2 / 2',
      outcome: 'Failed — aborted after retries',
      error: 'The run hit an error and was aborted after 2 retries. Nothing was sent.',
      steps: [
        { t: clock(time, 0), text: 'Run started · schedule trigger' },
        { t: clock(time, 2), text: 'Working…' },
        { t: clock(time, 8), text: 'Unrecoverable error — run aborted', error: true },
      ],
      logs: [
        { text: `${clock(time, 3)} WARN  retry 1/2`, level: 'warn' },
        { text: `${clock(time, 8)} ERROR run aborted`, level: 'error' },
      ],
    }
  }

  if (result === 'skip') {
    const reason = SKIP_REASON[row.id] ?? 'there was nothing to do'
    return {
      ...base,
      duration: '—',
      cost: '$0.00',
      attempts: '—',
      outcome: `Skipped — ${reason}`,
      steps: [
        { t: clock(time, 0), text: 'Run started · schedule trigger' },
        { t: clock(time, 1), text: `Skipped — ${reason}` },
      ],
      logs: [{ text: `${clock(time, 1)} INFO  skipped: ${reason}` }],
    }
  }

  if (result === 'none')
    return { ...base, duration: '—', cost: '$0.00', attempts: '—', outcome: 'No run yet', steps: [], logs: [] }

  // Success.
  const outcome = RUN_OUTCOME[row.id] ?? 'Completed on schedule'
  return {
    ...base,
    duration: '1m 50s',
    cost: '$0.009',
    attempts: '1 / 1',
    outcome,
    output: RUN_OUTPUT_LINES[row.id] ?? ['Completed on schedule.', outcome],
    steps: [
      { t: clock(time, 0), text: 'Run started · schedule trigger' },
      { t: clock(time, 2), text: `${AGENTS[row.agentId].name} read the sources` },
      { t: clock(time, 110), text: `Produced output — ${outcome}` },
      { t: clock(time, 112), text: 'Delivered to WhatsApp & chat' },
    ],
    logs: [
      { text: `${clock(time, 1)} INFO  read sources ok` },
      { text: `${clock(time, 4)} INFO  generating output` },
      { text: `${clock(time, 110)} INFO  output ready` },
      { text: `${clock(time, 112)} INFO  delivered ok` },
    ],
  }
}

export const SUGGESTION = {
  title: 'Monday morning is crowded',
  desc: '4 routines start between 08:00 and 10:00. Spreading them keeps Ops free for incidents.',
  moves: [
    { name: 'Instagram report', agentId: 'growth', area: 'Growth', from: 'Mon 08:00', to: 'Mon 11:00' },
    { name: 'Dependency updates', agentId: 'dev', area: 'Dev', from: 'Mon 10:00', to: 'Tue 10:00' },
  ],
  note: 'Chief never moves routines you set yourself.',
}

export const APPLIED_TOAST = {
  title: '2 routines moved',
  body: 'Instagram report → Mon 11:00 · Dependency updates → Tue 10:00 · Undo',
}

// ── Empty state (diQBZ) ──────────────────────────────────────────────────────

export interface Template {
  id: string
  name: string
  agentId: string
  when: string
  checked: boolean
}

export const TEMPLATES: Template[] = [
  { id: 't1', name: 'Morning brief', agentId: 'chief', when: 'Chief · Weekdays · 07:30', checked: true },
  { id: 't2', name: 'Weekly retro', agentId: 'chief', when: 'Chief · Fridays · 16:00', checked: true },
  { id: 't3', name: 'On-call digest', agentId: 'ops', when: 'Ops · Every day · 08:00', checked: true },
  { id: 't4', name: 'Invoice chaser', agentId: 'finance', when: 'Finance · Weekdays · 10:00', checked: true },
  { id: 't5', name: 'Social calendar', agentId: 'growth', when: 'Growth · Mondays · 09:30', checked: false },
  { id: 't6', name: 'Backup check', agentId: 'ops', when: 'Ops · Sundays · 03:00', checked: false },
]

export const COMPANY_NAME = 'Sahabat Warga'

// ── Routine detail (xuAoe and states) ────────────────────────────────────────

export type Frequency = 'Daily' | 'Weekdays' | 'Weekly' | 'Monthly'
export const FREQUENCIES: Frequency[] = ['Daily', 'Weekdays', 'Weekly', 'Monthly']

export interface PastRun {
  when: string
  outcome: string
  duration: string
  skipped?: boolean
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
  sendsTo: { icon: 'message-circle' | 'hash'; label: string }[]
  nextRun: string
  lastRun: string
  cost: string
  runs: PastRun[]
  /** Weekly days selected (0 = Mon) */
  days?: number[]
  monthly?: 'date' | 'last-working-day'
  nextDates?: string
  managedByChief: boolean
}

const MORNING_BRIEF: RoutineDetail = {
  id: 'morning-brief',
  name: 'Morning brief',
  agentId: 'chief',
  subtitle: 'Chief · weekdays at 07:30 · managed by Chief',
  frequency: 'Weekdays',
  at: '07:30',
  zone: 'Asia/Jakarta',
  instructions:
    'Summarise what moved yesterday across goals, flag anything at risk, and list today’s decisions. Max 5 bullets.',
  sendsTo: [
    { icon: 'message-circle', label: 'WhatsApp · you' },
    { icon: 'hash', label: '#General chat' },
  ],
  nextRun: 'Mon 07:30',
  lastRun: 'Fri · 1m 50s',
  cost: '~$0.01 a run',
  runs: [
    { when: 'Fri 23 · 07:30', outcome: '5 bullets · 1 risk flagged', duration: '1m 50s' },
    { when: 'Thu 22 · 07:30', outcome: '4 bullets', duration: '1m 32s' },
    { when: 'Wed 21 · 07:30', outcome: 'Skipped — you were on leave', duration: '—', skipped: true },
  ],
  managedByChief: true,
}

export const ROUTINES: Record<string, RoutineDetail> = {
  'morning-brief': MORNING_BRIEF,
  'goal-check-ins': {
    ...MORNING_BRIEF,
    id: 'goal-check-ins',
    name: 'Goal check-ins',
    subtitle: 'Chief · Mondays & Thursdays at 09:00 · set by you',
    frequency: 'Weekly',
    at: '09:00',
    days: [0, 3],
    nextRun: 'Mon 09:00',
    nextDates: 'Next: Mon 27 · Thu 30 · Mon Nov 3',
    managedByChief: false,
  },
  'monthly-cost-review': {
    ...MORNING_BRIEF,
    id: 'monthly-cost-review',
    name: 'Monthly cost review',
    agentId: 'ops',
    subtitle: 'Ops · last working day at 09:00 · managed by Chief',
    frequency: 'Monthly',
    at: '09:00',
    monthly: 'last-working-day',
    nextDates: 'Next: Fri Oct 30 · Fri Nov 27 · Thu Dec 31',
  },
}

export function routineById(id: string): RoutineDetail {
  if (ROUTINES[id]) return ROUTINES[id]
  for (const g of LIST_GROUPS) {
    const r = g.rows.find((x) => x.id === id)
    if (r)
      return {
        ...MORNING_BRIEF,
        id: r.id,
        name: r.name,
        agentId: r.agentId,
        subtitle: `${AGENTS[r.agentId].name} · ${r.when.toLowerCase().replace(' · ', ' at ')}`,
        nextRun: r.next,
      }
  }
  return MORNING_BRIEF
}

export const RUNNING = {
  title: 'Running now · step 2 of 3',
  elapsed: '0:41',
  progress: 270 / 408,
  steps: [
    { label: 'Read yesterday’s goals & Inbox', status: 'done' as const },
    { label: 'Writing 5 bullets…', status: 'active' as const },
    { label: 'Send to WhatsApp & #General', status: 'todo' as const },
  ],
}

export const PAUSED = {
  subtitle: 'Chief · weekdays at 07:30 · paused',
  title: 'Paused until Mon, Nov 3',
  desc: 'You paused it Oct 24 · 6 runs will be skipped',
  until: 'Until Mon, Nov 3',
}

export const RUN_OUTPUT = {
  title: 'Morning brief · Fri 23',
  subtitle: 'Ran 07:30 · 1m 50s · $0.009 · by Chief',
  delivery: 'WhatsApp · read 07:41  ·  #General',
  greeting: 'Good morning, Mas Dede ☀️',
  bullets: [
    'Passkeys: web + iOS on staging; Android slipping 2 days.',
    'Referral launch: ad budget approved, first payouts Friday.',
    'At risk: Postgres 16 upgrade — 20%, due Nov 30.',
    'Decide today: shift launch comms to Nov 26?',
    'Invoice chaser failed — Xero needs reconnecting.',
  ],
  sources: [
    { icon: 'target' as const, label: '4 goals' },
    { icon: 'inbox' as const, label: '3 Inbox items' },
    { icon: 'workflow' as const, label: '6 flow runs' },
  ],
}

export const REASSIGN_OPTIONS = [
  { agentId: 'chief', desc: '4 routines · Mon & Thu free at 09:00', selected: true, pick: false },
  { agentId: 'ops', desc: '3 routines · reads the same goals', selected: false, pick: true },
  { agentId: 'growth', desc: '3 routines · busy Mon morning', selected: false, pick: false },
]

// ── New routine (F4RGvz / oY6x7) ─────────────────────────────────────────────

export const NEW_ROUTINE = {
  prompt:
    'Every Friday afternoon, check which invoices are overdue and send me a short summary on WhatsApp.',
  who: 'finance',
  when: 'Fridays · 15:30',
  why: 'Right after Payout reconcile at 15:00',
  sendsTo: 'WhatsApp · you',
  cost: '~$0.01 a run',
  free: 'No clashes — Finance is free 15:30–16:00',
  clash: 'Fridays 15:00–15:30 clashes with Payout reconcile',
  slots: [
    { title: 'Fridays · 15:30 — recommended', desc: 'Right after Payout reconcile, uses its fresh numbers', recommended: true },
    { title: 'Fridays · 11:00', desc: 'Earlier, before the weekend rush', recommended: false },
    { title: 'Mondays · 09:00', desc: 'Start the week with the overdue list', recommended: false },
  ],
}

export const DELETE_COPY = {
  body: 'Chief stops sending it from Monday. Past runs and outputs stay in the activity log. You can’t undo this — pause it instead if you might want it back.',
}
