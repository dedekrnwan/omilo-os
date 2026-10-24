import { Download } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane } from '../legacyShared'
import type { DialogKind } from '../legacyTypes'

const INVOICES = [
  { date: 'Oct 1, 2026', desc: 'Team plan · paid via QRIS', amount: 'Rp 2.000.000', status: 'Paid' },
  { date: 'Sep 1, 2026', desc: 'Team plan · paid via BCA virtual account', amount: 'Rp 2.000.000', status: 'Paid' },
  { date: 'Aug 1, 2026', desc: 'Starter plan · paid via GoPay', amount: 'Rp 500.000', status: 'Paid' },
]

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionUsage({ onDialog }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Usage & billing" />
        <div className="ml-auto">
          <Button variant="secondary" height={28} onClick={() => onDialog('change-plan')}>
            Change plan
          </Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Usage & billing</h1>
        <p className="mb-[24px] text-[13px] text-muted">Your plan, seats and what AI cost this month.</p>

        {/* Plan + Payments */}
        <div className="mb-[24px] grid grid-cols-2 gap-[12px]">
          <div className="rounded-lg border border-line-strong bg-surface p-[16px]">
            <p className="mb-[6px] text-[11px] font-medium uppercase tracking-[0.8px] text-faint">Plan</p>
            <p className="text-[20px] font-semibold text-ink">Team <span className="text-[14px] font-normal text-muted">Rp 2 jt / month</span></p>
            <p className="mt-[4px] text-[12px] text-muted">5 of 5 seats used · 1 pending · renews Nov 1</p>
          </div>
          <div className="rounded-lg border border-line-strong bg-surface p-[16px]">
            <p className="mb-[6px] text-[11px] font-medium uppercase tracking-[0.8px] text-faint">Payments</p>
            <div className="flex items-center gap-[6px]">
              <span className="text-[18px]">💳</span>
              <span className="text-[15px] font-semibold text-ink">Mayar</span>
            </div>
            <p className="mt-[4px] text-[12px] text-muted">QRIS, virtual account, e-wallet or card · receipts to billing@saga.co.id</p>
          </div>
        </div>

        {/* AI usage */}
        <p className="mb-[4px] text-[13px] font-medium text-ink">AI usage this month</p>
        <p className="mb-[10px] text-[12px] text-muted">Billed at cost through your AI accounts — not part of the plan.</p>
        <div className="mb-[8px] flex items-end gap-[6px]">
          <span className="text-[32px] font-semibold text-ink">$182</span>
          <span className="mb-[4px] text-[13px] text-muted">of $400 budget · 1,284 runs</span>
        </div>
        <div className="mb-[4px] h-[6px] overflow-hidden rounded-full bg-line-strong">
          <div className="flex h-full">
            <div className="h-full bg-[#6366F1]" style={{ width: '35%' }} />
            <div className="h-full bg-[#0EA5E9]" style={{ width: '28%' }} />
            <div className="h-full bg-[#14B8A6]" style={{ width: '15%' }} />
          </div>
        </div>
        <div className="mb-[24px] flex gap-[12px] text-[11.5px] text-muted">
          <span className="flex items-center gap-[4px]"><span className="size-[8px] rounded-full bg-[#6366F1]" />Chat $64</span>
          <span className="flex items-center gap-[4px]"><span className="size-[8px] rounded-full bg-[#0EA5E9]" />Flows $91</span>
          <span className="flex items-center gap-[4px]"><span className="size-[8px] rounded-full bg-[#14B8A6]" />Knowledge $27</span>
        </div>

        {/* Invoices */}
        <p className="mb-[10px] text-[13px] font-semibold text-ink">Invoices</p>
        <div className="overflow-hidden rounded-lg border border-line-strong bg-surface">
          {INVOICES.map((inv, i) => (
            <div
              key={inv.date}
              className={`flex items-center gap-[12px] px-[16px] py-[12px] ${i < INVOICES.length - 1 ? 'border-b border-line' : ''}`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[13px] font-medium text-ink">{inv.date}</span>
                <span className="text-[12px] text-muted">{inv.desc}</span>
              </div>
              <span className="text-[13px] font-medium text-ink">{inv.amount}</span>
              <span className="rounded-pill bg-ok-tint px-[8px] py-[2px] text-[11px] font-medium text-ok">{inv.status}</span>
              <button type="button" aria-label="Download invoice" className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover">
                <Download size={14} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </SectionPane>
    </div>
  )
}
