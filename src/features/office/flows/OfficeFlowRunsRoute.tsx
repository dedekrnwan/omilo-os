// ── Office Flow Runs history ───────────────────────────────────────────────────
// Matches design ref: GMEPK.png — runs list (left) + run detail (right)
// Interactive: Approve/Decline/Cancel run/Publish changes update local run status.

import { useReducer, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Play,
  RefreshCw,
  X,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '../../../ui/ds/Button'
import {
  OFFICE_FLOW_RUNS,
  RUN_DETAIL_214,
} from './data'
import type { FlowRunRow, FlowRunStatus, RunDetailStep, RunDetailStepStatus } from './data'
import { RUN_STATUS_STYLE, RunStatusChip } from './shared'

// ── Runs state / reducer ──────────────────────────────────────────────────────

interface RunsState {
  runs: FlowRunRow[]
  runDetail214Steps: RunDetailStep[]
  publishedRunIds: Set<string>
}

type RunsAction =
  | { type: 'APPROVE_RUN'; runId: string }
  | { type: 'DECLINE_RUN'; runId: string }
  | { type: 'CANCEL_RUN'; runId: string }
  | { type: 'PUBLISH_CHANGES'; runId: string }

function updateRunStatus(runs: FlowRunRow[], runId: string, status: FlowRunStatus): FlowRunRow[] {
  return runs.map((r) => r.id === runId ? { ...r, status, waitingFor: undefined } : r)
}

function runsReducer(state: RunsState, action: RunsAction): RunsState {
  switch (action.type) {
    case 'APPROVE_RUN': {
      // Approval: advance waiting → done; update detail step status
      const newRuns = updateRunStatus(state.runs, action.runId, 'Done')
      const newSteps = state.runDetail214Steps.map((s) =>
        s.kind === 'approval' && s.status === 'waiting'
          ? { ...s, status: 'done' as RunDetailStepStatus }
          : s.status === 'queued'
          ? { ...s, status: 'done' as RunDetailStepStatus }
          : s
      )
      return { ...state, runs: newRuns, runDetail214Steps: newSteps }
    }
    case 'DECLINE_RUN': {
      const newRuns = updateRunStatus(state.runs, action.runId, 'Failed')
      const newSteps = state.runDetail214Steps.map((s) =>
        s.kind === 'approval' && s.status === 'waiting'
          ? { ...s, status: 'skipped' as RunDetailStepStatus }
          : s
      )
      return { ...state, runs: newRuns, runDetail214Steps: newSteps }
    }
    case 'CANCEL_RUN': {
      const newRuns = updateRunStatus(state.runs, action.runId, 'Failed')
      return { ...state, runs: newRuns }
    }
    case 'PUBLISH_CHANGES': {
      return { ...state, publishedRunIds: new Set([...state.publishedRunIds, action.runId]) }
    }
    default:
      return state
  }
}

function initRunsState(): RunsState {
  return {
    runs: OFFICE_FLOW_RUNS.map((r) => ({ ...r })),
    runDetail214Steps: RUN_DETAIL_214.map((s) => ({ ...s })),
    publishedRunIds: new Set(),
  }
}

// ── Run list item ─────────────────────────────────────────────────────────────

function RunListItem({
  run,
  selected,
  onClick,
}: {
  run: FlowRunRow
  selected: boolean
  onClick: () => void
}) {
  const st = RUN_STATUS_STYLE[run.status]

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full flex-col gap-[6px] rounded-lg p-[10px] text-left transition-colors ${
        selected ? 'bg-hover' : 'hover:bg-hover'
      }`}
    >
      {/* Title + status */}
      <div className="flex items-center gap-[8px]">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          Run #{run.id.slice(1)}
        </span>
        <span
          className="inline-flex h-[20px] shrink-0 items-center rounded-pill px-[7px] text-[11px] font-semibold"
          style={{ background: st.bg, color: st.ink }}
        >
          {run.status}
          {run.waitingFor && ` · ${run.waitingFor}`}
        </span>
      </div>

      {/* Trigger */}
      <span className="truncate text-[11.5px] text-muted">{run.trigger}</span>

      {/* Time + cost */}
      <div className="flex items-center gap-[8px]">
        <span className="text-[11.5px] text-faint">{run.startedAt}</span>
        <span className="text-[11.5px] text-faint">·</span>
        <span className="text-[11.5px] text-faint">{run.cost}</span>
        {run.duration !== '—' && (
          <>
            <span className="text-[11.5px] text-faint">·</span>
            <span className="text-[11.5px] text-faint">{run.duration}</span>
          </>
        )}
      </div>
    </button>
  )
}

// ── Run detail step row ───────────────────────────────────────────────────────

const STEP_STATUS_ICON: Record<RunDetailStepStatus, { icon: typeof Check; color: string; label: string }> = {
  done:    { icon: Check,       color: 'var(--color-ok)',    label: 'Done' },
  running: { icon: RefreshCw,   color: 'var(--color-info)',  label: 'Running' },
  waiting: { icon: RefreshCw,   color: '#EB6834',            label: 'Waiting' },
  queued:  { icon: RefreshCw,   color: 'var(--color-faint)', label: 'Queued' },
  skipped: { icon: X,           color: 'var(--color-faint)', label: 'Skipped' },
}

const STEP_KIND_COLOR: Record<RunDetailStep['kind'], string> = {
  trigger:   'var(--color-warn)',
  ai:        '#6366F1',
  condition: 'var(--color-muted)',
  approval:  '#F97316',
  connector: '#0EA5E9',
}

const STEP_KIND_LABEL: Record<RunDetailStep['kind'], string> = {
  trigger:   'TRIGGER',
  ai:        'AI  OPS',
  condition: 'IF',
  approval:  'APPROVAL',
  connector: 'SLACK',
}

function RunDetailStepRow({
  step,
  onApprove,
  onDecline,
}: {
  step: RunDetailStep
  onApprove?: () => void
  onDecline?: () => void
}) {
  const statusCfg = STEP_STATUS_ICON[step.status]
  const Icon = statusCfg.icon
  const kindColor = STEP_KIND_COLOR[step.kind]
  const kindLabel = STEP_KIND_LABEL[step.kind]

  return (
    <div className="flex flex-col gap-[8px] border-b border-line px-[16px] py-[12px] last:border-0">
      {/* Step header */}
      <div className="flex items-center gap-[8px]">
        <span
          className="inline-flex h-[18px] items-center rounded-pill px-[7px] text-[10px] font-semibold tracking-[0.5px]"
          style={{
            background: `${kindColor}20`,
            color: kindColor,
          }}
        >
          {kindLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{step.label}</span>
        {step.duration && (
          <span className="text-[11.5px] text-muted shrink-0 whitespace-nowrap">{step.duration}</span>
        )}
        <Icon
          size={13}
          aria-label={statusCfg.label}
          className={step.status === 'running' ? 'animate-spin shrink-0' : 'shrink-0'}
          style={{ color: statusCfg.color }}
        />
      </div>

      {/* Trigger meta */}
      {step.meta && step.kind !== 'ai' && (
        <span className="text-[11.5px] text-muted">{step.meta}</span>
      )}

      {/* AI fields */}
      {step.fields && step.fields.length > 0 && (
        <div className="flex flex-col gap-[4px] rounded-base bg-soft px-[10px] py-[8px]">
          {step.fields.map(({ key, value }) => (
            <div key={key} className="flex gap-[12px]">
              <span className="w-[60px] shrink-0 text-[11.5px] font-medium text-faint">{key}</span>
              <span className="min-w-0 flex-1 text-[11.5px] text-ink-2 leading-[1.4]">{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Approval action */}
      {step.kind === 'approval' && step.status === 'waiting' && step.approveLabel && (
        <div className="flex flex-col gap-[8px] rounded-lg outline-1 -outline-offset-1 outline-line-strong p-[12px]" style={{ background: '#EB68340A', borderColor: '#EB683420' }}>
          <p className="m-0 text-[12.5px] text-ink-2 leading-[1.5]">{step.approveLabel}</p>
          <div className="flex items-center gap-[6px]">
            <Button variant="primary" height={28} icon={Check} onClick={onApprove}>Approve</Button>
            <Button variant="secondary" height={28} onClick={onDecline}>Decline</Button>
            {step.approveDetail && (
              <span className="ml-[4px] text-[11.5px] text-muted">{step.approveDetail}</span>
            )}
          </div>
        </div>
      )}

      {/* Approved/declined feedback */}
      {step.kind === 'approval' && step.status === 'done' && (
        <span className="text-[11.5px]" style={{ color: 'var(--color-ok)' }}>Approved</span>
      )}
      {step.kind === 'approval' && step.status === 'skipped' && (
        <span className="text-[11.5px] text-faint">Declined</span>
      )}

      {/* Queued state */}
      {step.status === 'queued' && (
        <span className="text-[11.5px] text-faint">queued</span>
      )}
    </div>
  )
}

// ── Run detail panel ──────────────────────────────────────────────────────────

function RunDetailPanel({
  run,
  steps,
  onApprove,
  onDecline,
  onCancel,
  onPublish,
  published,
}: {
  run: FlowRunRow
  steps: RunDetailStep[]
  onApprove: () => void
  onDecline: () => void
  onCancel: () => void
  onPublish: () => void
  published: boolean
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden border-l border-line bg-surface">
      {/* Panel header */}
      <div className="flex items-center gap-[10px] border-b border-line px-[16px] py-[12px]">
        <div className="flex flex-col gap-[3px] min-w-0 flex-1">
          <div className="flex items-center gap-[8px]">
            <span className="text-[14px] font-semibold text-ink">Run #{run.id.slice(1)}</span>
            <RunStatusChip status={run.status} />
            {run.waitingFor && (
              <span className="text-[11.5px] text-muted">· {run.waitingFor}</span>
            )}
          </div>
          <span className="text-[11.5px] text-muted">
            Started {run.startedAt} by {run.startedBy} · {run.trigger} · {run.cost}
          </span>
        </div>
        {run.status !== 'Done' && run.status !== 'Failed' && (
          <Button variant="secondary" height={28} icon={X} onClick={onCancel}>Cancel run</Button>
        )}
        {(run.status === 'Done' || run.status === 'Failed') && (
          <Button
            variant={published ? 'secondary' : 'primary'}
            height={28}
            onClick={published ? undefined : onPublish}
          >
            {published ? 'Published' : 'Publish changes'}
          </Button>
        )}
      </div>

      {/* Steps */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {steps.length > 0 ? (
          steps.map((step) => (
            <RunDetailStepRow
              key={step.id}
              step={step}
              onApprove={onApprove}
              onDecline={onDecline}
            />
          ))
        ) : (
          // For non-r214 runs: show a simpler timeline
          <div className="flex flex-col gap-[0px]">
            {[
              { label: run.trigger, kind: 'trigger' as const, status: 'done' as const },
              { label: run.flowTitle, kind: 'ai' as const, status: run.status === 'Failed' ? 'done' as const : run.status === 'Running' ? 'running' as const : 'done' as const },
            ].map((step, i) => (
              <RunDetailStepRow key={i} step={{ id: `s${i}`, ...step, duration: i === 1 ? run.duration : undefined }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── OfficeFlowRunsPage ────────────────────────────────────────────────────────

const RUN_FILTERS: Array<'All' | FlowRunStatus> = ['All', 'Needs you', 'Failed', 'Running', 'Done']

function OfficeFlowRunsPage() {
  const [runsState, dispatch] = useReducer(runsReducer, undefined, initRunsState)
  const [selectedRunId, setSelectedRunId] = useState<string>('r214')
  const [filter, setFilter] = useState<'All' | FlowRunStatus>('All')
  const navigate = useNavigate()

  const shown = filter === 'All' ? runsState.runs : runsState.runs.filter((r) => r.status === filter)
  const selectedRun = runsState.runs.find((r) => r.id === selectedRunId) ?? runsState.runs[0]
  const stepsFor214 = runsState.runDetail214Steps

  const totalThisWeek = runsState.runs.length
  const needsYou = runsState.runs.filter((r) => r.status === 'Needs you').length

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[14px]">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate({ to: '/flows' })}
          className="flex items-center gap-[4px] text-[12.5px] text-muted hover:text-ink-2 transition-colors"
        >
          <ArrowLeft size={13} aria-hidden />
          Flows
        </button>
        <ChevronRight size={12} aria-hidden className="text-faint" />
        <span className="text-[12.5px] font-medium text-ink">Deploy failure triage</span>
        <span className="inline-flex h-[20px] items-center gap-[5px] rounded-pill px-[7px] text-[11px] font-medium" style={{ background: '#14B8A620', color: '#14B8A6' }}>
          Engineering
        </span>
        <span className="flex-1" />
        {(['Canvas', 'Runs', 'Settings'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className="h-[28px] rounded-sm px-[10px] text-[12.5px] font-medium transition-colors"
            style={{
              background: tab === 'Runs' ? 'var(--color-hover)' : 'transparent',
              color: tab === 'Runs' ? 'var(--color-ink)' : 'var(--color-muted)',
            }}
          >
            {tab}
          </button>
        ))}
        <span className="text-[11.5px] text-faint">~$0.02 a run</span>
        <Button variant="secondary" height={28} icon={Play}>Test run</Button>
        <Button variant="primary" height={28}>Publish changes</Button>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: run list */}
        <div className="flex w-[220px] shrink-0 flex-col overflow-hidden border-r border-line bg-app">
          {/* Stats */}
          <div className="flex items-center gap-[16px] border-b border-line px-[12px] py-[10px]">
            <div className="flex flex-col gap-[1px]">
              <span className="text-[18px] font-semibold text-ink">{totalThisWeek}</span>
              <span className="text-[10.5px] text-faint">runs this week</span>
            </div>
            {needsYou > 0 && (
              <div className="flex flex-col gap-[1px]">
                <span className="text-[18px] font-semibold" style={{ color: '#C2410C' }}>{needsYou}</span>
                <span className="text-[10.5px] text-faint">needs you</span>
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-[2px] border-b border-line px-[8px] py-[6px]">
            {RUN_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className="h-[22px] rounded-sm px-[6px] text-[11px] font-medium transition-colors"
                style={{
                  background: filter === f ? 'var(--color-hover)' : 'transparent',
                  color: filter === f ? 'var(--color-ink)' : 'var(--color-muted)',
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Run list */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto gap-px px-[6px] py-[6px]">
            {shown.map((run) => (
              <RunListItem
                key={run.id}
                run={run}
                selected={run.id === selectedRunId}
                onClick={() => setSelectedRunId(run.id)}
              />
            ))}
          </div>
        </div>

        {/* Right: run detail */}
        <RunDetailPanel
          run={selectedRun}
          steps={selectedRun.id === 'r214' ? stepsFor214 : []}
          onApprove={() => dispatch({ type: 'APPROVE_RUN', runId: selectedRun.id })}
          onDecline={() => dispatch({ type: 'DECLINE_RUN', runId: selectedRun.id })}
          onCancel={() => dispatch({ type: 'CANCEL_RUN', runId: selectedRun.id })}
          onPublish={() => dispatch({ type: 'PUBLISH_CHANGES', runId: selectedRun.id })}
          published={runsState.publishedRunIds.has(selectedRun.id)}
        />
      </div>
    </div>
  )
}

// ── OfficeFlowRunsRoute ────────────────────────────────────────────────────────

/**
 * Runs history for /office/flows/:flowId/runs.
 * Two-pane: list on the left, live run detail on the right.
 */
export function OfficeFlowRunsRoute() {
  return <OfficeFlowRunsPage />
}
