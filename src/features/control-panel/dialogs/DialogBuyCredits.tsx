import { Toggle, Modal } from '../legacyShared'
import { Button } from '../../../ui/ds/Button'

interface Props {
  onClose: () => void
}

const PACKS = [
  { credits: 2000, label: '2,000 credits', sub: 'About 3 weeks · small team', price: 'Rp 100 rb', selected: false },
  { credits: 5000, label: '5,000 credits', sub: 'About 2 months · most popular', price: 'Rp 238 rb', badge: 'Save 6%', selected: true },
  { credits: 20000, label: '20,000 credits', sub: 'For busy teams', price: 'Rp 800 rb', badge: 'Save 22%', selected: false },
]

export function DialogBuyCredits({ onClose }: Props) {
  return (
    <Modal
      title="Buy credits"
      subtitle="Top-up credits never expire and are used after your monthly plan credits."
      width={440}
      onClose={onClose}
      footer={
        <>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[14px] font-semibold text-ink">Rp 238 rb</span>
            <span className="text-[11.5px] text-muted">Paid through Mayar · QRIS, vA, card</span>
          </div>
          <Button variant="secondary" height={30} onClick={onClose}>Cancel</Button>
          <Button variant="primary" height={30}>Pay with Mayar</Button>
        </>
      }
    >
      <div className="flex flex-col gap-[16px]">
        <div>
          <p className="mb-[8px] text-[12px] font-medium text-muted">Pick a pack</p>
          <div className="flex flex-col gap-[6px]">
            {PACKS.map((p) => (
              <label
                key={p.credits}
                className={`flex cursor-pointer items-center gap-[10px] rounded-base border p-[12px] ${
                  p.selected ? 'border-ink bg-surface' : 'border-line-strong bg-soft'
                }`}
              >
                <span className={`flex size-[16px] shrink-0 items-center justify-center rounded-full border-2 ${p.selected ? 'border-ink bg-ink' : 'border-line-strong bg-surface'}`}>
                  {p.selected && <span className="size-[6px] rounded-full bg-white" />}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="text-[13px] font-semibold text-ink">{p.label}</span>
                  <span className="text-[12px] text-muted">{p.sub}</span>
                </div>
                {p.badge && (
                  <span className="rounded-pill bg-ok-tint border border-ok-line px-[6px] py-[1px] text-[10.5px] text-ok">{p.badge}</span>
                )}
                <span className="text-[13px] font-semibold text-ink">{p.price}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Auto top-up */}
        <div className="flex items-center gap-[10px] rounded-lg border border-line-strong bg-soft px-[14px] py-[10px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
            <p className="text-[13px] font-semibold text-ink">Auto top-up</p>
            <p className="text-[12px] text-muted">When credits drop below 500, buy 5,000 more automatically. Max once a week.</p>
          </div>
          <Toggle on={false} />
        </div>

        {/* Monthly cap */}
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Monthly spending cap</p>
          <div className="flex h-[34px] items-center rounded-base border border-line-strong bg-soft px-[12px] text-[13px] text-ink">
            Rp 1 jt
          </div>
          <p className="mt-[4px] text-[11.5px] text-muted">Helpers pause and ask you before going over this.</p>
        </div>
      </div>
    </Modal>
  )
}
