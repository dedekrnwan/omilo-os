import { Minus, Plus } from 'lucide-react'
import { Modal } from '../ControlPanelShared'

interface Props {
  onClose: () => void
}

export function DialogAddSeats({ onClose }: Props) {
  return (
    <Modal
      title="Add seats to Team"
      subtitle="Anyone you invite as a member or admin uses a seat."
      width={420}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="flex h-[30px] items-center gap-[6px] rounded-btn bg-ink px-[12px] text-[12.5px] font-medium text-white hover:bg-primary-hover transition-colors"
        >
          💳 Pay Rp 77 rb with Mayar
        </button>
      }
    >
      <div className="flex flex-col gap-[20px]">
        {/* Stepper */}
        <div>
          <p className="mb-[8px] text-[12.5px] font-medium text-ink">Extra seats</p>
          <div className="flex items-center gap-[12px]">
            <button type="button" className="flex size-[28px] items-center justify-center rounded-sm border border-line-strong bg-surface text-muted hover:bg-hover">
              <Minus size={14} aria-hidden />
            </button>
            <span className="text-[20px] font-semibold text-ink">2</span>
            <button type="button" className="flex size-[28px] items-center justify-center rounded-sm border border-line-strong bg-surface text-muted hover:bg-hover">
              <Plus size={14} aria-hidden />
            </button>
            <span className="text-[12.5px] text-muted">7 of 15 seats on Team after this</span>
          </div>
          {/* Seat visualiser */}
          <div className="mt-[10px] flex h-[8px] gap-[2px]">
            {Array.from({ length: 15 }).map((_, i) => (
              <span
                key={i}
                className={`flex-1 rounded-sm ${
                  i < 4 ? 'bg-ink' : i === 4 ? 'bg-warn' : i < 7 ? 'bg-ok' : 'bg-line-strong'
                }`}
              />
            ))}
          </div>
          <div className="mt-[4px] flex gap-[10px] text-[11px] text-muted">
            <span className="flex items-center gap-[4px]"><span className="size-[6px] rounded-full bg-ink" />4 people</span>
            <span className="flex items-center gap-[4px]"><span className="size-[6px] rounded-full bg-warn" />1 pending</span>
            <span className="flex items-center gap-[4px]"><span className="size-[6px] rounded-full bg-ok" />2 new</span>
            <span className="flex items-center gap-[4px]"><span className="size-[6px] rounded-full bg-line-strong" />8 more available</span>
          </div>
        </div>

        {/* Pricing breakdown */}
        <div className="flex flex-col gap-[6px] rounded-lg border border-line-strong bg-soft px-[14px] py-[12px] text-[12.5px]">
          <div className="flex items-center justify-between">
            <span className="text-muted">Team plan · 5 seats included</span>
            <span className="text-ink">Rp 2 jt</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">2 extra seats × Rp 150 rb</span>
            <span className="text-ink">Rp 300 rb</span>
          </div>
          <div className="h-px bg-line-strong my-[4px]" />
          <div className="flex items-center justify-between font-semibold">
            <span className="text-ink">Monthly from Nov 1</span>
            <span className="text-ink">Rp 2,3 jt</span>
          </div>
          <div className="flex items-center justify-between text-muted text-[11.5px]">
            <span>Due today · prorated, 8 days left</span>
            <span>Rp 77 rb</span>
          </div>
        </div>

        <p className="text-[12px] text-muted">Remove a seat any time. Unused days are credited on your next invoice.</p>
      </div>
    </Modal>
  )
}
