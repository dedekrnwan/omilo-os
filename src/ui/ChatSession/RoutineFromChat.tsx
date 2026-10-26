import { CalendarSync, Check, Clock } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Mascot } from '../ds/Mascot'
import { notify } from '../ds/Toaster'

// ── Chat · Routine from chat (pen WTlg1) ──────────────────────────────────────
// The owner asks Chief for a recurring job in plain words; Chief answers with a
// `Chat/Widget` (X3g17) card confirming the routine it created.

// Times available for the inline time-picker popover
const TIME_OPTIONS = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00']

/** pen `Chat/Widget` (X3g17) filled as "Routine created". */
export function RoutineCreatedCard() {
  const navigate = useNavigate()
  const [timePickerOpen, setTimePickerOpen] = useState(false)
  const [selectedTime, setSelectedTime] = useState('09:00')

  const details = [
    ['Who', 'Growth'],
    ['When', `Mondays · ${selectedTime} · starts Oct 26`],
    ['Sends to', 'WhatsApp · you, and this chat'],
    ['Cost', '~$0.01 a run'],
  ]

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
        {details.map(([k, v], i) => (
          <div
            key={k}
            className={`flex w-full gap-[10px] py-[7px] ${i < details.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''}`}
          >
            <span className="w-[90px] shrink-0 text-[12.5px] text-muted">{k}</span>
            <span className="text-[12.5px] font-medium text-ink">{v}</span>
          </div>
        ))}
      </div>
      <div className="flex w-full items-center gap-[8px] bg-soft px-[16px] py-[10px] shadow-[inset_0_1px_0_var(--color-line)]">
        <button
          type="button"
          onClick={() => void navigate({ to: '/routines' })}
          className="inline-flex h-[30px] items-center rounded-btn bg-primary px-[14px] text-[13px] font-medium text-primary-ink outline-1 -outline-offset-1 outline-primary hover:bg-primary-hover"
        >
          Open in Routines
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setTimePickerOpen((v) => !v)}
            aria-expanded={timePickerOpen}
            className="inline-flex h-[30px] items-center gap-[5px] rounded-btn bg-surface px-[14px] text-[13px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
          >
            <Clock size={13} aria-hidden className="text-muted" />
            Change time
          </button>
          {timePickerOpen && (
            <div
              role="listbox"
              aria-label="Select time"
              className="absolute bottom-full left-0 z-50 mb-[4px] flex w-[120px] flex-col gap-px rounded-lg bg-surface p-[6px] shadow-[0_12px_32px_#0C0A0924] outline-1 -outline-offset-1 outline-line-strong"
            >
              {TIME_OPTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="option"
                  aria-selected={t === selectedTime}
                  onClick={() => { setSelectedTime(t); setTimePickerOpen(false); notify(`Routine time changed to ${t}`) }}
                  className={`flex w-full items-center rounded-btn px-[10px] py-[6px] text-left text-[13px] transition-colors hover:bg-hover ${t === selectedTime ? 'font-semibold text-ink' : 'text-ink-2'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
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
