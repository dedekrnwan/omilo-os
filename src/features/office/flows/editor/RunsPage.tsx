import { useMemo, useState } from 'react'
import { Check, CircleCheck, CircleSlash, Hash, Link, PanelRight, Play, X, CircleDashed, CircleMinus, CircleX, Hourglass, Loader2, RotateCcw } from 'lucide-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { RunStatus, RunStep } from './data'
import { EditorFrame } from './EditorFrame'
import { ContextMenuArea, MoreMenu, copyText } from '../../../../ui/ds/ItemMenu'
import type { MenuEntries } from '../../../../ui/ds/ItemMenu'
import { notify } from '../../../../ui/ds/Toaster'
import { useFlowStore } from './store'
import { runsThisWeek, toRunStates } from './runs'
import type { RunState } from './runs'
import { useFlowRun, useFlowRunAction, useFlowRuns } from '../../../../app/queries'
import type { FlowRunAction } from '../../../../app/queries'
import { EmptyState } from '../../../../ui/ds/EmptyState'

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
  if (r.live) return { label: 'Running', ink: 'text-muted' }
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
  const running = run.live
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
          Retry
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

function Timeline({ run, onApprove, busy }: { run: RunState; onApprove: (ok: boolean) => void; busy?: boolean }) {
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
                      disabled={busy}
                      onClick={() => onApprove(true)}
                      className="flex h-[28px] items-center gap-[6px] rounded-btn bg-primary px-[11px] text-[12.5px] font-medium text-primary-ink hover:bg-primary-hover"
                    >
                      <Check size={13} aria-hidden />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
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
  const s = useFlowStore()
  const { data: apiRuns = [], isLoading, isError } = useFlowRuns(flowId)
  const all = useMemo(() => toRunStates(apiRuns), [apiRuns])
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('run') ?? undefined : undefined,
  )
  const runs = all.filter((r) => (filter === 'all' ? true : r.status === filter))
  const listed = all.find((r) => r.id === selectedId) ?? runs[0]
  // Full step log for the selected run (polls while it is still going).
  const { data: detail } = useFlowRun(flowId, listed?.id, { poll: true })
  const run = useMemo(() => {
    if (!listed) return undefined
    if (!detail?.steps) return listed
    const [fresh] = toRunStates([detail])
    return { ...fresh, number: listed.number, detail: { ...fresh.detail, title: listed.detail.title } }
  }, [listed, detail])
  const live = run && (run.waiting || run.live)
  const action = useFlowRunAction()

  function act(a: FlowRunAction, done: string, select = false) {
    action.mutate(a, {
      onSuccess: (r) => {
        notify(done)
        if (select) setSelectedId(r.id)
      },
      onError: () => notify('Could not update the run — try again'),
    })
  }
  const approve = (id: string, ok: boolean) =>
    act({ kind: 'decide', flowId, runId: id, approve: ok }, ok ? 'Approved — the run continues' : 'Declined — nothing changed')
  const cancel = (id: string) => act({ kind: 'cancel', flowId, runId: id }, 'Run cancelled')
  const retry = (id: string) => act({ kind: 'retry', flowId, runId: id }, 'Retrying — new run started', true)
  const runNow = () => act({ kind: 'run', flowId }, 'Run started', true)

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
          <h2 className="m-0 flex-1 text-[13px] font-semibold text-ink">
            {(() => {
              const n = runsThisWeek(apiRuns)
              return `${n} run${n === 1 ? '' : 's'} this week`
            })()}
          </h2>
          <button
            type="button"
            onClick={runNow}
            disabled={action.isPending}
            className="flex h-[24px] items-center gap-[4px] rounded-full bg-surface px-[9px] text-[12px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-soft disabled:text-muted"
          >
            <Play size={11} aria-hidden />
            Run now
          </button>
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
              onRetry={() => retry(r.id)}
              menu={[
                { label: 'Open', icon: PanelRight, onSelect: () => setSelectedId(r.id) },
                r.waiting && { type: 'separator' },
                r.waiting && { label: 'Approve', icon: Check, onSelect: () => { setSelectedId(r.id); approve(r.id, true) } },
                r.waiting && { label: 'Decline', icon: X, onSelect: () => { setSelectedId(r.id); approve(r.id, false) } },
                (r.waiting || r.live) && { label: 'Cancel run', icon: CircleSlash, onSelect: () => cancel(r.id) },
                r.status === 'failed' && { label: 'Retry', icon: RotateCcw, onSelect: () => retry(r.id) },
                { type: 'separator' },
                { label: 'Copy run link', icon: Link, onSelect: () => { copyText(`${location.origin}/flows/${flowId}/runs?run=${r.id}`); notify('Link copied') } },
                { label: 'Copy run ID', icon: Hash, onSelect: () => { copyText(r.id); notify('Run ID copied') } },
              ]}
            />
          ))}
          {isLoading && <li className="px-[16px] py-[24px] text-[12.5px] text-muted">Loading runs…</li>}
          {isError && (
            <li role="alert" className="px-[16px] py-[24px] text-[12.5px] text-bad">
              Could not load runs. Please refresh to try again.
            </li>
          )}
          {!isLoading && !isError && runs.length === 0 && (
            <li>
              {all.length === 0 ? (
                <EmptyState size="sm" title="No runs yet" description="Use Run now or Test run to try this flow." />
              ) : (
                <EmptyState size="sm" title={`No ${filter} runs`} description="Try another filter." />
              )}
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
                disabled={action.isPending}
                onClick={() => cancel(run.id)}
                className="mt-[4px] h-[28px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
              >
                Cancel run
              </button>
            ) : run.status === 'failed' ? (
              <button
                type="button"
                disabled={action.isPending}
                onClick={() => retry(run.id)}
                className="mt-[4px] flex h-[28px] items-center gap-[6px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
              >
                <RotateCcw size={13} aria-hidden />
                Retry
              </button>
            ) : null}
          </header>
          {run.detail.steps.length === 0 ? (
            <p className="m-0 px-[24px] py-[16px] text-[12.5px] text-muted">No step log for this run.</p>
          ) : (
            <Timeline run={run} busy={action.isPending} onApprove={(ok) => approve(run.id, ok)} />
          )}
        </section>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          {all.length === 0 && !isLoading ? (
            <EmptyState
              title="This flow hasn't run yet"
              description="Use Run now for a real run, or Test run to try it without touching anything. Each step's input and output shows up here."
            />
          ) : (
            'Pick a run to see its steps.'
          )}
        </div>
      )}
    </EditorFrame>
  )
}
