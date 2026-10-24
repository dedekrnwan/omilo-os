import type { HelperArea } from '../../core/domain/types'

/** Mock analytics data — mirrors omilo-v2.pen fqQP5 / MLPUB / BcTka / Q7dBso / Ui79T / gcqA2. */

export const DAYS = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'] as const

export type ChipTone = 'up' | 'warn' | 'neutral' | 'down' | 'run'

export interface Stat {
  label: string
  value: string
  delta: string
  tone: ChipTone
  note: string
}

export interface Series {
  label: string
  color: string
  /** Segment height in px per day (bars are 110px tall), Wed → Tue. */
  values: number[]
}

export interface BarChart {
  title: string
  sub: string
  /** Series listed top of stack first (= legend order reversed where the pen does so). */
  stack: Series[]
  legend: { label: string; color: string }[]
}

export type HelperStatus = 'working' | 'idle' | 'needs' | 'paused'

export interface HelperStat {
  id: string
  name: string
  area: HelperArea
  role: string
  doing: string
  status: HelperStatus
  jobs: string
  success: string
  successWarn?: boolean
  tokens: string
  spend: string
  /** Monthly budget; undefined = no budget set. */
  budget?: { spent: number; limit: number; warn?: boolean }
  lastActive: string
}

const C = {
  brand: 'var(--color-helper-brand)',
  dev: 'var(--color-helper-dev)',
  ops: 'var(--color-helper-ops)',
  support: 'var(--color-helper-support)',
  finance: 'var(--color-helper-finance)',
  marketing: 'var(--color-helper-marketing)',
  ok: 'var(--color-ok)',
  bad: 'var(--color-bad-solid)',
}

// ── Overview ──────────────────────────────────────────────────────────────────

export const channelStats: Stat[] = [
  { label: 'Jobs done', value: '142', delta: '+12%', tone: 'up', note: 'vs last week' },
  { label: 'Success rate', value: '96%', delta: '+2 pts', tone: 'up', note: '6 failed' },
  { label: 'Tokens', value: '1.24M', delta: '+18%', tone: 'warn', note: '≈ 4.3k per job' },
  { label: 'Spend', value: '$18.40', delta: 'of $60 budget', tone: 'neutral', note: '31% used' },
]

export const officeStats: Stat[] = [
  { label: 'Jobs done', value: '418', delta: '+12%', tone: 'up', note: 'vs last week' },
  { label: 'Success rate', value: '94%', delta: '+2 pts', tone: 'up', note: '24 failed' },
  { label: 'Tokens', value: '3.9M', delta: '+18%', tone: 'warn', note: '6 helpers' },
  { label: 'Spend', value: '$41.80', delta: 'of $60 budget', tone: 'neutral', note: '35% used' },
]

const jobsStack: Series[] = [
  { label: 'Failed', color: C.bad, values: [0, 3, 0, 0, 2, 5, 0] },
  { label: 'Done', color: C.ok, values: [55, 69, 75, 23, 19, 94, 81] },
]
const jobsLegend = [
  { label: 'Done', color: C.ok },
  { label: 'Failed', color: C.bad },
]

export const tokensByHelper: BarChart = {
  title: 'Tokens by helper',
  sub: '1.24M this week',
  stack: [
    { label: 'Support', color: C.support, values: [6, 9, 8, 11, 9, 12, 11] },
    { label: 'Grower', color: C.ops, values: [8, 11, 6, 5, 3, 14, 16] },
    { label: 'Builder', color: C.dev, values: [31, 41, 47, 8, 5, 55, 37] },
    { label: 'Chief', color: C.brand, values: [23, 20, 27, 9, 8, 30, 25] },
  ],
  legend: [
    { label: 'Chief', color: C.brand },
    { label: 'Builder', color: C.dev },
    { label: 'Grower', color: C.ops },
    { label: 'Support', color: C.support },
  ],
}

export const channelJobs: BarChart = { title: 'Jobs', sub: '142 · 6 failed', stack: jobsStack, legend: jobsLegend }

export const spendByChannel: BarChart = {
  title: 'Spend by channel',
  sub: '$41.80 this week',
  stack: [
    { label: 'Business', color: C.finance, values: [6, 9, 8, 11, 9, 12, 11] },
    { label: 'Marketing', color: C.marketing, values: [8, 11, 6, 5, 3, 14, 16] },
    { label: 'Engineering', color: C.dev, values: [31, 41, 47, 8, 5, 55, 37] },
    { label: 'General', color: C.brand, values: [23, 20, 27, 9, 8, 30, 25] },
  ],
  legend: [
    { label: 'Engineering', color: C.dev },
    { label: 'Marketing', color: C.marketing },
    { label: 'Business', color: C.finance },
    { label: 'General', color: C.brand },
  ],
}

export const officeJobs: BarChart = { title: 'Jobs', sub: '418 · 24 failed', stack: jobsStack, legend: jobsLegend }

// ── Helpers ───────────────────────────────────────────────────────────────────

export const helpers: HelperStat[] = [
  {
    id: 'chief', name: 'Chief of Staff', area: 'brand', role: 'Runs the team', doing: 'Writing the morning brief',
    status: 'working', jobs: '38', success: '100%', tokens: '412k', spend: '$6.20',
    budget: { spent: 12, limit: 25 }, lastActive: 'now',
  },
  {
    id: 'builder', name: 'Builder', area: 'dev', role: 'Engineering', doing: 'Fixing OTP retry limit',
    status: 'working', jobs: '61', success: '95%', tokens: '598k', spend: '$8.90',
    budget: { spent: 22, limit: 30, warn: true }, lastActive: 'now',
  },
  {
    id: 'grower', name: 'Grower', area: 'ops', role: 'Growth', doing: 'Next: weekly growth · Mon 08:00',
    status: 'idle', jobs: '19', success: '100%', tokens: '148k', spend: '$2.10',
    budget: { spent: 2, limit: 10 }, lastActive: '2h ago',
  },
  {
    id: 'support', name: 'Support', area: 'support', role: 'Customer support', doing: 'Waiting on your approval',
    status: 'needs', jobs: '24', success: '88%', successWarn: true, tokens: '82k', spend: '$1.20',
    lastActive: '12m ago',
  },
  {
    id: 'finance', name: 'Finance', area: 'finance', role: 'Money', doing: 'Paused',
    status: 'paused', jobs: '0', success: '—', tokens: '0', spend: '$0', lastActive: '—',
  },
]

/** The overview tables list the four channel helpers (Finance has not run this week). */
export const tableHelpers = helpers.slice(0, 4)

export const helpersSub = '4 helpers · 2 working now'
export const officeHelpersSub = '6 helpers in 4 channels · 2 working now'

/** Budget-reached state (pen EIxIX): Builder hits its $30 cap. */
export const builderReached: HelperStat = {
  ...helpers[1],
  spend: '$9.40',
  budget: { spent: 30, limit: 30 },
}

// ── Loops ─────────────────────────────────────────────────────────────────────

export interface Loop {
  id: string
  name: string
  helper: string
  area: HelperArea
  schedule: string
  next: string
  result: { label: string; tone: ChipTone }
  runs: string
  cost: string
  on: boolean
}

export const loops: Loop[] = [
  { id: 'l1', name: 'Morning brief', helper: 'Chief of Staff', area: 'brand', schedule: 'Weekdays · 07:30', next: 'Tomorrow 07:30', result: { label: 'Done', tone: 'up' }, runs: '7', cost: '$0.12', on: true },
  { id: 'l2', name: 'PR digest to #engineering', helper: 'Builder', area: 'dev', schedule: 'Daily · 09:00', next: 'Today 09:00', result: { label: 'Done', tone: 'up' }, runs: '7', cost: '$0.04', on: true },
  { id: 'l3', name: 'Weekly latency report', helper: 'Builder', area: 'dev', schedule: 'Fri · 16:00', next: 'Fri 16:00', result: { label: 'Failed', tone: 'down' }, runs: '1', cost: '$0.21', on: true },
  { id: 'l4', name: 'Weekly growth review', helper: 'Grower', area: 'ops', schedule: 'Mon · 08:00', next: 'Mon 08:00', result: { label: 'Done', tone: 'up' }, runs: '1', cost: '$0.35', on: true },
  { id: 'l5', name: 'Ticket triage', helper: 'Support', area: 'support', schedule: 'Every 30 min', next: 'in 12 min', result: { label: 'Needs you', tone: 'warn' }, runs: '312', cost: '$0.01', on: true },
  { id: 'l6', name: 'Weekly retro', helper: 'Chief of Staff', area: 'brand', schedule: 'Fri · 17:00', next: '—', result: { label: 'Paused', tone: 'neutral' }, runs: '1', cost: '$0.18', on: false },
]

export const loopsSub = 'Jobs your helpers repeat on a schedule · 6 active'
export const loopsTip = 'Weekly latency report failed last Friday. Builder will retry at 16:00, or reconnect Grafana now.'

// ── Reliability ───────────────────────────────────────────────────────────────

export const reliabilityStats: Stat[] = [
  { label: 'Success rate', value: '96%', delta: '+2 pts', tone: 'up', note: 'last 7 days' },
  { label: 'Failed jobs', value: '6', delta: '−3', tone: 'up', note: 'vs last week' },
  { label: 'Retried and recovered', value: '4', delta: 'of 6 failures', tone: 'neutral', note: 'auto-retry on' },
  { label: 'Median duration', value: '48s', delta: 'p95 3m 10s', tone: 'neutral', note: 'per job' },
]

export interface Failure {
  id: string
  job: string
  cause: string
  area: HelperArea
  when: string
  status: { label: string; tone: ChipTone }
  action: { label: string; kind: 'quiet' | 'secondary' }
}

export const failures: Failure[] = [
  { id: 'f1', job: 'Deploy failure triage', cause: 'GitHub token expired · Fixed after reconnect', area: 'dev', when: 'Mon 14:02', status: { label: 'Recovered', tone: 'up' }, action: { label: 'View run', kind: 'quiet' } },
  { id: 'f2', job: 'Reply to new tickets', cause: 'Zendesk rate limit hit · Retried 2×', area: 'support', when: 'Mon 09:40', status: { label: 'Recovered', tone: 'up' }, action: { label: 'View run', kind: 'quiet' } },
  { id: 'f3', job: 'Weekly latency report', cause: 'Grafana query timed out · Retried 3×, still failing', area: 'dev', when: 'Sun 16:00', status: { label: 'Failed', tone: 'down' }, action: { label: 'Retry', kind: 'secondary' } },
  { id: 'f4', job: 'Morning brief', cause: 'Calendar not connected · Needs you', area: 'brand', when: 'Thu 07:30', status: { label: 'Needs you', tone: 'warn' }, action: { label: 'Connect', kind: 'secondary' } },
]

export const causes = [
  { label: 'Expired or missing connection', count: 9 },
  { label: 'Rate limits', count: 6 },
  { label: 'Timeouts', count: 4 },
  { label: 'Bad input from a step', count: 2 },
]

export const causesTip =
  'Most failures come from expired connections. Reconnect GitHub and Calendar in Connectors.'

// ── Activity ──────────────────────────────────────────────────────────────────

export interface ActivityItem {
  id: string
  time: string
  who: string
  area: HelperArea
  what: string
  meta: string
  status: { label: string; tone: ChipTone }
}

export const activity: { group: string; items: ActivityItem[] }[] = [
  {
    group: 'TODAY',
    items: [
      { id: 'a1', time: '12:56', who: 'Builder', area: 'dev', what: 'started Deploy failure triage', meta: 'GitHub · deploy #882 failed · step 2 of 4', status: { label: 'Running', tone: 'run' } },
      { id: 'a2', time: '12:44', who: 'Support', area: 'support', what: 'asked you to approve 2 refund replies', meta: 'Ticket triage · #4821, #4830', status: { label: 'Needs you', tone: 'warn' } },
      { id: 'a3', time: '12:41', who: 'Builder', area: 'dev', what: 'opened PR fix/otp-retry', meta: 'go-core · 3 files · all 26 tests pass', status: { label: 'Done', tone: 'up' } },
      { id: 'a4', time: '09:00', who: 'Builder', area: 'dev', what: 'posted PR digest to #engineering', meta: 'PR digest · 7 open, 2 need review · $0.04', status: { label: 'Done', tone: 'up' } },
      { id: 'a5', time: '07:30', who: 'Chief of Staff', area: 'brand', what: 'sent your morning brief', meta: 'Morning brief · 3 decisions waiting · $0.12', status: { label: 'Done', tone: 'up' } },
    ],
  },
  {
    group: 'YESTERDAY',
    items: [
      { id: 'a6', time: '16:02', who: 'Builder', area: 'dev', what: "couldn't finish Weekly latency report", meta: 'Grafana query timed out · retried 3×', status: { label: 'Failed', tone: 'down' } },
      { id: 'a7', time: '14:02', who: 'Builder', area: 'dev', what: 'recovered Deploy failure triage', meta: 'GitHub reconnected · finished in 1m 12s', status: { label: 'Done', tone: 'up' } },
    ],
  },
]

export const activityKinds = [
  { label: 'Finished jobs', count: '128', on: true },
  { label: 'Needs you', count: '3', on: true },
  { label: 'Failures', count: '6', on: true },
  { label: 'Started', count: '142', on: false },
]

export const COMPANY_NAME = 'Sahabat Warga'
export const UPDATED_AT = '12:57'
