import { Eye, Mail, Moon, Rocket, UserPlus } from 'lucide-react'
import { Chip, DialogCard, PenButton } from '../ControlPanelShared'

function Lines({ lines }: { lines: string[] }) {
  return (
    <div className="flex w-full flex-1 flex-col gap-[5px]">
      {lines.map((l) => (
        <span key={l} className="text-[12.5px] text-ink-2">{l}</span>
      ))}
    </div>
  )
}

/** pen Wy7PQ · Members · Plan maximum reached */
export function DialogPlanMax({ onClose }: { onClose: () => void }) {
  return (
    <DialogCard
      width={560}
      icon={UserPlus}
      title="Team tops out at 15 seats"
      sub="To invite maya@sahabatwarga.id as a member, pick one:"
      onClose={onClose}
      bodyGap={12}
      footer={
        <>
          <PenButton fs={13} onClick={onClose}>Cancel</PenButton>
          <button type="button" className="min-w-0 flex-1 text-center text-[12px] text-link">
            Compare plans in Usage & billing
          </button>
        </>
      }
    >
      <div className="flex h-[155px] w-full gap-[10px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[10px] rounded-lg p-[14px] outline-[1.5px] -outline-offset-[1.5px] outline-ink">
          <div className="flex w-full items-center gap-[8px]">
            <Rocket size={16} aria-hidden className="text-ink" />
            <span className="text-[13px] font-semibold text-ink">Business</span>
            <div className="h-px flex-1" />
            <Chip>Recommended</Chip>
          </div>
          <Lines lines={['20 seats included, add more any time', 'SSO and audit log', 'Rp 6 jt / month · prorated today']} />
          <PenButton variant="primary" h={30} fs={13} className="w-full">Upgrade & invite</PenButton>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-[10px] rounded-lg p-[14px] outline-1 -outline-offset-1 outline-line-strong">
          <div className="flex w-full items-center gap-[8px]">
            <Eye size={16} aria-hidden className="text-ink" />
            <span className="text-[13px] font-semibold text-ink">Invite as Viewer</span>
          </div>
          <Lines lines={['Free, doesn’t use a seat', 'Reads goals, docs and runs', 'Promote when a seat opens']} />
          <PenButton h={30} fs={13} className="w-full">Invite as Viewer</PenButton>
        </div>
      </div>
      <div className="flex w-full flex-col gap-[8px] rounded-md bg-soft px-[14px] py-[12px]">
        <span className="text-[12.5px] font-semibold text-ink">Or free a seat</span>
        <div className="flex w-full items-center gap-[8px]">
          <Mail size={14} aria-hidden className="text-muted" />
          <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">andi@saga.co.id — invite pending 6 days</span>
          <PenButton variant="quiet" h={26} fs={12.5}>Revoke</PenButton>
        </div>
        <div className="flex w-full items-center gap-[8px]">
          <Moon size={14} aria-hidden className="text-muted" />
          <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">2 members inactive for 30+ days</span>
          <PenButton variant="quiet" h={26} fs={12.5}>Review</PenButton>
        </div>
      </div>
    </DialogCard>
  )
}
