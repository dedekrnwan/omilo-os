/**
 * InboxChangeAmountDialog — "Change amount" budget editor.
 * Matches design ref mw1zT.png.
 *
 * Shows:
 *   - Title: "Change the ad budget"
 *   - Current budget input (dollar)
 *   - Segmented quick-pick chips ($1,900 / $3,000 / $4,800)
 *   - Run for + Daily cap read-only fields
 *   - AI insight row (blue)
 *   - Optional note to agent textarea
 *   - Cancel / Approve $X buttons
 *
 * Visual-only. Parent supplies the initial `amount` and `label`.
 */

import { useState } from 'react'
import { X, Info } from 'lucide-react'
import { Button } from '../../ui/ds/Button'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InboxChangeAmountDialogProps {
  open: boolean
  /** Display label for what is being changed, e.g. "Growth asked for 14 days for the referral launch." */
  context: string
  /** The three quick-pick amounts (in dollars). */
  options: [number, number, number]
  /** Index of the pre-selected option (0-based). */
  defaultOption?: 0 | 1 | 2
  /** Run-for label, e.g. "14 days". */
  runFor?: string
  /** Daily cap label, e.g. "$215". */
  dailyCap?: string
  onClose: () => void
  onApprove: (amount: number, note: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export function InboxChangeAmountDialog({
  open,
  context,
  options,
  defaultOption = 1,
  runFor = '14 days',
  dailyCap = '$215',
  onClose,
  onApprove,
}: InboxChangeAmountDialogProps) {
  const [selected, setSelected] = useState<0 | 1 | 2>(defaultOption)
  const [note, setNote] = useState('')

  if (!open) return null

  const amount = options[selected]

  function handleApprove() {
    onApprove(amount, note)
    onClose()
  }

  // Insight copy is visual-only; references the middle option for coherence.
  const insight = `At ${fmt(options[selected])} we reach ~62% of the audience. Expected ~140 referrals instead of ~220. I'll stop early if cost per referral goes above $25.`

  return (
    /* Backdrop */
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Change amount"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0C0A0940] backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Panel */}
      <div className="relative flex w-[440px] flex-col gap-[18px] rounded-dialog bg-surface p-[24px] shadow-[0_20px_60px_#0C0A0933]">
        {/* Header */}
        <div className="flex items-center gap-[8px]">
          <h3 className="m-0 flex-1 text-[16px] font-semibold text-ink">Change the ad budget</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Context line */}
        <p className="m-0 text-[12.5px] text-muted">{context}</p>

        {/* Budget field */}
        <div className="flex flex-col gap-[6px]">
          <label className="text-[12px] font-medium text-ink-2" htmlFor="budget-display">
            Budget
          </label>
          {/* Amount display with dollar prefix */}
          <div className="flex h-[38px] items-center rounded-md outline-1 -outline-offset-1 outline-line-strong bg-soft px-[12px] gap-[4px]">
            <span className="text-[13.5px] font-medium text-muted">$</span>
            <span className="text-[15px] font-semibold text-ink" id="budget-display">
              {amount.toLocaleString('en-US')}
            </span>
          </div>

          {/* Quick-pick chips */}
          <div className="grid grid-cols-3 gap-[6px]">
            {options.map((opt, i) => (
              <button
                key={opt}
                type="button"
                onClick={() => setSelected(i as 0 | 1 | 2)}
                className={`h-[32px] rounded-md text-[12.5px] font-medium transition-colors outline-1 -outline-offset-1 ${
                  i === selected
                    ? 'bg-ink text-primary-ink outline-ink'
                    : 'bg-soft text-ink-2 outline-line-strong hover:bg-hover'
                }`}
              >
                {fmt(opt)}
              </button>
            ))}
          </div>
        </div>

        {/* Run for + Daily cap row */}
        <div className="grid grid-cols-2 gap-[10px]">
          <div className="flex flex-col gap-[4px]">
            <span className="text-[12px] font-medium text-ink-2">Run for</span>
            <div className="flex h-[34px] items-center rounded-md outline-1 -outline-offset-1 outline-line-strong bg-soft px-[10px]">
              <span className="text-[13px] text-ink">{runFor}</span>
            </div>
          </div>
          <div className="flex flex-col gap-[4px]">
            <span className="text-[12px] font-medium text-ink-2">Daily cap</span>
            <div className="flex h-[34px] items-center rounded-md outline-1 -outline-offset-1 outline-line-strong bg-soft px-[10px]">
              <span className="text-[13px] text-ink">{dailyCap}</span>
            </div>
          </div>
        </div>

        {/* AI insight row */}
        <div className="flex items-start gap-[8px] rounded-md bg-info-tint outline-1 -outline-offset-1 outline-info-line p-[10px]">
          <Info size={14} aria-hidden className="mt-[1px] shrink-0 text-info" />
          <p className="m-0 text-[12.5px] leading-[1.5] text-info">{insight}</p>
        </div>

        {/* Note field */}
        <div className="flex flex-col gap-[4px]">
          <label className="text-[12px] font-medium text-ink-2" htmlFor="change-amount-note">
            Note to Growth (optional)
          </label>
          <textarea
            id="change-amount-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Start smaller, we'll top up if week 1 looks good."
            className="w-full resize-none rounded-md outline-1 -outline-offset-1 outline-line-strong bg-soft px-[10px] py-[8px] text-[12.5px] text-ink placeholder:text-faint focus:outline-ink focus:outline-2 transition-[outline]"
          />
        </div>

        {/* Divider */}
        <div className="h-px w-full bg-line-strong" />

        {/* Footer */}
        <div className="flex items-center justify-end gap-[8px]">
          <Button variant="secondary" height={30} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" height={30} onClick={handleApprove}>
            Approve {fmt(amount)}
          </Button>
        </div>
      </div>
    </div>
  )
}
