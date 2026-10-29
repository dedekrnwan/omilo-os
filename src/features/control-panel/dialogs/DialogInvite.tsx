import { useState } from 'react'
import { Armchair, CircleCheck, Copy, Hash, Link, Send, Shield, UserPlus, X } from 'lucide-react'
import { DialogCard, Field, PenButton, Radio } from '../ControlPanelShared'
import { useSession } from '../../../app/session'

const ROLE_OPTIONS = ['Member', 'Admin', 'Viewer']
const CHANNEL_OPTIONS = ['Engineering, General', 'General', 'Engineering', 'All channels']

function EmailChip({ email }: { email: string }) {
  return (
    <span className="flex items-center gap-[4px] rounded-sm bg-soft py-[4px] pr-[6px] pl-[8px] outline-1 -outline-offset-1 outline-line">
      <span className="text-[12.5px] text-ink-2">{email}</span>
      <X size={12} aria-hidden className="text-muted" />
    </span>
  )
}

function Option({ on, title, sub, right }: { on?: boolean; title: string; sub: string; right?: string }) {
  return (
    <div
      className={`flex w-full gap-[10px] rounded-base bg-surface px-[12px] py-[10px] ${
        on ? 'outline-[1.5px] -outline-offset-[1.5px] outline-ink' : 'outline-1 -outline-offset-1 outline-line-strong'
      }`}
    >
      <Radio on={on} />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13px] font-medium text-ink">{title}</span>
        <span className="text-[12px] text-muted">{sub}</span>
      </div>
      {right && <span className="font-mono text-[11.5px] text-muted">{right}</span>}
    </div>
  )
}

/** pen aNKDy · Members · Invite — and iKSyB · Seats full (`seatsFull`). */
export function DialogInvite({ onClose, seatsFull }: { onClose: () => void; seatsFull?: boolean }) {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const [role, setRole] = useState('Member')
  const [channels, setChannels] = useState('Engineering, General')
  return (
    <DialogCard
      width={520}
      icon={UserPlus}
      title={`Invite people to ${companyName}`}
      sub="They get an email and can join with Google or a magic link."
      onClose={onClose}
      footer={
        <>
          <PenButton fs={13} onClick={onClose}>Cancel</PenButton>
          <span className="min-w-0 flex-1 text-center text-[12px] text-muted">
            {seatsFull ? 'Paid through Mayar' : 'Invites expire in 7 days'}
          </span>
          <PenButton variant="primary" fs={13} icon={Send}>
            {seatsFull ? 'Add 2 seats & send' : 'Send 2 invites'}
          </PenButton>
        </>
      }
    >
      <div className="flex w-full flex-col gap-[6px]">
        <span className="text-[13px] font-medium text-ink-2">Emails</span>
        <div className="flex w-full items-center gap-[6px] rounded-base p-[8px] outline-1 -outline-offset-1 outline-faint">
          <EmailChip email="rina@sahabatwarga.id" />
          <EmailChip email="budi@sahabatwarga.id" />
          <span className="text-[13px] text-faint">add more…</span>
        </div>
      </div>
      <div className="flex w-full gap-[12px]">
        <Field className="min-w-0 flex-1" width="auto" label="Role" icon={Shield} value={role} onChange={setRole} options={ROLE_OPTIONS} fs={13} select />
        <Field className="min-w-0 flex-1" width="auto" label="Channels" icon={Hash} value={channels} onChange={setChannels} options={CHANNEL_OPTIONS} fs={13} select />
      </div>

      {seatsFull ? (
        <div className="flex w-full flex-col gap-[10px] rounded-md bg-warn-tint p-[14px] outline-1 -outline-offset-1 outline-warn-line">
          <div className="flex w-full items-center gap-[8px]">
            <Armchair size={15} aria-hidden className="text-warn" />
            <span className="text-[13px] font-semibold text-warn">No seats left for these 2 invites</span>
            <div className="h-px flex-1" />
            <span className="font-mono text-[11.5px] text-warn">5 of 5 used</span>
          </div>
          <span className="text-[12.5px] text-ink-2">Members and admins each take a seat. Choose how to make room:</span>
          <div className="flex w-full flex-col gap-[6px]">
            <Option on title="Add 2 seats" sub="+Rp 300 rb / month · Rp 77 rb today, prorated" right="7 of 15" />
            <Option title="Invite them as Viewers" sub="Free. Read-only — promote them when a seat opens" />
            <Option title="Upgrade to Business" sub="20 seats included · Rp 6 jt / month" />
          </div>
        </div>
      ) : (
        <div className="flex w-full items-center gap-[10px] rounded-md bg-ok-tint px-[14px] py-[12px] outline-1 -outline-offset-1 outline-ok-line">
          <CircleCheck size={16} aria-hidden className="text-ok" />
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[13px] font-semibold text-ink">Seats available</span>
            <span className="text-[12px] text-ink-2">These 2 invites use 2 of your 3 free seats. No extra charge.</span>
          </div>
          <span className="font-mono text-[11px] font-medium text-ok">5 of 8 used</span>
        </div>
      )}

      <div className="flex w-full items-center gap-[10px]">
        <Link size={14} aria-hidden className="text-muted" />
        <span className="min-w-0 flex-1 text-[12.5px] text-muted">Or share an invite link · expires in 7 days</span>
        <PenButton variant="quiet" h={28} fs={13} icon={Copy}>Copy link</PenButton>
      </div>
    </DialogCard>
  )
}
