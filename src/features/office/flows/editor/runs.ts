// Live FlowRun (GET /v1/flows/{id}/runs[/{runId}]) → editor run list + timeline shapes.

import type { FlowRun as ApiRun, FlowRunStep } from '../../../../core/domain/types'
import { formatCost, formatDuration, formatRelative } from '../runsAdapter'
import type { FlowRun, RunStatus, RunStep } from './data'

export interface RunState extends FlowRun {
  /** Run is still going (status running). */
  live: boolean
  /** Waiting at an approval step. */
  waiting: boolean
  detail: { title: string; chip: string; sub: string; steps: RunStep[] }
}

export function runStatus(s: string): RunStatus {
  if (s === 'done' || s === 'succeeded') return 'succeeded'
  if (s === 'needs_you' || s === 'waiting') return 'waiting'
  if (s === 'failed') return 'failed'
  return 'noop' // running · declined · cancelled
}

function chipFor(r: ApiRun, waitingFor: string): string {
  switch (r.status) {
    case 'needs_you':
    case 'waiting':
      return `Waiting for you${waitingFor ? ` · ${waitingFor}` : ''}`
    case 'done':
    case 'succeeded':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'declined':
      return 'Declined — nothing changed'
    case 'cancelled':
      return 'Cancelled'
    case 'running':
      return 'Running'
    default:
      return r.status
  }
}

const KIND: Record<string, string> = {
  trigger: 'TRIGGER',
  ai_step: 'AI',
  condition: 'IF',
  approval: 'APPROVAL',
  connector: 'CONNECTOR',
}

export function stepTime(ms: number): string {
  if (!ms) return '0s'
  return ms < 1000 ? `${(ms / 1000).toFixed(1)}s` : formatDuration(Math.round(ms / 1000))
}

/** One logged step → a timeline row. */
export function runStep(st: FlowRunStep): RunStep {
  const state: RunStep['state'] =
    st.status === 'waiting' ? 'waiting' : st.status === 'failed' ? 'failed' : st.status === 'cancelled' ? 'queued' : 'done'
  const output = st.output
    ? Object.entries(st.output).map(([k, v]): [string, string] => [k, typeof v === 'string' ? v : JSON.stringify(v)])
    : undefined
  const time =
    st.status === 'waiting'
      ? 'waiting'
      : st.status === 'skipped'
        ? 'skipped'
        : st.status === 'declined'
          ? 'declined'
          : st.status === 'cancelled'
            ? 'cancelled'
            : stepTime(st.durationMs)
  return {
    kind: KIND[st.kind] ?? st.kind.toUpperCase(),
    title: st.kind === 'condition' && st.note ? `${st.label} → ${st.note}` : st.label,
    sub: st.status !== 'waiting' && st.kind !== 'condition' ? st.note : undefined,
    state,
    time,
    output: output?.length ? output : undefined,
    approval: st.status === 'waiting' ? { text: st.note || 'Waiting for your approval' } : undefined,
  }
}

/** Runs come newest first; #number counts from the oldest. */
export function toRunStates(runs: ApiRun[], now = Date.now()): RunState[] {
  return runs.map((r, i) => {
    const number = runs.length - i
    const when = formatRelative(r.startedAt, now)
    const waitingFor = r.status === 'needs_you' && r.startedAt ? formatRelative(r.startedAt, now).replace(' ago', '') : ''
    const meta = [formatDuration(r.duration), formatCost(r.tokens ?? 0)].filter((x) => x !== '—').join(' · ')
    const status = runStatus(r.status)
    return {
      id: r.id,
      number,
      status,
      when,
      what: r.triggerSummary ?? '',
      meta,
      retry: r.status === 'failed',
      live: r.status === 'running',
      waiting: status === 'waiting',
      detail: {
        title: `Run #${number}`,
        chip: chipFor(r, waitingFor),
        sub: [when, r.startedBy ? `by ${r.startedBy}` : '', r.triggerSummary ?? '', meta].filter(Boolean).join(' · '),
        steps: (r.steps ?? []).map(runStep),
      },
    }
  })
}

/** Runs started in the last 7 days. */
export function runsThisWeek(runs: ApiRun[], now = Date.now()): number {
  const weekAgo = now - 7 * 86_400_000
  return runs.filter((r) => r.startedAt && new Date(r.startedAt).getTime() >= weekAgo).length
}

/** Per-node "last" badge (canvas top-right) from the latest run's step log. */
export function lastByNode(run: ApiRun | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const st of run?.steps ?? []) {
    out[st.nodeId] = st.status === 'waiting' ? 'waits' : st.status === 'skipped' ? 'skipped' : stepTime(st.durationMs)
  }
  return out
}

/** Average cost per run, "$0.018", or null when there are no runs. */
export function avgTokens(runs: ApiRun[]): string | null {
  if (!runs.length) return null
  return formatCost(Math.round(runs.reduce((s, r) => s + (r.tokens ?? 0), 0) / runs.length))
}
