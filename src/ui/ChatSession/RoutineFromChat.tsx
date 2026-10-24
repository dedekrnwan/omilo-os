import { CalendarSync, Check } from 'lucide-react'
import { Mascot } from '../ds/Mascot'

// ── Chat · Routine from chat (pen WTlg1) ──────────────────────────────────────
// The owner asks Chief for a recurring job in plain words; Chief answers with a
// `Chat/Widget` (X3g17) card confirming the routine it created.

const DETAILS = [
  ['Who', 'Growth'],
  ['When', 'Mondays · 09:00 · starts Oct 26'],
  ['Sends to', 'WhatsApp · you, and this chat'],
  ['Cost', '~$0.01 a run'],
]

/** pen `Chat/Widget` (X3g17) filled as "Routine created". */
export function RoutineCreatedCard() {
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong">
      <div className="flex w-full items-center gap-[10px] px-[16px] pt-[14px] pb-[12px]">
        <span className="flex size-[32px] shrink-0 items-center justify-center rounded-md bg-[#EEF2FF] outline-1 -outline-offset-1 outline-line">
          <CalendarSync size={16} aria-hidden className="text-[#4338CA]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[14px] font-semibold text-ink">Weekly signups by city</span>
          <span className="text-[12px] text-muted">New routine · managed by Chief</span>
        </div>
        {/* pen `Chip/Up` (Elczk) */}
        <span className="inline-flex h-[22px] items-center gap-[4px] rounded-sm bg-ok-tint px-[8px] outline-1 -outline-offset-1 outline-ok-line">
          <Check size={12} aria-hidden className="text-ok" />
          <span className="text-[12px] font-medium text-ok">Created</span>
        </span>
      </div>
      <div className="flex w-full flex-col px-[16px] pb-[14px]">
        {DETAILS.map(([k, v], i) => (
          <div
            key={k}
            className={`flex w-full gap-[10px] py-[7px] ${i < DETAILS.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}
          >
            <span className="w-[90px] shrink-0 text-[12.5px] text-muted">{k}</span>
            <span className="text-[12.5px] font-medium text-ink">{v}</span>
          </div>
        ))}
      </div>
      <div className="flex w-full items-center gap-[8px] bg-soft px-[16px] py-[10px] shadow-[inset_0_1px_0_var(--color-line)]">
        <button
          type="button"
          className="inline-flex h-[30px] items-center rounded-btn bg-primary px-[14px] text-[13px] font-medium text-primary-ink outline-1 -outline-offset-1 outline-primary hover:bg-primary-hover"
        >
          Open in Routines
        </button>
        <button
          type="button"
          className="inline-flex h-[30px] items-center rounded-btn bg-surface px-[14px] text-[13px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
        >
          Change time
        </button>
        <span className="h-px flex-1" />
        <span className="text-[11px] text-faint">Chief · just now</span>
      </div>
    </div>
  )
}

/** Thread for the routine-from-chat state. */
export function RoutineCreatedThread() {
  const col = 'w-[680px] max-w-[calc(100%-48px)]'
  return (
    <div role="log" aria-label="Messages" className="flex flex-col items-center gap-[20px] pt-[23px] pb-[13px]">
      <div className={`${col} flex justify-end`}>
        {/* pen `Owner Bubble` (XX2OZ) */}
        <div className="w-[360px] max-w-full rounded-[14px_14px_4px_14px] bg-soft px-[14px] py-[10px] outline-1 -outline-offset-1 outline-line">
          <p className="m-0 text-[14px] leading-[1.55] text-ink">
            @Chief every Monday at 9, send me how many RT admins signed up last week, by city.
          </p>
        </div>
      </div>
      <div className={`${col} flex gap-[10px]`}>
        <Mascot size={24} radius={7} area="brand" />
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <div className="flex items-center gap-[8px]">
            <span className="text-[12.5px] font-semibold text-ink">Chief</span>
            <span className="text-[11.5px] text-muted">Chief of Staff</span>
            <span className="text-[11.5px] text-faint">now</span>
          </div>
          <p className="m-0 text-[13.5px] leading-[1.55] text-ink-2">
            Done — I gave it to Growth, since it already reads signups. Monday 09:00 was free, so it starts next week.
          </p>
        </div>
      </div>
      <div className={`${col} pl-[34px]`}>
        <RoutineCreatedCard />
      </div>
    </div>
  )
}
