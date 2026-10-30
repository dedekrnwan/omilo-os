import { describe, expect, it } from 'vitest'
import type { FlowRun } from '../../../core/domain/types'
import {
  formatCost,
  formatDuration,
  formatRelative,
  normaliseRunStatus,
  officeRunRow,
  runsStats,
  sortRunsByStartedDesc,
} from './runsAdapter'

const NOW = new Date('2026-10-28T12:00:00Z').getTime()

function run(partial: Partial<FlowRun>): FlowRun {
  return {
    id: 'r1',
    flowId: 'f1',
    status: 'done',
    triggerSummary: 'schedule',
    startedBy: 'system',
    costCredits: 0,
    tokens: 0,
    duration: null,
    waitingFor: null,
    jobIds: [],
    startedAt: null,
    endedAt: null,
    ...partial,
  }
}

describe('normaliseRunStatus', () => {
  it('maps backend status strings to UI FlowRunStatus', () => {
    expect(normaliseRunStatus('done')).toBe('Done')
    expect(normaliseRunStatus('succeeded')).toBe('Done')
    expect(normaliseRunStatus('failed')).toBe('Failed')
    expect(normaliseRunStatus('needs_you')).toBe('Needs you')
    expect(normaliseRunStatus('waiting')).toBe('Needs you')
    expect(normaliseRunStatus('running')).toBe('Running')
    expect(normaliseRunStatus('anything-else')).toBe('Running')
  })
})

describe('formatRelative', () => {
  it('renders relative labels and handles nulls', () => {
    expect(formatRelative(null, NOW)).toBe('—')
    expect(formatRelative('not-a-date', NOW)).toBe('—')
    expect(formatRelative(new Date(NOW - 30_000).toISOString(), NOW)).toBe('just now')
    expect(formatRelative(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe('12m ago')
    expect(formatRelative(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h ago')
    expect(formatRelative(new Date(NOW - 24 * 3_600_000).toISOString(), NOW)).toBe('Yesterday')
    expect(formatRelative(new Date(NOW - 3 * 24 * 3_600_000).toISOString(), NOW)).toBe('3d ago')
  })
})

describe('formatDuration / formatCost', () => {
  it('formats durations', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(0)).toBe('—')
    expect(formatDuration(5)).toBe('5s')
    expect(formatDuration(72)).toBe('1m 12s')
    expect(formatDuration(120)).toBe('2m')
  })
  it('formats AI usage in tokens', () => {
    expect(formatCost(0)).toBe('—')
    expect(formatCost(18_000)).toBe('18k tokens')
  })
})

describe('officeRunRow', () => {
  it('maps a live FlowRun to the table row shape', () => {
    const row = officeRunRow(
      run({
        id: 'run-9',
        flowId: 'f2',
        status: 'failed',
        triggerSummary: 'GitHub · deploy',
        tokens: 4_000,
        duration: 38,
        startedAt: new Date(NOW - 12 * 60_000).toISOString(),
      }),
      'Deploy triage',
      NOW,
    )
    expect(row).toMatchObject({
      id: 'run-9',
      flowId: 'f2',
      flowTitle: 'Deploy triage',
      status: 'Failed',
      trigger: 'GitHub · deploy',
      startedAt: '12m ago',
      duration: '38s',
      cost: '4k tokens',
    })
  })

  it('falls back to "—" for a missing trigger', () => {
    expect(officeRunRow(run({ triggerSummary: null }), 'F', NOW).trigger).toBe('—')
  })
})

describe('runsStats', () => {
  it('computes week count, success rate, needs-you, and tokens', () => {
    const runs: FlowRun[] = [
      run({ id: 'a', status: 'done', tokens: 5_000, startedAt: new Date(NOW - 60_000).toISOString() }),
      run({ id: 'b', status: 'failed', tokens: 3_000, startedAt: new Date(NOW - 2 * 24 * 3_600_000).toISOString() }),
      run({ id: 'c', status: 'needs_you', tokens: 2_000, startedAt: new Date(NOW - 60_000).toISOString() }),
      run({ id: 'd', status: 'running', tokens: 0, startedAt: new Date(NOW - 20 * 24 * 3_600_000).toISOString() }),
    ]
    const stats = runsStats(runs, NOW)
    expect(stats['Runs this week']).toBe('3') // a, b, c within 7d; d is 20d old
    expect(stats['Success rate']).toBe('50%') // finished = a(done) + b(failed); 1/2
    expect(stats['Needs you']).toBe('1') // c
    expect(stats.Tokens).toBe('10k tokens') // 5k+3k+2k+0
  })

  it('shows "—" success rate when nothing has finished', () => {
    expect(runsStats([run({ status: 'running', startedAt: null })], NOW)['Success rate']).toBe('—')
  })
})

describe('sortRunsByStartedDesc', () => {
  it('orders newest-first with nulls last', () => {
    const older = run({ id: 'old', startedAt: new Date(NOW - 3_600_000).toISOString() })
    const newer = run({ id: 'new', startedAt: new Date(NOW - 60_000).toISOString() })
    const nullish = run({ id: 'null', startedAt: null })
    const sorted = sortRunsByStartedDesc([older, nullish, newer])
    expect(sorted.map((r) => r.id)).toEqual(['new', 'old', 'null'])
  })
})
