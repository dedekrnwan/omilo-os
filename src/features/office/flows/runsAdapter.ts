import type { FlowRun } from '../../../core/domain/types'
import type { FlowRunRow, FlowRunStatus } from './data'
import { costLabel } from '../../../app/money'

/**
 * Adapters for the office-level "Runs" tab, which aggregates runs across ALL
 * flows. The backend has no cross-flow runs endpoint — the caller fans out
 * `repos.flows.runs(flowId)` per flow (see `useAllFlowRuns`) and these pure
 * helpers map the live `FlowRun`s into the table's row + header-stat shapes.
 *
 * Backend run-status vocabulary (apps/api/omilo/flows/engine.py):
 *   "running" | "done" | "failed" | "needs_you".
 * ("waiting"/"succeeded" are accepted defensively — legacy/alias values.)
 */

/** Map a backend FlowRun.status string to the UI FlowRunStatus. */
export function normaliseRunStatus(s: string): FlowRunStatus {
  if (s === 'done' || s === 'succeeded') return 'Done'
  if (s === 'failed') return 'Failed'
  if (s === 'needs_you' || s === 'waiting') return 'Needs you'
  return 'Running'
}

/** Relative-time label from an ISO timestamp (e.g. "12m ago", "3h ago", "Yesterday"). */
export function formatRelative(iso: string | null, now: number): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const sec = Math.max(0, Math.round((now - then) / 1000))
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day === 1) return 'Yesterday'
  if (day < 7) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

/** Short duration label from a second count. */
export function formatDuration(sec: number | null): string {
  if (sec == null || sec <= 0) return '—'
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

/** Rupiah cost label from a credit count (app-wide rate, src/app/money.ts). */
export function formatCost(credits: number): string {
  return costLabel(credits)
}

/** Map a live FlowRun + its flow's title into the office Runs table row. */
export function officeRunRow(run: FlowRun, flowTitle: string, now: number): FlowRunRow {
  return {
    id: run.id,
    flowId: run.flowId,
    flowTitle,
    status: normaliseRunStatus(run.status),
    trigger: run.triggerSummary ?? '—',
    startedBy: run.startedBy ?? '',
    startedAt: formatRelative(run.startedAt, now),
    duration: formatDuration(run.duration),
    cost: formatCost(run.costCredits),
    waitingFor: run.waitingFor ?? undefined,
  }
}

export interface RunsStats {
  'Runs this week': string
  'Success rate': string
  'Needs you': string
  Spend: string
}

/** Header stats for the office Runs tab, computed from the aggregated live runs. */
export function runsStats(runs: FlowRun[], now: number): RunsStats {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const thisWeek = runs.filter((r) => {
    if (!r.startedAt) return false
    const t = new Date(r.startedAt).getTime()
    return !Number.isNaN(t) && t >= weekAgo
  }).length

  const isDone = (r: FlowRun) => r.status === 'done' || r.status === 'succeeded'
  const finished = runs.filter((r) => isDone(r) || r.status === 'failed')
  const succeeded = finished.filter(isDone).length
  const successRate = finished.length ? `${Math.round((succeeded / finished.length) * 100)}%` : '—'

  const needsYou = runs.filter((r) => r.status === 'needs_you' || r.status === 'waiting').length
  const spend = runs.reduce((sum, r) => sum + r.costCredits, 0)

  return {
    'Runs this week': String(thisWeek),
    'Success rate': successRate,
    'Needs you': String(needsYou),
    Spend: formatCost(spend),
  }
}

/** Sort runs newest-first by startedAt (nulls last). */
export function sortRunsByStartedDesc(runs: FlowRun[]): FlowRun[] {
  return [...runs].sort((a, b) => {
    const ta = a.startedAt ? new Date(a.startedAt).getTime() : 0
    const tb = b.startedAt ? new Date(b.startedAt).getTime() : 0
    return tb - ta
  })
}
