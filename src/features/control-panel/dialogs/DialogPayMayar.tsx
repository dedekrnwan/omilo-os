import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CircleCheck, CreditCard, ExternalLink, Landmark, QrCode, Smartphone, Wallet } from 'lucide-react'
import { Chip, DialogCard, IconTile, PenButton, Spinner, SumRow } from '../ControlPanelShared'
import { usePayment } from '../../../app/queries'
import { openCheckout } from '../format'

/** A hosted-checkout payment the user is completing in Mayar (Doit). */
export interface PendingPayment {
  id: string | null
  hostedUrl: string | null
  /** Summary rows (first row is the item, last is "Due today"). */
  lines: { label: string; value: string }[]
  /** What gets unlocked when it's paid, e.g. "Seats are added". */
  unlocks: string
}

function useCountdown(fromIso: string | null | undefined, minutes = 15): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!fromIso) return null
  const end = new Date(fromIso).getTime() + minutes * 60_000
  const left = Math.max(0, Math.floor((end - now) / 1000))
  return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`
}

/** pen Dupmg · Members · Paying with Mayar */
export function DialogPayMayar({ onClose, payment }: { onClose: () => void; payment: PendingPayment | null }) {
  const qc = useQueryClient()
  const { data: live } = usePayment(payment?.id ?? null)
  const status = live?.status ?? 'pending'
  const paid = status === 'paid'
  const failed = status === 'failed' || status === 'expired'
  const countdown = useCountdown(live?.createdAt)
  const hostedUrl = live?.hostedUrl ?? payment?.hostedUrl ?? null

  useEffect(() => {
    if (paid) {
      for (const k of [['seats'], ['billingSubscription'], ['usage'], ['ledger'], ['invoices'], ['invites']]) {
        void qc.invalidateQueries({ queryKey: k })
      }
    }
  }, [paid, qc])

  const lines = payment?.lines ?? []
  return (
    <DialogCard
      width={460}
      tile={<IconTile icon={Wallet} iconClassName="text-ink" />}
      title={paid ? 'Payment received' : 'Finish paying in Mayar'}
      sub={paid ? 'Thanks — it’s all set.' : 'We opened Mayar’s secure checkout in a new tab.'}
      onClose={onClose}
      bodyGap={14}
      footer={
        paid ? (
          <>
            <div className="h-px flex-1" />
            <PenButton variant="primary" fs={13} onClick={onClose}>Done</PenButton>
          </>
        ) : (
          <>
            <PenButton fs={13} onClick={onClose}>{failed ? 'Close' : 'Cancel payment'}</PenButton>
            <div className="h-px flex-1" />
            <PenButton
              variant="primary"
              fs={13}
              icon={ExternalLink}
              disabled={!hostedUrl}
              onClick={() => hostedUrl && openCheckout(hostedUrl)}
            >
              Reopen checkout
            </PenButton>
          </>
        )
      }
    >
      {lines.length > 0 && (
        <div className="flex w-full flex-col overflow-hidden rounded-md outline-1 -outline-offset-1 outline-line-strong">
          {lines.map((l, i) => (
            <SumRow key={l.label} first={i === 0} soft={i === lines.length - 1} strong={i === lines.length - 1} label={l.label} value={l.value} />
          ))}
        </div>
      )}
      {paid ? (
        <div className="flex w-full items-center gap-[10px] rounded-md bg-ok-tint px-[14px] py-[12px] outline-1 -outline-offset-1 outline-ok-line">
          <CircleCheck size={16} aria-hidden className="text-ok" />
          <span className="text-[13px] font-semibold text-ok">Paid · {payment?.unlocks ?? 'Your purchase is active'}.</span>
        </div>
      ) : failed ? (
        <div className="flex w-full items-center gap-[10px] rounded-md bg-bad-tint px-[14px] py-[12px] outline-1 -outline-offset-1 outline-bad-line">
          <span className="text-[13px] font-semibold text-bad">This checkout {status}. Start again to pay.</span>
        </div>
      ) : (
        <div className="flex w-full items-center gap-[10px] rounded-md bg-info-tint px-[14px] py-[12px] outline-1 -outline-offset-1 outline-info-line">
          <Spinner />
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[13px] font-semibold text-info">Waiting for payment…</span>
            <span className="text-[12px] text-ink-2">{payment?.unlocks ?? 'It’s applied'} the moment Mayar confirms.</span>
          </div>
          {countdown && <span className="font-mono text-[12px] text-info">{countdown}</span>}
        </div>
      )}
      <div className="flex w-full flex-col gap-[8px]">
        <span className="text-[12px] text-muted">Pay with any of these in Mayar</span>
        <div className="flex gap-[6px]">
          <Chip icon={QrCode}>QRIS</Chip>
          <Chip icon={Landmark}>Virtual account</Chip>
          <Chip icon={Smartphone}>E-wallet</Chip>
          <Chip icon={CreditCard}>Card</Chip>
        </div>
      </div>
      {!paid && <span className="text-[12px] text-muted">You can close this. We’ll notify you when it’s paid.</span>}
    </DialogCard>
  )
}
