import { Check, Loader2, RotateCcw, ScrollText, Upload, X } from 'lucide-react'
import { TEST_RUN } from './data'

/**
 * pen `Canvas · Test run result` sheet: floats over the canvas bottom.
 * Steps tick in as the dry run goes; nothing is sent to real apps.
 */
export function TestRunPanel({
  step,
  done,
  onClose,
  onRunAgain,
  onPublish,
  onViewLog,
  publishLabel = 'Publish changes',
}: {
  /** How many steps have finished */
  step: number
  done: boolean
  onClose: () => void
  onRunAgain: () => void
  onPublish: () => void
  onViewLog: () => void
  publishLabel?: string
}) {
  return (
    <section
      role="dialog"
      aria-label="Test run result"
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute bottom-[16px] left-[317px] z-20 flex w-[780px] max-w-[calc(100%-333px)] flex-col rounded-lg bg-surface shadow-[0_12px_32px_#0C0A091F,0_2px_6px_#0C0A090F] outline-1 -outline-offset-1 outline-line-strong animate-in fade-in-0 slide-in-from-bottom-2"
    >
      <header className="flex h-[51px] items-center gap-[10px] pr-[14px] pl-[15px] shadow-[inset_0_-1px_0_var(--color-line)]">
        {done ? (
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
          {done ? TEST_RUN.summary : 'Running with last run’s data · nothing will be sent'}
        </span>
        <button type="button" aria-label="Close test result" onClick={onClose} className="flex size-[24px] items-center justify-center rounded-sm text-muted hover:bg-hover hover:text-ink">
          <X size={15} aria-hidden />
        </button>
      </header>
      <ol className="m-0 flex list-none flex-col px-[15px] py-[6px]">
        {TEST_RUN.steps.map((s, i) => {
          const finished = i < step
          const current = i === step && !done
          return (
            <li
              key={s.label}
              className={`flex h-[34px] items-center gap-[10px] ${i < TEST_RUN.steps.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}
            >
              <span
                className={`size-[7px] shrink-0 rounded-full ${
                  finished ? (s.tone === 'wait' ? 'bg-[#C2410C]' : 'bg-ok') : current ? 'animate-pulse bg-wire-strong' : 'bg-line-strong'
                }`}
                aria-hidden
              />
              <span className={`min-w-0 flex-1 truncate pl-[7px] text-[13px] ${finished ? 'text-ink' : 'text-muted'}`}>{s.label}</span>
              <span className="text-[12.5px] whitespace-nowrap text-muted">{finished ? s.result : current ? 'running…' : ''}</span>
              <span className="w-[62px] shrink-0 text-right font-mono text-[11.5px] text-faint">{finished ? s.time : ''}</span>
            </li>
          )
        })}
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
          disabled={!done}
          className="flex h-[32px] items-center gap-[7px] rounded-base bg-primary px-[15px] text-[13px] font-medium text-primary-ink hover:bg-primary-hover disabled:opacity-60"
        >
          <Upload size={15} aria-hidden />
          {publishLabel}
        </button>
      </footer>
    </section>
  )
}
