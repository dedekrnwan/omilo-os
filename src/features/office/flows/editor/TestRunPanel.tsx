import { Check, CircleX, Loader2, RotateCcw, ScrollText, Upload, X } from 'lucide-react'
import type { FlowRun } from '../../../../core/domain/types'
import { formatDuration } from '../runsAdapter'
import { stepTime } from './runs'

/** One row of the result sheet. */
function rowsOf(run: FlowRun) {
  return (run.steps ?? []).map((st) => ({
    key: st.nodeId,
    label: st.label,
    result:
      st.status === 'skipped'
        ? 'Skipped in test'
        : st.status === 'failed'
          ? st.note || 'Failed'
          : st.note || (st.output?.result ? String(st.output.result).slice(0, 48) : 'Done'),
    time: st.status === 'skipped' ? 'dry run' : stepTime(st.durationMs),
    tone: st.status === 'failed' ? 'bad' : st.note === 'Would wait for you' || st.status === 'waiting' ? 'wait' : 'ok',
  }))
}

/**
 * pen `Canvas · Test run result` sheet: floats over the canvas bottom.
 * Shows the real test run (POST /v1/flows/{id}/test-run); nothing is sent to real apps.
 */
export function TestRunPanel({
  run,
  onClose,
  onRunAgain,
  onPublish,
  onViewLog,
  publishLabel = 'Publish changes',
}: {
  /** The finished test run; null while it is still running. */
  run: FlowRun | null
  onClose: () => void
  onRunAgain: () => void
  onPublish: () => void
  onViewLog: () => void
  publishLabel?: string
}) {
  const done = !!run && run.status !== 'running'
  const failed = done && run!.status === 'failed'
  const rows = run ? rowsOf(run) : []
  const summary = done
    ? `Ran with sample data · ${formatDuration(run!.duration) === '—' ? 'under 1s' : formatDuration(run!.duration)} · nothing was sent`
    : 'Running with sample data · nothing will be sent'
  return (
    <section
      role="dialog"
      aria-label="Test run result"
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute bottom-[16px] left-[317px] z-20 flex w-[780px] max-w-[calc(100%-333px)] flex-col rounded-lg bg-surface shadow-[0_12px_32px_#0C0A091F,0_2px_6px_#0C0A090F] outline-1 -outline-offset-1 outline-line-strong animate-in fade-in-0 slide-in-from-bottom-2"
    >
      <header className="flex h-[51px] items-center gap-[10px] pr-[14px] pl-[15px] shadow-[inset_0_-1px_0_var(--color-line)]">
        {failed ? (
          <span className="inline-flex h-[23px] items-center gap-[5px] rounded-sm bg-bad-tint px-[8px] text-[12.5px] font-medium text-bad outline-1 -outline-offset-1 outline-bad-line">
            <CircleX size={13} aria-hidden />
            Test failed
          </span>
        ) : done ? (
          <span className="inline-flex h-[23px] items-center gap-[5px] rounded-sm bg-ok-tint px-[8px] text-[12.5px] font-medium text-ok outline-1 -outline-offset-1 outline-ok-line">
            <Check size={13} aria-hidden />
            Test passed
          </span>
        ) : (
          <span className="inline-flex h-[23px] items-center gap-[5px] rounded-sm bg-soft px-[8px] text-[12.5px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong">
            <Loader2 size={13} aria-hidden className="animate-spin" />
            Testing…
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted">
          {summary}
        </span>
        <button type="button" aria-label="Close test result" onClick={onClose} className="flex size-[24px] items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-ink">
          <X size={15} aria-hidden />
        </button>
      </header>
      <ol className="m-0 flex list-none flex-col px-[15px] py-[6px]">
        {!done && (
          <li className="flex h-[34px] items-center gap-[10px]">
            <span className="size-[7px] shrink-0 animate-pulse rounded-full bg-wire-strong" aria-hidden />
            <span className="min-w-0 flex-1 truncate pl-[7px] text-[13px] text-muted">Running each step…</span>
          </li>
        )}
        {done && rows.length === 0 && (
          <li className="flex h-[34px] items-center pl-[17px] text-[13px] text-muted">
            {run!.waitingFor === 'no trigger node' ? 'Add a trigger so the flow knows when to start.' : 'No steps ran.'}
          </li>
        )}
        {rows.map((s, i) => (
          <li
            key={`${s.key}-${i}`}
            className={`flex h-[34px] items-center gap-[10px] ${i < rows.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}
          >
            <span
              className={`size-[7px] shrink-0 rounded-full ${s.tone === 'wait' ? 'bg-[#C2410C]' : s.tone === 'bad' ? 'bg-bad' : 'bg-ok'}`}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate pl-[7px] text-[13px] text-ink">{s.label}</span>
            <span className="max-w-[240px] truncate text-[12.5px] whitespace-nowrap text-muted">{s.result}</span>
            <span className="w-[62px] shrink-0 text-right font-mono text-[11.5px] text-faint">{s.time}</span>
          </li>
        ))}
      </ol>
      <footer className="flex h-[52px] items-center gap-[8px] pr-[15px] pl-[15px] shadow-[inset_0_1px_0_var(--color-line)]">
        <button type="button" onClick={onViewLog} className="flex h-[28px] items-center gap-[6px] rounded-sm px-[14px] text-[13px] text-muted hover:bg-hover hover:text-ink-2">
          <ScrollText size={14} aria-hidden />
          View full log
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onRunAgain}
          disabled={!done}
          className="flex h-[32px] items-center gap-[7px] rounded-base bg-surface px-[14px] text-[13px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft disabled:text-muted"
        >
          <RotateCcw size={15} aria-hidden />
          Run again
        </button>
        <button
          type="button"
          onClick={onPublish}
          disabled={!done || failed}
          className="flex h-[32px] items-center gap-[7px] rounded-base bg-primary px-[15px] text-[13px] font-medium text-primary-ink hover:bg-primary-hover disabled:opacity-60"
        >
          <Upload size={15} aria-hidden />
          {publishLabel}
        </button>
      </footer>
    </section>
  )
}
