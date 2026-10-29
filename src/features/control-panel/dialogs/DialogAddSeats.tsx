import { useState } from 'react'
import { ExternalLink, Minus, Plus, UserPlus } from 'lucide-react'
import { DialogCard, PenButton, SumRow } from '../ControlPanelShared'
import { useBuySeats, usePlans, useSeats } from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'
import { errorMessage, formatIdrShort, openCheckout, shortDate } from '../format'
import type { PendingPayment } from './DialogPayMayar'

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-[5px]">
      <span className="size-[8px] rounded-[2px]" style={{ background: color }} />
      <span className="text-[11.5px] text-muted">{label}</span>
    </span>
  )
}

/** Days left in the current period + its length (for the proration estimate). */
function proration(periodEnd: string | null | undefined, yearly: boolean): { daysLeft: number; periodDays: number } {
  const periodDays = yearly ? 365 : 30
  if (!periodEnd) return { daysLeft: periodDays, periodDays }
  const left = Math.ceil((new Date(periodEnd).getTime() - Date.now()) / 86_400_000)
  return { daysLeft: Math.max(1, Math.min(periodDays, left)), periodDays }
}

/** pen rWvit · Members · Add seats */
export function DialogAddSeats({
  onClose,
  onPay,
  initialCount = 1,
}: {
  onClose: () => void
  onPay?: (p: PendingPayment) => void
  initialCount?: number
}) {
  const { data: seats, isLoading } = useSeats()
  const { data: plans = [] } = usePlans()
  const buy = useBuySeats()
  const [count, setCount] = useState(Math.max(1, initialCount))

  const plan = plans.find((p) => p.id === seats?.planId)
  const price = seats?.seatPriceIdr ?? null
  const total = seats?.total ?? 0
  const max = seats?.max ?? null
  const room = max == null ? 50 : Math.max(0, max - total)
  const canBuy = !!seats && seats.canAdd && price != null && room > 0
  const used = seats?.used ?? 0
  const pending = seats?.pending ?? 0
  const extraNow = Math.max(0, total - (seats?.included ?? 0))
  const yearly = seats?.billingInterval === 'yearly'
  const { daysLeft, periodDays } = proration(seats?.periodEnd, yearly)
  const unit = (price ?? 0) * (yearly ? 12 : 1)
  const dueToday = Math.round((count * unit * daysLeft) / periodDays)
  const planMonthly = plan?.monthlyPriceIdr ?? 0
  const monthlyAfter = planMonthly + (extraNow + count) * (price ?? 0)

  // Bar: people · pending · new · still available (up to the plan max).
  const barMax = max ?? Math.max(total + count, used + pending + count) + 3
  const free = Math.max(0, barMax - used - pending - count)
  const bar = [
    ...Array(Math.min(used, barMax)).fill('var(--color-ink)'),
    ...Array(pending).fill('var(--color-spark)'),
    ...Array(count).fill('var(--color-ok)'),
    ...Array(free).fill('var(--color-line-strong)'),
  ].slice(0, 40) as string[]

  async function handlePay() {
    try {
      const r = await buy.mutateAsync(count)
      if (r.hostedUrl) {
        openCheckout(r.hostedUrl)
        onPay?.({
          id: r.paymentId,
          hostedUrl: r.hostedUrl,
          lines: [
            { label: `${count} extra seat${count === 1 ? '' : 's'} · ${seats?.planName ?? 'plan'}`, value: `${formatIdrShort(count * (price ?? 0))} / mo` },
            { label: 'Due today, prorated', value: formatIdrShort(r.amountIdr) },
          ],
          unlocks: 'Seats are added',
        })
        return
      }
      notify(`${count} seat${count === 1 ? '' : 's'} added`)
      onClose()
    } catch (e) {
      notify(errorMessage(e, 'Could not add seats'))
    }
  }

  return (
    <DialogCard
      width={480}
      icon={UserPlus}
      title={`Add seats to ${seats?.planName ?? 'your plan'}`}
      sub="Anyone you invite as a member or admin uses a seat."
      onClose={onClose}
      footer={
        <>
          <PenButton fs={13} onClick={onClose}>Cancel</PenButton>
          <div className="h-px flex-1" />
          <PenButton variant="primary" fs={13} icon={ExternalLink} disabled={!canBuy || buy.isPending} onClick={() => void handlePay()}>
            {buy.isPending ? 'Starting…' : `Pay ${formatIdrShort(dueToday)} with Mayar`}
          </PenButton>
        </>
      }
    >
      {isLoading && <span className="text-[12.5px] text-muted">Loading seats…</span>}
      {seats && !seats.canAdd && (
        <span className="text-[12.5px] text-warn">{seats.planName ?? 'This plan'} has no extra seats. Change plan to add more people.</span>
      )}
      {seats && seats.canAdd && room === 0 && (
        <span className="text-[12.5px] text-warn">{seats.planName} tops out at {max} seats.</span>
      )}
      <div className="flex w-full items-center gap-[12px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[13px] font-semibold text-ink">Extra seats</span>
          <span className="text-[12px] text-muted">
            {total + count}{max != null ? ` of ${max}` : ''} seats on {seats?.planName ?? 'your plan'} after this
          </span>
        </div>
        <div className="flex h-[34px] items-center rounded-base outline-1 -outline-offset-1 outline-line-strong">
          <button type="button" aria-label="Fewer seats" disabled={count <= 1} onClick={() => setCount((c) => Math.max(1, c - 1))} className="flex size-[34px] items-center justify-center disabled:opacity-40">
            <Minus size={15} aria-hidden className="text-ink-2" />
          </button>
          <span className="flex h-[34px] w-[44px] items-center justify-center font-mono text-[15px] font-medium text-ink shadow-[inset_1px_0_0_var(--color-line-strong),inset_-1px_0_0_var(--color-line-strong)]">
            {count}
          </span>
          <button type="button" aria-label="More seats" disabled={count >= room} onClick={() => setCount((c) => Math.min(room, c + 1))} className="flex size-[34px] items-center justify-center disabled:opacity-40">
            <Plus size={15} aria-hidden className="text-ink-2" />
          </button>
        </div>
      </div>
      <div className="flex w-full flex-col gap-[6px]">
        <div className="flex h-[8px] w-full gap-[3px]">
          {bar.map((c, i) => (
            <span key={i} className="h-[8px] flex-1 rounded-[2px]" style={{ background: c }} />
          ))}
        </div>
        <div className="flex gap-[12px]">
          <Legend color="var(--color-ink)" label={`${used} ${used === 1 ? 'person' : 'people'}`} />
          {pending > 0 && <Legend color="var(--color-spark)" label={`${pending} pending`} />}
          <Legend color="var(--color-ok)" label={`${count} new`} />
          {max != null && <Legend color="var(--color-line-strong)" label={`${Math.max(0, max - total - count)} more available`} />}
        </div>
      </div>
      <div className="flex w-full flex-col overflow-hidden rounded-md outline-1 -outline-offset-1 outline-line-strong">
        <SumRow first label={`${seats?.planName ?? 'Plan'} plan · ${seats?.included ?? 0} seats included`} value={formatIdrShort(planMonthly)} />
        <SumRow label={`${extraNow + count} extra seat${extraNow + count === 1 ? '' : 's'} × ${formatIdrShort(price)}`} value={formatIdrShort((extraNow + count) * (price ?? 0))} />
        <SumRow soft strong label={`Monthly${seats?.periodEnd ? ` from ${shortDate(seats.periodEnd)}` : ''}`} value={formatIdrShort(monthlyAfter)} />
        <SumRow soft label={`Due today · prorated, ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`} value={formatIdrShort(dueToday)} />
      </div>
      <span className="text-[12px] text-muted">Extra seats renew with your plan each period.</span>
    </DialogCard>
  )
}
