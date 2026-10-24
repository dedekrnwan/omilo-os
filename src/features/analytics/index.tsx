import { useParams } from '@tanstack/react-router'
import { useChannel } from '../../app/queries'
import { AnalyticsScreen } from './AnalyticsScreen'
import type { AnalyticsConfig } from './AnalyticsScreen'
import type { HelperArea } from '../../core/domain/types'

export { AnalyticsScreen } from './AnalyticsScreen'

// ── Shared helper roster (pen fqQP5 / gcqA2) ──────────────────────────────────

const HELPERS: AnalyticsConfig['helpers'] = [
  { name: 'Chief of Staff', area: 'brand',     doing: 'Writing the morning brief',       now: 'Working',   jobs: 38, success: 100, tokens: '412k', spend: '$6.20', budgetUsed: 22, budgetCap: 25, lastActive: 'now' },
  { name: 'Builder',        area: 'dev',       doing: 'Fixing OTP retry limit',          now: 'Working',   jobs: 61, success: 95,  tokens: '598k', spend: '$8.90', budgetUsed: 22, budgetCap: 30, lastActive: 'now' },
  { name: 'Grower',         area: 'marketing', doing: 'Next: weekly growth · Mon 08:00', now: 'Idle',      jobs: 19, success: 100, tokens: '148k', spend: '$2.10', budgetUsed: 7,  budgetCap: 10, lastActive: '2h ago' },
  { name: 'Support',        area: 'support',   doing: 'Waiting on your approval',        now: 'Needs you', jobs: 24, success: 88,  tokens: '82k',  spend: '$1.20', lastActive: '12m ago' },
]

const DAYS = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']

function stack(rows: number[][]): AnalyticsConfig['stack'] {
  return DAYS.map((day, i) => ({ day, parts: rows[i] }))
}

function jobs(pairs: [number, number][]): AnalyticsConfig['jobs'] {
  return DAYS.map((day, i) => ({ day, done: pairs[i][0], failed: pairs[i][1] }))
}

const color = (a: HelperArea) => `var(--color-helper-${a})`

// ── Chat (per-channel) analytics ──────────────────────────────────────────────

function channelConfig(name: string): AnalyticsConfig {
  return {
    topbarMeta: `in ${name}`,
    title: name,
    subtitle: `How ${name}'s helpers did this week.`,
    stats: [
      { label: 'Jobs done',    value: '142',   delta: '+12%', deltaKind: 'up',      sub: 'vs last week' },
      { label: 'Success rate', value: '96%',   delta: '+2 pts', deltaKind: 'up',    sub: '6 failed' },
      { label: 'Tokens',       value: '1.24M', delta: '+18%', deltaKind: 'up',      sub: '~4.3k per job' },
      { label: 'Spend',        value: '$18.40', delta: 'of $60 budget', deltaKind: 'neutral', sub: '31% used' },
    ],
    stackTitle: 'Tokens by helper',
    stackTotal: '1.24M this week',
    legend: [
      { label: 'Chief',   color: color('brand') },
      { label: 'Builder', color: color('dev') },
      { label: 'Grower',  color: color('marketing') },
      { label: 'Support', color: color('support') },
    ],
    stack: stack([
      [34, 28, 10, 8],
      [40, 30, 12, 9],
      [22, 18, 8, 6],
      [10, 8, 4, 3],
      [8, 6, 3, 2],
      [52, 44, 16, 12],
      [38, 34, 12, 10],
    ]),
    jobsTitle: 'Jobs · 142 · 6 failed',
    jobs: jobs([
      [18, 1], [22, 0], [14, 1], [6, 0], [4, 0], [30, 2], [24, 2],
    ]),
    helpersCaption: '4 helpers · 2 working now',
    helpers: HELPERS,
  }
}

export function ChatAnalyticsRoute() {
  const params = useParams({ strict: false })
  const { data: channel } = useChannel(params.channelId ?? 'ch-general')
  return <AnalyticsScreen config={channelConfig(channel?.name ?? '…')} />
}

// ── Office (company-wide) analytics ───────────────────────────────────────────

const COMPANY_CONFIG: AnalyticsConfig = {
  topbarMeta: 'All channels',
  title: 'Sahabat Warga',
  subtitle: 'Every helper across all channels this week.',
  stats: [
    { label: 'Jobs done',    value: '418',   delta: '+12%', deltaKind: 'up',      sub: 'vs last week' },
    { label: 'Success rate', value: '94%',   delta: '+2 pts', deltaKind: 'up',    sub: '24 failed' },
    { label: 'Tokens',       value: '3.9M',  delta: '+18%', deltaKind: 'up',      sub: '6 helpers' },
    { label: 'Spend',        value: '$41.80', delta: 'of $60 budget', deltaKind: 'neutral', sub: '35% used' },
  ],
  stackTitle: 'Spend by channel',
  stackTotal: '$41.80 this week',
  legend: [
    { label: 'Engineering', color: 'var(--color-helper-dev)' },
    { label: 'Marketing',   color: 'var(--color-helper-marketing)' },
    { label: 'Business',    color: 'var(--color-helper-sales)' },
    { label: 'General',     color: 'var(--color-info)' },
  ],
  stack: stack([
    [20, 10, 8, 6],
    [26, 12, 9, 7],
    [16, 9, 6, 5],
    [8, 5, 3, 3],
    [6, 4, 3, 2],
    [34, 16, 12, 9],
    [28, 14, 10, 8],
  ]),
  jobsTitle: 'Jobs · 418 · 24 failed',
  jobs: jobs([
    [52, 3], [64, 2], [44, 4], [20, 1], [14, 1], [86, 7], [72, 6],
  ]),
  helpersCaption: '6 helpers in 4 channels · 2 working now',
  helpers: HELPERS,
}

export function OfficeAnalyticsRoute() {
  return <AnalyticsScreen config={COMPANY_CONFIG} />
}
