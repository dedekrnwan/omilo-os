import { useEffect, useState } from 'react'
import { Check, CircleCheck, CircleSlash, Hash, Link, PanelRight, X, CircleDashed, CircleMinus, CircleX, Hourglass, Loader2, RotateCcw } from 'lucide-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { RunStatus, RunStep } from './data'
import { EditorFrame } from './EditorFrame'
import { ContextMenuArea, MoreMenu, copyText } from '../../../../ui/ds/ItemMenu'
import type { MenuEntries } from '../../../../ui/ds/ItemMenu'
import { notify } from '../../../../ui/ds/Toaster'
import { useFlow, useFlowStore } from './store'
import type { RunState } from './store'
import { useFlowRuns } from '../../../../app/queries'

type Filter = 'all' | 'waiting' | 'failed'

const STATUS: Record<RunStatus, { label: string; ink: string }> = {
  waiting: { label: 'Waiting for you', ink: 'text-[#C2410C]' },
  succeeded: { label: 'Succeeded', ink: 'text-ok' },
  noop: { label: 'No action needed', ink: 'text-faint' },
  failed: { label: 'Failed', ink: 'text-bad' },
}

function StatusIcon({ status, running }: { status: RunStatus; running?: boolean }) {
  if (running) return <Loader2 size={14} aria-hidden className="animate-spin text-muted" />
  switch (status) {
    case 'waiting':
      return <Hourglass size={14} aria-hidden className="text-[#C2410C]" />
    case 'succeeded':
      return <CircleCheck size={14} aria-hidden className="text-ok" />
    case 'noop':
      return <CircleMinus size={14} aria-hidden className="text-faint" />
    default:
      return <CircleX size={14} aria-hidden className="text-bad" />
  }
}

function statusLabel(r: RunState) {
  if (r.detail.chip === 'Running') return { label: 'Running', ink: 'text-muted' }
  if (r.detail.chip === 'Cancelled') return { label: 'Cancelled', ink: 'text-faint' }
  if (r.detail.chip.startsWith('Declined')) return { label: 'Declined', ink: 'text-faint' }
  return STATUS[r.status]
}

function RunRow({
  run,
  selected,
  onSelect,
  onRetry,
  menu,
}: {
  run: RunState
  selected: boolean
  onSelect: () => void
  onRetry: () => void
  menu: MenuEntries
}) {
  const st = statusLabel(run)
  const running = run.detail.chip === 'Running'
  return (
    <ContextMenuArea items={menu} label={`Run #${run.number} actions`}>
    <li className="group/run relative data-[state=open]:[&>button]:bg-soft">
      <button
        type="button"
        aria-current={selected || undefined}
        onClick={onSelect}
        className={`flex w-full gap-[8px] pt-[12px] pb-[11px] pr-[15px] pl-[21px] text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink ${
          selected ? 'bg-soft shadow-[inset_0_-1px_0_var(--color-line)]' : 'shadow-[inset_0_-1px_0_var(--color-line)] hover:bg-soft'
        } ${run.retry ? '!pb-[30px]' : ''}`}
      >
        <span className="mt-[1px] shrink-0">
          <StatusIcon status={run.status} running={running} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-[7px]">
            <span className="text-[13px] font-semibold text-ink">Run #{run.number}</span>
            <span className={`text-[12px] font-medium ${st.ink}`}>{st.label}</span>
            <span className="flex-1" />
            <span className="text-[11.5px] text-faint group-hover/run:invisible group-has-[[data-state=open]]/run:invisible">{run.when}</span>
          </span>
          <span className="mt-[4px] truncate text-[12.5px] text-ink-2">{run.what}</span>
          <span className="mt-[1px] text-[11.5px] text-muted">{run.meta}</span>
        </span>
      </button>
      {run.retry && (
        <button
          type="button"
          onClick={onRetry}
          className="absolute bottom-[10px] left-[37px] flex items-center gap-[5px] rounded-xs px-[2px] text-[12px] text-ink-2 hover:text-ink"
        >
          <RotateCcw size={11} aria-hidden />
          Retry from failed step
        </button>
      )}
      <span className="absolute top-[9px] right-[11px] hidden group-hover/run:flex group-focus-within/run:flex has-[[data-state=open]]:flex">
        <MoreMenu items={menu} label={`Run #${run.number} actions`} size={22} />
      </span>
    </li>
    </ContextMenuArea>
  )
}

function StepIcon({ state }: { state: RunStep['state'] }) {
  switch (state) {
    case 'done':
      return <CircleCheck size={18} aria-hidden className="text-ok" />
    case 'waiting':
      return <Hourglass size={18} aria-hidden className="text-[#C2410C]" />
    case 'failed':
      return <CircleX size={18} aria-hidden className="text-bad" />
    default:
      return <CircleDashed size={18} aria-hidden className="text-wire-strong" />
  }
}

function Timeline({ run, onApprove }: { run: RunState; onApprove: (ok: boolean) => void }) {
  const steps = run.detail.steps
  return (
    <ol className="m-0 flex list-none flex-col px-[24px] pt-[16px] pb-[24px]">
      {steps.map((s, i) => {
        const queued = s.state === 'queued'
        const last = i === steps.length - 1
        return (
          <li key={`${s.kind}-${i}`} className="relative flex gap-[14px] pb-[16px]">
            {!last && <span aria-hidden className="absolute top-[22px] bottom-[2px] left-[8px] w-px bg-line-strong" />}
            <span className="relative mt-[-1px] shrink-0 bg-surface">
              <StepIcon state={s.state} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
              <div className="flex items-center gap-[9px]">
                <span className="text-[11px] font-semibold tracking-[0.6px] text-muted">{s.kind}</span>
                <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${queued ? 'text-muted' : 'text-ink'}`}>{s.title}</span>
                <span className="text-[11.5px] whitespace-nowrap text-faint">{s.time}</span>
              </div>
              {s.sub && <span className="text-[12.5px] text-ink-2">{s.sub}</span>}
              {s.output && (
                <dl className="m-0 mt-[2px] mb-[2px] flex flex-col rounded-base bg-soft px-[10px] py-[5px] outline-1 -outline-offset-1 outline-line-strong">
                  {s.output.map(([k, v]) => (
                    <div key={k} className="flex h-[21px] items-center gap-[10px]">
                      <dt className="w-[70px] shrink-0 font-mono text-[11px] text-muted">{k}</dt>
                      <dd className="m-0 text-[12.5px] text-ink">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {s.approval && (
                <div className="mt-[3px] mb-[4px] flex flex-col gap-[10px] rounded-base bg-warn-tint px-[12px] pt-[10px] pb-[8px] outline-1 -outline-offset-1 outline-warn-line">
                  <p className="m-0 text-[12.5px] text-ink-2">{s.approval.text}</p>
                  <div className="flex items-center gap-[6px]">
                    <button
                      type="button"
                      onClick={() => onApprove(true)}
                      className="flex h-[28px] items-center gap-[6px] rounded-btn bg-primary px-[11px] text-[12.5px] font-medium text-primary-ink hover:bg-primary-hover"
                    >
                      <Check size={13} aria-hidden />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => onApprove(false)}
                      className="h-[28px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
                    >
                      Decline
                    </button>
                    <span className="ml-[2px] text-[11.5px] text-faint">Also in your Inbox</span>
                  </div>
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

const CHIP_LOOK: Record<string, string> = {
  waiting: 'bg-[#FEF3C7] text-[#B45309]',
  succeeded: 'bg-ok-tint text-ok',
  noop: 'bg-app text-muted',
  failed: 'bg-bad-tint text-bad',
}

/** pen `Office · Flows · Runs` (GMEPK): run list + the selected run's step timeline. */
export function FlowRunsPage() {
  const { flowId } = useParams({ strict: false }) as { flowId: string }
  const navigate = useNavigate()
  const f = useFlow(flowId)
  const s = useFlowStore()
  const { data: apiRuns } = useFlowRuns(flowId)
  useEffect(() => {
    if (apiRuns) s.seedRuns(flowId, apiRuns)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, apiRuns])
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState(f.runs[0]?.id)
  const runs = f.runs.filter((r) => (filter === 'all' ? true : r.status === filter))
  const run = f.runs.find((r) => r.id === selectedId) ?? runs[0]
  const live = run && (run.status === 'waiting' || run.detail.chip === 'Running')

  return (
    <EditorFrame
      flowId={flowId}
      tab="runs"
      onTestRun={() => {
        s.startTest(flowId)
        void navigate({ to: '/flows/$flowId/canvas', params: { flowId } })
      }}
    >
      <section aria-label="Runs" className="flex w-[380px] shrink-0 flex-col shadow-[inset_-1px_0_0_var(--color-line-strong)]">
        <header className="flex h-[47px] shrink-0 items-center gap-[8px] pr-[14px] pl-[14px] shadow-[inset_0_-1px_0_var(--color-line)]">
          <h2 className="m-0 flex-1 text-[13px] font-semibold text-ink">{f.runs.length + 8} runs this week</h2>
          <div role="radiogroup" aria-label="Filter runs" className="flex gap-[8px]">
            {(
              [
                ['all', 'All'],
                ['waiting', 'Waiting'],
                ['failed', 'Failed'],
              ] as [Filter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={filter === id}
                onClick={() => setFilter(id)}
                className={`h-[24px] rounded-full px-[9px] text-[12px] font-medium ${
                  filter === id ? 'bg-primary text-primary-ink' : 'bg-surface text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-soft'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>
        <ul className="m-0 flex min-h-0 flex-1 list-none flex-col overflow-y-auto p-0">
          {runs.map((r) => (
            <RunRow
              key={r.id}
              run={r}
              selected={r.id === run?.id}
              onSelect={() => setSelectedId(r.id)}
              onRetry={() => setSelectedId(s.retryRun(flowId, r.id))}
              menu={[
                { label: 'Open', icon: PanelRight, onSelect: () => setSelectedId(r.id) },
                r.status === 'waiting' && r.detail.chip !== 'Running' && { type: 'separator' },
                r.status === 'waiting' && r.detail.chip !== 'Running' && { label: 'Approve', icon: Check, onSelect: () => { setSelectedId(r.id); s.approve(flowId, r.id, true) } },
                r.status === 'waiting' && r.detail.chip !== 'Running' && { label: 'Decline', icon: X, onSelect: () => { setSelectedId(r.id); s.approve(flowId, r.id, false) } },
                (r.status === 'waiting' || r.detail.chip === 'Running') && { label: 'Cancel run', icon: CircleSlash, onSelect: () => s.cancelRun(flowId, r.id) },
                r.status === 'failed' && { label: 'Retry from failed step', icon: RotateCcw, onSelect: () => setSelectedId(s.retryRun(flowId, r.id)) },
                { type: 'separator' },
                { label: 'Copy run link', icon: Link, onSelect: () => { copyText(`${location.origin}/flows/${flowId}/runs?run=${r.id}`); notify('Link copied') } },
                { label: 'Copy run ID', icon: Hash, onSelect: () => { copyText(`run_${r.number}`); notify('Run ID copied') } },
              ]}
            />
          ))}
          {runs.length === 0 && (
            <li className="px-[16px] py-[24px] text-[12.5px] text-muted">
              {f.runs.length === 0 ? 'No runs yet' : `No ${filter} runs this week.`}
            </li>
          )}
        </ul>
      </section>
      {run ? (
        <section aria-label={run.detail.title} className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <header className="flex shrink-0 items-start gap-[12px] px-[24px] pt-[17px] pb-[15px] shadow-[inset_0_-1px_0_var(--color-line)]">
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <div className="flex items-center gap-[9px]">
                <h2 className="m-0 font-display text-[19px] font-semibold tracking-[-0.3px] text-ink [font-variation-settings:'opsz'_96]">{run.detail.title}</h2>
                <span className={`inline-flex h-[19px] items-center rounded-xs px-[7px] text-[12px] font-medium ${CHIP_LOOK[run.status]}`}>
                  {run.detail.chip}
                </span>
              </div>
              <p className="m-0 truncate text-[12.5px] text-muted">{run.detail.sub}</p>
            </div>
            {live ? (
              <button
                type="button"
                onClick={() => s.cancelRun(flowId, run.id)}
                className="mt-[4px] h-[28px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
              >
                Cancel run
              </button>
            ) : run.status === 'failed' ? (
              <button
                type="button"
                onClick={() => setSelectedId(s.retryRun(flowId, run.id))}
                className="mt-[4px] flex h-[28px] items-center gap-[6px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
              >
                <RotateCcw size={13} aria-hidden />
                Retry
              </button>
            ) : null}
          </header>
          <Timeline run={run} onApprove={(ok) => s.approve(flowId, run.id, ok)} />
        </section>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">Pick a run to see its steps.</div>
      )}
    </EditorFrame>
  )
}
