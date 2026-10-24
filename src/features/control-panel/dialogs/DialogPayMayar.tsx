import { CreditCard, ExternalLink, Landmark, QrCode, Smartphone, Wallet } from 'lucide-react'
import { Chip, DialogCard, IconTile, PenButton, Spinner, SumRow } from '../ControlPanelShared'

/** pen Dupmg · Members · Paying with Mayar */
export function DialogPayMayar({ onClose }: { onClose: () => void }) {
  return (
    <DialogCard
      width={460}
      tile={<IconTile icon={Wallet} iconClassName="text-ink" />}
      title="Finish paying in Mayar"
      sub="We opened Mayar’s secure checkout in a new tab."
      onClose={onClose}
      bodyGap={14}
      footer={
        <>
          <PenButton fs={13} onClick={onClose}>Cancel payment</PenButton>
          <div className="h-px flex-1" />
          <PenButton variant="primary" fs={13} icon={ExternalLink}>Reopen checkout</PenButton>
        </>
      }
    >
      <div className="flex w-full flex-col overflow-hidden rounded-md outline-1 -outline-offset-1 outline-line-strong">
        <SumRow first label="2 extra seats · Team" value="Rp 300 rb / mo" />
        <SumRow soft strong label="Due today, prorated" value="Rp 77 rb" />
      </div>
      <div className="flex w-full items-center gap-[10px] rounded-md bg-info-tint px-[14px] py-[12px] outline-1 -outline-offset-1 outline-info-line">
        <Spinner />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[13px] font-semibold text-info">Waiting for payment…</span>
          <span className="text-[12px] text-ink-2">Seats are added the moment Mayar confirms.</span>
        </div>
        <span className="font-mono text-[12px] text-info">14:52</span>
      </div>
      <div className="flex w-full flex-col gap-[8px]">
        <span className="text-[12px] text-muted">Pay with any of these in Mayar</span>
        <div className="flex gap-[6px]">
          <Chip icon={QrCode}>QRIS</Chip>
          <Chip icon={Landmark}>Virtual account</Chip>
          <Chip icon={Smartphone}>E-wallet</Chip>
          <Chip icon={CreditCard}>Card</Chip>
        </div>
      </div>
      <span className="text-[12px] text-muted">You can close this. We’ll notify you when it’s paid.</span>
    </DialogCard>
  )
}
