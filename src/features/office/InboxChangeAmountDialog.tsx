/**
 * InboxChangeAmountDialog — "Change the ad budget" (pen mw1zT).
 * Budget field + quick picks · Run for / Daily cap · helper forecast · note · Cancel / Approve $X.
 */

import { useState } from 'react'
import { Calendar, Check, DollarSign, Gauge, Wallet } from 'lucide-react'
import type { HelperArea } from '../../core/domain/types'
import { Mascot } from '../../ui/ds/Mascot'
import { Btn32, Field, OfficeDialog } from './ui'

export interface InboxChangeAmountDialogProps {
  open: boolean
  /** Helper who asked, e.g. "Growth". */
  asker: string
  /** Helper whose mascot speaks the forecast (pen uses Mini/Grower = Ops look). */
  forecastArea?: HelperArea
  /** Original ask, in dollars. */
  asked: number
  /** Quick-pick amounts (dollars). */
  options: readonly number[]
  defaultAmount: number
  /** Campaign length in days (parsed from the request), when known. */
  days?: number | null
  /** Pre-filled note. */
  defaultNote?: string
  onClose: () => void
  onApprove: (amount: number, note: string) => void | Promise<void>
}

function fmt(n: number) {
  return `$${n.toLocaleString('en-US')}`
}

function parse(v: string) {
  const n = Number(v.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function InboxChangeAmountDialog({
  open,
  asker,
  forecastArea = 'ops',
  asked,
  options,
  defaultAmount,
  days,
  defaultNote = '',
  onClose,
  onApprove,
}: InboxChangeAmountDialogProps) {
  const [amount, setAmount] = useState(defaultAmount)
  const [note, setNote] = useState(defaultNote)
  const [saving, setSaving] = useState(false)
  const share = asked > 0 ? Math.round((amount / asked) * 100) : 100
  const runFor = days ? `${days} days` : 'As requested'
  const dailyCap = days ? fmt(Math.round(amount / days)) : '—'

  return (
    <OfficeDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      width={480}
      icon={Wallet}
      title="Change the ad budget"
      sub={`${asker} asked for ${fmt(asked)}${days ? ` over ${days} days` : ''}.`}
      footer={
        <>
          <Btn32 variant="secondary" onClick={onClose}>
            Cancel
          </Btn32>
          <span className="h-px flex-1" />
          <Btn32
            variant="primary"
            icon={Check}
            disabled={saving || amount <= 0}
            onClick={async () => {
              setSaving(true)
              try {
                await onApprove(amount, note)
              } finally {
                setSaving(false)
              }
            }}
          >
            Approve {fmt(amount)}
          </Btn32>
        </>
      }
    >
      <Field
        id="budget-amount"
        label="Budget"
        icon={DollarSign}
        value={fmt(amount)}
        onChange={(v) => setAmount(parse(v))}
      />
      <div className="flex gap-[8px]" role="group" aria-label="Quick amounts">
        {options.map((opt) => {
          const on = opt === amount
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={on}
              onClick={() => setAmount(opt)}
              className={`rounded-pill px-[12px] py-[6px] text-[12.5px] font-medium transition-colors ${
                on ? 'bg-ink text-white' : 'text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-soft'
              }`}
            >
              {fmt(opt)}
            </button>
          )
        })}
      </div>
      <div className="flex w-full gap-[12px]">
        <Field id="budget-run-for" label="Run for" icon={Calendar} value={runFor} className="flex-1" />
        <Field id="budget-daily-cap" label="Daily cap" icon={Gauge} value={dailyCap} className="flex-1" />
      </div>
      <div className="flex w-full gap-[10px] rounded-md bg-info-tint px-[12px] py-[10px] outline-1 -outline-offset-1 outline-info-line">
        <Mascot size={24} radius={7} area={forecastArea} helper />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[12.5px] font-semibold text-ink">
            {asker}: {amount >= asked ? `${fmt(amount)} is the full ask` : `${fmt(amount)} is ${share}% of what I asked for`}
          </span>
          <p className="m-0 text-[12.5px] leading-[1.45] text-ink-2">
            I'll spend up to {fmt(amount)}{days ? ` over ${days} days (about ${dailyCap} a day)` : ''} and stop at the cap.
          </p>
        </div>
      </div>
      <Field id="budget-note" label={`Note to ${asker} (optional)`} value={note} onChange={setNote} />
    </OfficeDialog>
  )
}
