import { ExternalLink, Minus, Plus, UserPlus } from 'lucide-react'
import { DialogCard, PenButton, SumRow } from '../ControlPanelShared'

const BAR = [
  ...Array(4).fill('var(--color-ink)'),
  'var(--color-spark)',
  'var(--color-ok)',
  'var(--color-ok)',
  ...Array(8).fill('var(--color-line-strong)'),
] as string[]

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-[5px]">
      <span className="size-[8px] rounded-[2px]" style={{ background: color }} />
      <span className="text-[11.5px] text-muted">{label}</span>
    </span>
  )
}

/** pen rWvit · Members · Add seats */
export function DialogAddSeats({ onClose, onPay }: { onClose: () => void; onPay?: () => void }) {
  return (
    <DialogCard
      width={480}
      icon={UserPlus}
      title="Add seats to Team"
      sub="Anyone you invite as a member or admin uses a seat."
      onClose={onClose}
      footer={
        <>
          <PenButton fs={13} onClick={onClose}>Cancel</PenButton>
          <div className="h-px flex-1" />
          <PenButton variant="primary" fs={13} icon={ExternalLink} onClick={onPay}>Pay Rp 77 rb with Mayar</PenButton>
        </>
      }
    >
      <div className="flex w-full items-center gap-[12px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[13px] font-semibold text-ink">Extra seats</span>
          <span className="text-[12px] text-muted">7 of 15 seats on Team after this</span>
        </div>
        <div className="flex h-[34px] items-center rounded-base outline-1 -outline-offset-1 outline-line-strong">
          <button type="button" aria-label="Fewer seats" className="flex size-[34px] items-center justify-center">
            <Minus size={15} aria-hidden className="text-ink-2" />
          </button>
          <span className="flex h-[34px] w-[44px] items-center justify-center font-mono text-[15px] font-medium text-ink shadow-[inset_1px_0_0_var(--color-line-strong),inset_-1px_0_0_var(--color-line-strong)]">
            2
          </span>
          <button type="button" aria-label="More seats" className="flex size-[34px] items-center justify-center">
            <Plus size={15} aria-hidden className="text-ink-2" />
          </button>
        </div>
      </div>
      <div className="flex w-full flex-col gap-[6px]">
        <div className="flex h-[8px] w-full gap-[3px]">
          {BAR.map((c, i) => (
            <span key={i} className="h-[8px] flex-1 rounded-[2px]" style={{ background: c }} />
          ))}
        </div>
        <div className="flex gap-[12px]">
          <Legend color="var(--color-ink)" label="4 people" />
          <Legend color="var(--color-spark)" label="1 pending" />
          <Legend color="var(--color-ok)" label="2 new" />
          <Legend color="var(--color-line-strong)" label="8 more available" />
        </div>
      </div>
      <div className="flex w-full flex-col overflow-hidden rounded-md outline-1 -outline-offset-1 outline-line-strong">
        <SumRow first label="Team plan · 5 seats included" value="Rp 2 jt" />
        <SumRow label="2 extra seats × Rp 150 rb" value="Rp 300 rb" />
        <SumRow soft strong label="Monthly from Nov 1" value="Rp 2,3 jt" />
        <SumRow soft label="Due today · prorated, 8 days left" value="Rp 77 rb" />
      </div>
      <span className="text-[12px] text-muted">Remove a seat any time. Unused days are credited on your next invoice.</span>
    </DialogCard>
  )
}
