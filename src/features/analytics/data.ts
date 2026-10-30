import type { AnalyticsStackedSeries, AnalyticsStat, HelperArea } from '../../core/domain/types'
import {
  formatDuration,
  formatTokens,
  pctChange,
  signedNum,
  signedPct,
} from './format'

/**
 * Analytics view model — display types plus the pure builders that turn API
 * data into them (omilo-v2.pen fqQP5 / MLPUB / BcTka / Q7dBso / Ui79T / gcqA2).
 * No fixture data lives here: everything is built from the analytics endpoints.
 */

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
  /** Raw value per bar (jobs or tokens) — the chart scales them. */
  values: number[]
}

export interface BarChart {
  title: string
  sub: string
  /** Series listed top of stack first. */
  stack: Series[]
  legend: { label: string; color: string }[]
  /** Short label under each bar ("Wed", "Oct 3"). */
  labels: string[]
  /** Tooltip header per bar ("Wednesday, October 21" / "Oct 3 – Oct 5"). */
  tipLabels: string[]
  /** Format a raw bar value (and the bar total) for the hover tooltip. */
  fmt: (v: number) => string
  /** Unit word after the bar total in the tooltip, e.g. 'tokens' ('' = none). */
  unit: string
}

export type HelperStatus = 'working' | 'idle' | 'needs' | 'paused'

/** Display row for one helper (overview table, Helpers tab, budget drawer). */
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
  /** Monthly budget in tokens; undefined = no budget set. */
  budget?: { spent: number; limit: number; warn?: boolean }
  /** Budget spent and no one-off override left — the helper is paused. */
  budgetReached?: boolean
  lastActive: string
}

// ── Range ─────────────────────────────────────────────────────────────────────

export const RANGE_LABELS = ['7 days', '30 days', '90 days'] as const
export type RangeLabel = (typeof RANGE_LABELS)[number]

/** Toolbar label → API range key (backend accepts day | week | month | quarter). */
export const RANGE_KEY: Record<RangeLabel, string> = {
  '7 days': 'week',
  '30 days': 'month',
  '90 days': 'quarter',
}

const PERIOD_WORD: Record<string, string> = { week: 'last week', month: 'last 30 days', quarter: 'last 90 days' }

// ── Colours ───────────────────────────────────────────────────────────────────

export const AREA_COLOR: Record<string, string> = {
  brand: 'var(--color-helper-brand)',
  dev: 'var(--color-helper-dev)',
  ops: 'var(--color-helper-ops)',
  support: 'var(--color-helper-support)',
  finance: 'var(--color-helper-finance)',
  marketing: 'var(--color-helper-marketing)',
  sales: 'var(--color-helper-sales)',
  retro: 'var(--color-helper-retro)',
}
const OK = 'var(--color-ok)'
const BAD = 'var(--color-bad-solid)'

export const KNOWN_AREAS: HelperArea[] = ['brand', 'ops', 'dev', 'support', 'finance', 'marketing', 'sales', 'retro']
export function asArea(a: string | undefined | null): HelperArea {
  return (KNOWN_AREAS as string[]).includes(a ?? '') ? (a as HelperArea) : 'ops'
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function deltaChip(value: number, prev: number | undefined, upIsGood = true): { delta: string; tone: ChipTone } {
  const p = pctChange(value, prev)
  if (p === null) return { delta: prev === 0 && value > 0 ? 'new' : '—', tone: 'neutral' }
  if (p === 0) return { delta: '0%', tone: 'neutral' }
  const good = p > 0 === upIsGood
  return { delta: signedPct(p), tone: good ? 'up' : 'warn' }
}

/** Overview / reliability stat → display Stat with a delta vs the previous period. */
export function toDisplayStat(s: AnalyticsStat, range: string): Stat {
  const period = `vs ${PERIOD_WORD[range] ?? 'last period'}`
  switch (s.label) {
    case 'Tokens per job': {
      const d = deltaChip(s.value, s.prev, false)
      return { label: s.label, value: formatTokens(s.value), ...d, note: period }
    }
    case 'Tokens': {
      const d = deltaChip(s.value, s.prev, false)
      return {
        label: s.label,
        value: formatTokens(s.value),
        ...d,
        note: s.perJob ? `≈ ${formatTokens(s.perJob)} per job` : period,
      }
    }
    case 'Success rate': {
      const diff = s.prev !== undefined ? s.value - s.prev : null
      return {
        label: s.label,
        value: `${s.value}%`,
        delta: diff === null ? '—' : `${signedNum(diff)} pts`,
        tone: diff === null || diff === 0 ? 'neutral' : diff > 0 ? 'up' : 'warn',
        note: s.failed !== undefined ? `${s.failed} failed` : period,
      }
    }
    case 'Failed jobs': {
      const diff = s.prev !== undefined ? s.value - s.prev : null
      return {
        label: s.label,
        value: String(s.value),
        delta: diff === null ? '—' : signedNum(diff),
        tone: diff === null || diff === 0 ? 'neutral' : diff < 0 ? 'up' : 'warn',
        note: period,
      }
    }
    case 'Retried and recovered':
      return {
        label: s.label,
        value: String(s.value),
        delta: `of ${s.of ?? s.value} failures`,
        tone: 'neutral',
        note: 'retried jobs that finished',
      }
    case 'Median duration':
      return {
        label: s.label,
        value: formatDuration(s.value),
        delta: s.p95 ? `p95 ${formatDuration(s.p95)}` : '—',
        tone: 'neutral',
        note: 'per job',
      }
    default: {
      const d = deltaChip(s.value, s.prev)
      return {
        label: s.label,
        value: s.note === '%' ? `${s.value}%` : String(s.value),
        ...d,
        note: s.prev !== undefined ? period : s.note && s.note !== '%' ? s.note : '',
      }
    }
  }
}

// ── Charts ────────────────────────────────────────────────────────────────────

const SHORT_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
const LONG_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const SHORT_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function bucketLabels(buckets: { start: string; end: string }[]): { labels: string[]; tips: string[] } {
  const labels: string[] = []
  const tips: string[] = []
  for (const b of buckets) {
    const s = new Date(`${b.start}T00:00:00Z`)
    if (b.start === b.end) {
      labels.push(SHORT_DAY.format(s))
      tips.push(LONG_DAY.format(s))
    } else {
      const e = new Date(`${b.end}T00:00:00Z`)
      labels.push(SHORT_DATE.format(s))
      tips.push(`${SHORT_DATE.format(s)} – ${SHORT_DATE.format(e)}`)
    }
  }
  return { labels, tips }
}

/** Fallback buckets: the last 7 days ending today. */
export function lastSevenDays(): { start: string; end: string }[] {
  const out = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))
      .toISOString()
      .slice(0, 10)
    out.push({ start: d, end: d })
  }
  return out
}

export function jobsChart(
  done: number[],
  failed: number[],
  buckets: { start: string; end: string }[],
): BarChart {
  const b = buckets.length ? buckets : lastSevenDays()
  const { labels, tips } = bucketLabels(b)
  const totalDone = done.reduce((a, v) => a + v, 0)
  const totalFailed = failed.reduce((a, v) => a + v, 0)
  return {
    title: 'Jobs',
    sub: `${totalDone + totalFailed} · ${totalFailed} failed`,
    stack: [
      { label: 'Failed', color: BAD, values: failed },
      { label: 'Done', color: OK, values: done },
    ],
    legend: [
      { label: 'Done', color: OK },
      { label: 'Failed', color: BAD },
    ],
    labels,
    tipLabels: tips,
    fmt: (v) => String(v),
    unit: 'jobs',
  }
}

export function stackedChart(
  kind: 'spend' | 'tokens',
  data: AnalyticsStackedSeries | undefined,
  periodWord: string,
): BarChart {
  const buckets = data?.buckets.length ? data.buckets : lastSevenDays()
  const { labels, tips } = bucketLabels(buckets)
  const series = (data?.series ?? []).slice(0, 6)
  const stack = [...series].reverse().map((s) => ({
    label: s.label,
    color: AREA_COLOR[s.area] ?? AREA_COLOR.ops,
    values: s.values,
  }))
  const total = data?.total ?? 0
  return kind === 'spend'
    ? {
        title: 'Tokens by channel',
        sub: `${formatTokens(total)} ${periodWord}`,
        stack,
        legend: series.map((s) => ({ label: s.label, color: AREA_COLOR[s.area] ?? AREA_COLOR.ops })),
        labels,
        tipLabels: tips,
        fmt: formatTokens,
        unit: 'tokens',
      }
    : {
        title: 'Tokens by helper',
        sub: `${formatTokens(total)} ${periodWord}`,
        stack,
        legend: series.map((s) => ({ label: s.label, color: AREA_COLOR[s.area] ?? AREA_COLOR.ops })),
        labels,
        tipLabels: tips,
        fmt: formatTokens,
        unit: 'tokens',
      }
}

export const PERIOD_SUFFIX: Record<string, string> = {
  week: 'this week',
  month: 'last 30 days',
  quarter: 'last 90 days',
}

// ── Loops / reliability / activity display helpers ────────────────────────────

export function resultChip(result: string | null, on: boolean): { label: string; tone: ChipTone } {
  if (!on) return { label: 'Paused', tone: 'neutral' }
  switch (result) {
    case 'done':
    case 'ok':
      return { label: 'Done', tone: 'up' }
    case 'failed':
    case 'blocked':
      return { label: 'Failed', tone: 'down' }
    case 'waiting':
      return { label: 'Needs you', tone: 'warn' }
    case 'running':
    case 'queued':
      return { label: 'Running', tone: 'run' }
    case null:
    case undefined:
      return { label: 'Not run yet', tone: 'neutral' }
    default:
      return { label: result, tone: 'neutral' }
  }
}

export const FAILURE_STATUS: Record<string, { label: string; tone: ChipTone }> = {
  failed: { label: 'Failed', tone: 'down' },
  recovered: { label: 'Recovered', tone: 'up' },
  needs_you: { label: 'Needs you', tone: 'warn' },
}

export const FAILURE_ACTION: Record<string, { label: string; kind: 'quiet' | 'secondary' }> = {
  retry: { label: 'Retry', kind: 'secondary' },
  connect: { label: 'Connect', kind: 'secondary' },
  budget: { label: 'Raise budget', kind: 'secondary' },
  view: { label: 'View run', kind: 'quiet' },
}

export const ACTIVITY_STATUS: Record<string, { label: string; tone: ChipTone }> = {
  done: { label: 'Done', tone: 'up' },
  needs_you: { label: 'Needs you', tone: 'warn' },
  failed: { label: 'Failed', tone: 'down' },
  started: { label: 'Running', tone: 'run' },
}

export const ACTIVITY_KINDS: { kind: 'done' | 'needs_you' | 'failed' | 'started'; label: string; on: boolean }[] = [
  { kind: 'done', label: 'Finished jobs', on: true },
  { kind: 'needs_you', label: 'Needs you', on: true },
  { kind: 'failed', label: 'Failures', on: true },
  { kind: 'started', label: 'Started', on: false },
]
